'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  EXCEPTION_STATUSES,
  EXCEPTION_TYPES,
  listOperationalExceptions,
  targetFor,
} = require('../domain/operational-exceptions')

const APP_ID = 'wx1111111111111111'
const NOW = new Date('2026-08-24T12:00:00.000Z')
const IDS = {
  outbox: '11111111-1111-4111-8111-111111111111',
  event: '22222222-2222-4222-8222-222222222222',
  refund: '33333333-3333-4333-8333-333333333333',
  order: '44444444-4444-4444-8444-444444444444',
  payment: '55555555-5555-4555-8555-555555555555',
  media: '66666666-6666-4666-8666-666666666666',
  delivery: '77777777-7777-4777-8777-777777777777',
  ai: '88888888-8888-4888-8888-888888888888',
}

function fixtureDatabase() {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_outbox_events')) {
        return [{
          id: IDS.outbox,
          aggregate_type: 'EVENT',
          aggregate_id: IDS.event,
          status: 'FAILED',
          attempts: 2,
          updated_at: new Date('2026-08-24T11:59:00.000Z'),
          last_error_code: 'MUST_NOT_LEAK',
          payload_json: { openid: 'MUST_NOT_LEAK' },
        }]
      }
      if (sql.includes('FROM mip_refunds')) {
        return [{
          id: IDS.refund,
          order_id: IDS.order,
          status: 'PROCESSING',
          updated_at: new Date('2026-08-24T11:58:00.000Z'),
          merchant_refund_no: 'MUST_NOT_LEAK',
        }]
      }
      if (sql.includes('FROM mip_payment_attempts')) {
        return [{
          id: IDS.payment,
          order_id: IDS.order,
          status: 'FAILED',
          updated_at: new Date('2026-08-24T11:57:00.000Z'),
          prepay_id: 'MUST_NOT_LEAK',
        }]
      }
      if (sql.includes('FROM mip_media_assets')) {
        return [{
          id: IDS.media,
          status: 'REJECTED',
          updated_at: new Date('2026-08-24T11:56:00.000Z'),
          cloud_file_id: 'cloud://MUST_NOT_LEAK',
        }]
      }
      if (sql.includes('FROM mip_delivery_tasks')) {
        return [{
          id: IDS.delivery,
          status: 'PROCESSING',
          updated_at: new Date('2026-08-24T11:55:00.000Z'),
          target_type: 'EVENT',
          target_id: IDS.event,
          recipient_user_id: 'MUST_NOT_LEAK',
          payload_json: { phoneNumber: 'MUST_NOT_LEAK' },
        }]
      }
      if (sql.includes('FROM mip_ai_drafts')) {
        return [{
          id: IDS.ai,
          status: 'EXPIRED',
          expires_at: new Date('2026-08-24T11:00:00.000Z'),
          updated_at: new Date('2026-08-24T11:54:00.000Z'),
          audio_status: 'READY',
          transcript_text: 'MUST_NOT_LEAK',
        }]
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }
}

describe('operational exception reader', () => {
  it('aggregates only app-scoped durable facts into a limited, sanitized page', async () => {
    const database = fixtureDatabase()
    const items = await listOperationalExceptions(database, {
      appId: APP_ID,
      now: NOW,
      types: EXCEPTION_TYPES,
      statuses: EXCEPTION_STATUSES,
      limit: 4,
    })

    assert.equal(database.calls.length, 6)
    assert.equal(database.calls.every(call => call.params[0] === APP_ID), true)
    assert.equal(database.calls.every(call => Number(call.params.at(-1)) === 4), true)
    assert.equal(items.length, 4)
    assert.deepEqual(items.map(item => item.source), ['OUTBOX', 'REFUND', 'PAYMENT', 'MEDIA'])
    assert.equal(items[0].target.route, `/packages/admin/event-console/index?eventId=${IDS.event}`)
    const serialized = JSON.stringify(items).toLowerCase()
    for (const forbidden of ['must_not_leak', 'openid', 'phone', 'cloud://', 'prepay', 'merchant_refund']) {
      assert.equal(serialized.includes(forbidden), false)
    }
    for (const item of items) {
      assert.deepEqual(Object.keys(item), ['id', 'source', 'status', 'title', 'summary', 'occurredAt', 'reasonCode', 'target'])
    }
    const aiQuery = database.calls.find(call => call.sql.includes('FROM mip_ai_drafts')).sql
    assert.match(aiQuery, /asset\.purpose = 'AI_AUDIO'/)
    assert.match(aiQuery, /asset\.owner_user_id = draft\.user_id/)
  })

  it('pushes type and status filters into the selected bounded query', async () => {
    const database = fixtureDatabase()
    const items = await listOperationalExceptions(database, {
      appId: APP_ID,
      now: NOW,
      types: ['PAYMENT'],
      statuses: ['FAILED'],
      limit: 12,
    })

    assert.equal(database.calls.length, 1)
    assert.match(database.calls[0].sql, /FROM mip_payment_attempts/)
    assert.doesNotMatch(database.calls[0].sql, /DATE_SUB/)
    assert.equal(database.calls[0].params.at(-1), 12)
    assert.deepEqual(items.map(item => [item.source, item.status]), [['PAYMENT', 'FAILED']])
  })

  it('keeps the terminal unknown delivery outcome as a read-only fact', async () => {
    const database = fixtureDatabase()
    const query = database.query.bind(database)
    database.query = async (sql, params) => {
      const rows = await query(sql, params)
      if (sql.includes('FROM mip_delivery_tasks')) {
        return rows.map(row => ({ ...row, status: 'CANCELLED', last_error_code: 'DELIVERY_OUTCOME_UNKNOWN' }))
      }
      return rows
    }
    const items = await listOperationalExceptions(database, {
      appId: APP_ID,
      now: NOW,
      types: ['DELIVERY'],
      statuses: ['FAILED'],
      limit: 10,
    })
    assert.equal(items[0].status, 'FAILED')
    assert.equal(items[0].reasonCode, 'DELIVERY_OUTCOME_UNKNOWN')
    const deliveryQuery = database.calls.find(call => call.sql.includes('FROM mip_delivery_tasks')).sql
    assert.match(deliveryQuery, /task\.status = 'FAILED'/)
    assert.match(deliveryQuery, /task\.status = 'CANCELLED' AND task\.last_error_code IS NOT NULL/)
  })

  it('does not forward unknown or malformed navigation targets', () => {
    assert.equal(targetFor('UNKNOWN', IDS.event), null)
    assert.equal(targetFor('EVENT', 'not-a-uuid'), null)
    assert.deepEqual(targetFor('ORDER', IDS.order), {
      type: 'ORDER',
      id: IDS.order,
      route: '/packages/admin/orders/index',
    })
  })

  it('rejects a missing app scope before querying', async () => {
    const database = fixtureDatabase()
    for (const appId of ['', '   ', null, undefined]) {
      await assert.rejects(
        listOperationalExceptions(database, { appId, now: NOW, limit: 10 }),
        /OPERATIONAL_EXCEPTION_APP_INVALID/,
      )
    }
    assert.equal(database.calls.length, 0)
  })
})
