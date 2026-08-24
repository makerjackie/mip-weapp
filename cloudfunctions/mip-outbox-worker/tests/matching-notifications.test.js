'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { projectEvent } = require('../domain/projector')

const APP_ID = 'wx-matching-notifications'

function event(overrides = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    app_id: APP_ID,
    aggregate_type: 'MATCHING_REQUEST',
    aggregate_id: '20000000-0000-4000-8000-000000000001',
    event_type: 'matching.recommendation_ready',
    source_version: 1,
    ...overrides,
  }
}

describe('matching and opportunity notification projection', () => {
  it('rehydrates a current recommendation and routes it to the matching center', async () => {
    const outboxEvent = event()
    const result = await projectEvent({
      async one(sql, params) {
        assert.match(sql, /opportunity_matching_notifications_enabled/)
        assert.match(sql, /source\.version = request\.source_version/)
        assert.deepEqual(params, [APP_ID, outboxEvent.aggregate_id, 1])
        return {
          requester_user_id: '30000000-0000-4000-8000-000000000001',
          result_count: 7,
          source_title: '城市品牌合作',
        }
      },
    }, outboxEvent)

    assert.equal(result.reason, 'PROJECTED')
    assert.deepEqual(result.notifications[0], {
      recipientUserId: '30000000-0000-4000-8000-000000000001',
      dedupeKey: `outbox:${outboxEvent.id}:matching-ready`,
      messageType: 'OPPORTUNITY',
      title: '机会撮合结果已生成',
      body: '“城市品牌合作”已有 7 条推荐。',
      targetType: 'MATCHING',
      targetId: outboxEvent.aggregate_id,
      external: {
        channel: 'WECHAT_CUSTOMER_SERVICE',
        templateKey: 'CUSTOMER_SERVICE_TEXT',
        fields: { content: '机会撮合结果已生成，请在小程序内查看。' },
      },
    })
  })

  it('suppresses a recommendation when the current preference or source fact is unavailable', async () => {
    const result = await projectEvent({ one: async () => null }, event())
    assert.equal(result.reason, 'FACT_NO_LONGER_CURRENT')
    assert.deepEqual(result.notifications, [])
  })

  it('rehydrates a published comment and respects comment preference and mutual blocks in SQL', async () => {
    const outboxEvent = event({
      aggregate_type: 'OPPORTUNITY_COMMENT',
      aggregate_id: '40000000-0000-4000-8000-000000000001',
      event_type: 'opportunity.comment_published',
      source_version: 3,
    })
    const result = await projectEvent({
      async one(sql, params) {
        assert.match(sql, /comment_notifications_enabled/)
        assert.match(sql, /mip_user_blocks/)
        assert.deepEqual(params, [APP_ID, outboxEvent.aggregate_id])
        return {
          author_user_id: '50000000-0000-4000-8000-000000000001',
          owner_user_id: '60000000-0000-4000-8000-000000000001',
          opportunity_id: '70000000-0000-4000-8000-000000000001',
        }
      },
    }, outboxEvent)
    assert.equal(result.notifications[0].recipientUserId, '60000000-0000-4000-8000-000000000001')
    assert.equal(result.notifications[0].targetType, 'OPPORTUNITY')
    assert.equal(result.notifications[0].targetId, '70000000-0000-4000-8000-000000000001')
  })
})
