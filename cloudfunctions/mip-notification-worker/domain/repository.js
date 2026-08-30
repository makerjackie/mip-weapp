'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { deliveryEvidenceRevision, normalizedDeliveryEvidence } = require('./delivery-evidence')

const MAX_ATTEMPTS = 5
const TASK_LEASE_MS = 2 * 60 * 1000
const RETRYABLE_PRE_PROVIDER_CODES = new Set([
  'CHANNEL_UNAVAILABLE',
  'GRANT_UNAVAILABLE',
  'TEMPLATE_MISSING',
])
const TERMINAL_PRE_PROVIDER_CODES = new Set([
  'CHANNEL_UNSUPPORTED',
  'DELIVERY_PAYLOAD_INVALID',
  'DELIVERY_RECIPIENT_INACTIVE',
  'DELIVERY_SENDER_INVALID',
  'DELIVERY_WINDOW_EXPIRED',
  'NOTIFICATION_RECIPIENT_INVALID',
])
const KNOWN_PROVIDER_FAILURE_CODES = new Set([
  'SERVICE_ACCOUNT_DELIVERY_REJECTED',
  'SERVICE_ACCOUNT_RATE_LIMITED',
  'WECHAT_DELIVERY_REJECTED',
  'WECHAT_PROVIDER_BUSY',
])
const RETRYABLE_PROVIDER_FAILURE_CODES = new Set([
  'SERVICE_ACCOUNT_RATE_LIMITED',
  'WECHAT_PROVIDER_BUSY',
])

function createNotificationRepository(database, options = {}) {
  const createId = options.createId || randomUUID

  async function publishMessage(appId, message) {
    return database.transaction(async (tx) => {
      const recipient = await tx.one(
        `SELECT id, status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
        [appId, message.recipientUserId],
      )
      if (!recipient || recipient.status !== 'ACTIVE') throw new Error('NOT_FOUND')
      const messageId = createId()
      await tx.query(
        `INSERT INTO mip_inbox_messages (
           id, app_id, recipient_user_id, message_type, title, body,
           target_type, target_id, target_route, dedupe_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE dedupe_key = VALUES(dedupe_key)`,
        [
          messageId,
          appId,
          message.recipientUserId,
          message.messageType,
          message.title,
          message.body,
          message.target?.type || null,
          message.target?.id || null,
          message.target?.route || null,
          message.dedupeKey,
        ],
      )
      const stored = await tx.one(
        `SELECT id, recipient_user_id, message_type, title, body, target_type,
                target_id, target_route, read_at, created_at
         FROM mip_inbox_messages
         WHERE app_id = ? AND recipient_user_id = ? AND dedupe_key = ? FOR UPDATE`,
        [appId, message.recipientUserId, message.dedupeKey],
      )
      assertInboxReplay(stored, message)
      const replayed = stored.id !== messageId
      if (replayed) {
        const deliveryTasks = await tx.query(
          `SELECT channel, template_key, payload_json
           FROM mip_delivery_tasks
           WHERE app_id = ? AND inbox_message_id = ?
           ORDER BY created_at, id FOR UPDATE`,
          [appId, stored.id],
        )
        assertDeliveryReplay(deliveryTasks, message.external)
        return messageDto(stored)
      }
      if (message.external) {
        await tx.query(
          `INSERT INTO mip_delivery_tasks (
             id, app_id, inbox_message_id, channel, template_key, payload_json,
             status, last_outcome, retry_disposition
           ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 'NOT_ATTEMPTED', 'RETRIABLE')
           ON DUPLICATE KEY UPDATE inbox_message_id = VALUES(inbox_message_id)`,
          [
            createId(),
            appId,
            stored.id,
            message.external.channel,
            message.external.templateKey,
            JSON.stringify(message.external.payload),
          ],
        )
      }
      return messageDto(stored)
    })
  }

  async function leaseTasks(appId, limit, now = new Date()) {
    const batchSize = Math.min(20, Math.max(1, Number(limit) || 10))
    const leaseExpiresAt = new Date(now.getTime() + TASK_LEASE_MS)
    return database.transaction(async (tx) => {
      const abandoned = await tx.query(
        `SELECT id FROM mip_delivery_tasks
         WHERE app_id = ? AND status = 'PROCESSING' AND lease_expires_at < ?
         ORDER BY lease_expires_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, now, batchSize],
      )
      if (abandoned.length) {
        const abandonedIds = abandoned.map(row => row.id)
        const abandonedPlaceholders = abandonedIds.map(() => '?').join(', ')
        await tx.query(
          `UPDATE mip_notification_grants
           SET status = 'EXPIRED', reservation_task_id = NULL,
               reservation_token = NULL, reservation_expires_at = NULL
           WHERE app_id = ? AND status = 'RESERVED'
             AND reservation_task_id IN (${abandonedPlaceholders})`,
          [appId, ...abandonedIds],
        )
        await tx.query(
          `UPDATE mip_delivery_tasks
           SET status = 'CANCELLED', lease_expires_at = NULL,
               last_error_code = 'DELIVERY_OUTCOME_UNKNOWN',
               last_outcome = 'UNKNOWN', retry_disposition = 'MANUAL_REVIEW',
               outcome_updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND status = 'PROCESSING'
             AND id IN (${abandonedPlaceholders})`,
          [appId, ...abandonedIds],
        )
      }

      const rows = await tx.query(
        `SELECT id FROM mip_delivery_tasks
         WHERE app_id = ? AND attempts < ? AND available_at <= ?
           AND (
             (status = 'PENDING' AND last_outcome = 'NOT_ATTEMPTED'
               AND retry_disposition = 'RETRIABLE')
             OR (status = 'FAILED' AND retry_disposition = 'RETRIABLE'
               AND last_outcome IN ('NOT_ATTEMPTED', 'KNOWN_FAILED'))
           )
         ORDER BY available_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, MAX_ATTEMPTS, now, batchSize],
      )
      if (!rows.length) return []
      const ids = rows.map(row => row.id)
      const placeholders = ids.map(() => '?').join(', ')
      await tx.query(
        `UPDATE mip_delivery_tasks
         SET status = 'PROCESSING', attempts = attempts + 1, lease_expires_at = ?,
             last_error_code = NULL, last_outcome = 'UNKNOWN',
             retry_disposition = 'MANUAL_REVIEW', outcome_updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id IN (${placeholders})`,
        [leaseExpiresAt, appId, ...ids],
      )
      const tasks = await tx.query(
        `SELECT id, app_id, attempts, lease_expires_at
         FROM mip_delivery_tasks
         WHERE app_id = ? AND id IN (${placeholders})
         ORDER BY available_at, id`,
        [appId, ...ids],
      )
      return tasks.map(row => ({ ...row, leaseKey: iso(row.lease_expires_at) }))
    })
  }

  async function reserveTask(task) {
    const reservationToken = createId()
    return database.transaction(async (tx) => {
      const current = await tx.one(
        `SELECT t.id, t.app_id, t.channel, t.template_key, t.payload_json,
                t.attempts, t.lease_expires_at, m.recipient_user_id, m.target_route
         FROM mip_delivery_tasks t
         INNER JOIN mip_inbox_messages m ON m.app_id = t.app_id AND m.id = t.inbox_message_id
         INNER JOIN mip_users u
           ON u.app_id = m.app_id AND u.id = m.recipient_user_id AND u.status = 'ACTIVE'
         WHERE t.app_id = ? AND t.id = ? AND t.status = 'PROCESSING' FOR UPDATE`,
        [task.app_id, task.id],
      )
      assertTaskLease(current, task)

      if (current.channel === 'WECHAT_SERVICE_ACCOUNT') {
        return reservationDto(current, null, null)
      }

      let grant = await tx.one(
        `SELECT id, recipient_hash, recipient_ciphertext
         FROM mip_notification_grants
         WHERE app_id = ? AND status = 'RESERVED' AND reservation_task_id = ?
           AND user_id = ? AND channel = ? AND template_key = ?
         LIMIT 1 FOR UPDATE`,
        [
          task.app_id,
          task.id,
          current.recipient_user_id,
          current.channel,
          current.template_key,
        ],
      )
      if (!grant) {
        grant = await tx.one(
          `SELECT id, recipient_hash, recipient_ciphertext
           FROM mip_notification_grants
           WHERE app_id = ? AND user_id = ? AND channel = ? AND template_key = ?
             AND status = 'AVAILABLE' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
           ORDER BY granted_at, id LIMIT 1 FOR UPDATE`,
          [task.app_id, current.recipient_user_id, current.channel, current.template_key],
        )
        if (!grant) throw new Error('GRANT_UNAVAILABLE')
        const update = await tx.query(
          `UPDATE mip_notification_grants
           SET status = 'RESERVED', reservation_task_id = ?, reservation_token = ?,
               reservation_expires_at = ?
           WHERE app_id = ? AND id = ? AND status = 'AVAILABLE'
             AND reservation_task_id IS NULL AND reservation_token IS NULL`,
          [task.id, reservationToken, current.lease_expires_at, task.app_id, grant.id],
        )
        assertAffected(update, 'DELIVERY_RESERVATION_LOST')
      }
      else {
        const update = await tx.query(
          `UPDATE mip_notification_grants
           SET reservation_token = ?, reservation_expires_at = ?
           WHERE app_id = ? AND id = ? AND status = 'RESERVED'
             AND reservation_task_id = ?`,
          [reservationToken, current.lease_expires_at, task.app_id, grant.id, task.id],
        )
        assertAffected(update, 'DELIVERY_RESERVATION_LOST')
      }

      return reservationDto(current, grant, reservationToken)
    })
  }

  async function deliverReservedTask(reservation, deliver, input = {}) {
    const now = input.now || new Date()
    if (typeof deliver !== 'function') throw new Error('DELIVERY_SENDER_INVALID')
    // Retrying this transaction could repeat a provider call after an uncertain commit.
    return database.transaction(async (tx) => {
      const recipient = await tx.one(
        `SELECT id, status FROM mip_users
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [reservation.app_id, reservation.recipient_user_id],
      )
      const current = await tx.one(
        `SELECT id, app_id, status, attempts, lease_expires_at
         FROM mip_delivery_tasks
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [reservation.app_id, reservation.taskId],
      )
      assertReservationTask(current, reservation)
      const grant = reservation.grant
        ? await tx.one(
            `SELECT id, user_id, channel, template_key, status, expires_at,
                    reservation_task_id, reservation_token
             FROM mip_notification_grants
             WHERE app_id = ? AND id = ? FOR UPDATE`,
            [reservation.app_id, reservation.grant.id],
          )
        : null
      if (reservation.grant) {
        assertGrantReservation(grant, reservation)
        assertGrantScope(grant, reservation)
      }
      if (!recipient || recipient.status !== 'ACTIVE') {
        const grantUpdate = reservation.grant
          ? await expireReservationGrant(tx, reservation)
          : null
        const taskUpdate = await tx.query(
          `UPDATE mip_delivery_tasks
           SET status = 'CANCELLED', lease_expires_at = NULL,
               last_error_code = 'DELIVERY_RECIPIENT_INACTIVE',
               last_outcome = 'NOT_ATTEMPTED', retry_disposition = 'TERMINAL',
               outcome_updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
          [reservation.app_id, reservation.taskId, reservation.lease_expires_at],
        )
        if (grantUpdate) assertAffected(grantUpdate, 'DELIVERY_RESERVATION_LOST')
        assertAffected(taskUpdate, 'DELIVERY_LEASE_LOST')
        return {
          taskId: reservation.taskId,
          status: 'CANCELLED',
          errorCode: 'DELIVERY_RECIPIENT_INACTIVE',
        }
      }

      if (grant && grant.expires_at && new Date(grant.expires_at).getTime() <= now.getTime()) {
        const grantUpdate = await expireReservationGrant(tx, reservation)
        const taskUpdate = await tx.query(
          `UPDATE mip_delivery_tasks
           SET status = 'CANCELLED', lease_expires_at = NULL,
               last_error_code = 'DELIVERY_WINDOW_EXPIRED',
               last_outcome = 'NOT_ATTEMPTED', retry_disposition = 'TERMINAL',
               outcome_updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
          [reservation.app_id, reservation.taskId, reservation.lease_expires_at],
        )
        assertAffected(grantUpdate, 'DELIVERY_RESERVATION_LOST')
        assertAffected(taskUpdate, 'DELIVERY_LEASE_LOST')
        return {
          taskId: reservation.taskId,
          status: 'CANCELLED',
          errorCode: 'DELIVERY_WINDOW_EXPIRED',
        }
      }

      let deliveryError = null
      try {
        await deliver()
      }
      catch (error) {
        deliveryError = safeErrorCode(error instanceof Error ? error.message : '')
      }

      if (deliveryError) {
        return settleAttemptedFailure(tx, current, reservation, deliveryError, now)
      }

      const grantUpdate = reservation.grant
        ? await completeReservationGrant(tx, reservation)
        : null
      const taskUpdate = await tx.query(
        `UPDATE mip_delivery_tasks
         SET status = 'DELIVERED', delivered_at = UTC_TIMESTAMP(3), lease_expires_at = NULL,
             last_error_code = NULL, last_outcome = 'SUCCEEDED',
             retry_disposition = 'TERMINAL', outcome_updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
        [reservation.app_id, reservation.taskId, reservation.lease_expires_at],
      )
      if (grantUpdate) assertAffected(grantUpdate, 'DELIVERY_RESERVATION_LOST')
      assertAffected(taskUpdate, 'DELIVERY_LEASE_LOST')
      return { taskId: reservation.taskId, status: 'DELIVERED' }
    }, 1)
  }

  async function failReservedTask(reservation, errorCode, input = {}) {
    const now = input.now || new Date()
    const code = safeErrorCode(errorCode)
    return database.transaction(async (tx) => {
      const current = await tx.one(
        `SELECT id, app_id, status, attempts, lease_expires_at
         FROM mip_delivery_tasks
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [reservation.app_id, reservation.taskId],
      )
      assertReservationTask(current, reservation)
      const grant = reservation.grant
        ? await tx.one(
            `SELECT id, status, reservation_task_id, reservation_token
             FROM mip_notification_grants
             WHERE app_id = ? AND id = ? FOR UPDATE`,
            [reservation.app_id, reservation.grant.id],
          )
        : null
      if (reservation.grant) assertGrantReservation(grant, reservation)

      const failure = classifyPreProviderFailure(code, Number(current.attempts))
      if (reservation.grant) {
        const grantUpdate = await tx.query(
          `UPDATE mip_notification_grants
           SET status = 'AVAILABLE', reservation_task_id = NULL, reservation_token = NULL,
               reservation_expires_at = NULL
           WHERE app_id = ? AND id = ? AND status = 'RESERVED'
             AND reservation_task_id = ? AND reservation_token = ?`,
          [
            reservation.app_id,
            reservation.grant.id,
            reservation.taskId,
            reservation.reservationToken,
          ],
        )
        assertAffected(grantUpdate, 'DELIVERY_RESERVATION_LOST')
      }

      const availableAt = new Date(now.getTime() + retryDelayMs(Number(current.attempts)))
      const taskUpdate = await tx.query(
        `UPDATE mip_delivery_tasks
         SET status = ?, available_at = ?, lease_expires_at = NULL, last_error_code = ?,
             last_outcome = ?, retry_disposition = ?, outcome_updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
        [failure.status, availableAt, code, failure.outcome, failure.retryDisposition,
          reservation.app_id, reservation.taskId, reservation.lease_expires_at],
      )
      assertAffected(taskUpdate, 'DELIVERY_LEASE_LOST')
      return failureResult(reservation.taskId, failure.status, code, availableAt)
    })
  }

  async function failLeasedTask(task, errorCode, now = new Date()) {
    const code = safeErrorCode(errorCode)
    return database.transaction(async (tx) => {
      const current = await tx.one(
        `SELECT id, app_id, status, attempts, lease_expires_at
         FROM mip_delivery_tasks
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [task.app_id, task.id],
      )
      assertTaskLease(current, task)
      const failure = classifyPreProviderFailure(code, Number(current.attempts))
      if (failure.retryDisposition !== 'RETRIABLE') {
        const nextGrantStatus = failure.outcome === 'UNKNOWN' ? 'EXPIRED' : 'AVAILABLE'
        await tx.query(
          `UPDATE mip_notification_grants
           SET status = ?, reservation_task_id = NULL,
               reservation_token = NULL, reservation_expires_at = NULL
           WHERE app_id = ? AND status = 'RESERVED' AND reservation_task_id = ?`,
          [nextGrantStatus, task.app_id, task.id],
        )
      }
      const availableAt = new Date(now.getTime() + retryDelayMs(Number(current.attempts)))
      const update = await tx.query(
        `UPDATE mip_delivery_tasks
         SET status = ?, available_at = ?, lease_expires_at = NULL, last_error_code = ?,
             last_outcome = ?, retry_disposition = ?, outcome_updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
        [failure.status, availableAt, code, failure.outcome, failure.retryDisposition,
          task.app_id, task.id, current.lease_expires_at],
      )
      assertAffected(update, 'DELIVERY_LEASE_LOST')
      return failureResult(task.id, failure.status, code, availableAt)
    })
  }

  async function reconcileDeliveryTask(input) {
    const requestHash = createHash('sha256').update(JSON.stringify([
      input.taskId,
      input.actorUserId,
      input.expectedEvidenceRevision,
    ])).digest('hex')
    return database.transaction(async (tx) => {
      const operation = await claimReconcileRequest(tx, {
        ...input,
        createId,
        requestHash,
      })
      if (operation.replay) return operation.replay

      const before = await lockDeliveryEvidence(tx, input.appId, input.taskId)
      if (!before) throw new Error('NOT_FOUND')
      const beforeEvidence = normalizedDeliveryEvidence(before.task, before.grant)
      const beforeEvidenceRevision = deliveryEvidenceRevision(beforeEvidence)
      if (beforeEvidenceRevision !== input.expectedEvidenceRevision) {
        throw new Error('EVIDENCE_CHANGED')
      }

      let effect = 'UNCHANGED'
      if (before.task.status === 'PROCESSING') {
        const leaseExpiresAt = new Date(before.task.lease_expires_at).getTime()
        if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt > input.now.getTime()) {
          throw new Error('NOT_ACTIONABLE')
        }
        if (before.grant) {
          const expired = await tx.query(
            `UPDATE mip_notification_grants
             SET status = 'EXPIRED', reservation_task_id = NULL,
                 reservation_token = NULL, reservation_expires_at = NULL
             WHERE app_id = ? AND id = ? AND status = 'RESERVED'
               AND reservation_task_id = ?`,
            [input.appId, before.grant.id, input.taskId],
          )
          assertAffected(expired, 'DELIVERY_RESERVATION_LOST')
        }
        const quarantined = await tx.query(
          `UPDATE mip_delivery_tasks
           SET status = 'CANCELLED', lease_expires_at = NULL,
               last_error_code = 'DELIVERY_OUTCOME_UNKNOWN',
               last_outcome = 'UNKNOWN', retry_disposition = 'MANUAL_REVIEW',
               outcome_updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND id = ? AND status = 'PROCESSING'
             AND (lease_expires_at <=> ?)`,
          [input.appId, input.taskId, before.task.lease_expires_at || null],
        )
        assertAffected(quarantined, 'DELIVERY_LEASE_LOST')
        effect = 'QUARANTINED'
      }
      else if (before.task.status === 'FAILED'
        && before.task.retry_disposition === 'RETRIABLE'
        && ['NOT_ATTEMPTED', 'KNOWN_FAILED'].includes(before.task.last_outcome)) {
        effect = 'RETRYABLE_UNCHANGED'
      }

      const after = await lockDeliveryEvidence(tx, input.appId, input.taskId)
      const afterEvidence = normalizedDeliveryEvidence(after.task, after.grant)
      const response = {
        taskId: input.taskId,
        effect,
        beforeEvidenceRevision,
        afterEvidenceRevision: deliveryEvidenceRevision(afterEvidence),
        source: deliverySourceDto(afterEvidence),
      }
      await writeDeliveryReconcileAudit(tx, {
        ...input,
        before: beforeEvidence,
        after: afterEvidence,
        response,
      })
      await completeReconcileRequest(tx, {
        ...input,
        requestHash,
        response,
      })
      return response
    })
  }

  return {
    deliverReservedTask,
    failLeasedTask,
    failReservedTask,
    leaseTasks,
    publishMessage,
    reconcileDeliveryTask,
    reserveTask,
  }
}

function assertInboxReplay(stored, message) {
  const target = message.target || null
  if (!stored
    || stored.recipient_user_id !== message.recipientUserId
    || stored.message_type !== message.messageType
    || stored.title !== message.title
    || stored.body !== message.body
    || nullable(stored.target_type) !== nullable(target?.type)
    || nullable(stored.target_id) !== nullable(target?.id)
    || nullable(stored.target_route) !== nullable(target?.route)) {
    throw new Error('IDEMPOTENCY_CONFLICT')
  }
}

function assertDeliveryReplay(rows, external) {
  if (!Array.isArray(rows) || rows.length !== (external ? 1 : 0)) {
    throw new Error('IDEMPOTENCY_CONFLICT')
  }
  if (!external) return
  const stored = rows[0]
  if (stored.channel !== external.channel
    || nullable(stored.template_key) !== nullable(external.templateKey)
    || canonicalJson(stored.payload_json) !== canonicalJson(external.payload)) {
    throw new Error('IDEMPOTENCY_CONFLICT')
  }
}

function nullable(value) {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function canonicalJson(value) {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    }
    catch {
      throw new Error('IDEMPOTENCY_CONFLICT')
    }
  }
  return JSON.stringify(sortJson(parsed))
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]))
}

async function lockDeliveryEvidence(tx, appId, taskId) {
  const task = await tx.one(
    `SELECT id, status, attempts, available_at, lease_expires_at, delivered_at,
      last_error_code, last_outcome, retry_disposition, outcome_updated_at
     FROM mip_delivery_tasks WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, taskId],
  )
  if (!task) return null
  const grant = await tx.one(
    `SELECT id, reservation_expires_at
     FROM mip_notification_grants
     WHERE app_id = ? AND status = 'RESERVED' AND reservation_task_id = ?
     FOR UPDATE`,
    [appId, taskId],
  )
  return { task, grant }
}

async function claimReconcileRequest(tx, input) {
  try {
    await tx.query(
      `INSERT INTO mip_idempotency_keys (
        id, app_id, actor_user_id, operation, idempotency_key,
        request_hash, status, expires_at
      ) VALUES (?, ?, ?, 'notification.delivery.reconcile', ?, ?, 'RUNNING',
        DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [input.createId(), input.appId, input.actorUserId, input.idempotencyKey, input.requestHash],
    )
    return { replay: null }
  }
  catch (error) {
    if (!duplicateError(error)) throw error
  }
  const stored = await tx.one(
    `SELECT request_hash, status, response_json
     FROM mip_idempotency_keys
     WHERE app_id = ? AND actor_user_id = ?
       AND operation = 'notification.delivery.reconcile' AND idempotency_key = ?
     FOR UPDATE`,
    [input.appId, input.actorUserId, input.idempotencyKey],
  )
  if (!stored || stored.request_hash !== input.requestHash) {
    throw new Error('IDEMPOTENCY_CONFLICT')
  }
  if (stored.status !== 'COMPLETED') throw new Error('REQUEST_IN_PROGRESS')
  const replay = parseReconcileResponse(stored.response_json, input.taskId)
  if (!replay) throw new Error('IDEMPOTENCY_CONFLICT')
  return { replay }
}

async function completeReconcileRequest(tx, input) {
  const completed = await tx.query(
    `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
     WHERE app_id = ? AND actor_user_id = ?
       AND operation = 'notification.delivery.reconcile' AND idempotency_key = ?
       AND request_hash = ? AND status = 'RUNNING'`,
    [JSON.stringify(input.response), input.appId, input.actorUserId,
      input.idempotencyKey, input.requestHash],
  )
  assertAffected(completed, 'CONFLICT')
}

async function writeDeliveryReconcileAudit(tx, input) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'ADMIN', 'PLATFORM', NULL,
      'admin.message_delivery_reviews.delivery_task_reconcile',
      'DELIVERY_TASK', ?, NULL, ?)`,
    [input.appId, input.actorUserId, input.taskId, JSON.stringify({
      effect: input.response.effect,
      beforeStatus: input.before.status,
      afterStatus: input.after.status,
      beforeOutcome: input.before.lastOutcome,
      afterOutcome: input.after.lastOutcome,
      beforeEvidenceRevision: input.response.beforeEvidenceRevision,
      afterEvidenceRevision: input.response.afterEvidenceRevision,
    })],
  )
}

function parseReconcileResponse(value, taskId) {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) }
    catch { return null }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.taskId !== taskId
    || !['QUARANTINED', 'UNCHANGED', 'RETRYABLE_UNCHANGED'].includes(parsed.effect)
    || !/^[0-9a-f]{64}$/.test(parsed.beforeEvidenceRevision || '')
    || !/^[0-9a-f]{64}$/.test(parsed.afterEvidenceRevision || '')) {
    return null
  }
  return parsed
}

function deliverySourceDto(evidence) {
  return {
    status: evidence.status,
    attempts: evidence.attempts,
    availableAt: iso(evidence.availableAt) || null,
    leaseExpiresAt: iso(evidence.leaseExpiresAt) || null,
    deliveredAt: iso(evidence.deliveredAt) || null,
    lastErrorCode: evidence.lastErrorCode,
    lastOutcome: evidence.lastOutcome,
    retryDisposition: evidence.retryDisposition,
    outcomeUpdatedAt: iso(evidence.outcomeUpdatedAt) || null,
    reservedGrantCount: evidence.reservedGrantCount,
  }
}

function duplicateError(error) {
  return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062
}

function reservationDto(task, grant, reservationToken) {
  return {
    taskId: task.id,
    app_id: task.app_id,
    channel: task.channel,
    template_key: task.template_key,
    payload_json: task.payload_json,
    attempts: Number(task.attempts),
    lease_expires_at: task.lease_expires_at,
    leaseKey: iso(task.lease_expires_at),
    recipient_user_id: task.recipient_user_id,
    target_route: task.target_route,
    ...(reservationToken ? { reservationToken } : {}),
    ...(grant ? {
      grant: {
        id: grant.id,
        recipient_hash: grant.recipient_hash,
        recipient_ciphertext: grant.recipient_ciphertext,
      },
    } : {}),
  }
}

function assertTaskLease(current, task) {
  if (!current || (current.status !== undefined && current.status !== 'PROCESSING')
    || iso(current.lease_expires_at) !== task.leaseKey) {
    throw new Error('DELIVERY_LEASE_LOST')
  }
}

function assertReservationTask(current, reservation) {
  assertTaskLease(current, { leaseKey: reservation.leaseKey })
}

function assertGrantReservation(grant, reservation) {
  if (!grant || grant.status !== 'RESERVED'
    || grant.reservation_task_id !== reservation.taskId
    || grant.reservation_token !== reservation.reservationToken) {
    throw new Error('DELIVERY_RESERVATION_LOST')
  }
}

function assertGrantScope(grant, reservation) {
  if (grant.user_id !== reservation.recipient_user_id
    || grant.channel !== reservation.channel
    || grant.template_key !== reservation.template_key) {
    throw new Error('DELIVERY_RESERVATION_LOST')
  }
}

async function settleAttemptedFailure(tx, current, reservation, errorCode, now) {
  const failure = classifyProviderFailure(errorCode, Number(current.attempts))
  if (reservation.grant
    && (failure.retryDisposition !== 'RETRIABLE'
      || reservation.channel === 'WECHAT_CUSTOMER_SERVICE')) {
    const grantUpdate = reservation.channel === 'WECHAT_CUSTOMER_SERVICE'
      ? await releaseReservationGrant(tx, reservation)
      : await expireReservationGrant(tx, reservation)
    assertAffected(grantUpdate, 'DELIVERY_RESERVATION_LOST')
  }
  const availableAt = new Date(now.getTime() + retryDelayMs(Number(current.attempts)))
  const taskUpdate = await tx.query(
    `UPDATE mip_delivery_tasks
     SET status = ?, available_at = ?, lease_expires_at = NULL, last_error_code = ?,
         last_outcome = ?, retry_disposition = ?, outcome_updated_at = UTC_TIMESTAMP(3)
     WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
    [failure.status, availableAt, failure.errorCode, failure.outcome, failure.retryDisposition,
      reservation.app_id, reservation.taskId, reservation.lease_expires_at],
  )
  assertAffected(taskUpdate, 'DELIVERY_LEASE_LOST')
  return failureResult(reservation.taskId, failure.status, failure.errorCode, availableAt)
}

function classifyPreProviderFailure(errorCode, attempts) {
  if (RETRYABLE_PRE_PROVIDER_CODES.has(errorCode) && attempts < MAX_ATTEMPTS) {
    return {
      status: 'FAILED',
      outcome: 'NOT_ATTEMPTED',
      retryDisposition: 'RETRIABLE',
    }
  }
  if (TERMINAL_PRE_PROVIDER_CODES.has(errorCode)
    || RETRYABLE_PRE_PROVIDER_CODES.has(errorCode)) {
    return {
      status: 'CANCELLED',
      outcome: 'NOT_ATTEMPTED',
      retryDisposition: 'TERMINAL',
    }
  }
  return {
    status: 'CANCELLED',
    outcome: 'UNKNOWN',
    retryDisposition: 'MANUAL_REVIEW',
  }
}

function classifyProviderFailure(errorCode, attempts) {
  if (!KNOWN_PROVIDER_FAILURE_CODES.has(errorCode)) {
    return {
      status: 'CANCELLED',
      outcome: 'UNKNOWN',
      retryDisposition: 'MANUAL_REVIEW',
      errorCode: 'DELIVERY_OUTCOME_UNKNOWN',
    }
  }
  const retryable = RETRYABLE_PROVIDER_FAILURE_CODES.has(errorCode) && attempts < MAX_ATTEMPTS
  return {
    status: retryable ? 'FAILED' : 'CANCELLED',
    outcome: 'KNOWN_FAILED',
    retryDisposition: retryable ? 'RETRIABLE' : 'TERMINAL',
    errorCode,
  }
}

function completeReservationGrant(tx, reservation) {
  if (reservation.channel === 'WECHAT_CUSTOMER_SERVICE') {
    return releaseReservationGrant(tx, reservation)
  }
  return tx.query(
    `UPDATE mip_notification_grants
     SET status = 'CONSUMED', consumed_at = UTC_TIMESTAMP(3),
         reservation_task_id = NULL, reservation_token = NULL,
         reservation_expires_at = NULL
     WHERE app_id = ? AND id = ? AND status = 'RESERVED'
       AND reservation_task_id = ? AND reservation_token = ?`,
    [
      reservation.app_id,
      reservation.grant.id,
      reservation.taskId,
      reservation.reservationToken,
    ],
  )
}

function expireReservationGrant(tx, reservation) {
  return tx.query(
    `UPDATE mip_notification_grants
     SET status = 'EXPIRED', reservation_task_id = NULL, reservation_token = NULL,
         reservation_expires_at = NULL
     WHERE app_id = ? AND id = ? AND status = 'RESERVED'
       AND reservation_task_id = ? AND reservation_token = ?`,
    [
      reservation.app_id,
      reservation.grant.id,
      reservation.taskId,
      reservation.reservationToken,
    ],
  )
}

function releaseReservationGrant(tx, reservation) {
  return tx.query(
    `UPDATE mip_notification_grants
     SET status = 'AVAILABLE', reservation_task_id = NULL, reservation_token = NULL,
         reservation_expires_at = NULL
     WHERE app_id = ? AND id = ? AND status = 'RESERVED'
       AND reservation_task_id = ? AND reservation_token = ?`,
    [
      reservation.app_id,
      reservation.grant.id,
      reservation.taskId,
      reservation.reservationToken,
    ],
  )
}

function failureResult(taskId, status, errorCode, availableAt) {
  return {
    taskId,
    status,
    errorCode,
    ...(status === 'FAILED' ? { retryAt: iso(availableAt) } : {}),
  }
}

function assertAffected(result, code) {
  if (Number(result?.affectedRows) !== 1) throw new Error(code)
}

function messageDto(row) {
  const target = row.target_type && row.target_id && row.target_route
    ? { type: row.target_type, id: row.target_id, route: row.target_route }
    : undefined
  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    messageType: row.message_type,
    title: row.title,
    body: row.body,
    target,
    readAt: row.read_at ? iso(row.read_at) : undefined,
    createdAt: iso(row.created_at),
  }
}

function retryDelayMs(attempts) {
  return Math.min(8_000, Math.max(500, 2 ** Math.max(0, attempts - 1) * 500))
}

function safeErrorCode(value) {
  const code = String(value || 'DELIVERY_FAILED').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  return code.slice(0, 64) || 'DELIVERY_FAILED'
}

function iso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

module.exports = {
  MAX_ATTEMPTS,
  classifyPreProviderFailure,
  classifyProviderFailure,
  createNotificationRepository,
  messageDto,
  retryDelayMs,
  safeErrorCode,
}
