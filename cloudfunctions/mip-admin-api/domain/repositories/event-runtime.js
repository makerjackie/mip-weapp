'use strict'

const { createHash, randomBytes, randomUUID } = require('node:crypto')
const { cursorPredicateFor, pageRows } = require('../pagination')

function createAdminEventRuntimeRepository(database, dependencies) {
  const { lockMutationAuthorization: lockMutation, assertMutationScope: assertScope, assertAuthorizedScope,
    eventScopeFromRow, writeAudit, writeOutbox, fullAccessPolicy, cancelEventRegistrations } = dependencies
  const { codeError, iso, json } = dependencies.repositorySupport
  const id = dependencies.createId || randomUUID
  const bytes = dependencies.randomBytes || randomBytes
  const now = dependencies.now || (() => new Date())
  async function lockEvent(tx, input) {
    const authorization = await lockMutation(tx, input)
    const event = await tx.one('SELECT * FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE', [input.appId, input.eventId])
    if (!event) throw codeError('NOT_FOUND')
    const scope = eventScopeFromRow(event, input.eventId)
    assertScope(authorization, scope)
    assertAuthorizedScope(scope, input.authorizedScope)
    return event
  }
  async function eligible(tx, appId, userId, event, time) {
    const user = await fullAccessPolicy.loadByUserId(tx, appId, userId, { lock: true })
    if (!user || user.status !== 'ACTIVE' || !user.agreementsAccepted || !user.phoneBound || !user.profileComplete) return false
    if (event.access_type === 'MEMBER_INCLUDED') {
      return Boolean(await tx.one(`SELECT id FROM mip_membership_entitlements WHERE app_id = ? AND user_id = ?
        AND status = 'ACTIVE' AND starts_at <= ? AND ends_at > ? ORDER BY ends_at DESC, id DESC LIMIT 1 FOR UPDATE`, [appId, userId, time, time]))
    }
    return true
  }
  async function emit(tx, input, registrationId, userId, status, version, extra = {}) {
    await writeOutbox(tx, { id: id(), appId: input.appId, aggregateType: 'EVENT_REGISTRATION', aggregateId: registrationId,
      eventType: status === 'REGISTERED' ? 'event.registration_confirmed' : status === 'WAITLISTED' ? 'event.registration_waitlisted' : 'event.registration_submitted',
      sourceVersion: version, payload: { eventId: input.eventId, userId, status, ...extra } })
  }
  async function promote(tx, input, event, time) {
    if (event.status !== 'PUBLISHED' || time >= new Date(event.starts_at) || event.access_type === 'PAID') return
    let after = null
    while (true) {
      const next = await tx.one(`SELECT id, user_id, version, waitlisted_at FROM mip_event_registrations
        WHERE app_id = ? AND event_id = ? AND status = 'WAITLISTED'
        ${after ? 'AND (waitlisted_at > ? OR (waitlisted_at = ? AND id > ?))' : ''}
        ORDER BY waitlisted_at ASC, id ASC LIMIT 1 FOR UPDATE`, [input.appId, input.eventId, ...(after ? [after.waitlisted_at, after.waitlisted_at, after.id] : [])])
      if (!next) return
      if (!await eligible(tx, input.appId, next.user_id, event, time)) { after = next; continue }
      const status = event.registration_policy === 'APPROVAL' ? 'PENDING_REVIEW' : 'REGISTERED'
      const updated = await tx.query(`UPDATE mip_event_registrations SET status = ?, ticket_hash = ?, registered_at = ?, waitlisted_at = NULL,
        version = version + 1 WHERE app_id = ? AND id = ? AND version = ? AND status = 'WAITLISTED'`,
      [status, status === 'REGISTERED' ? createHash('sha256').update(bytes(24)).digest('hex') : null,
        status === 'REGISTERED' ? time : null, input.appId, next.id, next.version])
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      await emit(tx, input, next.id, next.user_id, status, Number(next.version) + 1, { promotedFromWaitlist: true })
      return
    }
  }
  async function listEventFeedbacks(appId, eventId, options = {}) {
    const cursor = cursorPredicateFor('f.submitted_at', options.cursor, 'submittedAt', 'f.id')
    const rows = await database.query(`SELECT f.id, f.rating, f.body, f.answers_json, f.version, f.submitted_at, f.updated_at, p.nickname
      FROM mip_event_feedback f LEFT JOIN mip_profiles p ON p.app_id = f.app_id AND p.user_id = f.user_id
      WHERE f.app_id = ? AND f.event_id = ? ${options.rating ? 'AND f.rating = ?' : ''}${cursor.sql}
      ORDER BY f.submitted_at DESC, f.id DESC LIMIT ?`, [appId, eventId, ...(options.rating ? [options.rating] : []), ...cursor.params, options.limit + 1])
    return pageRows(rows.map(row => ({ id: row.id, nickname: row.nickname || '未填写昵称', rating: Number(row.rating), body: row.body || '',
      answers: json(row.answers_json, {}), version: Number(row.version), submittedAt: iso(row.submitted_at), updatedAt: iso(row.updated_at) })),
    options.limit, row => ({ submittedAt: row.submittedAt, id: row.id }))
  }
  async function listEventHearts(appId, eventId, options) {
    const cursor = cursorPredicateFor('h.updated_at', options.cursor, 'updatedAt', 'h.id')
    const rows = await database.query(`SELECT h.id, h.status, h.updated_at, voter.nickname AS voter_name, target.nickname AS target_name
      FROM mip_event_hearts h LEFT JOIN mip_profiles voter ON voter.app_id = h.app_id AND voter.user_id = h.voter_user_id
      LEFT JOIN mip_profiles target ON target.app_id = h.app_id AND target.user_id = h.target_user_id
      WHERE h.app_id = ? AND h.event_id = ? AND h.status = 'ACTIVE'${cursor.sql}
      ORDER BY h.updated_at DESC, h.id DESC LIMIT ?`, [appId, eventId, ...cursor.params, options.limit + 1])
    return pageRows(rows.map(row => ({ id: row.id, voterNickname: row.voter_name || '未填写昵称', targetNickname: row.target_name || '未填写昵称',
      status: row.status, updatedAt: iso(row.updated_at) })), options.limit, row => ({ updatedAt: row.updatedAt, id: row.id }))
  }
  async function issueAdminCheckinCredential(input) {
    return database.transaction(async (tx) => {
      const event = await lockEvent(tx, input)
      const time = now()
      if (event.status !== 'PUBLISHED') throw codeError('INVALID_STATE')
      const start = new Date(event.starts_at); const end = new Date(event.ends_at)
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || time >= new Date(end.getTime() + 86400000)) throw codeError('EVENT_ENDED')
      const validFrom = input.mode === 'ROTATING' ? time : new Date(start.getTime() - 21600000)
      const validUntil = input.mode === 'ROTATING' ? new Date(Math.min(time.getTime() + 300000, end.getTime() + 86400000)) : new Date(end.getTime() + 86400000)
      if (input.mode === 'ROTATING') await tx.query(`UPDATE mip_event_checkin_credentials SET status = 'REVOKED', revoked_at = ?
        WHERE app_id = ? AND event_id = ? AND mode = 'ROTATING' AND status = 'ACTIVE' AND valid_until > ?`, [time, input.appId, input.eventId, time])
      const credentialId = id(); const scanKey = bytes(8).toString('base64url'); const secret = bytes(8).toString('base64url')
      await tx.query(`INSERT INTO mip_event_checkin_credentials
        (id, app_id, event_id, scan_key, mode, token_hash, valid_from, valid_until, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [credentialId, input.appId, input.eventId, scanKey, input.mode,
        createHash('sha256').update(secret).digest('hex'), validFrom, validUntil, input.actorUserId])
      await writeAudit(tx, { ...input.audit, resourceType: 'EVENT_CHECKIN_CREDENTIAL', resourceId: credentialId })
      return { mode: input.mode, scanToken: `s1.${scanKey}.${secret}`, validUntil: iso(validUntil) }
    })
  }
  async function importParticipant(input) {
    return database.transaction(async (tx) => {
      const event = await lockEvent(tx, input); const time = now()
      // Manual entry cannot manufacture a paid order or replace the payment ledger.
      if (event.status !== 'PUBLISHED' || !['FREE', 'MEMBER_INCLUDED'].includes(event.access_type) || time >= new Date(event.starts_at)) throw codeError('INVALID_STATE')
      if (!await eligible(tx, input.appId, input.userId, event, time)) throw codeError('REGISTRATION_INELIGIBLE')
      const existing = await tx.one('SELECT id, status FROM mip_event_registrations WHERE app_id = ? AND event_id = ? AND user_id = ? FOR UPDATE', [input.appId, input.eventId, input.userId])
      if (existing) throw codeError('CONFLICT')
      const capacity = await tx.one(`SELECT COUNT(*) AS total FROM mip_event_registrations WHERE app_id = ? AND event_id = ?
        AND status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')`, [input.appId, input.eventId])
      const holds = await tx.one(`SELECT COUNT(*) AS total FROM mip_event_seat_holds WHERE app_id = ? AND event_id = ? AND status = 'ACTIVE' AND expires_at > ?`, [input.appId, input.eventId, time])
      const full = event.capacity !== null && Number(capacity?.total || 0) + Number(holds?.total || 0) >= Number(event.capacity)
      if (full && Number(event.waitlist_enabled) !== 1) throw codeError('INVALID_STATE')
      const status = full ? 'WAITLISTED' : event.registration_policy === 'APPROVAL' ? 'PENDING_REVIEW' : 'REGISTERED'
      const registrationId = id()
      await tx.query(`INSERT INTO mip_event_registrations
        (id, app_id, event_id, user_id, status, answers_json, form_version, share_profile, ticket_hash, registered_at, waitlisted_at,
          registration_source, imported_by_user_id, imported_at, import_reason, role_mark)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'ADMIN_IMPORT', ?, ?, ?, ?)`, [registrationId, input.appId, input.eventId, input.userId, status,
        '{}', Number(event.form_version || 1), status === 'REGISTERED' ? createHash('sha256').update(bytes(24)).digest('hex') : null,
        status === 'REGISTERED' ? time : null, status === 'WAITLISTED' ? time : null,
        input.actorUserId, time, input.reason, input.roleMark])
      await writeAudit(tx, { ...input.audit, resourceId: registrationId })
      await emit(tx, input, registrationId, input.userId, status, 1, { importedByAdmin: true })
      return { id: registrationId, status, version: 1 }
    })
  }
  async function markAbnormalParticipant(input) {
    return database.transaction(async (tx) => {
      await lockEvent(tx, input)
      const result = await tx.query(`UPDATE mip_event_registrations SET abnormal_reason = ?, abnormal_marked_at = ?, abnormal_by_user_id = ?,
        version = version + 1 WHERE app_id = ? AND event_id = ? AND id = ? AND version = ?
          AND status NOT IN ('CANCELLED', 'REJECTED')`,
      [input.reason, now(), input.actorUserId, input.appId, input.eventId, input.registrationId, input.expectedVersion])
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit)
      return { id: input.registrationId, abnormalReason: input.reason, version: input.expectedVersion + 1 }
    })
  }
  async function cancelParticipant(input) {
    return database.transaction(async (tx) => {
      const event = await lockEvent(tx, input)
      const row = await tx.one('SELECT id, status, version, order_id FROM mip_event_registrations WHERE app_id = ? AND event_id = ? AND id = ? FOR UPDATE', [input.appId, input.eventId, input.registrationId])
      if (!row) throw codeError('NOT_FOUND')
      if (Number(row.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (!['PENDING_REVIEW', 'WAITLISTED', 'PAYMENT_PENDING', 'REGISTERED'].includes(row.status)) throw codeError('INVALID_STATE')
      const time = now()
      const result = await cancelEventRegistrations(tx, input, time)
      if (result.affectedCount !== 1) throw codeError('CONFLICT')
      const current = await tx.one('SELECT status, version FROM mip_event_registrations WHERE app_id = ? AND id = ?', [input.appId, input.registrationId])
      if (row.status === 'REGISTERED' && current.status === 'CANCELLED') await promote(tx, input, event, time)
      await writeAudit(tx, input.audit)
      return { id: input.registrationId, status: current.status, version: Number(current.version), refundIds: result.refundIds }
    })
  }
  return { listEventFeedbacks, listEventHearts, issueAdminCheckinCredential, importParticipant, markAbnormalParticipant, cancelParticipant }
}
module.exports = { createAdminEventRuntimeRepository }
