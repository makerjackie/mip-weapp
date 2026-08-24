'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminRepository: createProductionAdminRepository } = require('../domain/repository')
const { withTestAuthorization } = require('./test-authorization')

function createAdminRepository(database, options) {
  return createProductionAdminRepository(database, withTestAuthorization(options))
}

const appId = 'wx-checkin-test'
const eventId = '10000000-0000-4000-8000-000000000001'
const registrationId = '20000000-0000-4000-8000-000000000002'
const userId = '30000000-0000-4000-8000-000000000003'

function audit(action) {
  return {
    appId,
    actorUserId: userId,
    scopeType: 'EVENT',
    scopeId: eventId,
    action,
    resourceType: 'EVENT_REGISTRATION',
    resourceId: registrationId,
    effectiveRole: 'EVENT_MANAGER',
    metadata: {},
  }
}

describe('MIP admin check-in repository', () => {
  it('writes the same checked-in outbox fact as a participant scan', async () => {
    const calls = []
    const repository = createAdminRepository({
      transaction: work => work({
        async one(sql, params) {
          calls.push({ kind: 'one', sql, params })
          return { id: registrationId, user_id: userId, status: 'REGISTERED', version: 2 }
        },
        async query(sql, params) {
          calls.push({ kind: 'query', sql, params })
          return { affectedRows: 1 }
        },
      }),
    }, {
      id: (() => {
        let counter = 0
        return () => `${++counter}0000000-0000-4000-8000-000000000000`
      })(),
    })
    await repository.checkIn({
      appId,
      actorUserId: userId,
      eventId,
      registrationId,
      expectedVersion: 2,
      audit: audit('admin.events.checkin'),
    })
    const outbox = calls.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
    const transition = calls.find(call => call.sql.includes('INSERT INTO mip_event_checkin_transitions'))
    assert.ok(outbox)
    assert.ok(transition)
    assert.equal(outbox.params[0], transition.params[0])
    assert.equal(outbox.params[2], 'EVENT_CHECKIN_TRANSITION')
    assert.equal(outbox.params[3], transition.params[0])
    assert.equal(outbox.params[4], 'event.checked_in')
    assert.match(String(outbox.params[6]), new RegExp(userId))
  })

  it('version-checks and softly revokes an active check-in with an audit reason', async () => {
    const calls = []
    const repository = createAdminRepository({
      transaction: work => work({
        async one(sql, params) {
          calls.push({ kind: 'one', sql, params })
          if (sql.includes('mip_event_checkin_transitions')) {
            return { id: '50000000-0000-4000-8000-000000000005' }
          }
          return sql.includes('mip_event_checkins')
            ? { id: '40000000-0000-4000-8000-000000000004', version: 1 }
            : { id: registrationId, user_id: userId, status: 'ATTENDED', version: 3 }
        },
        async query(sql, params) {
          calls.push({ kind: 'query', sql, params })
          return { affectedRows: 1 }
        },
      }),
    }, { now: () => new Date('2026-08-24T05:00:00.000Z') })
    const result = await repository.undoCheckIn({
      appId,
      actorUserId: userId,
      eventId,
      registrationId,
      expectedVersion: 3,
      reason: '现场误操作',
      audit: audit('admin.events.checkin.undo'),
    })
    assert.deepEqual(result, { id: registrationId, status: 'REGISTERED', version: 4 })
    const source = calls.map(call => call.sql).join('\n')
    assert.match(source, /mip_event_checkins SET status = 'REVOKED'/)
    assert.match(source, /mip_event_registrations SET status = 'REGISTERED'/)
    assert.match(source, /INSERT INTO mip_event_checkin_transitions/)
    assert.match(source, /INSERT INTO mip_audit_logs/)
    assert.doesNotMatch(source, /DELETE FROM/)
    const transition = calls.find(call => call.sql.includes('INSERT INTO mip_event_checkin_transitions'))
    const outbox = calls.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
    assert.equal(transition.params[6], 'REVOKED')
    assert.equal(transition.params[9], '50000000-0000-4000-8000-000000000005')
    assert.equal(outbox.params[0], transition.params[0])
    assert.equal(outbox.params[4], 'event.checkin_revoked')
  })
})
