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
  it('suppresses retired matching recommendations without reading candidate data', async () => {
    const result = await projectEvent({}, event())
    assert.equal(result.reason, 'FEATURE_RETIRED')
    assert.deepEqual(result.notifications, [])
  })

  it('rehydrates a published comment and respects comment preference and mutual blocks in SQL', async () => {
    const outboxEvent = event({
      aggregate_type: 'OPPORTUNITY_COMMENT',
      aggregate_id: '40000000-0000-4000-8000-000000000001',
      event_type: 'opportunity.comment_published',
      source_version: 3,
      payload_json: {
        recipientUserId: 'attacker-controlled-recipient',
        opportunityId: 'attacker-controlled-opportunity',
      },
    })
    const result = await projectEvent({
      async one(sql, params) {
        assert.match(sql, /opportunity\.status IN \('PUBLISHED', 'ENDED'\)/)
        assert.match(sql, /opportunity\.published_at IS NOT NULL/)
        assert.match(sql, /author\.id = comment\.author_user_id/)
        assert.match(sql, /author\.status = 'ACTIVE'/)
        assert.match(sql, /owner\.id = opportunity\.owner_user_id/)
        assert.match(sql, /owner\.status = 'ACTIVE'/)
        assert.match(sql, /comment\.version = \?/)
        assert.match(sql, /comment\.status = 'PUBLISHED'/)
        assert.match(sql, /comment\.content_safety_status = 'PASSED'/)
        assert.match(sql, /comment_notifications_enabled/)
        assert.match(sql, /mip_user_blocks/)
        assert.match(sql, /block\.blocker_user_id = comment\.author_user_id/)
        assert.match(sql, /block\.blocked_user_id = owner\.id/)
        assert.match(sql, /block\.blocker_user_id = owner\.id/)
        assert.match(sql, /block\.blocked_user_id = comment\.author_user_id/)
        assert.deepEqual(params, [APP_ID, outboxEvent.aggregate_id, outboxEvent.source_version])
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
    assert.equal(JSON.stringify(result).includes('attacker-controlled'), false)
  })

  it('suppresses an opportunity comment when a current fact no longer matches', async () => {
    const outboxEvent = event({
      aggregate_type: 'OPPORTUNITY_COMMENT',
      aggregate_id: '40000000-0000-4000-8000-000000000001',
      event_type: 'opportunity.comment_published',
      source_version: 3,
    })
    const result = await projectEvent({ one: async () => null }, outboxEvent)
    assert.equal(result.reason, 'FACT_NO_LONGER_CURRENT')
    assert.deepEqual(result.notifications, [])
  })
})
