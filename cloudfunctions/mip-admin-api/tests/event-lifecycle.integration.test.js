'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminEventRepository } = require('../domain/repositories/events')
const { createRegistration, getMyRegistration } = require('../../mip-events-api/domain/event-service')

const APP_ID = 'wx-event-lifecycle'
const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2030-08-25T00:00:00.000Z')

function lifecycleDatabase() {
  const state = {
    event: null,
    registration: null,
    checkin: null,
    transitions: [],
  }
  const tx = {
    async one(sql) {
      const text = String(sql)
      if (text.includes('COUNT(*) AS total')) {
        return { total: state.registration?.status === 'REGISTERED' || state.registration?.status === 'ATTENDED' ? 1 : 0 }
      }
      if (text.includes('SELECT r.status, r.order_id')) {
        return state.registration
          ? { ...state.registration, event_status: state.event.status, registration_deadline: null, starts_at: state.event.starts_at }
          : null
      }
      if (text.includes('FROM mip_event_registrations')) return state.registration
      if (text.includes('FROM mip_event_checkin_transitions')) return state.transitions[0] ? { id: state.transitions[0][0] } : null
      if (text.includes('FROM mip_event_checkins')) return state.checkin
      if (text.includes('FROM mip_users')) return { id: ADMIN_ID, status: 'ACTIVE' }
      if (text.includes('FROM mip_events')) return state.event
      if (text.includes('FROM mip_idempotency_keys')) return null
      throw new Error(`unexpected one query: ${text}`)
    },
    async query(sql, params) {
      const text = String(sql)
      if (text.includes('INSERT INTO mip_events')) {
        state.event = {
          id: params[0], app_id: params[1], scope_type: params[2], branch_id: params[3],
          title: params[5], status: 'DRAFT', content_safety_status: params[16], starts_at: params[17],
          ends_at: params[18], registration_schema_json: params[30], form_version: 1,
          version: 1, access_type: params[12], registration_policy: params[13],
          capacity: params[27], waitlist_enabled: params[28],
        }
      }
      else if (text.includes('UPDATE mip_events SET status =')) {
        state.event.status = params[0]
        state.event.version += 1
      }
      else if (text.includes('INSERT INTO mip_event_registrations')) {
        state.registration = {
          id: params[0], app_id: params[1], event_id: params[2], user_id: params[3],
          status: params[5], answers_json: params[6], form_version: params[7],
          share_profile: params[8], version: 1, created_at: NOW, registered_at: NOW,
        }
      }
      else if (text.includes("UPDATE mip_event_registrations SET status = 'ATTENDED'")) {
        state.registration.status = 'ATTENDED'
        state.registration.version += 1
      }
      else if (text.includes("UPDATE mip_event_registrations SET status = 'REGISTERED'")) {
        state.registration.status = 'REGISTERED'
        state.registration.version += 1
      }
      else if (text.includes('INSERT INTO mip_event_checkins')) {
        state.checkin = { id: params[0], version: 1, status: 'ACTIVE', checked_in_at: NOW }
      }
      else if (text.includes("UPDATE mip_event_checkins SET status = 'REVOKED'")) {
        state.checkin.status = 'REVOKED'
        state.checkin.version += 1
      }
      else if (text.includes('INSERT INTO mip_event_checkin_transitions')) {
        state.transitions.push(params)
      }
      if (text.includes('INSERT INTO mip_event_types')
        || text.includes('INSERT INTO mip_events')
        || text.includes('INSERT INTO mip_event_changes')
        || text.includes('UPDATE mip_events SET status =')
        || text.includes('INSERT INTO mip_event_registrations')
        || text.includes("UPDATE mip_event_registrations SET status =")
        || text.includes('UPDATE mip_event_seat_holds SET status =')
        || text.includes('INSERT IGNORE INTO mip_event_invitation_attributions')
        || text.includes('INSERT INTO mip_event_checkins')
        || text.includes("UPDATE mip_event_checkins SET status = 'REVOKED'")
        || text.includes('INSERT INTO mip_event_checkin_transitions')
        || text.includes('INSERT INTO mip_audit_logs')
        || text.includes('INSERT INTO mip_outbox_events')
        || text.includes('UPDATE mip_idempotency_keys')
        || text.includes('INSERT INTO mip_idempotency_keys')
        || text.includes('UPDATE mip_event_content_media')) return { affectedRows: 1 }
      throw new Error(`unexpected query: ${text}`)
    },
  }
  const database = {
    async transaction(work) { return work(tx) },
    async one(sql) { return tx.one(sql) },
    async query(sql, params) {
      if (String(sql).includes('FROM mip_event_registrations')) {
        return state.registration ? [{
          id: state.registration.id,
          user_id: state.registration.user_id,
          status: state.registration.status,
          answers_json: state.registration.answers_json,
          registration_schema_json: state.event.registration_schema_json,
          created_at: NOW,
          registered_at: NOW,
          nickname: '测试参与者',
          city_name: '深圳',
          phone_ciphertext: null,
          phone_verified_at: NOW,
          checked_in_at: state.checkin?.status === 'ACTIVE' ? NOW : null,
          version: state.registration.version,
        }] : []
      }
      throw new Error(`unexpected database query: ${String(sql)}`)
    },
  }
  return { database, state }
}

function repository(database) {
  let idSequence = 0
  return createAdminEventRepository(database, {
    assertAuthorizedScope() {},
    assertMutationScope() {},
    async lockMutationAuthorization() {
      return { capability: 'events.write', effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null } }
    },
    eventScopeFromRow(row, eventId = row.id) {
      return { scopeType: 'EVENT', scopeId: eventId, branchId: row.branch_id || null }
    },
    createId: () => {
      idSequence += 1
      return `66666666-6666-4666-8666-${String(idSequence).padStart(12, '0')}`
    },
    now: () => NOW,
    repositorySupport: {
      codeError: code => Object.assign(new Error(code), { code }),
      duplicateConstraint: () => '',
      escapeLike: value => value,
      iso: value => new Date(value).toISOString(),
      json: (value, fallback = {}) => {
        if (value === null || value === undefined) return fallback
        if (typeof value === 'object') return value
        try { return JSON.parse(value) } catch { return fallback }
      },
    },
    sameScope: (left, right) => left?.scopeType === right?.scopeType && (left?.scopeId || null) === (right?.scopeId || null),
    visibleEventsWhere: () => ({ sql: '1 = 1', params: [] }),
    async writeAudit() {},
    async writeOutbox() {},
  })
}

describe('event lifecycle integration', () => {
  it('runs create, publish, register, roster, check-in, undo, end, and mine in one fixture', async () => {
    const { database, state } = lifecycleDatabase()
    const events = repository(database)
    const draft = {
      scopeType: 'PLATFORM', branchId: null, title: '端到端活动', summary: '生命周期测试',
      description: '生命周期测试', notices: '', coverAssetId: null, contentMedia: [],
      startsAt: new Date('2030-08-26T10:00:00.000Z'), endsAt: new Date('2030-08-26T12:00:00.000Z'),
      registrationDeadline: null, cancellationDeadline: null, venueName: '现场', address: '深圳',
      cityName: '深圳', latitude: null, longitude: null, capacity: 1, eventTypeKey: 'general',
      eventMode: 'OFFLINE', accessType: 'FREE', registrationPolicy: 'AUTO', albumEnabled: false,
      albumSubmissionPolicy: 'REVIEW', onlineUrl: '', waitlistEnabled: false, priceCents: 0,
      registrationSchema: [{ key: 'role', type: 'TEXT', label: '参与身份', required: false, maxLength: 120 }],
    }
    const created = await events.saveEvent({ appId: APP_ID, actorUserId: ADMIN_ID, eventId: null, expectedVersion: null, draft, contentSafetyStatus: 'PASSED', audit: () => ({}) })
    assert.deepEqual({ status: created.status, version: created.version }, { status: 'DRAFT', version: 1 })
    assert.equal(state.event.title, draft.title)
    assert.equal(state.event.capacity, 1)
    assert.notEqual(state.event.registration_schema_json, '')
    const published = await events.changeEventStatus({ appId: APP_ID, actorUserId: ADMIN_ID, eventId: created.id, expectedVersion: 1, status: 'PUBLISHED', authorizedScope: { scopeType: 'EVENT', scopeId: created.id, branchId: null }, audit: {} })
    assert.equal(published.status, 'PUBLISHED')
    const registration = await createRegistration(database, {
      appId: APP_ID, userId: USER_ID, input: { eventId: created.id, formVersion: 1, answers: { role: '嘉宾' }, idempotencyKey: 'lifecycle-register' },
      now: NOW, resolveUserKind: async () => 'GUEST', participationAccessPolicy: { requireAccess: async () => ({ id: USER_ID }) },
    })
    assert.equal(registration.status, 'REGISTERED')
    assert.equal(registration.registrationId, state.registration.id)
    const roster = await events.listRoster(APP_ID, created.id, { status: '', query: '' }, 20)
    assert.equal(roster.items.length, 1)
    assert.deepEqual({ id: roster.items[0].id, nickname: roster.items[0].nickname, status: roster.items[0].status, version: roster.items[0].version }, { id: state.registration.id, nickname: '测试参与者', status: 'REGISTERED', version: 1 })
    const checkedIn = await events.checkIn({ appId: APP_ID, actorUserId: ADMIN_ID, eventId: created.id, registrationId: registration.registrationId, expectedVersion: 1, authorizedScope: { scopeType: 'EVENT', scopeId: created.id, branchId: null }, audit: {} })
    assert.equal(checkedIn.status, 'ATTENDED')
    assert.ok(state.checkin.id)
    assert.notEqual(state.checkin.id, created.id)
    const repeated = await events.checkIn({ appId: APP_ID, actorUserId: ADMIN_ID, eventId: created.id, registrationId: registration.registrationId, expectedVersion: 2, authorizedScope: { scopeType: 'EVENT', scopeId: created.id, branchId: null }, audit: {} })
    assert.equal(repeated.idempotent, true)
    const undone = await events.undoCheckIn({ appId: APP_ID, actorUserId: ADMIN_ID, eventId: created.id, registrationId: registration.registrationId, expectedVersion: 2, reason: '测试撤销', authorizedScope: { scopeType: 'EVENT', scopeId: created.id, branchId: null }, audit: {} })
    assert.equal(undone.status, 'REGISTERED')
    const ended = await events.changeEventStatus({ appId: APP_ID, actorUserId: ADMIN_ID, eventId: created.id, expectedVersion: 2, status: 'ENDED', authorizedScope: { scopeType: 'EVENT', scopeId: created.id, branchId: null }, audit: {} })
    assert.equal(ended.status, 'ENDED')
    const mine = await getMyRegistration(database, { appId: APP_ID, userId: USER_ID, eventId: created.id, now: new Date('2030-08-26T13:00:00.000Z') })
    assert.equal(mine.status, 'REGISTERED')
    assert.equal(mine.canEdit, false)
    assert.equal(mine.version, state.registration.version)
    assert.equal(state.transitions.length, 2)
  })
})
