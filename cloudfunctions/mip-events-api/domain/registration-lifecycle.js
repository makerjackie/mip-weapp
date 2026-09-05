'use strict'

const { createHash, randomBytes } = require('node:crypto')
const { DomainError } = require('./rules')

async function defaultResolveUserKind(tx, appId, userId, now) {
  const entitlement = await tx.one(
    `SELECT id FROM mip_membership_entitlements
     WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
       AND starts_at <= ? AND ends_at > ?
     ORDER BY ends_at DESC, id DESC LIMIT 1 FOR UPDATE`,
    [appId, userId, now, now],
  )
  return entitlement ? 'PLAYER' : 'GUEST'
}

async function requireActiveUserForMutation(tx, appId, userId) {
  const user = await tx.one(
    `SELECT id, status FROM mip_users
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, userId],
  )
  if (!user || user.status !== 'ACTIVE') {
    throw new DomainError('FORBIDDEN', '当前账号不能执行此操作')
  }
  return user
}

async function requireCurrentParticipationAccess(policy, queryable, appId, userId) {
  if (!policy || typeof policy.requireAccess !== 'function') {
    throw new DomainError('SERVICE_UNAVAILABLE', '活动参与服务暂时不可用', true)
  }
  return policy.requireAccess(queryable, appId, userId)
}

async function promoteWaitlist(tx, { appId, eventId, event, now, participationAccessPolicy, resolveUserKind, writeOutbox }) {
  if (event.status !== 'PUBLISHED' || now >= new Date(event.starts_at)) return null
  let after = null
  let next
  while (true) {
    next = await tx.one(
      `SELECT id, user_id, version, waitlisted_at FROM mip_event_registrations
       WHERE app_id = ? AND event_id = ? AND status = 'WAITLISTED'
         ${after ? 'AND (waitlisted_at > ? OR (waitlisted_at = ? AND id > ?))' : ''}
       ORDER BY waitlisted_at ASC, id ASC LIMIT 1 FOR UPDATE`,
      [appId, eventId, ...(after ? [after.waitlisted_at, after.waitlisted_at, after.id] : [])],
    )
    if (!next) return null
    try {
      await requireActiveUserForMutation(tx, appId, next.user_id)
      await requireCurrentParticipationAccess(participationAccessPolicy, tx, appId, next.user_id)
      if (event.access_type === 'MEMBER_INCLUDED'
        && await resolveUserKind(tx, appId, next.user_id, now) !== 'PLAYER') {
        throw new DomainError('FORBIDDEN', '本活动仅限玩家报名')
      }
      break
    }
    catch (error) {
      if (!['FORBIDDEN', 'AGREEMENT_REQUIRED', 'PHONE_REQUIRED', 'PROFILE_REQUIRED'].includes(error?.code)) throw error
      after = next
    }
  }

  const status = event.registration_policy === 'APPROVAL' ? 'PENDING_REVIEW' : 'REGISTERED'
  const updated = await tx.query(
    `UPDATE mip_event_registrations SET
      status = ?, ticket_hash = ?, registered_at = ?, waitlisted_at = NULL,
      version = version + 1
     WHERE app_id = ? AND id = ? AND version = ?`,
    [status, status === 'REGISTERED' ? createHash('sha256').update(randomBytes(24)).digest('hex') : null,
      status === 'REGISTERED' ? now : null, appId, next.id, next.version],
  )
  if (Number(updated?.affectedRows) !== 1) {
    throw new DomainError('CONFLICT', '候补状态已变化，请刷新后重试', true)
  }
  await writeOutbox(tx, {
    appId,
    aggregateType: 'EVENT_REGISTRATION',
    aggregateId: next.id,
    eventType: status === 'REGISTERED' ? 'event.registration_confirmed' : 'event.registration_submitted',
    sourceVersion: Number(next.version) + 1,
    payload: { eventId, userId: next.user_id, status, promotedFromWaitlist: true },
  })
  return next.id
}

module.exports = {
  defaultResolveUserKind,
  requireActiveUserForMutation,
  requireCurrentParticipationAccess,
  promoteWaitlist,
}
