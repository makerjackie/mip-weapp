'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createRegistration } = require('../domain/event-service')

const appId = 'wx-mip-app'
const userId = '10000000-0000-4000-8000-000000000001'
const eventId = '20000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-25T00:00:00.000Z')

function freeEventDatabase(overrides = {}) {
  const calls = []
  const event = {
    id: eventId,
    app_id: appId,
    status: 'PUBLISHED',
    title: '2030 MIP 城市交流活动',
    starts_at: '2030-08-25T10:00:00.000Z',
    ends_at: '2030-08-25T12:00:00.000Z',
    registration_opens_at: null,
    registration_deadline: '2030-08-25T09:00:00.000Z',
    registration_schema_json: '[]',
    form_version: 1,
    access_type: 'FREE',
    registration_policy: 'AUTO',
    capacity: 100,
    waitlist_enabled: 1,
    ...overrides,
  }
  const tx = {
    async one(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'one', sql: normalized, params })
      if (normalized.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
      if (normalized.includes('SELECT * FROM mip_events')) return event
      if (normalized.includes('SELECT r.*')) return null
      if (normalized.includes('COUNT(*) AS total FROM mip_event_registrations')) return { total: 0 }
      if (normalized.includes('COUNT(*) AS total FROM mip_event_seat_holds')) return { total: 0 }
      throw new Error(`unexpected read: ${normalized}`)
    },
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'query', sql: normalized, params })
      return { affectedRows: 1 }
    },
  }
  return { calls, database: { transaction: work => work(tx) }, tx }
}

describe('free event registration journey', () => {
  it('confirms an eligible guest without creating an order or payment seat hold', async () => {
    const fixture = freeEventDatabase()
    let accessQueryable
    const outcome = await createRegistration(fixture.database, {
      appId,
      userId,
      input: {
        eventId,
        formVersion: 1,
        answers: {},
        // MIW-91：客户端不再发送 shareProfile，缺省即公开。
        idempotencyKey: 'free-event-registration-1',
      },
      now,
      resolveUserKind: async () => 'GUEST',
      participationAccessPolicy: {
        async requireAccess(queryable) {
          accessQueryable = queryable
          return { id: userId }
        },
      },
    })

    assert.equal(accessQueryable, fixture.tx)
    assert.deepEqual(outcome, {
      kind: 'REGISTERED',
      registrationId: outcome.registrationId,
      status: 'REGISTERED',
      waitlistPosition: undefined,
    })
    const registrationWrite = fixture.calls.find(call => call.sql.includes('INSERT INTO mip_event_registrations'))
    assert.ok(registrationWrite)
    assert.equal(registrationWrite.params[4], null)
    assert.equal(registrationWrite.params[5], 'REGISTERED')
    // MIW-91：缺省 shareProfile 落 share_profile=1（默认公开，公开名单/头像墙可计入）。
    assert.equal(registrationWrite.params[8], 1)
    assert.equal(typeof registrationWrite.params[9], 'string')
    assert.equal(registrationWrite.params[9].length, 64)
    assert.equal(fixture.calls.some(call => call.sql.includes('INSERT INTO mip_orders')), false)
    assert.equal(fixture.calls.some(call => call.sql.includes('INSERT INTO mip_event_seat_holds')), false)
    const attribution = fixture.calls.find(call => call.sql.includes('mip_event_invitation_attributions'))
    assert.equal(attribution.params[4], 'PLATFORM')
    const outbox = fixture.calls.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
    assert.equal(outbox.params[4], 'event.registration_confirmed')
  })

  it('keeps a registration hidden only when a legacy client explicitly reports shareProfile false', async () => {
    const fixture = freeEventDatabase()
    await createRegistration(fixture.database, {
      appId,
      userId,
      input: {
        eventId,
        formVersion: 1,
        answers: {},
        shareProfile: false,
        idempotencyKey: 'free-event-registration-hidden-1',
      },
      now,
      resolveUserKind: async () => 'GUEST',
      participationAccessPolicy: {
        async requireAccess(queryable) {
          return { id: userId, queryable }
        },
      },
    })
    const registrationWrite = fixture.calls.find(call => call.sql.includes('INSERT INTO mip_event_registrations'))
    assert.ok(registrationWrite)
    assert.equal(registrationWrite.params[8], 0)
  })
})

for (const userKind of ['PLAYER', 'GUEST']) {
  it(`member-free paid event derives ${userKind} price from server identity`, async () => {
    const f = freeEventDatabase({ access_type: 'PAID', member_free: 1, price_cents: 1990, currency: 'CNY', waitlist_enabled: 0 })
    const outcome = await createRegistration(f.database, {
      appId, userId, input: { eventId, formVersion: 1, answers: {}, idempotencyKey: `member-free-${userKind}` }, now,
      resolveUserKind: async () => userKind,
      participationAccessPolicy: { requireAccess: async () => ({ id: userId }) },
      paymentAvailable: true,
    })
    const order = f.calls.find(c => c.sql.includes('INSERT INTO mip_orders'))
    if (userKind === 'PLAYER') {
      assert.equal(outcome.kind, 'REGISTERED')
      assert.equal(order, undefined)
      assert.equal(f.calls.some(c => c.sql.includes('INSERT INTO mip_event_seat_holds')), false)
    } else {
      assert.equal(outcome.kind, 'PAYMENT_REQUIRED')
      assert.equal(order.params[6], 1990)
      const snapshot = JSON.parse(order.params[8])
      assert.equal(snapshot.priceCents, 1990)
    }
  })
}
