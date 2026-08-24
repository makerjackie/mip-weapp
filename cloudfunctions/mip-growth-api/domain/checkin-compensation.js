'use strict'

const { randomUUID } = require('node:crypto')
const { balanceField, projectAward } = require('./rules')

const CHECKED_IN_EVENT = 'event.checked_in'
const CHECKIN_REVOKED_EVENT = 'event.checkin_revoked'

function createCheckInGrowthRepository(database, options = {}) {
  const createId = options.createId || randomUUID

  async function applyCheckInTransition(input) {
    validateInput(input)
    return database.transaction(async (tx) => {
      const requested = await tx.one(
        `SELECT id, transition_type, reversal_of_transition_id
         FROM mip_event_checkin_transitions
         WHERE app_id = ? AND id = ?`,
        [input.appId, input.transitionId],
      )
      if (!requested) throw new Error('VALIDATION_FAILED')
      const recordedId = requested.transition_type === 'REVOKED'
        ? requested.reversal_of_transition_id
        : requested.id
      const recorded = await tx.one(
        `SELECT transition.id, transition.app_id, transition.checkin_id,
                transition.registration_id, transition.event_id, transition.user_id,
                transition.checkin_version, transition.registration_version
         FROM mip_event_checkin_transitions transition
         WHERE transition.app_id = ? AND transition.id = ?
           AND transition.transition_type = 'CHECKED_IN'
         FOR UPDATE`,
        [input.appId, recordedId],
      )
      if (!recorded) throw new Error('VALIDATION_FAILED')
      const relation = await tx.one(
        `SELECT checkin.id
         FROM mip_event_checkins checkin
         INNER JOIN mip_event_registrations registration
           ON registration.app_id = checkin.app_id
          AND registration.id = checkin.registration_id
          AND registration.event_id = checkin.event_id
          AND registration.user_id = checkin.user_id
         INNER JOIN mip_events event
           ON event.app_id = checkin.app_id AND event.id = checkin.event_id
         INNER JOIN mip_users user
           ON user.app_id = checkin.app_id AND user.id = checkin.user_id
         WHERE checkin.app_id = ? AND checkin.id = ?
           AND checkin.registration_id = ? AND checkin.event_id = ? AND checkin.user_id = ?`,
        [recorded.app_id, recorded.checkin_id, recorded.registration_id,
          recorded.event_id, recorded.user_id],
      )
      if (!relation) throw new Error('VALIDATION_FAILED')
      const reversal = await tx.one(
        `SELECT id, app_id, checkin_id, registration_id, event_id, user_id,
                checkin_version, registration_version, reversal_of_transition_id,
                actor_user_id
         FROM mip_event_checkin_transitions
         WHERE app_id = ? AND reversal_of_transition_id = ?
           AND transition_type = 'REVOKED'
         FOR UPDATE`,
        [input.appId, recorded.id],
      )
      if (reversal && !sameCycle(recorded, reversal)) throw new Error('VALIDATION_FAILED')
      if (requested.transition_type === 'CHECKED_IN') {
        if (requested.id !== recorded.id) throw new Error('VALIDATION_FAILED')
        if (reversal) {
          return { transitionId: requested.id, status: 'REVERSED_BEFORE_PROJECTION', awards: [] }
        }
        const account = await lockAccount(tx, recorded.app_id, recorded.user_id)
        return awardCheckIn(tx, recorded, account, createId)
      }
      if (requested.transition_type !== 'REVOKED'
        || !reversal
        || reversal.id !== requested.id
        || reversal.reversal_of_transition_id !== recorded.id) {
        throw new Error('VALIDATION_FAILED')
      }
      const account = await lockAccount(tx, recorded.app_id, recorded.user_id)
      return reverseCheckIn(tx, recorded, reversal, account, createId)
    })
  }

  return { applyCheckInTransition }
}

async function awardCheckIn(tx, recorded, account, createId) {
  const rules = await tx.query(
    `SELECT id, rule_key, name, metric, delta_value, daily_limit_value,
            source_event_type, status
     FROM mip_growth_rules
     WHERE app_id = ? AND source_event_type = 'event.checked_in' AND status = 'ACTIVE'
     ORDER BY id FOR UPDATE`,
    [recorded.app_id],
  )
  if (new Set(rules.map(rule => rule.metric)).size !== rules.length) {
    throw new Error('GROWTH_RULE_CONFLICT')
  }
  const awards = []
  for (const rule of rules) {
    const existing = await tx.one(
      `SELECT id, metric, delta_value, balance_after, created_at
       FROM mip_growth_entries
       WHERE app_id = ? AND user_id = ? AND source_event_type = 'event.checked_in'
         AND source_event_id = ? AND metric = ?
       FOR UPDATE`,
      [recorded.app_id, recorded.user_id, recorded.id, rule.metric],
    )
    if (existing) {
      awards.push(entryResult(existing, rule.rule_key, true))
      continue
    }
    const daily = await tx.one(
      `SELECT COALESCE(SUM(GREATEST(entry.delta_value, 0)), 0) AS total
       FROM mip_growth_entries entry
       WHERE entry.app_id = ? AND entry.user_id = ? AND entry.rule_id = ?
         AND entry.created_at >= UTC_DATE()
         AND entry.created_at < DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)
         AND NOT (
           entry.source_event_type = 'event.checked_in'
           AND EXISTS (
             SELECT 1 FROM mip_event_checkin_transitions reversal
             WHERE reversal.app_id = entry.app_id
               AND reversal.reversal_of_transition_id = entry.source_event_id
               AND reversal.transition_type = 'REVOKED'
           )
         )`,
      [recorded.app_id, recorded.user_id, rule.id],
    )
    const projection = projectAward(account, rule, Number(daily?.total || 0))
    if (projection.applied === 0) {
      awards.push({
        ruleKey: rule.rule_key,
        metric: rule.metric,
        requestedDelta: projection.requested,
        appliedDelta: 0,
        balanceAfter: projection.balanceAfter,
        capped: true,
      })
      continue
    }
    const entryId = await appendEntry(tx, {
      createId,
      account,
      appId: recorded.app_id,
      userId: recorded.user_id,
      ruleId: rule.id,
      sourceEventId: recorded.id,
      sourceEventType: CHECKED_IN_EVENT,
      metric: rule.metric,
      delta: projection.applied,
      balanceAfter: projection.balanceAfter,
    })
    awards.push({
      id: entryId,
      ruleKey: rule.rule_key,
      metric: rule.metric,
      requestedDelta: projection.requested,
      appliedDelta: projection.applied,
      balanceAfter: projection.balanceAfter,
      capped: projection.capped,
      idempotent: false,
    })
  }
  return {
    transitionId: recorded.id,
    status: awards.some(award => award.appliedDelta !== 0) ? 'APPLIED' : 'NO_AWARD',
    awards,
  }
}

async function reverseCheckIn(tx, recorded, reversal, account, createId) {
  const originals = await tx.query(
    `SELECT id, rule_id, metric, delta_value, balance_after
     FROM mip_growth_entries
     WHERE app_id = ? AND user_id = ? AND source_event_type = 'event.checked_in'
       AND source_event_id = ?
     ORDER BY id FOR UPDATE`,
    [recorded.app_id, recorded.user_id, recorded.id],
  )
  const awards = []
  for (const original of originals) {
    const existing = await tx.one(
      `SELECT id, metric, delta_value, balance_after, created_at
       FROM mip_growth_entries
       WHERE app_id = ? AND user_id = ? AND source_event_type = 'event.checkin_revoked'
         AND source_event_id = ? AND metric = ?
       FOR UPDATE`,
      [recorded.app_id, recorded.user_id, reversal.id, original.metric],
    )
    if (existing) {
      awards.push(entryResult(existing, undefined, true))
      continue
    }
    const field = balanceField(original.metric)
    const delta = -Number(original.delta_value)
    const balanceAfter = Number(account[field]) + delta
    if (!Number.isSafeInteger(delta) || delta === 0 || !Number.isSafeInteger(balanceAfter)) {
      throw new Error('GROWTH_BALANCE_INVALID')
    }
    const entryId = await appendEntry(tx, {
      createId,
      account,
      appId: recorded.app_id,
      userId: recorded.user_id,
      ruleId: original.rule_id,
      sourceEventId: reversal.id,
      sourceEventType: CHECKIN_REVOKED_EVENT,
      metric: original.metric,
      delta,
      balanceAfter,
      adjustmentReason: `签到撤销冲销:${original.id}`,
      actorUserId: reversal.actor_user_id,
    })
    awards.push({
      id: entryId,
      metric: original.metric,
      requestedDelta: delta,
      appliedDelta: delta,
      balanceAfter,
      capped: false,
      idempotent: false,
    })
  }
  return {
    transitionId: reversal.id,
    reversedTransitionId: recorded.id,
    status: originals.length ? 'REVERSED' : 'NO_AWARD_TO_REVERSE',
    awards,
  }
}

async function lockAccount(tx, appId, userId) {
  await tx.query(
    `INSERT INTO mip_growth_accounts (app_id, user_id)
     VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
    [appId, userId],
  )
  const account = await tx.one(
    `SELECT user_id, experience_balance, contribution_balance, coin_balance, version
     FROM mip_growth_accounts WHERE app_id = ? AND user_id = ? FOR UPDATE`,
    [appId, userId],
  )
  if (!account) throw new Error('CONFLICT')
  return account
}

async function appendEntry(tx, input) {
  const field = balanceField(input.metric)
  await tx.query(
    `UPDATE mip_growth_accounts SET ${field} = ?, version = version + 1
     WHERE app_id = ? AND user_id = ?`,
    [input.balanceAfter, input.appId, input.userId],
  )
  input.account[field] = input.balanceAfter
  input.account.version = Number(input.account.version) + 1
  const entryId = input.createId()
  await tx.query(
    `INSERT INTO mip_growth_entries (
       id, app_id, user_id, rule_id, source_event_id, source_event_type,
       metric, delta_value, balance_after, adjustment_reason, actor_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entryId, input.appId, input.userId, input.ruleId || null,
      input.sourceEventId, input.sourceEventType, input.metric, input.delta,
      input.balanceAfter, input.adjustmentReason || null, input.actorUserId || null],
  )
  await tx.query(
    `INSERT INTO mip_outbox_events (
       id, app_id, aggregate_type, aggregate_id, event_type,
       source_version, payload_json, status
     ) VALUES (?, ?, 'GROWTH_ENTRY', ?, 'growth.changed', ?, JSON_OBJECT(), 'PENDING')`,
    [input.createId(), input.appId, entryId, input.account.version],
  )
  return entryId
}

function entryResult(entry, ruleKey, idempotent) {
  return {
    id: entry.id,
    ...(ruleKey ? { ruleKey } : {}),
    metric: entry.metric,
    requestedDelta: Number(entry.delta_value),
    appliedDelta: Number(entry.delta_value),
    balanceAfter: Number(entry.balance_after),
    capped: false,
    idempotent,
  }
}

function sameCycle(recorded, reversal) {
  return recorded.app_id === reversal.app_id
    && recorded.checkin_id === reversal.checkin_id
    && recorded.registration_id === reversal.registration_id
    && recorded.event_id === reversal.event_id
    && recorded.user_id === reversal.user_id
    && Number(reversal.checkin_version) === Number(recorded.checkin_version) + 1
    && Number(reversal.registration_version) === Number(recorded.registration_version) + 1
}

function validateInput(input) {
  if (!input || typeof input.appId !== 'string' || !input.appId.trim()
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(input.transitionId || ''))) {
    throw new Error('VALIDATION_FAILED')
  }
}

module.exports = {
  CHECKED_IN_EVENT,
  CHECKIN_REVOKED_EVENT,
  createCheckInGrowthRepository,
  sameCycle,
}
