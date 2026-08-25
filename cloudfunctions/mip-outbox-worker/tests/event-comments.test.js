'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { roleCapabilities } = require('../../mip-admin-api/domain/capabilities')
const {
  EVENT_COMMENT_ROLE_CAPABILITIES,
  hasEffectiveEventCommentCapability,
} = require('../domain/event-comment-policy')
const { projectEvent } = require('../domain/projector')

const APP_ID = 'wx-event-comment-projection'
const OUTBOX_ID = '10000000-0000-4000-8000-000000000001'
const COMMENT_ID = '20000000-0000-4000-8000-000000000002'
const EVENT_ID = '30000000-0000-4000-8000-000000000003'
const ORGANIZER_ID = '40000000-0000-4000-8000-000000000004'
const MANAGER_ID = '50000000-0000-4000-8000-000000000005'

function publishedEvent(overrides = {}) {
  return {
    id: OUTBOX_ID,
    app_id: APP_ID,
    aggregate_type: 'EVENT_COMMENT',
    aggregate_id: COMMENT_ID,
    event_type: 'event.comment_published',
    source_version: 1,
    payload_json: JSON.stringify({
      authorUserId: 'untrusted-author',
      recipientUserId: 'untrusted-recipient',
    }),
    ...overrides,
  }
}

describe('event comment outbox projection', () => {
  it('rehydrates current responsibilities and filters preferences, self-notices and mutual blocks', async () => {
    const outboxEvent = publishedEvent()
    const result = await projectEvent({
      async query(sql, params) {
        assert.match(sql, /comment\.target_type = 'EVENT'/)
        assert.match(sql, /comment\.status = 'PUBLISHED'/)
        assert.match(sql, /comment\.version = \?/)
        assert.match(sql, /comment\.content_safety_status = 'PASSED'/)
        assert.match(sql, /current_event\.published_at IS NOT NULL/)
        assert.match(sql, /current_event\.status IN \('PUBLISHED', 'CANCELLED', 'ENDED'\)/)
        assert.match(sql, /author\.status = 'ACTIVE'/)
        assert.match(sql, /recipient\.status = 'ACTIVE'/)
        assert.match(sql, /mip_admin_role_bindings/)
        assert.match(sql, /'PLATFORM_OWNER', 'PLATFORM_OPERATIONS'/)
        assert.match(sql, /'BRANCH_ADMIN'/)
        assert.match(sql, /'EVENT_OWNER', 'EVENT_MANAGER'/)
        assert.match(sql, /mip_role_capability_policies/)
        assert.match(sql, /comment_notifications_enabled/)
        assert.match(sql, /responsibility\.recipient_user_id <> responsibility\.author_user_id/)
        assert.match(sql, /mip_user_blocks/)
        assert.match(sql, /SELECT responsibility\.recipient_user_id/)
        assert.doesNotMatch(sql, /SELECT DISTINCT/)
        assert.deepEqual(params, [APP_ID, COMMENT_ID, 1])
        return [
          {
            recipient_user_id: ORGANIZER_ID,
            event_id: EVENT_ID,
            responsibility_kind: 'ORGANIZER',
            role_key: null,
          },
          {
            recipient_user_id: MANAGER_ID,
            event_id: EVENT_ID,
            responsibility_kind: 'MANAGEMENT',
            role_key: 'EVENT_MANAGER',
            policy_mode: 'DEFAULT',
          },
        ]
      },
    }, outboxEvent)

    assert.equal(result.reason, 'PROJECTED')
    assert.equal(result.notifications.length, 2)
    assert.deepEqual(result.notifications.map(item => item.recipientUserId), [ORGANIZER_ID, MANAGER_ID])
    assert.deepEqual(result.notifications.map(item => item.dedupeKey), [
      `outbox:${OUTBOX_ID}:recipient:${ORGANIZER_ID}`,
      `outbox:${OUTBOX_ID}:recipient:${MANAGER_ID}`,
    ])
    for (const notification of result.notifications) {
      assert.equal(notification.messageType, 'EVENT')
      assert.equal(notification.targetType, 'EVENT')
      assert.equal(notification.targetId, EVENT_ID)
      assert.equal(notification.external.channel, 'WECHAT_CUSTOMER_SERVICE')
    }
    assert.equal(JSON.stringify(result).includes('untrusted-recipient'), false)
  })

  it('finishes without a notification when no current effective recipient remains', async () => {
    const result = await projectEvent({
      async query() { return [] },
    }, publishedEvent())
    assert.equal(result.reason, 'NO_EFFECTIVE_RECIPIENTS')
    assert.deepEqual(result.notifications, [])
    assert.deepEqual(result.growth, [])
  })

  it('rejects malformed recipient facts returned by the projection query', async () => {
    await assert.rejects(projectEvent({
      async query() {
        return [{
          recipient_user_id: 'not-a-user-id',
          event_id: EVENT_ID,
          responsibility_kind: 'ORGANIZER',
          role_key: null,
        }]
      },
    }, publishedEvent()), /OUTBOX_EVENT_INVALID/)
  })

  it('keeps policy evaluation aligned with the admin capability contract', () => {
    for (const [roleKey, capabilities] of Object.entries(EVENT_COMMENT_ROLE_CAPABILITIES)) {
      assert.deepEqual(capabilities, roleCapabilities[roleKey])
    }
    assert.equal(hasEffectiveEventCommentCapability({
      responsibility_kind: 'MANAGEMENT',
      role_key: 'EVENT_MANAGER',
      policy_mode: 'CUSTOM',
      capabilities_json: JSON.stringify(['events.read', 'events.comments.manage']),
    }), true)
    for (const capabilities of [
      ['events.comments.manage', 'events.comments.manage'],
      ['events.comments.manage', 'refunds.submit'],
      [42, 'events.comments.manage'],
    ]) {
      assert.equal(hasEffectiveEventCommentCapability({
        responsibility_kind: 'MANAGEMENT',
        role_key: 'EVENT_MANAGER',
        policy_mode: 'CUSTOM',
        capabilities_json: JSON.stringify(capabilities),
      }), false)
    }
  })
})
