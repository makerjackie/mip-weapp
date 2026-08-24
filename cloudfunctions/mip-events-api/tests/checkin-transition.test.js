'use strict'

const assert = require('node:assert/strict')
const { it } = require('node:test')
const { checkIn } = require('../domain/event-service')

it('writes the user scan transition and outbox atomically with the same immutable id', async () => {
  const appId = 'wx-app'
  const eventId = '10000000-0000-4000-8000-000000000001'
  const registrationId = '20000000-0000-4000-8000-000000000001'
  const userId = '30000000-0000-4000-8000-000000000001'
  const credentialId = '40000000-0000-4000-8000-000000000001'
  const now = new Date('2026-08-24T08:00:00.000Z')
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
      if (sql.includes('mip_event_checkin_credentials')) {
        return {
          id: credentialId,
          event_id: eventId,
          mode: 'STATIC',
          status: 'ACTIVE',
          valid_from: new Date('2026-08-24T07:00:00.000Z'),
          valid_until: new Date('2026-08-24T09:00:00.000Z'),
        }
      }
      if (sql.includes('FROM mip_events')) return { id: eventId }
      if (sql.includes('FROM mip_event_registrations')) {
        return { id: registrationId, event_id: eventId, user_id: userId, status: 'REGISTERED', version: 2 }
      }
      if (sql.includes('FROM mip_event_checkins')) return null
      throw new Error(`unexpected one query: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      return { affectedRows: 1 }
    },
  }
  const result = await checkIn({ transaction: work => work(tx) }, {
    appId,
    userId,
    scanToken: 's1.abcdefghijk.lmnopqrstuv',
    idempotencyKey: 'scan-transition-test',
    expectedVersion: 2,
    now,
  })
  assert.equal(result.status, 'ATTENDED')
  const transition = calls.find(call => call.sql.includes('INSERT INTO mip_event_checkin_transitions'))
  const outbox = calls.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
  assert.ok(transition)
  assert.ok(outbox)
  assert.equal(transition.params[6], 'CHECKED_IN')
  assert.equal(transition.params[7], 1)
  assert.equal(transition.params[8], 3)
  assert.equal(transition.params[11], 'USER_SCAN')
  assert.equal(outbox.params[0], transition.params[0])
  assert.equal(outbox.params[2], 'EVENT_CHECKIN_TRANSITION')
  assert.equal(outbox.params[3], transition.params[0])
  assert.equal(outbox.params[4], 'event.checked_in')
  assert.deepEqual(JSON.parse(outbox.params[6]), { eventId, registrationId, userId, checkinId: transition.params[2] })
})
