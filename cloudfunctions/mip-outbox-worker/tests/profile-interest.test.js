'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { projectEvent } = require('../domain/projector')

const APP_ID = 'wx-profile-interest'
const RELATION_ID = '10000000-0000-4000-8000-000000000001'
const ACTOR_ID = '20000000-0000-4000-8000-000000000001'
const TARGET_ID = '30000000-0000-4000-8000-000000000001'
const SOURCE_ID = '40000000-0000-4000-8000-000000000001'
const OUTBOX_ID = '50000000-0000-4000-8000-000000000001'

function interestEvent(overrides = {}) {
  return {
    id: OUTBOX_ID,
    app_id: APP_ID,
    aggregate_type: 'PROFILE_INTEREST',
    aggregate_id: RELATION_ID,
    event_type: 'profile.interest_changed',
    source_version: 2,
    payload_json: {
      recipientUserId: 'attacker-controlled-recipient',
      sourceType: 'PROFILE',
      sourceId: 'attacker-controlled-source',
    },
    ...overrides,
  }
}

function currentRelationship(overrides = {}) {
  return {
    status: 'ACTIVE',
    version: 2,
    actor_user_id: ACTOR_ID,
    target_user_id: TARGET_ID,
    source_type: 'OPPORTUNITY',
    source_id: SOURCE_ID,
    ...overrides,
  }
}

function assertCurrentFactQuery(sql, params, event) {
  assert.match(sql, /FROM mip_profile_interests i/)
  assert.match(sql, /INNER JOIN mip_users actor/)
  assert.match(sql, /actor\.id = i\.actor_user_id AND actor\.status = 'ACTIVE'/)
  assert.match(sql, /INNER JOIN mip_users recipient/)
  assert.match(sql, /recipient\.id = i\.target_user_id AND recipient\.status = 'ACTIVE'/)
  assert.match(sql, /opportunity\.owner_user_id = i\.target_user_id/)
  assert.match(sql, /opportunity\.status IN \('PUBLISHED', 'ENDED'\)/)
  assert.match(sql, /cooperation\.owner_user_id = i\.target_user_id/)
  assert.match(sql, /super_case\.owner_user_id = i\.target_user_id/)
  assert.match(sql, /profile_source\.id = i\.source_id AND profile_source\.id = i\.target_user_id/)
  assert.match(sql, /i\.status = 'ACTIVE' AND i\.version = \?/)
  assert.match(sql, /FROM mip_user_blocks visibility_block/)
  assert.match(sql, /visibility_block\.status = 'ACTIVE'/)
  assert.match(sql, /visibility_block\.blocker_user_id = i\.actor_user_id/)
  assert.match(sql, /visibility_block\.blocked_user_id = i\.target_user_id/)
  assert.match(sql, /visibility_block\.blocker_user_id = i\.target_user_id/)
  assert.match(sql, /visibility_block\.blocked_user_id = i\.actor_user_id/)
  assert.deepEqual(params, [event.app_id, event.aggregate_id, event.source_version])
}

describe('profile interest outbox projection', () => {
  it('projects an opportunity interest from one current-fact query', async () => {
    const outboxEvent = interestEvent()
    let queryCount = 0
    const result = await projectEvent({
      async one(sql, params) {
        queryCount += 1
        assertCurrentFactQuery(sql, params, outboxEvent)
        return currentRelationship()
      },
    }, outboxEvent)

    assert.equal(queryCount, 1)
    assert.equal(result.reason, 'PROJECTED')
    assert.deepEqual(result.notifications, [{
      recipientUserId: TARGET_ID,
      messageType: 'PROFILE_INTEREST',
      title: '机会收到新的关注',
      body: '你的机会收到新的感兴趣标记。',
      dedupeKey: `outbox:${OUTBOX_ID}:opportunity-interest`,
      targetType: 'OPPORTUNITY',
      targetId: SOURCE_ID,
      external: {
        channel: 'WECHAT_CUSTOMER_SERVICE',
        templateKey: 'CUSTOMER_SERVICE_TEXT',
        fields: { content: '机会收到新的关注，请在小程序内查看。' },
      },
    }])
    assert.equal(JSON.stringify(result).includes('attacker-controlled'), false)
  })

  it('keeps direct public-profile interest bound to the current target profile', async () => {
    const outboxEvent = interestEvent()
    const result = await projectEvent({
      async one(sql, params) {
        assertCurrentFactQuery(sql, params, outboxEvent)
        return currentRelationship({ source_type: 'PROFILE', source_id: TARGET_ID })
      },
    }, outboxEvent)

    assert.equal(result.reason, 'PROJECTED')
    assert.equal(result.notifications.length, 1)
    assert.equal(result.notifications[0].recipientUserId, TARGET_ID)
    assert.equal(result.notifications[0].title, '公开档案收到新的关注')
    assert.equal(result.notifications[0].dedupeKey, `outbox:${OUTBOX_ID}:profile-interest`)
    assert.equal(JSON.stringify(result).includes('attacker-controlled'), false)
  })

  it('fails closed when current facts no longer satisfy the query', async () => {
    const outboxEvent = interestEvent()
    const result = await projectEvent({
      async one(sql, params) {
        assertCurrentFactQuery(sql, params, outboxEvent)
        return null
      },
    }, outboxEvent)

    assert.equal(result.reason, 'FACT_NO_LONGER_CURRENT')
    assert.deepEqual(result.notifications, [])
    assert.deepEqual(result.growth, [])
  })

  for (const [description, relationship] of [
    ['the relation is cancelled', currentRelationship({ status: 'CANCELLED' })],
    ['the relation version has advanced', currentRelationship({ version: 3 })],
    ['the source type is not recognized', currentRelationship({ source_type: 'UNTRUSTED' })],
  ]) {
    it(`fails closed when ${description}`, async () => {
      const result = await projectEvent({ one: async () => relationship }, interestEvent())
      assert.equal(result.reason, 'FACT_NO_LONGER_CURRENT')
      assert.deepEqual(result.notifications, [])
    })
  }
})
