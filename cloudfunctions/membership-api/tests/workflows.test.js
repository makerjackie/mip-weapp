'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')
const {
  cancelEventRegistration,
  deleteMemberAccount,
  registerForEvent,
} = require('../lib/workflows')

const APP_ID = 'wx-app'
const USER_ID = 'openid'
const EVENT_ID = 'event-1'
const REG_ID = 'reg-existing'

/**
 * Fake transactional DB that records SQL kind/sql/params and resolves
 * rows from ordered matchers. Matchers receive the normalized SQL text.
 */
function createFakeDb(matchers, { queryAffectedRows = 1 } = {}) {
  const calls = []

  function normalize(sql) {
    return String(sql).replace(/\s+/g, ' ').trim()
  }

  function resolve(kind, sql, params) {
    const normalized = normalize(sql)
    calls.push({ kind, sql: normalized, params: params || [] })
    for (const matcher of matchers) {
      if (matcher.match(normalized, params || [], kind)) {
        return typeof matcher.result === 'function'
          ? matcher.result(normalized, params || [], kind)
          : matcher.result
      }
    }
    return null
  }

  const db = {
    async transaction(work) {
      return work({
        async one(sql, params) {
          return resolve('one', sql, params)
        },
        async query(sql, params) {
          resolve('query', sql, params)
          return { affectedRows: queryAffectedRows }
        },
      })
    },
  }

  return { db, calls }
}

function includesAll(sql, fragments) {
  return fragments.every(fragment => sql.includes(fragment))
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

function baseMatchers(overrides = {}) {
  const {
    phone = { phone_number: '13800000000' },
    event = {
      id: EVENT_ID,
      capacity: 1,
      price_cents: 0,
      member_free: 0,
      registration_deadline: null,
      status: 'PUBLISHED',
      starts_at: hoursFromNow(48).toISOString(),
    },
    existing = null,
    count = { total: 0 },
    entitlement = { id: 'ent-1' },
  } = overrides

  return [
    {
      match: sql => includesAll(sql, ['FROM member_events', 'FOR UPDATE']),
      result: event,
    },
    {
      match: (sql, _params, kind) =>
        kind === 'one'
        && includesAll(sql, ['FROM member_registrations', 'user_id', 'FOR UPDATE'])
        && !sql.includes('COUNT(*)'),
      result: existing,
    },
    {
      match: sql => includesAll(sql, ['member_private_profiles', 'phone_number']),
      result: phone,
    },
    {
      match: sql => includesAll(sql, ['FROM member_entitlements', 'ACTIVE']),
      result: entitlement,
    },
    {
      match: sql => includesAll(sql, ['COUNT(*)', 'member_registrations']),
      result: count,
    },
  ]
}

function indexOfCall(calls, predicate) {
  return calls.findIndex(predicate)
}

describe('registerForEvent existing-fact-first', () => {
  it('locks the event then the registration before phone/capacity checks', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: { id: REG_ID, status: 'REGISTERED', ticket_code: 'TLOCKED0001' , version: 1 },
      phone: null,
    }))

    const result = await registerForEvent(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })

    assert.deepEqual(result, { id: REG_ID, status: 'REGISTERED', ticketCode: 'TLOCKED0001', version: 1, idempotent: true })
    const eventIdx = indexOfCall(calls, call =>
      call.kind === 'one' && call.sql.includes('FROM member_events') && call.sql.includes('FOR UPDATE'))
    const regIdx = indexOfCall(calls, call =>
      call.kind === 'one'
      && call.sql.includes('member_registrations')
      && call.sql.includes('user_id')
      && call.sql.includes('FOR UPDATE')
      && !call.sql.includes('COUNT(*)'))
    const phoneIdx = indexOfCall(calls, call => call.sql.includes('member_private_profiles'))
    assert.ok(eventIdx >= 0)
    assert.ok(regIdx > eventIdx, 'registration lock must follow event lock')
    assert.equal(phoneIdx, -1, 'active facts must not check phone')
    assert.deepEqual(calls[eventIdx].params, [EVENT_ID, APP_ID])
    assert.deepEqual(calls[regIdx].params, [APP_ID, EVENT_ID, USER_ID])
  })

  it('returns the same id/status for a full event when already REGISTERED even without phone', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: { id: REG_ID, status: 'REGISTERED', ticket_code: 'TFULL000001' , version: 1 },
      count: { total: 1 },
      phone: null,
      event: {
        id: EVENT_ID,
        capacity: 1,
        price_cents: 0,
        member_free: 0,
        registration_deadline: null,
        status: 'PUBLISHED',
        starts_at: hoursFromNow(48).toISOString(),
      },
    }))

    const result = await registerForEvent(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })

    assert.deepEqual(result, { id: REG_ID, status: 'REGISTERED', ticketCode: 'TFULL000001', version: 1, idempotent: true })
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
    assert.equal(calls.filter(call => call.sql.includes('COUNT(*)')).length, 0)
    assert.equal(calls.filter(call => call.sql.includes('member_private_profiles')).length, 0)
  })

  it('returns ATTENDED without UPDATE when membership expired and capacity full', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: { id: REG_ID, status: 'ATTENDED', ticket_code: 'TATTENDED01' , version: 1 },
      count: { total: 1 },
      phone: null,
      entitlement: null,
      event: {
        id: EVENT_ID,
        capacity: 1,
        price_cents: 0,
        member_free: 1,
        registration_deadline: null,
        status: 'PUBLISHED',
        starts_at: hoursFromNow(48).toISOString(),
      },
    }))

    const result = await registerForEvent(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })

    assert.deepEqual(result, { id: REG_ID, status: 'ATTENDED', ticketCode: 'TATTENDED01', version: 1, idempotent: true })
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
    assert.equal(calls.filter(call => call.sql.includes('member_entitlements')).length, 0)
    assert.equal(calls.filter(call => call.sql.includes('COUNT(*)')).length, 0)
  })

  it('still returns REGISTERED after deadline when the fact already exists', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: { id: REG_ID, status: 'REGISTERED', ticket_code: 'TDEADLINE01' , version: 1 },
      event: {
        id: EVENT_ID,
        capacity: 10,
        price_cents: 0,
        member_free: 0,
        registration_deadline: hoursFromNow(-2).toISOString(),
        status: 'PUBLISHED',
        starts_at: hoursFromNow(48).toISOString(),
      },
    }))

    const result = await registerForEvent(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
      now: new Date(),
    })
    assert.deepEqual(result, { id: REG_ID, status: 'REGISTERED', ticketCode: 'TDEADLINE01', version: 1, idempotent: true })
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
  })

  it('returns empty ticket without UPDATE when historical REGISTERED ticket_code is empty', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: { id: REG_ID, status: 'REGISTERED', ticket_code: null, version: 2 },
      phone: null,
      count: { total: 99 },
    }))

    const result = await registerForEvent(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })

    assert.deepEqual(result, {
      id: REG_ID,
      status: 'REGISTERED',
      ticketCode: '',
      version: 2,
      idempotent: true,
    })
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
    assert.equal(calls.filter(call => /UPDATE\s+member_registrations/i.test(call.sql)).length, 0)
    assert.equal(calls.filter(call => /SET\s+ticket_code/i.test(call.sql)).length, 0)
  })

  it('returns empty ticket without UPDATE when historical ATTENDED ticket_code is blank', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: { id: REG_ID, status: 'ATTENDED', ticket_code: '', version: 4 },
    }))

    const result = await registerForEvent(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })

    assert.deepEqual(result, {
      id: REG_ID,
      status: 'ATTENDED',
      ticketCode: '',
      version: 4,
      idempotent: true,
    })
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
  })

  it('rejects a new registration with EVENT_FULL when capacity is exhausted', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: null,
      count: { total: 1 },
      event: {
        id: EVENT_ID,
        capacity: 1,
        price_cents: 0,
        member_free: 0,
        registration_deadline: null,
        status: 'PUBLISHED',
        starts_at: hoursFromNow(48).toISOString(),
      },
    }))

    await assert.rejects(
      () => registerForEvent(db, { appId: APP_ID, userId: USER_ID, eventId: EVENT_ID }),
      /EVENT_FULL/,
    )

    const regIdx = indexOfCall(calls, call =>
      call.kind === 'one'
      && call.sql.includes('user_id')
      && call.sql.includes('member_registrations')
      && call.sql.includes('FOR UPDATE')
      && !call.sql.includes('COUNT(*)'))
    const countIdx = indexOfCall(calls, call => call.sql.includes('COUNT(*)'))
    const phoneIdx = indexOfCall(calls, call => call.sql.includes('member_private_profiles'))
    assert.ok(regIdx >= 0)
    assert.ok(phoneIdx > regIdx, 'phone check only after existing-fact lock')
    assert.ok(countIdx > phoneIdx, 'capacity must run after eligibility checks')
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
  })

  it('reactivates CANCELLED with scoped WHERE, cleared cancel metadata, and version bump', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: { id: REG_ID, status: 'CANCELLED', ticket_code: 'TAB12CD34EF' , version: 1 },
      count: { total: 0 },
      event: {
        id: EVENT_ID,
        capacity: 2,
        price_cents: 0,
        member_free: 0,
        registration_deadline: null,
        status: 'PUBLISHED',
        starts_at: hoursFromNow(48).toISOString(),
      },
    }))

    const result = await registerForEvent(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })

    assert.equal(result.id, REG_ID)
    assert.equal(result.status, 'REGISTERED')
    assert.equal(result.ticketCode, 'TAB12CD34EF')

    const updates = calls.filter(call => call.kind === 'query' && /UPDATE/i.test(call.sql))
    assert.equal(updates.length, 1)
    assert.match(updates[0].sql, /status\s*=\s*\?/)
    assert.match(updates[0].sql, /ticket_code\s*=\s*CASE[\s\S]*COALESCE/)
    assert.match(updates[0].sql, /cancelled_at\s*=\s*NULL/)
    assert.match(updates[0].sql, /cancelled_by_type\s*=\s*NULL/)
    assert.match(updates[0].sql, /cancellation_reason\s*=\s*NULL/)
    assert.match(updates[0].sql, /version\s*=\s*version\s*\+\s*1/)
    assert.match(updates[0].sql, /status IN \('CANCELLED', 'REJECTED'\)/)
    assert.deepEqual(updates[0].params, [
      'REGISTERED',
      'REGISTERED',
      'TAB12CD34EF',
      'REGISTERED',
      1,
      '{}',
      0,
      APP_ID,
      EVENT_ID,
      USER_ID,
    ])
    assert.equal(
      calls.filter(call => call.kind === 'query' && /INSERT INTO member_registrations/i.test(call.sql)).length,
      0,
      'reactivation must not insert a second registration row',
    )
    assert.ok(calls.some(call => call.kind === 'query' && /INSERT INTO member_audit_logs/i.test(call.sql)))
  })

  it('surfaces REGISTRATION_CONFLICT when CANCELLED reactivation affects zero rows', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: { id: REG_ID, status: 'CANCELLED' , version: 1 },
      count: { total: 0 },
    }), { queryAffectedRows: 0 })

    await assert.rejects(
      () => registerForEvent(db, { appId: APP_ID, userId: USER_ID, eventId: EVENT_ID }),
      /REGISTRATION_CONFLICT/,
    )
    assert.ok(calls.some(call => call.kind === 'query' && /UPDATE member_registrations/i.test(call.sql)))
  })

  it('still rejects CANCELLED reactivation when the event is full', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: { id: REG_ID, status: 'CANCELLED' , version: 1 },
      count: { total: 1 },
      event: {
        id: EVENT_ID,
        capacity: 1,
        price_cents: 0,
        member_free: 0,
        registration_deadline: null,
        status: 'PUBLISHED',
        starts_at: hoursFromNow(48).toISOString(),
      },
    }))

    await assert.rejects(
      () => registerForEvent(db, { appId: APP_ID, userId: USER_ID, eventId: EVENT_ID }),
      /EVENT_FULL/,
    )
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
  })

  it('requires phone only for new registrations, not existing facts', async () => {
    const missingPhone = createFakeDb(baseMatchers({
      existing: null,
      phone: null,
    }))
    await assert.rejects(
      () => registerForEvent(missingPhone.db, { appId: APP_ID, userId: USER_ID, eventId: EVENT_ID }),
      /PHONE_REQUIRED/,
    )

    const existing = createFakeDb(baseMatchers({
      existing: { id: REG_ID, status: 'REGISTERED', ticket_code: 'TEXISTING01' , version: 1 },
      phone: null,
    }))
    const result = await registerForEvent(existing.db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })
    assert.deepEqual(result, {
      id: REG_ID,
      status: 'REGISTERED',
      ticketCode: 'TEXISTING01',
      version: 1,
      idempotent: true,
    })
  })

  it('issues a ticket code for new registrations', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      existing: null,
      count: { total: 0 },
    }))
    const result = await registerForEvent(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })
    assert.equal(result.status, 'REGISTERED')
    assert.match(result.ticketCode, /^T[A-F0-9]{10}$/)
    const insert = calls.find(call => call.kind === 'query' && /INSERT INTO member_registrations/i.test(call.sql))
    assert.ok(insert)
    assert.match(insert.sql, /ticket_code/)
    assert.equal(insert.params[4], 'REGISTERED')
    assert.equal(insert.params[5], result.ticketCode)
    assert.ok(calls.some(call => call.kind === 'query' && /INSERT INTO member_audit_logs/i.test(call.sql)))
  })

  it('submits approval-mode registrations without occupying a seat or issuing a ticket', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      event: {
        id: EVENT_ID,
        capacity: 1,
        price_cents: 0,
        member_free: 0,
        registration_deadline: null,
        registration_mode: 'APPROVAL',
        waitlist_enabled: 1,
        status: 'PUBLISHED',
        starts_at: hoursFromNow(48).toISOString(),
      },
    }))
    const result = await registerForEvent(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })
    assert.equal(result.status, 'PENDING_REVIEW')
    assert.equal(result.ticketCode, '')
    const insert = calls.find(call => /INSERT INTO member_registrations/i.test(call.sql))
    assert.ok(insert)
    assert.equal(insert.params[4], 'PENDING_REVIEW')
    assert.equal(insert.params[5], null)
  })

  it('places a full auto-mode event into waitlist when enabled', async () => {
    const { db, calls } = createFakeDb(baseMatchers({
      count: { total: 1 },
      event: {
        id: EVENT_ID,
        capacity: 1,
        price_cents: 0,
        member_free: 0,
        registration_deadline: null,
        registration_mode: 'AUTO',
        waitlist_enabled: 1,
        status: 'PUBLISHED',
        starts_at: hoursFromNow(48).toISOString(),
      },
    }))
    const result = await registerForEvent(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })
    assert.equal(result.status, 'WAITLISTED')
    assert.equal(result.ticketCode, '')
    const insert = calls.find(call => /INSERT INTO member_registrations/i.test(call.sql))
    assert.ok(insert)
    assert.equal(insert.params[4], 'WAITLISTED')
    assert.equal(insert.params[6], 'WAITLISTED')
  })
})

describe('cancelEventRegistration member metadata', () => {
  it('writes MEMBER cancel metadata only for open published events', async () => {
    const { db, calls } = createFakeDb([
      {
        match: sql => includesAll(sql, ['FROM member_events', 'FOR SHARE']),
        result: {
          id: EVENT_ID,
          status: 'PUBLISHED',
          starts_at: hoursFromNow(72).toISOString(),
        },
      },
      {
        match: (sql, _params, kind) =>
          kind === 'one'
          && includesAll(sql, ['FROM member_registrations', 'user_id', 'FOR UPDATE']),
        result: { id: REG_ID, status: 'REGISTERED', version: 3 },
      },
    ])

    const result = await cancelEventRegistration(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })
    assert.deepEqual(result, {
      id: REG_ID,
      eventId: EVENT_ID,
      status: 'CANCELLED',
      version: 4,
      promotedRegistrationId: null,
      idempotent: false,
    })

    const update = calls.find(call => call.kind === 'query' && /UPDATE member_registrations/i.test(call.sql))
    assert.ok(update)
    assert.match(update.sql, /cancelled_by_type = 'MEMBER'/)
    assert.match(update.sql, /cancelled_at = UTC_TIMESTAMP\(3\)/)
    assert.deepEqual(update.params, [APP_ID, EVENT_ID, USER_ID, 3])
    assert.ok(calls.some(call => call.kind === 'query' && /INSERT INTO member_audit_logs/i.test(call.sql)))
  })

  it('returns existing CANCELLED fact on repeat cancel without REGISTRATION_NOT_FOUND', async () => {
    const { db, calls } = createFakeDb([
      {
        match: sql => includesAll(sql, ['FROM member_events', 'FOR SHARE']),
        result: {
          id: EVENT_ID,
          status: 'PUBLISHED',
          starts_at: hoursFromNow(72).toISOString(),
        },
      },
      {
        match: (sql, _params, kind) =>
          kind === 'one'
          && includesAll(sql, ['FROM member_registrations', 'user_id', 'FOR UPDATE']),
        result: { id: REG_ID, status: 'CANCELLED', version: 5 },
      },
    ])

    const result = await cancelEventRegistration(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })
    assert.deepEqual(result, {
      id: REG_ID,
      eventId: EVENT_ID,
      status: 'CANCELLED',
      version: 5,
      idempotent: true,
    })
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
  })

  it('rejects member cancel when the event is already cancelled by the host', async () => {
    const { db, calls } = createFakeDb([
      {
        match: (sql, _params, kind) =>
          kind === 'one'
          && includesAll(sql, ['FROM member_registrations', 'user_id', 'FOR UPDATE']),
        result: { id: REG_ID, status: 'REGISTERED', version: 2 },
      },
      {
        match: sql => includesAll(sql, ['FROM member_events', 'FOR SHARE']),
        result: {
          id: EVENT_ID,
          status: 'CANCELLED',
          starts_at: hoursFromNow(72).toISOString(),
        },
      },
    ])

    await assert.rejects(
      () => cancelEventRegistration(db, {
        appId: APP_ID,
        userId: USER_ID,
        eventId: EVENT_ID,
      }),
      /EVENT_CLOSED/,
    )
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
  })

  it('replays terminal CANCELLED even when the event later closes or completes', async () => {
    const { db, calls } = createFakeDb([
      {
        match: (sql, _params, kind) =>
          kind === 'one'
          && includesAll(sql, ['FROM member_registrations', 'user_id', 'FOR UPDATE']),
        result: { id: REG_ID, status: 'CANCELLED', version: 7 },
      },
      {
        match: sql => includesAll(sql, ['FROM member_events', 'FOR SHARE']),
        result: {
          id: EVENT_ID,
          status: 'COMPLETED',
          starts_at: hoursFromNow(-1).toISOString(),
        },
      },
    ])

    const result = await cancelEventRegistration(db, {
      appId: APP_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
    })
    assert.deepEqual(result, {
      id: REG_ID,
      eventId: EVENT_ID,
      status: 'CANCELLED',
      version: 7,
      idempotent: true,
    })
    // Terminal replay must not query dynamic event open conditions.
    assert.equal(calls.filter(call => /member_events/i.test(call.sql)).length, 0)
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
  })
})

/**
 * Fake DB that returns matcher results for both one() and query().
 * SELECT matchers return arrays; mutation matchers return { affectedRows }.
 */
function createDeleteFakeDb(matchers, { queryAffectedRows = 1 } = {}) {
  const calls = []

  function normalize(sql) {
    return String(sql).replace(/\s+/g, ' ').trim()
  }

  function resolve(kind, sql, params) {
    const normalized = normalize(sql)
    calls.push({ kind, sql: normalized, params: params || [] })
    for (const matcher of matchers) {
      if (matcher.match(normalized, params || [], kind)) {
        return typeof matcher.result === 'function'
          ? matcher.result(normalized, params || [], kind)
          : matcher.result
      }
    }
    if (kind === 'query') {
      return { affectedRows: queryAffectedRows }
    }
    return null
  }

  const db = {
    async transaction(work) {
      return work({
        async one(sql, params) {
          return resolve('one', sql, params)
        },
        async query(sql, params) {
          return resolve('query', sql, params)
        },
      })
    },
  }

  return { db, calls }
}

describe('deleteMemberAccount cleanup outbox', () => {
  const PROFILE_ID = 'profile-1'
  const ASSET_ID = 'asset-1'
  const CLOUD_FILE = 'cloud://env/member-assets/avatar.png'
  const OBJECT_KEY = 'member-assets/app/avatars/user/avatar.png'
  const avatarAssetKey = `member-avatar-${createHash('sha256').update(USER_ID).digest('hex').slice(0, 24)}`

  function deleteMatchers(overrides = {}) {
    const profile = Object.prototype.hasOwnProperty.call(overrides, 'profile')
      ? overrides.profile
      : {
          id: PROFILE_ID,
          avatar_asset_id: ASSET_ID,
          status: 'APPROVED',
        }
    const media = Object.prototype.hasOwnProperty.call(overrides, 'media')
      ? overrides.media
      : [{
          id: ASSET_ID,
          cloud_file_id: CLOUD_FILE,
          object_key: OBJECT_KEY,
          status: 'READY',
          asset_key: avatarAssetKey,
        }]
    const registrations = Object.prototype.hasOwnProperty.call(overrides, 'registrations')
      ? overrides.registrations
      : [{ id: REG_ID, version: 2, event_id: EVENT_ID, status: 'REGISTERED' }]

    return [
      {
        match: (sql, _params, kind) =>
          kind === 'one'
          && includesAll(sql, ['FROM member_profiles', 'FOR UPDATE']),
        result: profile,
      },
      {
        match: (sql, _params, kind) =>
          kind === 'query'
          && includesAll(sql, ['FROM member_media_assets', 'FOR UPDATE']),
        result: media,
      },
      {
        match: (sql, _params, kind) =>
          kind === 'query'
          && includesAll(sql, [
            'FROM member_registrations',
            "status IN ('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED')",
            'FOR UPDATE',
          ]),
        result: registrations,
      },
      {
        match: (sql, _params, kind) =>
          kind === 'query'
          && includesAll(sql, ['UPDATE member_registrations', "status = 'CANCELLED'"]),
        result: { affectedRows: 1 },
      },
    ]
  }

  it('writes full cancel metadata + version + registration audit on account delete', async () => {
    const { db, calls } = createDeleteFakeDb(deleteMatchers())

    const result = await deleteMemberAccount(db, {
      appId: APP_ID,
      userId: USER_ID,
    })

    assert.equal(result.status, 'DELETED')
    assert.equal(result.cancelledRegistrations, 1)

    const cancelUpdate = calls.find(call =>
      call.kind === 'query'
      && /UPDATE member_registrations/i.test(call.sql)
      && call.sql.includes("status = 'CANCELLED'"))
    assert.ok(cancelUpdate)
    assert.match(cancelUpdate.sql, /cancelled_at = UTC_TIMESTAMP\(3\)/)
    assert.match(cancelUpdate.sql, /cancelled_by_type = 'MEMBER'/)
    assert.match(cancelUpdate.sql, /cancellation_reason = 'ACCOUNT_DELETED'/)
    assert.match(cancelUpdate.sql, /version = version \+ 1/)
    assert.deepEqual(cancelUpdate.params, [REG_ID, APP_ID, 'REGISTERED', 2])

    const regAudit = calls.find(call =>
      call.kind === 'query'
      && /INSERT INTO member_audit_logs/i.test(call.sql)
      && (call.sql.includes('REGISTRATION_CANCELLED_ON_ACCOUNT_DELETE')
        || call.params.includes('REGISTRATION_CANCELLED_ON_ACCOUNT_DELETE')))
    assert.ok(regAudit, 'per-registration cancel audit required')
    // writeRegistrationAudit binds action as a param (index 3) and metadata as JSON (index 6).
    const regMeta = JSON.parse(regAudit.params[6])
    assert.equal(regMeta.from, 'REGISTERED')
    assert.equal(regMeta.to, 'CANCELLED')
    assert.equal(regMeta.version, 3)
  })

  it('archives media assets and writes executable cleanup outbox + pending audits', async () => {
    const { db, calls } = createDeleteFakeDb([
      ...deleteMatchers(),
      {
        match: (sql, _params, kind) =>
          kind === 'query'
          && /INSERT INTO member_media_cleanup_outbox/i.test(sql),
        result: { affectedRows: 1 },
      },
      {
        match: (sql, params, kind) =>
          kind === 'one'
          && /FROM member_media_cleanup_outbox/i.test(sql)
          && params?.[1] === ASSET_ID,
        result: {
          id: 'outbox-1',
          app_id: APP_ID,
          user_id: USER_ID,
          media_asset_id: ASSET_ID,
          cloud_file_id: CLOUD_FILE,
          status: 'PENDING',
          attempts: 0,
          version: 1,
        },
      },
    ])

    const result = await deleteMemberAccount(db, {
      appId: APP_ID,
      userId: USER_ID,
    })

    assert.equal(result.archivedAssets, 1)
    assert.equal(result.cleanupItems.length, 1)
    assert.equal(result.cleanupItems[0].assetId, ASSET_ID)
    assert.equal(result.cleanupItems[0].cloudFileId, CLOUD_FILE)
    assert.equal(result.cleanupItems[0].outboxId, 'outbox-1')

    const archive = calls.find(call =>
      call.kind === 'query'
      && /UPDATE member_media_assets/i.test(call.sql)
      && call.sql.includes("status = 'ARCHIVED'"))
    assert.ok(archive)
    assert.deepEqual(archive.params, [APP_ID, ASSET_ID])

    const outbox = calls.find(call =>
      call.kind === 'query'
      && /INSERT INTO member_media_cleanup_outbox/i.test(call.sql))
    assert.ok(outbox, 'executable outbox INSERT required (not audit-only)')

    const pending = calls.find(call =>
      call.kind === 'query'
      && /INSERT INTO member_audit_logs/i.test(call.sql)
      && call.sql.includes('MEDIA_CLEANUP_PENDING'))
    assert.ok(pending)
    const meta = JSON.parse(pending.params[3])
    assert.equal(meta.assetId, ASSET_ID)
    assert.equal(meta.cloudFileId, CLOUD_FILE)
    assert.equal(meta.outboxId, 'outbox-1')

    const deletedAudit = calls.find(call =>
      call.kind === 'query'
      && /INSERT INTO member_audit_logs/i.test(call.sql)
      && call.sql.includes('ACCOUNT_DELETED'))
    assert.ok(deletedAudit)
    const accountMeta = JSON.parse(deletedAudit.params[3])
    assert.equal(accountMeta.previousStatus, 'APPROVED')
    assert.equal(accountMeta.avatarAssetId, ASSET_ID)
    assert.equal(accountMeta.cancelledRegistrations, 1)
    assert.equal(accountMeta.version, 1)
  })

  it('records cancelledRegistrations as actual affectedRows not candidate count', async () => {
    let cancelAttempts = 0
    const { db, calls } = createDeleteFakeDb([
      {
        match: (sql, _params, kind) =>
          kind === 'one' && includesAll(sql, ['FROM member_profiles', 'FOR UPDATE']),
        result: {
          id: PROFILE_ID,
          avatar_asset_id: null,
          status: 'APPROVED',
        },
      },
      {
        match: (sql, _params, kind) =>
          kind === 'query'
          && includesAll(sql, ['FROM member_media_assets', 'FOR UPDATE']),
        result: [],
      },
      {
        match: (sql, _params, kind) =>
          kind === 'query'
          && includesAll(sql, [
            'FROM member_registrations',
            "status IN ('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED')",
            'FOR UPDATE',
          ]),
        result: [
          { id: REG_ID, version: 2, event_id: EVENT_ID, status: 'REGISTERED' },
          { id: 'reg-2', version: 1, event_id: EVENT_ID, status: 'WAITLISTED' },
        ],
      },
      {
        match: (sql, _params, kind) =>
          kind === 'query'
          && includesAll(sql, ['UPDATE member_registrations', "status = 'CANCELLED'"]),
        result: () => {
          cancelAttempts += 1
          return { affectedRows: cancelAttempts === 1 ? 1 : 0 }
        },
      },
    ])

    const result = await deleteMemberAccount(db, {
      appId: APP_ID,
      userId: USER_ID,
    })
    assert.equal(result.cancelledRegistrations, 1)
    assert.equal(cancelAttempts, 2)
    const accountAudit = calls.find(call =>
      call.kind === 'query'
      && /INSERT INTO member_audit_logs/i.test(call.sql)
      && call.sql.includes('ACCOUNT_DELETED'))
    assert.ok(accountAudit, `ACCOUNT_DELETED audit missing; calls=${JSON.stringify(calls.map(c => c.sql).slice(-5))}`)
    // VALUES (?, ?, 'member', 'ACCOUNT_DELETED', 'profile', ?, ?) → metadata is last param.
    const metaParam = accountAudit.params[accountAudit.params.length - 1]
    assert.equal(typeof metaParam, 'string')
    assert.equal(JSON.parse(metaParam).cancelledRegistrations, 1)
  })

  it('unbinds avatar, clears PII, revokes entitlements before cleanup', async () => {
    const { db, calls } = createDeleteFakeDb(deleteMatchers())

    await deleteMemberAccount(db, { appId: APP_ID, userId: USER_ID })

    const profileUpdate = calls.find(call =>
      call.kind === 'query' && /UPDATE member_profiles/i.test(call.sql))
    assert.ok(profileUpdate)
    assert.match(profileUpdate.sql, /avatar_asset_id = NULL/)
    assert.match(profileUpdate.sql, /status = 'DELETED'/)
    assert.match(profileUpdate.sql, /nickname = ''/)

    assert.ok(calls.some(call =>
      call.kind === 'query' && /UPDATE member_private_profiles/i.test(call.sql)
      && call.sql.includes('phone_number = NULL')))
    assert.ok(calls.some(call =>
      call.kind === 'query' && /UPDATE member_entitlements/i.test(call.sql)
      && call.sql.includes("status = 'REVOKED'")))
  })

  it('is idempotent-ish: second delete on already-deleted profile does not crash', async () => {
    const { db, calls } = createDeleteFakeDb([
      ...deleteMatchers({
        profile: {
          id: PROFILE_ID,
          avatar_asset_id: null,
          status: 'DELETED',
        },
        media: [{
          id: ASSET_ID,
          cloud_file_id: CLOUD_FILE,
          object_key: OBJECT_KEY,
          status: 'ARCHIVED',
          asset_key: avatarAssetKey,
        }],
        registrations: [],
      }),
      {
        match: (sql, _params, kind) =>
          kind === 'query'
          && /INSERT INTO member_media_cleanup_outbox/i.test(sql),
        result: { affectedRows: 1 },
      },
      {
        match: (sql, _params, kind) =>
          kind === 'one'
          && /FROM member_media_cleanup_outbox/i.test(sql),
        result: {
          id: 'outbox-1',
          app_id: APP_ID,
          media_asset_id: ASSET_ID,
          cloud_file_id: CLOUD_FILE,
          status: 'PENDING',
          version: 1,
        },
      },
    ])

    const result = await deleteMemberAccount(db, {
      appId: APP_ID,
      userId: USER_ID,
    })

    assert.equal(result.status, 'DELETED')
    assert.equal(result.cancelledRegistrations, 0)
    assert.ok(calls.some(call =>
      call.kind === 'query'
      && /INSERT INTO member_audit_logs/i.test(call.sql)
      && call.sql.includes('ACCOUNT_DELETED')))
    // Already-archived media still writes executable outbox + pending audit.
    assert.ok(calls.some(call =>
      call.kind === 'query'
      && /INSERT INTO member_media_cleanup_outbox/i.test(call.sql)))
    assert.ok(calls.some(call =>
      call.kind === 'query'
      && call.sql.includes('MEDIA_CLEANUP_PENDING')))
  })
})
