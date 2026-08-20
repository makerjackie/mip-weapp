'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  materializeNotifications,
  sendDueNotifications,
} = require('../domain/worker')

function businessFactDatabase() {
  const outbox = []
  const notifications = []
  let notificationSequence = 0
  return {
    outbox,
    notifications,
    async query(sql, params = []) {
      if (sql.includes('FROM member_registrations r')) {
        return [{
          id: 'registration-1',
          user_id: 'openid-user',
          event_id: 'event-1',
          status: 'REGISTERED',
          version: 2,
          updated_at: '2027-01-02T00:00:00.000Z',
          title: '城市手作聚会',
          starts_at: '2027-01-03T02:00:00.000Z',
          location: '上海',
        }]
      }
      if (sql.includes('FROM member_event_changes c')) {
        return [{
          id: 8,
          event_id: 'event-1',
          event_version: 4,
          summary: '活动地点已更新',
          created_at: '2027-01-02T01:00:00.000Z',
          title: '城市手作聚会',
          starts_at: '2027-01-03T02:00:00.000Z',
          location: '上海',
          status: 'PUBLISHED',
          cancellation_reason: null,
          user_id: 'openid-user',
        }]
      }
      if (sql.includes('FROM member_events e')
        && sql.includes('INTERVAL 23 HOUR')) {
        return [{
          event_id: 'event-1',
          version: 4,
          title: '城市手作聚会',
          starts_at: '2027-01-03T02:00:00.000Z',
          location: '上海',
          user_id: 'openid-user',
        }]
      }
      if (sql.includes('FROM member_refunds f')) {
        return [{
          id: 'refund-1',
          status: 'REFUNDED',
          amount_cents: 8800,
          updated_at: '2027-01-02T02:00:00.000Z',
          order_id: 'order-1',
          user_id: 'openid-user',
          description: '城市手作聚会报名费',
        }]
      }
      if (sql.includes('INSERT IGNORE INTO member_notifications')) {
        notifications.push(params)
        return { affectedRows: 1 }
      }
      if (sql.includes('INSERT IGNORE INTO member_notification_outbox')) {
        outbox.push(params)
        return { affectedRows: 1 }
      }
      return []
    },
    async one(sql) {
      if (sql.includes('SELECT id FROM member_notifications')) {
        notificationSequence += 1
        return { id: `notification-${notificationSequence}` }
      }
      return null
    },
  }
}

function deliveryDatabase(rows, grant = { id: 'grant-1' }) {
  const queue = [...rows]
  const updates = []
  return {
    updates,
    async transaction(work) {
      return work({
        async one(sql) {
          if (sql.includes('FROM member_notification_outbox')) {
            return queue.shift() || null
          }
          return null
        },
        async query(sql, params = []) {
          updates.push({ sql, params })
          return { affectedRows: 1 }
        },
      })
    },
    async one(sql) {
      if (sql.includes('FROM member_notification_subscriptions')) {
        return grant
      }
      return null
    },
    async query(sql, params = []) {
      updates.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
}

function dueRow(overrides = {}) {
  return {
    id: 'outbox-1',
    app_id: 'wx-app',
    user_id: 'openid-user',
    event_id: 'event-1',
    template_key: 'event_reminder',
    page_path: '/packages/member/ticket/index?eventId=event-1',
    payload: JSON.stringify({
      title: '城市手作聚会',
      time: '1月3日 10:00',
      location: '上海',
    }),
    expires_at: '2099-01-01T00:00:00.000Z',
    attempts: 0,
    ...overrides,
  }
}

const reminderTemplate = {
  templateId: 'template-reminder',
  fields: {
    title: 'thing1',
    time: 'time2',
    location: 'thing3',
  },
}

describe('membership notification worker', () => {
  it('materializes each durable business fact into an inbox item and outbox task', async () => {
    const database = businessFactDatabase()
    const counts = await materializeNotifications(database, ['wx-app'])

    assert.deepEqual(counts, {
      registrations: 1,
      eventChanges: 1,
      reminders: 1,
      refunds: 1,
    })
    assert.equal(database.notifications.length, 4)
    assert.deepEqual(
      database.outbox.map(params => params[9]),
      ['registration', 'event_update', 'event_reminder', 'refund'],
    )
    assert.deepEqual(
      database.outbox.map(params => params[11]),
      [
        '/packages/member/ticket/index?eventId=event-1',
        '/packages/member/event-detail/index?eventId=event-1',
        '/packages/member/ticket/index?eventId=event-1',
        '/packages/member/order-detail/index?orderId=order-1',
      ],
    )
    assert.ok(database.outbox.every(params =>
      !String(params[10]).includes('openid-user')
      && !String(params[10]).includes('138')))
  })

  it('sends once, consumes one accepted grant, and completes the leased task', async () => {
    const database = deliveryDatabase([dueRow()])
    const payloads = []
    const result = await sendDueNotifications(database, {
      appIds: ['wx-app'],
      templates: { event_reminder: reminderTemplate },
      miniprogramState: 'trial',
      leaseOwner: 'worker-1',
      limit: 10,
      async send(payload) {
        payloads.push(payload)
        return { errCode: 0, msgId: 'wechat-msg-1' }
      },
    })

    assert.deepEqual(result, { sent: 1, inAppOnly: 0, failed: 0 })
    assert.equal(payloads.length, 1)
    assert.equal(payloads[0].touser, 'openid-user')
    assert.equal(payloads[0].page, '/packages/member/ticket/index?eventId=event-1')
    assert.equal(payloads[0].data.thing1.value, '城市手作聚会')
    assert.ok(database.updates.some(({ sql, params }) =>
      sql.includes('SET consumed_at') && params[0] === 'grant-1'))
    assert.ok(database.updates.some(({ sql, params }) =>
      sql.includes("SET status = 'SENT'") && params[0] === 'wechat-msg-1'))
  })

  it('keeps the in-app inbox as fallback when no WeChat template is configured', async () => {
    const database = deliveryDatabase([dueRow()])
    const result = await sendDueNotifications(database, {
      appIds: ['wx-app'],
      templates: {},
      miniprogramState: 'trial',
      leaseOwner: 'worker-1',
      limit: 10,
      async send() {
        throw new Error('must not send')
      },
    })

    assert.deepEqual(result, { sent: 0, inAppOnly: 1, failed: 0 })
    assert.ok(database.updates.some(({ params }) =>
      params[0] === 'IN_APP_ONLY' && params[2] === 'TEMPLATE_NOT_CONFIGURED'))
  })

  it('moves a third failed delivery into the operations exception queue', async () => {
    const database = deliveryDatabase([dueRow({ attempts: 2 })])
    const result = await sendDueNotifications(database, {
      appIds: ['wx-app'],
      templates: { event_reminder: reminderTemplate },
      miniprogramState: 'trial',
      leaseOwner: 'worker-1',
      limit: 10,
      async send() {
        return { errCode: 43101 }
      },
    })

    assert.deepEqual(result, { sent: 0, inAppOnly: 0, failed: 1 })
    assert.ok(database.updates.some(({ params }) =>
      params[0] === 'FAILED' && params[2] === 'WECHAT_43101'))
  })
})
