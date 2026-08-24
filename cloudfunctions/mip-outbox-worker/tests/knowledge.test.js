'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { projectEvent } = require('../domain/projector')

const base = {
  id: '90000000-0000-4000-8000-000000000001',
  app_id: 'wx-app',
  aggregate_id: '10000000-0000-4000-8000-000000000001',
  source_version: 1,
}

describe('knowledge outbox projection', () => {
  it('routes confirmed content payment to the purchaser and knowledge detail', async () => {
    const event = { ...base, aggregate_type: 'ORDER', event_type: 'knowledge.payment_confirmed' }
    const result = await projectEvent({
      async one() {
        return {
          order_id: event.aggregate_id,
          user_id: '20000000-0000-4000-8000-000000000001',
          content_id: '30000000-0000-4000-8000-000000000001',
        }
      },
    }, event)
    assert.equal(result.notifications[0].targetType, 'KNOWLEDGE')
    assert.equal(result.notifications[0].recipientUserId, '20000000-0000-4000-8000-000000000001')
  })

  it('publishes hotspot messages only to server-selected opt-in recipients', async () => {
    const event = { ...base, aggregate_type: 'KNOWLEDGE_CONTENT', event_type: 'knowledge.content_published' }
    const database = {
      async one() {
        return { id: event.aggregate_id, title: '今日热点', content_type: 'HOT_NEWS', version: 1 }
      },
      async query(sql) {
        assert.match(sql, /hotspot_notifications_enabled = 1/)
        return [{ user_id: '20000000-0000-4000-8000-000000000001' }]
      },
    }
    const result = await projectEvent(database, event)
    assert.equal(result.notifications.length, 1)
    assert.equal(result.notifications[0].targetId, event.aggregate_id)
  })

  it('continues hotspot fanout after 500 recipients without dropping recipient 501', async () => {
    const event = { ...base, aggregate_type: 'KNOWLEDGE_CONTENT', event_type: 'knowledge.content_published' }
    const recipients = Array.from({ length: 501 }, (_, index) => ({
      user_id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }))
    const database = {
      async one() {
        return { id: event.aggregate_id, title: '今日热点', content_type: 'HOT_NEWS', version: 1 }
      },
      async query(_sql, params) {
        return recipients.filter(row => row.user_id > params[1]).slice(0, 501)
      },
    }
    const delivered = []
    let continuation = null
    let pages = 0
    do {
      const page = await projectEvent(database, {
        ...event,
        ...(continuation ? { payload_json: JSON.stringify(continuation) } : {}),
      })
      delivered.push(...page.notifications.map(item => item.recipientUserId))
      continuation = page.continuation
      pages += 1
    } while (continuation)
    assert.equal(pages, 11)
    assert.deepEqual(delivered, recipients.map(row => row.user_id))
  })
})
