'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  createMessageDeliveryRecordRepository,
  normalizeMessageDeliveryRecordList,
} = require('../domain/message-delivery-records')

const ID = '10000000-0000-4000-8000-000000000001'
const NOW = new Date('2030-08-25T10:00:00.000Z')

describe('message delivery records', () => {
  it('normalizes bounded filters and rejects invalid channel or range', () => {
    assert.deepEqual(normalizeMessageDeliveryRecordList({
      query: '活动',
      channel: 'wechat_subscription',
      status: 'failed',
      from: '2030-08-01T00:00:00.000Z',
      to: '2030-08-31T00:00:00.000Z',
      limit: 100,
    }), {
      query: '活动',
      channel: 'WECHAT_SUBSCRIPTION',
      status: 'FAILED',
      from: '2030-08-01T00:00:00.000Z',
      to: '2030-08-31T00:00:00.000Z',
      cursor: null,
      limit: 100,
    })
    assert.throws(() => normalizeMessageDeliveryRecordList({ channel: 'EMAIL' }), /消息渠道无效/)
    assert.throws(() => normalizeMessageDeliveryRecordList({ from: '2030-09-01', to: '2030-08-01' }), /时间范围无效/)
  })

  it('uses app and message capability scope, stable ordering, and hides raw task identifiers', async () => {
    let call
    const database = {
      async query(sql, params) {
        call = { sql, params }
        return [{
          id: ID,
          channel: 'WECHAT_SUBSCRIPTION',
          status: 'FAILED',
          attempts: 2,
          last_error_code: 'DELIVERY_TEMPORARY',
          available_at: NOW,
          delivered_at: null,
          created_at: NOW,
          updated_at: NOW,
          title: '活动提醒',
          event_title: '2030 城市见面会',
          campaign_name: '八月提醒',
          nickname: '小明',
          player_number: 18,
          branch_name: '武汉分会',
        }]
      },
    }
    const page = await createMessageDeliveryRecordRepository(database).listMessageDeliveryRecords({
      appId: 'wx-test',
      visibility: { platform: false, branchIds: ['branch-1'] },
      query: '活动',
      channel: 'WECHAT_SUBSCRIPTION',
      status: 'FAILED',
      from: null,
      to: null,
      cursor: null,
      limit: 20,
    })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].recordKey, '576f18824476444ff24b')
    assert.equal(Object.hasOwn(page.items[0], 'sortKey'), false)
    assert.equal(Object.hasOwn(page.items[0], 'payload'), false)
    assert.equal(Object.hasOwn(page.items[0], 'openId'), false)
    assert.match(call.sql, /task\.app_id = \?/)
    assert.match(call.sql, /task\.channel = \?/)
    assert.match(call.sql, /task\.status = \?/)
    assert.match(call.sql, /ORDER BY task\.updated_at DESC, task\.id DESC/)
    assert.equal(call.params.at(-1), 21)
  })
})
