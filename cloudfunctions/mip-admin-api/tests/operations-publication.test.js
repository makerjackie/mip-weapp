'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  MAX_EVENT_REMINDER_RECIPIENTS,
  createOperationsPublisher,
  eventReminderRequestHash,
} = require('../domain/operations-publication')
const { withTestAuthorization } = require('./test-authorization')

const input = {
  appId: 'wx-app',
  actorUserId: '20000000-0000-4000-8000-000000000001',
  eventId: '40000000-0000-4000-8000-000000000001',
  expectedVersion: 7,
  idempotencyKey: 'event-reminder-request-0001',
  sendWechatReminder: true,
  audit: (publicationId, result) => ({
    action: 'admin.communications.publish', publicationId, ...result,
  }),
}

function event(overrides = {}) {
  return {
    id: input.eventId,
    status: 'PUBLISHED',
    version: 7,
    title: '城市交流活动',
    starts_at_label: '2026-08-25 10:00',
    location_label: '广州活动中心',
    ...overrides,
  }
}

function ids() {
  let next = 0
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
}

function publisher(options = {}) {
  return createOperationsPublisher(withTestAuthorization({
    createId: ids(),
    writeAudit: (tx, audit) => tx.query('INSERT INTO mip_audit_logs', [audit]),
    ...options,
  }))
}

describe('admin event reminder publication', () => {
  it('selects confirmed recipients and derives every message fact from the app-scoped event', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ sql, params })
        return event()
      },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('SELECT registration.user_id')) {
          return [
            { user_id: '30000000-0000-4000-8000-000000000001' },
            { user_id: '30000000-0000-4000-8000-000000000002' },
          ]
        }
        return { affectedRows: 1 }
      },
    }
    const result = await publisher().publishEventReminder(tx, {
      ...input,
      recipientUserIds: ['forged-user'],
      title: '伪造标题',
      body: '伪造正文',
      templatePayload: { fields: { title: '伪造活动' } },
    })

    assert.deepEqual(result, {
      publicationId: '00000000-0000-4000-8000-000000000001',
      recipientCount: 2,
      sendWechatReminder: true,
      wechatDelivery: 'BEST_EFFORT',
      idempotent: false,
    })
    const recipientRead = calls.find(call => call.sql.includes('SELECT registration.user_id'))
    assert.match(recipientRead.sql, /registration\.app_id = \? AND registration\.event_id = \?/)
    assert.match(recipientRead.sql, /registration\.status IN \('REGISTERED', 'ATTENDED'\)/)
    assert.doesNotMatch(recipientRead.sql, /PENDING_REVIEW|WAITLISTED|PAYMENT_PENDING/)
    assert.deepEqual(recipientRead.params, [input.appId, input.eventId, MAX_EVENT_REMINDER_RECIPIENTS + 1])

    const messageInsert = calls.find(call => call.sql.includes('INSERT INTO mip_operations_messages'))
    assert.equal(messageInsert.params.includes('forged-user'), false)
    assert.equal(messageInsert.params.includes('伪造标题'), false)
    assert.equal(messageInsert.params[5], '30000000-0000-4000-8000-000000000001')
    assert.equal(messageInsert.params[6], '活动提醒：城市交流活动')
    assert.equal(messageInsert.params[7], '活动“城市交流活动”将于 2026-08-25 10:00 开始，地点：广州活动中心。')
    assert.equal(messageInsert.params[9], 'EVENT_REMINDER')
    assert.deepEqual(JSON.parse(messageInsert.params[10]), {
      fields: {
        title: '城市交流活动',
        startsAt: '2026-08-25 10:00',
        location: '广州活动中心',
      },
    })
    const outboxInsert = calls.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
    assert.match(outboxInsert.sql, /operations\.notification_published/)
    assert.match(outboxInsert.sql, /'\{\}'/)
    assert.equal(calls.filter(call => call.sql.includes('INSERT INTO mip_audit_logs')).length, 1)
    assert.ok(calls.findIndex(call => call.sql.includes('INSERT INTO mip_audit_logs'))
      < calls.findIndex(call => call.sql.includes("status = 'COMPLETED'")))
  })

  it('replays a completed publication without creating recipient facts or another audit', async () => {
    const stored = {
      publicationId: '00000000-0000-4000-8000-000000000099',
      recipientCount: 3,
      sendWechatReminder: true,
      wechatDelivery: 'BEST_EFFORT',
      idempotent: false,
    }
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_events')) return event()
        return {
          id: stored.publicationId,
          request_hash: eventReminderRequestHash(input),
          status: 'COMPLETED',
          response_json: JSON.stringify(stored),
        }
      },
      async query(sql, params) {
        calls.push({ sql, params })
        const error = new Error('duplicate')
        error.code = 'ER_DUP_ENTRY'
        throw error
      },
    }
    const result = await publisher().publishEventReminder(tx, input)
    assert.deepEqual(result, { ...stored, idempotent: true })
    assert.equal(calls.some(call => call.sql.includes('mip_operations_messages')), false)
    assert.equal(calls.some(call => call.sql.includes('mip_audit_logs')), false)
  })

  it('rejects an idempotency key reused with different request facts', async () => {
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_events')) return event()
        return {
          id: '00000000-0000-4000-8000-000000000099',
          request_hash: 'f'.repeat(64),
          status: 'COMPLETED',
          response_json: '{}',
        }
      },
      async query() {
        const error = new Error('duplicate')
        error.code = 'ER_DUP_ENTRY'
        throw error
      },
    }
    await assert.rejects(
      () => publisher().publishEventReminder(tx, input),
      error => error.code === 'COMMUNICATIONS_IDEMPOTENCY_CONFLICT',
    )
  })

  it('requires the locked event version to remain published before selecting recipients', async () => {
    const calls = []
    const tx = {
      async one() { return event({ status: 'UNPUBLISHED' }) },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    await assert.rejects(
      () => publisher().publishEventReminder(tx, input),
      error => error.code === 'COMMUNICATIONS_EVENT_NOT_PUBLISHED',
    )
    assert.equal(calls.some(call => call.sql.includes('SELECT registration.user_id')), false)
    assert.equal(calls.some(call => call.sql.includes('mip_operations_messages')), false)
    assert.equal(calls.some(call => call.sql.includes('mip_audit_logs')), false)
  })

  it('fails closed before any publication write when the recipient cap is exceeded', async () => {
    const calls = []
    const tx = {
      async one() { return event() },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('SELECT registration.user_id')) {
          return [
            { user_id: 'user-a' },
            { user_id: 'user-b' },
          ]
        }
        return { affectedRows: 1 }
      },
    }
    await assert.rejects(
      () => publisher({ maximumRecipients: 1 }).publishEventReminder(tx, input),
      error => error.code === 'COMMUNICATIONS_RECIPIENT_LIMIT_EXCEEDED',
    )
    assert.equal(calls.some(call => call.sql.includes('mip_operations_messages')), false)
    assert.equal(calls.some(call => call.sql.includes('mip_outbox_events')), false)
    assert.equal(calls.some(call => call.sql.includes('mip_audit_logs')), false)
    assert.equal(calls.some(call => call.sql.includes("status = 'COMPLETED'")), false)
  })

  it('does not report or audit partial success when an outbox write fails', async () => {
    const calls = []
    const tx = {
      async one() { return event() },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('SELECT registration.user_id')) return [{ user_id: 'user-a' }]
        if (sql.includes('INSERT INTO mip_outbox_events')) throw new Error('OUTBOX_WRITE_FAILED')
        return { affectedRows: 1 }
      },
    }
    await assert.rejects(() => publisher().publishEventReminder(tx, input), /OUTBOX_WRITE_FAILED/)
    assert.equal(calls.some(call => call.sql.includes('mip_audit_logs')), false)
    assert.equal(calls.some(call => call.sql.includes("status = 'COMPLETED'")), false)
  })

  it('completes an inbox-only zero-recipient request with one summary audit', async () => {
    const calls = []
    const tx = {
      async one() { return event() },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('SELECT registration.user_id')) return []
        return { affectedRows: 1 }
      },
    }
    const result = await publisher().publishEventReminder(tx, {
      ...input,
      idempotencyKey: 'event-reminder-request-0002',
      sendWechatReminder: false,
    })
    assert.deepEqual(result, {
      publicationId: '00000000-0000-4000-8000-000000000001',
      recipientCount: 0,
      sendWechatReminder: false,
      wechatDelivery: 'NOT_REQUESTED',
      idempotent: false,
    })
    assert.equal(calls.some(call => call.sql.includes('mip_operations_messages')), false)
    assert.equal(calls.filter(call => call.sql.includes('mip_audit_logs')).length, 1)
  })
})
