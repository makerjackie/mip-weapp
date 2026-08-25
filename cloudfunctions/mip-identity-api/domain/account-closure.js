'use strict'

const { createHash, randomUUID } = require('node:crypto')

const OPERATION = 'identity.closeAccount'
const TERMINAL_DELIVERY_OUTCOMES = Object.freeze(['NOT_ATTEMPTED', 'KNOWN_FAILED'])
const TERMINAL_DELIVERY_OUTCOMES_SQL = TERMINAL_DELIVERY_OUTCOMES
  .map(value => `'${value}'`)
  .join(', ')
const CLOSED_PROFILE_VISIBILITY = Object.freeze({
  nickname: false,
  avatar: false,
  identityStatus: false,
  headline: false,
  introduction: false,
  companies: false,
  organizations: false,
  industry: false,
  abilities: false,
  primaryBranch: false,
})

function createAccountClosureRepository(database, options = {}) {
  const createId = options.id || randomUUID
  const now = options.now || (() => new Date())

  async function closeAccount(caller, ensuredUser, input) {
    return database.transaction(async (tx) => {
      const identity = await tx.one(
        `SELECT id, identity_key, closed_identity_key
         FROM mip_user_identities
         WHERE app_id = ? AND user_id = ? AND provider = 'WECHAT_MINIPROGRAM'
         FOR UPDATE`,
        [caller.appId, ensuredUser.id],
      )
      if (!identity) throw new Error('AUTH_REQUIRED')

      const user = await tx.one(
        `SELECT id, status, version, closed_at
         FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, ensuredUser.id],
      )
      if (!user) throw new Error('AUTH_REQUIRED')

      const claim = await claimIdempotency(tx, {
        appId: caller.appId,
        userId: user.id,
        idempotencyKey: input.idempotencyKey,
        request: {
          confirmationPhrase: input.confirmationPhrase,
          expectedVersion: input.expectedVersion,
        },
        createId,
      })
      if (claim.replay) {
        return { ...claim.replay, idempotent: true }
      }
      if (Number(user.version) !== input.expectedVersion) {
        throw new Error('ACCOUNT_CLOSURE_CONFLICT')
      }

      if (user.status === 'CLOSED' && identity.closed_identity_key) {
        const response = closureResponse(user, true)
        await completeIdempotency(tx, claim, {
          appId: caller.appId,
          userId: user.id,
          response,
        })
        return response
      }

      await assertNoPendingSettlement(tx, caller.appId, user.id)
      const closedAt = now()
      const effects = await revokeAndMinimize(tx, {
        appId: caller.appId,
        user,
        identity,
        closedAt,
        tombstoneKey: identityTombstone(caller.appId, identity.id, createId()),
      })
      const response = {
        status: 'CLOSED',
        version: Number(user.version) + 1,
        closedAt: closedAt.toISOString(),
        idempotent: false,
      }
      await writeClosureAudit(tx, {
        appId: caller.appId,
        userId: user.id,
        effects,
      })
      await completeIdempotency(tx, claim, {
        appId: caller.appId,
        userId: user.id,
        response,
      })
      return response
    })
  }

  return { closeAccount }
}

async function assertNoPendingSettlement(tx, appId, userId) {
  const pendingOrders = await tx.query(
    `SELECT id FROM mip_orders
     WHERE app_id = ? AND user_id = ?
       AND status IN ('CREATED', 'PAYMENT_CREATED', 'REFUND_PENDING')
     FOR UPDATE`,
    [appId, userId],
  )
  const pendingAttempts = await tx.query(
    `SELECT attempt.id
     FROM mip_payment_attempts attempt
     INNER JOIN mip_orders ordered
       ON ordered.app_id = attempt.app_id AND ordered.id = attempt.order_id
     WHERE ordered.app_id = ? AND ordered.user_id = ?
       AND attempt.status IN ('CREATED', 'PARAMETERS_ISSUED', 'PENDING')
     FOR UPDATE`,
    [appId, userId],
  )
  const pendingRefunds = await tx.query(
    `SELECT refund.id
     FROM mip_refunds refund
     INNER JOIN mip_orders ordered
       ON ordered.app_id = refund.app_id AND ordered.id = refund.order_id
     WHERE ordered.app_id = ? AND ordered.user_id = ?
       AND refund.status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING')
     FOR UPDATE`,
    [appId, userId],
  )
  const pendingRegistrations = await tx.query(
    `SELECT id FROM mip_event_registrations
     WHERE app_id = ? AND user_id = ?
       AND status IN ('PAYMENT_PENDING', 'CANCELLATION_PENDING')
     FOR UPDATE`,
    [appId, userId],
  )
  const activeSeatHolds = await tx.query(
    `SELECT id FROM mip_event_seat_holds
     WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
     FOR UPDATE`,
    [appId, userId],
  )
  if ([pendingOrders, pendingAttempts, pendingRefunds, pendingRegistrations, activeSeatHolds]
    .some(rows => Array.isArray(rows) && rows.length > 0)) {
    throw new Error('ACCOUNT_CLOSURE_PENDING_SETTLEMENT')
  }
}

async function revokeAndMinimize(tx, input) {
  const { appId, user, identity, closedAt, tombstoneKey } = input
  const effects = {}
  effects.branchMemberships = affected(await tx.query(
    `UPDATE mip_branch_memberships
     SET status = 'INACTIVE', ended_at = ?
     WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'`,
    [closedAt, appId, user.id],
  ))
  effects.adminRoles = affected(await tx.query(
    `UPDATE mip_admin_role_bindings
     SET status = 'REVOKED', revoked_at = ?
     WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'`,
    [closedAt, appId, user.id],
  ))
  effects.opportunities = affected(await tx.query(
    `UPDATE mip_opportunities
     SET status = 'UNPUBLISHED', version = version + 1
     WHERE app_id = ? AND owner_user_id = ? AND status = 'PUBLISHED'`,
    [appId, user.id],
  ))
  effects.cooperationCards = affected(await tx.query(
    `UPDATE mip_cooperation_cards
     SET status = 'UNPUBLISHED', version = version + 1
     WHERE app_id = ? AND owner_user_id = ? AND status = 'PUBLISHED'`,
    [appId, user.id],
  ))
  effects.superCases = affected(await tx.query(
    `UPDATE mip_super_cases
     SET status = 'UNPUBLISHED', version = version + 1
     WHERE app_id = ? AND owner_user_id = ? AND status = 'PUBLISHED'`,
    [appId, user.id],
  ))
  const activeReferrals = await tx.query(
    `SELECT referral.id, referral.opportunity_id
     FROM mip_referral_intents referral
     INNER JOIN mip_opportunities opportunity
       ON opportunity.app_id = referral.app_id AND opportunity.id = referral.opportunity_id
     WHERE referral.app_id = ? AND referral.status = 'ACTIVE'
       AND (
         referral.actor_user_id = ?
         OR referral.target_user_id = ?
         OR opportunity.owner_user_id = ?
       )
     FOR UPDATE`,
    [appId, user.id, user.id, user.id],
  )
  effects.referrals = affected(await tx.query(
    `UPDATE mip_referral_intents referral
     INNER JOIN mip_opportunities opportunity
       ON opportunity.app_id = referral.app_id AND opportunity.id = referral.opportunity_id
     SET referral.status = 'CANCELLED', referral.cancelled_at = ?,
       referral.version = referral.version + 1
     WHERE referral.app_id = ? AND referral.status = 'ACTIVE'
       AND (
         referral.actor_user_id = ?
         OR referral.target_user_id = ?
         OR opportunity.owner_user_id = ?
       )`,
    [closedAt, appId, user.id, user.id, user.id],
  ))
  const referralCounts = countBy(activeReferrals, 'opportunity_id')
  for (const [opportunityId, total] of referralCounts) {
    await tx.query(
      `UPDATE mip_opportunities
       SET referral_count = GREATEST(0, referral_count - ?)
       WHERE app_id = ? AND id = ?`,
      [total, appId, opportunityId],
    )
  }
  effects.referralCountAdjustments = referralCounts.size
  effects.profileInterests = affected(await tx.query(
    `UPDATE mip_profile_interests
     SET status = 'CANCELLED', cancelled_at = ?, version = version + 1
     WHERE app_id = ? AND status = 'ACTIVE'
       AND (actor_user_id = ? OR target_user_id = ?)`,
    [closedAt, appId, user.id, user.id],
  ))
  effects.blocks = affected(await tx.query(
    `UPDATE mip_user_blocks
     SET status = 'INACTIVE', unblocked_at = ?, version = version + 1
     WHERE app_id = ? AND blocker_user_id = ? AND status = 'ACTIVE'`,
    [closedAt, appId, user.id],
  ))
  effects.deliveryTasks = affected(await tx.query(
    `UPDATE mip_delivery_tasks task
     INNER JOIN mip_inbox_messages message
       ON message.app_id = task.app_id AND message.id = task.inbox_message_id
     SET task.last_error_code = COALESCE(
           task.last_error_code,
           CASE WHEN task.status <> 'PROCESSING'
             AND task.last_outcome IN (${TERMINAL_DELIVERY_OUTCOMES_SQL})
             THEN 'DELIVERY_RECIPIENT_INACTIVE'
             ELSE 'DELIVERY_OUTCOME_UNKNOWN'
           END
         ),
       task.last_outcome = CASE
         WHEN task.status <> 'PROCESSING'
           AND task.last_outcome IN (${TERMINAL_DELIVERY_OUTCOMES_SQL}) THEN task.last_outcome
         ELSE 'UNKNOWN'
       END,
       task.retry_disposition = CASE
         WHEN task.status <> 'PROCESSING'
           AND task.last_outcome IN (${TERMINAL_DELIVERY_OUTCOMES_SQL}) THEN 'TERMINAL'
         ELSE 'MANUAL_REVIEW'
       END,
       task.outcome_updated_at = ?, task.lease_expires_at = NULL,
       task.status = 'CANCELLED'
     WHERE message.app_id = ? AND message.recipient_user_id = ?
       AND task.status IN ('PENDING', 'PROCESSING', 'FAILED')`,
    [closedAt, appId, user.id],
  ))
  effects.notificationGrants = affected(await tx.query(
    `UPDATE mip_notification_grants
     SET recipient_hash = SHA2(CONCAT('closed:', id), 256),
       recipient_ciphertext = ?,
       reservation_task_id = NULL,
       reservation_token = NULL,
       reservation_expires_at = NULL,
       status = CASE WHEN status IN ('AVAILABLE', 'RESERVED') THEN 'REVOKED' ELSE status END
     WHERE app_id = ? AND user_id = ?`,
    [Buffer.alloc(0), appId, user.id],
  ))
  effects.exportTickets = affected(await tx.query(
    `UPDATE mip_admin_export_tickets
     SET status = 'REVOKED', reserved_until = NULL
     WHERE app_id = ? AND requested_by_user_id = ?
       AND status IN ('PENDING', 'READY', 'RESERVED')`,
    [appId, user.id],
  ))
  effects.aiDrafts = affected(await tx.query(
    `UPDATE mip_ai_drafts
     SET audio_asset_id = NULL, provider_job_key_hash = NULL,
       transcript_text = NULL, structured_draft_json = NULL, status = 'DELETED',
       confirmed_resource_type = NULL, confirmed_resource_id = NULL,
       version = version + 1
     WHERE app_id = ? AND user_id = ? AND status <> 'DELETED'`,
    [appId, user.id],
  ))
  effects.profile = affected(await tx.query(
    `UPDATE mip_profiles
     SET nickname = '已注销用户', avatar_asset_id = NULL, identity_status = NULL,
       headline = NULL, introduction = NULL, companies_json = JSON_ARRAY(),
       organizations_json = JSON_ARRAY(), visibility_json = ?, version = version + 1
     WHERE app_id = ? AND user_id = ?`,
    [JSON.stringify(CLOSED_PROFILE_VISIBILITY), appId, user.id],
  ))
  effects.privateProfile = affected(await tx.query(
    `UPDATE mip_private_profiles
     SET phone_hash = NULL, phone_ciphertext = NULL, phone_verified_at = NULL
     WHERE app_id = ? AND user_id = ?`,
    [appId, user.id],
  ))

  const identityUpdate = await tx.query(
    `UPDATE mip_user_identities
     SET closed_identity_key = identity_key, identity_key = ?, union_identity_key = NULL
     WHERE app_id = ? AND id = ? AND user_id = ? AND closed_identity_key IS NULL`,
    [tombstoneKey, appId, identity.id, user.id],
  )
  if (affected(identityUpdate) !== 1) throw new Error('ACCOUNT_CLOSURE_CONFLICT')

  const userUpdate = await tx.query(
    `UPDATE mip_users
     SET status = 'CLOSED', primary_branch_id = NULL, closed_at = ?, version = version + 1
     WHERE app_id = ? AND id = ? AND version = ? AND status IN ('ACTIVE', 'BLOCKED', 'CLOSED')`,
    [closedAt, appId, user.id, Number(user.version)],
  )
  if (affected(userUpdate) !== 1) throw new Error('ACCOUNT_CLOSURE_CONFLICT')
  return effects
}

async function claimIdempotency(tx, input) {
  const requestHash = sha256(JSON.stringify(input.request))
  try {
    await tx.query(
      `INSERT INTO mip_idempotency_keys (
        id, app_id, actor_user_id, operation, idempotency_key,
        request_hash, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [input.createId(), input.appId, input.userId, OPERATION,
        input.idempotencyKey, requestHash],
    )
    return { key: input.idempotencyKey, requestHash, replay: null }
  }
  catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY' && Number(error?.errno) !== 1062) throw error
    const stored = await tx.one(
      `SELECT request_hash, status, response_json
       FROM mip_idempotency_keys
       WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
       FOR UPDATE`,
      [input.appId, input.userId, OPERATION, input.idempotencyKey],
    )
    if (!stored || stored.request_hash !== requestHash || stored.status !== 'COMPLETED') {
      throw new Error('ACCOUNT_CLOSURE_CONFLICT')
    }
    const replay = parseClosureResponse(stored.response_json)
    if (!replay) throw new Error('ACCOUNT_CLOSURE_CONFLICT')
    return { key: input.idempotencyKey, requestHash, replay }
  }
}

async function completeIdempotency(tx, claim, input) {
  const updated = await tx.query(
    `UPDATE mip_idempotency_keys
     SET status = 'COMPLETED', response_json = ?
     WHERE app_id = ? AND actor_user_id = ? AND operation = ?
       AND idempotency_key = ? AND request_hash = ? AND status = 'RUNNING'`,
    [JSON.stringify(input.response), input.appId, input.userId, OPERATION,
      claim.key, claim.requestHash],
  )
  if (affected(updated) !== 1) throw new Error('ACCOUNT_CLOSURE_CONFLICT')
}

async function writeClosureAudit(tx, input) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'USER', 'RESOURCE', ?, 'IDENTITY_ACCOUNT_CLOSED',
      'USER', ?, NULL, ?)`,
    [input.appId, input.userId, input.userId, input.userId, JSON.stringify(input.effects)],
  )
}

function closureResponse(user, idempotent) {
  const closedAt = iso(user.closed_at)
  if (!closedAt) throw new Error('ACCOUNT_CLOSURE_CONFLICT')
  return {
    status: 'CLOSED',
    version: Number(user.version),
    closedAt,
    idempotent,
  }
}

function parseClosureResponse(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (parsed?.status !== 'CLOSED'
      || !Number.isInteger(Number(parsed.version))
      || !iso(parsed.closedAt)) return null
    return {
      status: 'CLOSED',
      version: Number(parsed.version),
      closedAt: iso(parsed.closedAt),
      idempotent: Boolean(parsed.idempotent),
    }
  }
  catch {
    return null
  }
}

function identityTombstone(appId, identityId, nonce) {
  return sha256(`closed\0${appId}\0${identityId}\0${nonce}`)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function affected(result) {
  return Number(result?.affectedRows || 0)
}

function countBy(rows, key) {
  const counts = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = row?.[key]
    if (typeof value === 'string' && value) {
      counts.set(value, (counts.get(value) || 0) + 1)
    }
  }
  return counts
}

function iso(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function classifyDeliveryClosureState(status, lastOutcome, lastErrorCode = '') {
  const outcome = status !== 'PROCESSING' && TERMINAL_DELIVERY_OUTCOMES.includes(lastOutcome)
    ? lastOutcome
    : 'UNKNOWN'
  return {
    lastOutcome: outcome,
    retryDisposition: outcome === 'UNKNOWN' ? 'MANUAL_REVIEW' : 'TERMINAL',
    lastErrorCode: lastErrorCode || (outcome === 'UNKNOWN'
      ? 'DELIVERY_OUTCOME_UNKNOWN'
      : 'DELIVERY_RECIPIENT_INACTIVE'),
  }
}

module.exports = {
  CLOSED_PROFILE_VISIBILITY,
  classifyDeliveryClosureState,
  createAccountClosureRepository,
}
