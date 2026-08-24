'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { projectEvent } = require('../domain/projector')

const base = {
  id: '90000000-0000-4000-8000-000000000001',
  app_id: 'wx-app',
  aggregate_type: 'USER',
  aggregate_id: '10000000-0000-4000-8000-000000000001',
  event_type: 'identity.profile_completed',
  source_version: 1,
}

describe('outbox event projector', () => {
  it('projects profile completion to growth from the current server fact', async () => {
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ sql, params })
        return { user_id: base.aggregate_id }
      },
    }
    const result = await projectEvent(database, base)
    assert.equal(result.supported, true)
    assert.deepEqual(result.growth, [{
      userId: base.aggregate_id,
      sourceEventType: 'identity.profile_completed',
      sourceEventId: base.id,
    }])
    assert.deepEqual(calls[0].params, ['wx-app', base.aggregate_id])
  })

  it('projects a currently published super case to its owner growth ledger', async () => {
    const event = {
      ...base,
      aggregate_type: 'SUPER_CASE',
      aggregate_id: '20000000-0000-4000-8000-000000000008',
      event_type: 'super_case.published',
    }
    const ownerUserId = '30000000-0000-4000-8000-000000000008'
    const result = await projectEvent({
      async one(sql, params) {
        assert.match(sql, /mip_super_cases/)
        assert.match(sql, /c\.status = 'PUBLISHED'/)
        assert.deepEqual(params, ['wx-app', event.aggregate_id])
        return { owner_user_id: ownerUserId }
      },
    }, event)

    assert.deepEqual(result.growth, [{
      userId: ownerUserId,
      sourceEventType: 'super_case.published',
      sourceEventId: event.id,
    }])
  })

  it('rebuilds a referral recipient from relational facts instead of payload identity', async () => {
    const event = {
      ...base,
      aggregate_type: 'REFERRAL_INTENT',
      aggregate_id: '20000000-0000-4000-8000-000000000001',
      event_type: 'opportunity.referral_changed',
      source_version: 3,
      payload_json: { recipientUserId: 'attacker-controlled' },
    }
    const database = {
      async one(sql, params) {
        assert.match(sql, /mip_referral_intents/)
        assert.deepEqual(params, ['wx-app', event.aggregate_id])
        return {
          status: 'ACTIVE',
          version: 3,
          opportunity_id: '30000000-0000-4000-8000-000000000001',
          actor_user_id: '50000000-0000-4000-8000-000000000001',
          target_user_id: '40000000-0000-4000-8000-000000000001',
        }
      },
    }
    const result = await projectEvent(database, event)
    const replay = await projectEvent(database, event)
    assert.equal(result.notifications[0].recipientUserId, '40000000-0000-4000-8000-000000000001')
    assert.equal(result.notifications[0].targetId, '30000000-0000-4000-8000-000000000001')
    assert.equal(result.notifications[0].dedupeKey, `outbox:${event.id}:referral`)
    assert.deepEqual(result.growth, [])
    assert.deepEqual(replay.notifications, result.notifications)
  })

  it('projects the first active referral fact to the fixed server reward rule idempotently', async () => {
    const event = {
      ...base,
      aggregate_type: 'REFERRAL_INTENT',
      aggregate_id: '20000000-0000-4000-8000-000000000002',
      event_type: 'opportunity.referral_changed',
      source_version: 1,
      payload_json: { actorUserId: 'attacker-controlled' },
    }
    const actorUserId = '50000000-0000-4000-8000-000000000002'
    const database = {
      async one(sql, params) {
        assert.match(sql, /r\.actor_user_id/)
        assert.match(sql, /actor\.status = 'ACTIVE'/)
        assert.deepEqual(params, ['wx-app', event.aggregate_id])
        return {
          status: 'ACTIVE',
          version: 1,
          opportunity_id: '30000000-0000-4000-8000-000000000002',
          actor_user_id: actorUserId,
          target_user_id: '40000000-0000-4000-8000-000000000002',
        }
      },
    }
    const result = await projectEvent(database, event)
    const replay = await projectEvent(database, event)
    assert.deepEqual(result.growth, [{
      userId: actorUserId,
      sourceEventType: 'referral.confirmed',
      sourceEventId: event.id,
    }])
    assert.deepEqual(replay.growth, result.growth)
    assert.doesNotMatch(JSON.stringify(result), /attacker-controlled/)
  })

  it('drops a stale toggle projection without creating a notification', async () => {
    const event = {
      ...base,
      aggregate_type: 'EVENT_HEART',
      aggregate_id: '50000000-0000-4000-8000-000000000001',
      event_type: 'event.heart_changed',
      source_version: 1,
    }
    const result = await projectEvent({
      one: async () => ({ status: 'ACTIVE', version: 2 }),
    }, event)
    assert.equal(result.supported, true)
    assert.deepEqual(result.notifications, [])
    assert.equal(result.reason, 'FACT_NO_LONGER_CURRENT')
  })

  it('projects a current heart fact to inbox and the optional subscription adapter', async () => {
    const event = {
      ...base,
      aggregate_type: 'EVENT_HEART',
      aggregate_id: '50000000-0000-4000-8000-000000000002',
      event_type: 'event.heart_changed',
      source_version: 3,
    }
    const result = await projectEvent({
      one: async () => ({
        target_user_id: '51000000-0000-4000-8000-000000000001',
        event_id: '52000000-0000-4000-8000-000000000001',
        event_title: 'MIP 城市交流活动',
        status: 'ACTIVE',
        version: 3,
      }),
    }, event)
    assert.deepEqual(result.notifications[0].external, {
      channel: 'WECHAT_SUBSCRIPTION',
      templateKey: 'HEART_RECEIVED',
      fields: {
        title: 'MIP 城市交流活动',
        status: '收到新的心动选择',
      },
    })
  })

  it('rebuilds a growth notification from the immutable ledger entry without another growth projection', async () => {
    const event = {
      ...base,
      aggregate_type: 'GROWTH_ENTRY',
      aggregate_id: '60000000-0000-4000-8000-000000000001',
      event_type: 'growth.changed',
      source_version: 4,
    }
    const result = await projectEvent({
      async one(sql, params) {
        assert.match(sql, /mip_growth_entries/)
        assert.deepEqual(params, ['wx-app', event.aggregate_id])
        return {
          id: event.aggregate_id,
          user_id: '70000000-0000-4000-8000-000000000001',
          metric: 'EXPERIENCE',
          delta_value: 10,
          balance_after: 90,
        }
      },
    }, event)
    assert.equal(result.notifications[0].messageType, 'GROWTH')
    assert.equal(result.notifications[0].body, '本次增加 10，当前余额 90。')
    assert.deepEqual(result.growth, [])
  })

  it('projects check-in and revocation from immutable transition relations only', async () => {
    const transitionId = '61000000-0000-4000-8000-000000000001'
    const userId = '62000000-0000-4000-8000-000000000001'
    const eventId = '63000000-0000-4000-8000-000000000001'
    const checkedInEvent = {
      ...base,
      id: transitionId,
      aggregate_type: 'EVENT_CHECKIN_TRANSITION',
      aggregate_id: transitionId,
      event_type: 'event.checked_in',
      source_version: 7,
      payload_json: { userId: 'attacker-controlled' },
    }
    const checkedIn = await projectEvent({
      async one(sql, params) {
        assert.match(sql, /mip_event_checkin_transitions transition/)
        assert.match(sql, /checkin\.registration_id = transition\.registration_id/)
        assert.deepEqual(params, ['wx-app', transitionId])
        return {
          id: transitionId,
          transition_type: 'CHECKED_IN',
          registration_version: 7,
          reversal_of_transition_id: null,
          user_id: userId,
          event_id: eventId,
          event_title: 'MIP 城市交流活动',
          occurred_at: '2026-08-24T08:30:00.000Z',
          user_status: 'ACTIVE',
          reversal_id: null,
        }
      },
    }, checkedInEvent)
    assert.deepEqual(checkedIn.growth, [{ action: 'applyCheckInTransition', transitionId }])
    assert.equal(checkedIn.notifications[0].recipientUserId, userId)
    assert.deepEqual(checkedIn.notifications[0].external, {
      channel: 'WECHAT_SUBSCRIPTION',
      templateKey: 'CHECKIN_RESULT',
      fields: {
        title: 'MIP 城市交流活动',
        checkedAt: '2026-08-24 16:30',
        status: '签到成功',
      },
    })
    assert.doesNotMatch(JSON.stringify(checkedIn), /attacker-controlled/)

    const reversalId = '61000000-0000-4000-8000-000000000002'
    const revoked = await projectEvent({
      async one() {
        return {
          id: reversalId,
          transition_type: 'REVOKED',
          registration_version: 8,
          reversal_of_transition_id: transitionId,
          user_id: userId,
          event_id: eventId,
          user_status: 'ACTIVE',
          reversal_id: null,
        }
      },
    }, {
      ...checkedInEvent,
      id: reversalId,
      aggregate_id: reversalId,
      event_type: 'event.checkin_revoked',
      source_version: 8,
    })
    assert.deepEqual(revoked.notifications, [])
    assert.deepEqual(revoked.growth, [{ action: 'applyCheckInTransition', transitionId: reversalId }])
  })

  it('suppresses a stale success notification but still sends the transition to growth', async () => {
    const transitionId = '64000000-0000-4000-8000-000000000001'
    const result = await projectEvent({
      one: async () => ({
        id: transitionId,
        transition_type: 'CHECKED_IN',
        registration_version: 2,
        reversal_of_transition_id: null,
        user_id: '65000000-0000-4000-8000-000000000001',
        event_id: '66000000-0000-4000-8000-000000000001',
        user_status: 'ACTIVE',
        reversal_id: '64000000-0000-4000-8000-000000000002',
      }),
    }, {
      ...base,
      id: transitionId,
      aggregate_type: 'EVENT_CHECKIN_TRANSITION',
      aggregate_id: transitionId,
      event_type: 'event.checked_in',
      source_version: 2,
    })
    assert.deepEqual(result.notifications, [])
    assert.deepEqual(result.growth, [{ action: 'applyCheckInTransition', transitionId }])
  })

  it('projects reviewed registration outcomes from the current registration fact', async () => {
    for (const [eventType, status, title] of [
      ['event.registration_waitlisted', 'WAITLISTED', '活动报名已候补'],
      ['event.registration_rejected', 'REJECTED', '活动报名未通过'],
    ]) {
      const event = {
        ...base,
        aggregate_type: 'EVENT_REGISTRATION',
        aggregate_id: '60000000-0000-4000-8000-000000000001',
        event_type: eventType,
      }
      const result = await projectEvent({
        one: async () => ({
          id: event.aggregate_id,
          user_id: '70000000-0000-4000-8000-000000000001',
          status,
          event_id: '80000000-0000-4000-8000-000000000001',
        }),
      }, event)
      assert.equal(result.notifications[0].title, title)
      assert.equal(result.notifications[0].recipientUserId, '70000000-0000-4000-8000-000000000001')
    }
  })

  it('lets the event notice own event-wide cancellation while preserving user cancellation', async () => {
    const event = {
      ...base,
      aggregate_type: 'EVENT_REGISTRATION',
      aggregate_id: '60000000-0000-4000-8000-000000000004',
      event_type: 'event.registration_cancelled',
      source_version: 3,
    }
    const fact = {
      id: event.aggregate_id,
      user_id: '70000000-0000-4000-8000-000000000004',
      status: 'CANCELLED',
      event_id: '80000000-0000-4000-8000-000000000004',
    }
    const eventCancelled = await projectEvent({
      one: async () => ({ ...fact, cancelled_by_type: 'EVENT' }),
    }, event)
    assert.equal(eventCancelled.reason, 'PROJECTED_BY_EVENT_NOTICE')
    assert.deepEqual(eventCancelled.notifications, [])

    const userCancelled = await projectEvent({
      one: async () => ({ ...fact, cancelled_by_type: 'USER' }),
    }, event)
    assert.equal(userCancelled.notifications.length, 1)
    assert.equal(userCancelled.notifications[0].title, '活动报名已取消')
  })

  it('rebuilds published event updates and recipients only from current app-scoped facts', async () => {
    const event = {
      ...base,
      aggregate_type: 'EVENT',
      aggregate_id: '81000000-0000-4000-8000-000000000001',
      event_type: 'event.updated',
      source_version: 3,
      payload_json: {
        recipientUserId: 'attacker-controlled',
        title: '伪造活动',
        body: '伪造正文',
        phone: '13800000000',
        openId: 'openid-private',
      },
    }
    const recipients = [
      '82000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000002',
    ]
    const database = {
      async one(sql, params) {
        assert.match(sql, /FROM mip_events e/)
        assert.match(sql, /change_fact\.app_id = e\.app_id/)
        assert.match(sql, /change_fact\.source_version = \?/)
        assert.match(sql, /e\.app_id = \? AND e\.id = \?/)
        assert.match(sql, /MAX\(later_status\.source_version\)/)
        assert.doesNotMatch(sql, /payload|phone|openid/i)
        assert.deepEqual(params, [3, 'wx-app', event.aggregate_id])
        return {
          event_id: event.aggregate_id,
          title: '可信活动',
          status: 'PUBLISHED',
          version: 3,
          published_at: '2026-08-24T01:00:00.000Z',
          unpublished_at: null,
          cancelled_at: null,
          change_type: 'CONTENT',
          changed_fields_json: JSON.stringify(['startsAt', 'venueName']),
          change_created_at: '2026-08-24T02:00:00.000Z',
        }
      },
      async query(sql, params) {
        assert.match(sql, /mip_event_registrations/)
        assert.match(sql, /current_event\.app_id = registration\.app_id/)
        assert.match(sql, /current_event\.version = \?/)
        assert.match(sql, /recipient\.app_id = registration\.app_id/)
        assert.match(sql, /PENDING_REVIEW.*WAITLISTED.*PAYMENT_PENDING/s)
        assert.match(sql, /REGISTERED.*CANCELLATION_PENDING.*ATTENDED/s)
        assert.doesNotMatch(sql, /phone|openid|mip_user_blocks/i)
        assert.deepEqual(params, [3, 'PUBLISHED', 'wx-app', event.aggregate_id])
        return recipients.map(user_id => ({ user_id }))
      },
    }
    const result = await projectEvent(database, event)
    const replay = await projectEvent(database, event)
    assert.equal(result.reason, 'PROJECTED')
    assert.deepEqual(result.notifications.map(item => item.recipientUserId), recipients)
    assert.deepEqual(result.notifications.map(item => item.dedupeKey), recipients.map(
      recipient => `outbox:${event.id}:recipient:${recipient}`,
    ))
    assert.equal(result.notifications[0].title, '活动信息已更新')
    assert.match(result.notifications[0].body, /可信活动/)
    assert.doesNotMatch(JSON.stringify(result), /伪造|13800000000|openid-private/)
    assert.equal(result.notifications[0].targetType, 'EVENT')
    assert.equal(result.notifications[0].targetId, event.aggregate_id)
    assert.equal('external' in result.notifications[0], false)
    assert.deepEqual(replay.notifications, result.notifications)
  })

  it('keeps first publication as a no-op and does not read recipient data', async () => {
    const event = {
      ...base,
      aggregate_type: 'EVENT',
      aggregate_id: '81000000-0000-4000-8000-000000000002',
      event_type: 'event.published',
      payload_json: { recipientUserId: 'attacker-controlled' },
    }
    const database = {
      one: async () => { throw new Error('unexpected fact lookup') },
      query: async () => { throw new Error('unexpected recipient lookup') },
    }
    const result = await projectEvent(database, event)
    assert.equal(result.reason, 'NO_PROJECTION_REQUIRED')
    assert.deepEqual(result.notifications, [])
  })

  it('drops stale or non-substantive event update projections', async () => {
    const event = {
      ...base,
      aggregate_type: 'EVENT',
      aggregate_id: '81000000-0000-4000-8000-000000000003',
      event_type: 'event.updated',
      source_version: 4,
    }
    let queriedRecipients = false
    const stale = await projectEvent({
      one: async () => null,
      query: async () => { queriedRecipients = true; return [] },
    }, event)
    assert.equal(stale.reason, 'FACT_NO_LONGER_CURRENT')

    const coverOnly = await projectEvent({
      one: async () => ({
        event_id: event.aggregate_id,
        title: '可信活动',
        status: 'PUBLISHED',
        version: 4,
        published_at: '2026-08-24T01:00:00.000Z',
        change_type: 'CONTENT',
        changed_fields_json: JSON.stringify(['coverAssetId']),
        change_created_at: '2026-08-24T02:00:00.000Z',
      }),
      query: async () => { queriedRecipients = true; return [] },
    }, event)
    assert.equal(coverOnly.reason, 'FACT_NO_LONGER_CURRENT')
    assert.equal(queriedRecipients, false)
  })

  it('notifies every registration changed by the same event cancellation exactly once', async () => {
    const event = {
      ...base,
      aggregate_type: 'EVENT',
      aggregate_id: '81000000-0000-4000-8000-000000000004',
      event_type: 'event.status_changed',
      source_version: 5,
      payload_json: { to: 'PUBLISHED', title: '伪造活动' },
    }
    const cancelledAt = '2026-08-24T03:00:00.000Z'
    const recipient = '82000000-0000-4000-8000-000000000003'
    const result = await projectEvent({
      async one() {
        return {
          event_id: event.aggregate_id,
          title: '已取消活动',
          status: 'CANCELLED',
          version: 5,
          published_at: '2026-08-24T01:00:00.000Z',
          unpublished_at: null,
          cancelled_at: cancelledAt,
          change_type: 'STATUS',
          changed_fields_json: JSON.stringify(['status']),
          change_created_at: cancelledAt,
          latest_status_version: 5,
        }
      },
      async query(sql, params) {
        assert.match(sql, /registration\.status = 'ATTENDED'/)
        assert.match(sql, /registration\.status IN \('CANCELLED', 'CANCELLATION_PENDING'\)/)
        assert.match(sql, /registration\.cancelled_by_type = 'EVENT'/)
        assert.match(sql, /current_event\.version = \?/)
        assert.match(sql, /current_event\.status = 'CANCELLED'/)
        assert.match(sql, /registration\.cancelled_at = current_event\.cancelled_at/)
        assert.doesNotMatch(sql, /mip_user_blocks/)
        assert.deepEqual(params, [5, 'wx-app', event.aggregate_id])
        return [{ user_id: recipient }]
      },
    }, event)
    assert.equal(result.notifications[0].recipientUserId, recipient)
    assert.equal(result.notifications[0].title, '活动已取消')
    assert.match(result.notifications[0].body, /相关订单状态/)
    assert.doesNotMatch(result.notifications[0].body, /伪造活动/)
  })

  it('uses neutral status copy for explicit unpublish and end changes', async () => {
    for (const [status, title] of [
      ['UNPUBLISHED', '活动已下架'],
      ['ENDED', '活动已结束'],
    ]) {
      const event = {
        ...base,
        aggregate_type: 'EVENT',
        aggregate_id: '81000000-0000-4000-8000-000000000005',
        event_type: 'event.status_changed',
        source_version: 6,
      }
      const result = await projectEvent({
        one: async () => ({
          event_id: event.aggregate_id,
          title: '城市交流活动',
          status,
          version: status === 'UNPUBLISHED' ? 7 : 6,
          published_at: '2026-08-24T01:00:00.000Z',
          change_type: 'STATUS',
          changed_fields_json: JSON.stringify(['status']),
          change_created_at: '2026-08-24T03:00:00.000Z',
          latest_status_version: 6,
        }),
        query: async (sql, params) => {
          assert.match(sql, /PENDING_REVIEW.*WAITLISTED.*PAYMENT_PENDING/s)
          assert.match(sql, /REGISTERED.*CANCELLATION_PENDING.*ATTENDED/s)
          assert.doesNotMatch(sql, /CANCELLED', 'CANCELLATION_PENDING/)
          assert.deepEqual(params, [status === 'UNPUBLISHED' ? 7 : 6, status, 'wx-app', event.aggregate_id])
          return [{ user_id: '82000000-0000-4000-8000-000000000004' }]
        },
      }, event)
      assert.equal(result.notifications[0].title, title)
    }
  })

  it('turns an admin growth adjustment into a notification without another growth write', async () => {
    const event = {
      ...base,
      aggregate_type: 'GROWTH_ENTRY',
      aggregate_id: '60000000-0000-4000-8000-000000000002',
      event_type: 'growth.changed',
      payload_json: { userId: 'attacker-controlled', deltaValue: 999999 },
    }
    const result = await projectEvent({
      async one(sql, params) {
        assert.match(sql, /mip_growth_entries/)
        assert.deepEqual(params, ['wx-app', event.aggregate_id])
        return {
          id: event.aggregate_id,
          user_id: '70000000-0000-4000-8000-000000000002',
          metric: 'CONTRIBUTION',
          delta_value: -5,
          balance_after: 25,
        }
      },
    }, event)
    assert.equal(result.notifications[0].recipientUserId, '70000000-0000-4000-8000-000000000002')
    assert.equal(result.notifications[0].title, '贡献值已更新')
    assert.equal(result.notifications[0].body, '本次减少 5，当前余额 25。')
    assert.deepEqual(result.growth, [])
  })

  it('projects an operations notification only from the app-scoped recipient fact', async () => {
    const event = {
      ...base,
      aggregate_type: 'OPERATIONS_MESSAGE',
      aggregate_id: '61000000-0000-4000-8000-000000000001',
      event_type: 'operations.notification_published',
      source_version: 2,
      payload_json: {
        recipientUserId: 'attacker-controlled',
        title: '伪造标题',
        external: { fields: { title: '伪造活动' } },
      },
    }
    const result = await projectEvent({
      async one(sql, params) {
        assert.match(sql, /FROM mip_operations_messages message/)
        assert.match(sql, /recipient\.app_id = message\.app_id/)
        assert.match(sql, /event_fact\.app_id = message\.app_id/)
        assert.deepEqual(params, ['wx-app', event.aggregate_id])
        return {
          id: event.aggregate_id,
          recipient_user_id: '62000000-0000-4000-8000-000000000001',
          title: '活动开始提醒',
          body: '活动将于明天开始。',
          target_type: 'EVENT',
          target_id: '63000000-0000-4000-8000-000000000001',
          event_id: '63000000-0000-4000-8000-000000000001',
          template_key: 'EVENT_REMINDER',
          template_payload_json: JSON.stringify({
            fields: {
              title: '城市交流活动',
              startsAt: '2026-08-25 10:00',
              location: '广州活动中心',
            },
          }),
          status: 'PUBLISHED',
          version: 2,
        }
      },
    }, event)
    assert.deepEqual(result.notifications, [{
      recipientUserId: '62000000-0000-4000-8000-000000000001',
      messageType: 'OPERATIONS',
      title: '活动开始提醒',
      body: '活动将于明天开始。',
      dedupeKey: `outbox:${event.id}:operations`,
      targetType: 'EVENT',
      targetId: '63000000-0000-4000-8000-000000000001',
      external: {
        channel: 'WECHAT_SUBSCRIPTION',
        templateKey: 'EVENT_REMINDER',
        fields: {
          title: '城市交流活动',
          startsAt: '2026-08-25 10:00',
          location: '广州活动中心',
        },
      },
    }])
  })

  it('does not project an operations message missing from the current app scope', async () => {
    const event = {
      ...base,
      aggregate_type: 'OPERATIONS_MESSAGE',
      aggregate_id: '61000000-0000-4000-8000-000000000002',
      event_type: 'operations.notification_published',
    }
    const result = await projectEvent({ one: async () => null }, event)
    assert.deepEqual(result.notifications, [])
    assert.equal(result.reason, 'FACT_NO_LONGER_CURRENT')
  })

  it('marks an unknown event unsupported and a known no-op delivered without effects', async () => {
    const unknown = await projectEvent({}, { ...base, event_type: 'unknown.created' })
    assert.equal(unknown.supported, false)
    const noOp = await projectEvent({}, { ...base, event_type: 'identity.user_registered' })
    assert.equal(noOp.supported, true)
    assert.deepEqual(noOp.notifications, [])
    assert.deepEqual(noOp.growth, [])
    const announcement = await projectEvent({}, { ...base, event_type: 'announcement.published' })
    assert.equal(announcement.supported, true)
    assert.equal(announcement.reason, 'NO_PROJECTION_REQUIRED')
  })
})
