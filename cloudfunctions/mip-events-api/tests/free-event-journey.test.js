'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createRegistration } = require('../domain/event-service')

const appId = 'wx-mip-app'
const userId = '10000000-0000-4000-8000-000000000001'
const eventId = '20000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-25T00:00:00.000Z')

function freeEventDatabase() {
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
        shareProfile: true,
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
    assert.equal(typeof registrationWrite.params[9], 'string')
    assert.equal(registrationWrite.params[9].length, 64)
    assert.equal(fixture.calls.some(call => call.sql.includes('INSERT INTO mip_orders')), false)
    assert.equal(fixture.calls.some(call => call.sql.includes('INSERT INTO mip_event_seat_holds')), false)
    const attribution = fixture.calls.find(call => call.sql.includes('mip_event_invitation_attributions'))
    assert.equal(attribution.params[4], 'PLATFORM')
    const outbox = fixture.calls.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
    assert.equal(outbox.params[4], 'event.registration_confirmed')
  })
})
