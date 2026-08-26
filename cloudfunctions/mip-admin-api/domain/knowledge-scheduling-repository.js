'use strict'

const { createHash, randomBytes, randomUUID } = require('node:crypto')
const { CAPABILITIES, capabilitiesForBinding } = require('./capabilities')
const { nextDailyRunAt } = require('./knowledge-scheduling-time')

const MAX_SOURCES_PER_RUN = 3
const MAX_SOURCE_ATTEMPTS = 3
const DEFAULT_LEASE_MS = 2 * 60 * 1000
const DEFAULT_RETRY_DELAY_MS = 15 * 60 * 1000

function createKnowledgeSchedulingRepository(database, options = {}) {
  if (!database
    || typeof database.one !== 'function'
    || typeof database.query !== 'function'
    || typeof database.transaction !== 'function') {
    throw new TypeError('KNOWLEDGE_SCHEDULING_DATABASE_INVALID')
  }
  const createId = options.id || randomUUID
  const createLeaseToken = options.leaseToken || (() => randomBytes(32).toString('hex'))
  const now = options.now || (() => new Date())
  const leaseMs = boundedInteger(options.leaseMs, DEFAULT_LEASE_MS, 30_000, 5 * 60 * 1000)
  const retryDelayMs = boundedInteger(
    options.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS,
    60_000,
    6 * 60 * 60 * 1000,
  )

  async function getWakePlan(input) {
    const appId = requiredAppId(input?.appId)
    const row = await database.one(
      `SELECT MIN(
         CASE
           WHEN leased_until IS NOT NULL AND leased_until > UTC_TIMESTAMP(3)
             THEN GREATEST(next_run_at, leased_until)
           ELSE next_run_at
         END
       ) AS next_wake_at,
       COUNT(*) AS active_count
       FROM mip_knowledge_ingestion_schedules
       WHERE app_id = ? AND status = 'ACTIVE'`,
      [appId],
    )
    return {
      activeCount: Number(row?.active_count || 0),
      nextWakeAt: roundedWakeAt(row?.next_wake_at),
    }
  }

  async function claimDue(input) {
    const appId = requiredAppId(input?.appId)
    const limit = boundedInteger(input?.limit, MAX_SOURCES_PER_RUN, 1, MAX_SOURCES_PER_RUN)
    return database.transaction(async (tx) => {
      const currentTime = validDate(now())
      const reconciled = await reconcileExpiredLeases(
        tx,
        appId,
        currentTime,
        limit,
        retryDelayMs,
      )
      const candidates = await tx.query(
        `SELECT schedule.id, schedule.source_id, schedule.category_id,
                schedule.daily_time, schedule.timezone, schedule.next_run_at,
                schedule.attempt_count, schedule.configured_by_user_id, schedule.version,
                source.source_type, source.endpoint_url, source.fetch_config_json
         FROM mip_knowledge_ingestion_schedules schedule
         INNER JOIN mip_knowledge_sources source
           ON source.app_id = schedule.app_id AND source.id = schedule.source_id
         WHERE schedule.app_id = ? AND schedule.status = 'ACTIVE'
           AND schedule.next_run_at <= ?
           AND (schedule.leased_until IS NULL OR schedule.leased_until <= ?)
         ORDER BY schedule.next_run_at, schedule.id
         LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, currentTime, currentTime, limit],
      )
      const claims = []
      for (const candidate of candidates) {
        const leaseToken = createLeaseToken()
        const leasedUntil = new Date(currentTime.getTime() + leaseMs)
        const attempt = Math.min(Number(candidate.attempt_count || 0) + 1, MAX_SOURCE_ATTEMPTS)
        const updated = await tx.query(
          `UPDATE mip_knowledge_ingestion_schedules
           SET attempt_count = ?, lease_token = ?, lease_due_at = next_run_at,
             leased_until = ?, last_started_at = ?, last_error_code = NULL,
             version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status = 'ACTIVE'
             AND (leased_until IS NULL OR leased_until <= ?)`,
          [attempt, leaseToken, leasedUntil, currentTime, appId, candidate.id,
            Number(candidate.version), currentTime],
        )
        if (Number(updated.affectedRows) !== 1) continue
        claims.push({
          appId,
          attempt,
          categoryId: candidate.category_id,
          configuredByUserId: candidate.configured_by_user_id,
          dailyTime: candidate.daily_time,
          dueAt: validDate(candidate.next_run_at),
          fetchConfig: json(candidate.fetch_config_json),
          leaseToken,
          leasedUntil,
          scheduleId: candidate.id,
          sourceId: candidate.source_id,
          sourceType: candidate.source_type,
          endpointUrl: candidate.endpoint_url,
          timeZone: candidate.timezone,
          version: Number(candidate.version) + 1,
        })
      }
      return { claims, reconciled }
    })
  }

  async function completeSuccess(claim, items) {
    const normalizedItems = Array.isArray(items) ? items.slice(0, 50) : []
    if (!normalizedItems.length) throw codeError('KNOWLEDGE_SOURCE_RESPONSE_INVALID')
    return database.transaction(async (tx) => {
      const currentTime = validDate(now())
      const schedule = await lockClaim(tx, claim, currentTime)
      if (!schedule) return { status: 'LEASE_LOST' }
      const grant = await lockRunnableFacts(tx, schedule)
      if (!grant) throw codeError('KNOWLEDGE_SCHEDULE_AUTH_REVOKED')

      const idempotencyKey = workerRunKey(schedule, claim)
      const requestHash = createHash('sha256').update(JSON.stringify({
        categoryId: schedule.category_id,
        items: normalizedItems,
        scheduleId: schedule.id,
        sourceId: schedule.source_id,
      })).digest('hex')
      const replay = await tx.one(
        `SELECT id, request_hash, status, fetched_count, created_count,
                duplicate_count, rejected_count
         FROM mip_knowledge_ingestion_runs
         WHERE app_id = ? AND source_id = ? AND idempotency_key = ? FOR UPDATE`,
        [schedule.app_id, schedule.source_id, idempotencyKey],
      )
      if (replay && replay.request_hash !== requestHash) throw codeError('IDEMPOTENCY_CONFLICT')

      let result
      if (replay) {
        if (replay.status !== 'COMPLETED') throw codeError('KNOWLEDGE_SCHEDULE_OUTCOME_UNKNOWN')
        result = ingestionRunDto(replay)
      }
      else {
        result = await insertSuccessfulRun(tx, {
          createId,
          currentTime,
          idempotencyKey,
          items: normalizedItems,
          requestHash,
          schedule,
        })
      }

      const nextRunAt = nextDailyRunAt({
        after: currentTime,
        dailyTime: schedule.daily_time,
        timeZone: schedule.timezone,
      })
      const completed = await tx.query(
        `UPDATE mip_knowledge_ingestion_schedules
         SET next_run_at = ?, attempt_count = 0, lease_token = NULL,
           lease_due_at = NULL, leased_until = NULL, last_run_id = ?,
           last_completed_at = ?, last_error_code = NULL, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND lease_token = ?`,
        [nextRunAt, result.id, currentTime, schedule.app_id, schedule.id,
          Number(schedule.version), schedule.lease_token],
      )
      if (Number(completed.affectedRows) !== 1) throw codeError('KNOWLEDGE_SCHEDULE_LEASE_LOST')
      await writeSystemAudit(tx, {
        action: 'system.knowledge.ingestion.completed',
        appId: schedule.app_id,
        actorUserId: schedule.configured_by_user_id,
        effectiveRole: grant.role_key,
        metadata: {
          attempt: Number(schedule.attempt_count),
          created: result.createdCount,
          duplicate: result.duplicateCount,
          rejected: result.rejectedCount,
        },
        resourceId: result.id,
      })
      return { ...result, nextRunAt: nextRunAt.toISOString(), status: 'COMPLETED' }
    })
  }

  async function completeFailure(claim, errorCode) {
    const safeErrorCode = publicErrorCode(errorCode)
    return database.transaction(async (tx) => {
      const currentTime = validDate(now())
      const schedule = await lockClaim(tx, claim, currentTime)
      if (!schedule) return { status: 'LEASE_LOST' }
      const exhausted = Number(schedule.attempt_count) >= MAX_SOURCE_ATTEMPTS
      const nextRunAt = exhausted
        ? nextDailyRunAt({
            after: currentTime,
            dailyTime: schedule.daily_time,
            timeZone: schedule.timezone,
          })
        : new Date(currentTime.getTime() + retryDelayMs)
      const run = await insertFailedRun(tx, {
        createId,
        currentTime,
        errorCode: safeErrorCode,
        schedule,
      })
      const updated = await tx.query(
        `UPDATE mip_knowledge_ingestion_schedules
         SET next_run_at = ?, attempt_count = ?, lease_token = NULL,
           lease_due_at = NULL, leased_until = NULL, last_run_id = ?,
           last_completed_at = ?, last_error_code = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND lease_token = ?`,
        [nextRunAt, exhausted ? 0 : Number(schedule.attempt_count), run.id,
          currentTime, safeErrorCode, schedule.app_id, schedule.id,
          Number(schedule.version), schedule.lease_token],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('KNOWLEDGE_SCHEDULE_LEASE_LOST')
      await writeSystemAudit(tx, {
        action: 'system.knowledge.ingestion.failed',
        appId: schedule.app_id,
        actorUserId: schedule.configured_by_user_id,
        effectiveRole: null,
        metadata: {
          attempt: Number(schedule.attempt_count),
          errorCode: safeErrorCode,
          retryDisposition: exhausted ? 'NEXT_DAY' : 'RETRY',
        },
        resourceId: run.id,
      })
      return {
        errorCode: safeErrorCode,
        nextRunAt: nextRunAt.toISOString(),
        retryDisposition: exhausted ? 'NEXT_DAY' : 'RETRY',
        status: 'FAILED',
      }
    })
  }

  async function validateClaim(claim) {
    return database.transaction(async (tx) => {
      const schedule = await lockClaim(tx, claim, validDate(now()))
      if (!schedule) return { status: 'LEASE_LOST' }
      const grant = await lockRunnableFacts(tx, schedule)
      return grant
        ? { effectiveRole: grant.role_key, status: 'RUNNABLE' }
        : { status: 'BLOCKED' }
    })
  }

  return { claimDue, completeFailure, completeSuccess, getWakePlan, validateClaim }
}

async function reconcileExpiredLeases(tx, appId, currentTime, limit, retryDelayMs) {
  const rows = await tx.query(
    `SELECT id, daily_time, timezone, attempt_count, version
     FROM mip_knowledge_ingestion_schedules
     WHERE app_id = ? AND status = 'ACTIVE' AND leased_until <= ?
     ORDER BY leased_until, id LIMIT ? FOR UPDATE SKIP LOCKED`,
    [appId, currentTime, limit],
  )
  for (const row of rows) {
    const exhausted = Number(row.attempt_count) >= MAX_SOURCE_ATTEMPTS
    const nextRunAt = exhausted
      ? nextDailyRunAt({ after: currentTime, dailyTime: row.daily_time, timeZone: row.timezone })
      : new Date(currentTime.getTime() + retryDelayMs)
    await tx.query(
      `UPDATE mip_knowledge_ingestion_schedules
       SET next_run_at = ?, attempt_count = ?, lease_token = NULL,
         lease_due_at = NULL, leased_until = NULL,
         last_error_code = 'KNOWLEDGE_SCHEDULE_LEASE_EXPIRED', version = version + 1
       WHERE app_id = ? AND id = ? AND version = ? AND leased_until <= ?`,
      [nextRunAt, exhausted ? 0 : Number(row.attempt_count), appId, row.id,
        Number(row.version), currentTime],
    )
  }
  return rows.length
}

async function lockClaim(tx, claim, currentTime) {
  if (!claim || typeof claim !== 'object') return null
  const row = await tx.one(
    `SELECT schedule.*, source.source_type, source.endpoint_url, source.fetch_config_json,
            source.status AS source_status, category.status AS category_status,
            user.status AS configurer_status
     FROM mip_knowledge_ingestion_schedules schedule
     INNER JOIN mip_knowledge_sources source
       ON source.app_id = schedule.app_id AND source.id = schedule.source_id
     INNER JOIN mip_knowledge_categories category
       ON category.app_id = schedule.app_id AND category.id = schedule.category_id
     INNER JOIN mip_users user
       ON user.app_id = schedule.app_id AND user.id = schedule.configured_by_user_id
     WHERE schedule.app_id = ? AND schedule.id = ? FOR UPDATE`,
    [claim.appId, claim.scheduleId],
  )
  if (!row
    || row.status !== 'ACTIVE'
    || row.lease_token !== claim.leaseToken
    || Number(row.version) !== Number(claim.version)
    || new Date(row.leased_until).getTime() <= currentTime.getTime()) {
    return null
  }
  return row
}

async function lockRunnableFacts(tx, schedule) {
  if (schedule.source_status !== 'ACTIVE'
    || !['JSON_FEED', 'RSS'].includes(schedule.source_type)
    || schedule.category_status !== 'ACTIVE'
    || schedule.configurer_status !== 'ACTIVE') {
    return null
  }
  const rows = await tx.query(
    `SELECT binding.role_key, binding.scope_type, binding.scope_id, binding.status,
            CASE WHEN policy.policy_mode = 'CUSTOM' THEN policy.capabilities_json ELSE NULL END
              AS policy_capabilities_json
     FROM mip_admin_role_bindings binding
     LEFT JOIN mip_role_capability_policies policy
       ON policy.app_id = binding.app_id AND policy.role_key = binding.role_key
     WHERE binding.app_id = ? AND binding.user_id = ?
     ORDER BY binding.role_key FOR UPDATE`,
    [schedule.app_id, schedule.configured_by_user_id],
  )
  return rows.find((row) => row.status === 'ACTIVE'
    && row.scope_type === 'PLATFORM'
    && capabilitiesForBinding({
      roleKey: row.role_key,
      policyCapabilities: row.policy_capabilities_json,
    }).includes(CAPABILITIES.KNOWLEDGE_MANAGE)) || null
}

async function insertSuccessfulRun(tx, input) {
  const runId = input.createId()
  await tx.query(
    `INSERT INTO mip_knowledge_ingestion_runs (
      id, app_id, source_id, idempotency_key, request_hash, trigger_type,
      status, fetched_count, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, 'WORKER', 'RUNNING', ?, ?)`,
    [runId, input.schedule.app_id, input.schedule.source_id, input.idempotencyKey,
      input.requestHash, input.items.length, input.schedule.configured_by_user_id],
  )
  let created = 0
  let duplicate = 0
  let rejected = 0
  for (const item of input.items) {
    const stored = await tx.one(
      `SELECT id FROM mip_knowledge_contents
       WHERE app_id = ? AND (source_content_hash = ?
         OR (source_id = ? AND source_external_id = ?)) LIMIT 1 FOR UPDATE`,
      [input.schedule.app_id, item.contentHash, input.schedule.source_id, item.externalId],
    )
    const itemId = input.createId()
    if (stored) {
      duplicate += 1
      await insertIngestionItem(tx, input.schedule, runId, itemId, item, 'DUPLICATE', stored.id, null)
      continue
    }
    if (!item.title || !item.bodyText) {
      rejected += 1
      await insertIngestionItem(tx, input.schedule, runId, itemId, item, 'REJECTED', null, 'INVALID_ITEM')
      continue
    }
    const contentId = input.createId()
    await tx.query(
      `INSERT INTO mip_knowledge_contents (
        id, app_id, source_id, category_id, content_type, title, summary, body_text,
        external_url, author_name, access_type, source_external_id, source_content_hash,
        source_published_at, status, content_safety_status, created_by_user_id, updated_by_user_id
      ) VALUES (?, ?, ?, ?, 'HOT_NEWS', ?, ?, ?, ?, ?, 'FREE', ?, ?, ?,
        'PENDING_REVIEW', 'PENDING', ?, ?)`,
      [contentId, input.schedule.app_id, input.schedule.source_id, input.schedule.category_id,
        item.title, item.summary, item.bodyText, item.externalUrl, item.authorName,
        item.externalId, item.contentHash, item.publishedAt,
        input.schedule.configured_by_user_id, input.schedule.configured_by_user_id],
    )
    await insertIngestionItem(tx, input.schedule, runId, itemId, item, 'CREATED', contentId, null)
    created += 1
  }
  await tx.query(
    `UPDATE mip_knowledge_ingestion_runs
     SET status = 'COMPLETED', created_count = ?, duplicate_count = ?,
       rejected_count = ?, completed_at = ?
     WHERE app_id = ? AND id = ? AND status = 'RUNNING'`,
    [created, duplicate, rejected, input.currentTime, input.schedule.app_id, runId],
  )
  await tx.query(
    `UPDATE mip_knowledge_sources
     SET last_fetched_at = ?, updated_by_user_id = ?, version = version + 1
     WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
    [input.currentTime, input.schedule.configured_by_user_id,
      input.schedule.app_id, input.schedule.source_id],
  )
  return {
    createdCount: created,
    duplicateCount: duplicate,
    fetchedCount: input.items.length,
    id: runId,
    rejectedCount: rejected,
  }
}

async function insertFailedRun(tx, input) {
  const idempotencyKey = workerRunKey(input.schedule, input.schedule)
  const requestHash = createHash('sha256').update(JSON.stringify({
    attempt: Number(input.schedule.attempt_count),
    categoryId: input.schedule.category_id,
    errorCode: input.errorCode,
    scheduleId: input.schedule.id,
    sourceId: input.schedule.source_id,
  })).digest('hex')
  const replay = await tx.one(
    `SELECT id, request_hash FROM mip_knowledge_ingestion_runs
     WHERE app_id = ? AND source_id = ? AND idempotency_key = ? FOR UPDATE`,
    [input.schedule.app_id, input.schedule.source_id, idempotencyKey],
  )
  if (replay) {
    if (replay.request_hash !== requestHash) throw codeError('IDEMPOTENCY_CONFLICT')
    return replay
  }
  const runId = input.createId()
  await tx.query(
    `INSERT INTO mip_knowledge_ingestion_runs (
      id, app_id, source_id, idempotency_key, request_hash, trigger_type,
      status, fetched_count, last_error_code, completed_at, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, 'WORKER', 'FAILED', 0, ?, ?, ?)`,
    [runId, input.schedule.app_id, input.schedule.source_id, idempotencyKey,
      requestHash, input.errorCode, input.currentTime, input.schedule.configured_by_user_id],
  )
  return { id: runId }
}

async function insertIngestionItem(tx, schedule, runId, itemId, item, result, contentId, errorCode) {
  await tx.query(
    `INSERT INTO mip_knowledge_ingestion_items (
      id, app_id, run_id, source_id, source_external_id, source_url,
      content_hash, result, content_id, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [itemId, schedule.app_id, runId, schedule.source_id, item.externalId,
      item.externalUrl, item.contentHash, result, contentId, errorCode],
  )
}

async function writeSystemAudit(tx, input) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'SYSTEM', 'PLATFORM', NULL, ?, 'KNOWLEDGE_INGESTION_RUN', ?, ?, ?)`,
    [input.appId, input.actorUserId, input.action, input.resourceId,
      input.effectiveRole, JSON.stringify(input.metadata || {})],
  )
}

function workerRunKey(schedule, claim) {
  const due = validDate(schedule.lease_due_at || claim.dueAt)
  const attempt = Number(schedule.attempt_count || claim.attempt)
  return `worker:${schedule.id || claim.scheduleId}:${due.getTime()}:${attempt}`
}

function ingestionRunDto(row) {
  return {
    createdCount: Number(row.created_count || 0),
    duplicateCount: Number(row.duplicate_count || 0),
    fetchedCount: Number(row.fetched_count || 0),
    id: row.id,
    rejectedCount: Number(row.rejected_count || 0),
  }
}

function roundedWakeAt(value) {
  if (!value) return null
  const date = validDate(value)
  if (date.getUTCMilliseconds() > 0) date.setTime(date.getTime() + 1000 - date.getUTCMilliseconds())
  date.setUTCMilliseconds(0)
  if (date.getUTCFullYear() >= 2100) throw codeError('KNOWLEDGE_SCHEDULE_WAKE_PLAN_INVALID')
  return date.toISOString()
}

function requiredAppId(value) {
  const result = String(value || '').trim()
  if (!/^wx[0-9a-f]{16}$/i.test(result)) throw codeError('VALIDATION_FAILED')
  return result
}

function validDate(value) {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(result.getTime())) throw codeError('VALIDATION_FAILED')
  return result
}

function json(value) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(value || '{}') }
  catch { return {} }
}

function publicErrorCode(value) {
  const code = String(value || '').trim()
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE'
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = {
  DEFAULT_LEASE_MS,
  DEFAULT_RETRY_DELAY_MS,
  MAX_SOURCES_PER_RUN,
  MAX_SOURCE_ATTEMPTS,
  createKnowledgeSchedulingRepository,
  roundedWakeAt,
  workerRunKey,
}
