'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { projectEvent } = require('../domain/projector')

const APP_ID = 'wx-membership-adjustment'
const OUTBOX_ID = '10000000-0000-4000-8000-000000000001'
const ADJUSTMENT_ID = '20000000-0000-4000-8000-000000000002'
const USER_ID = '30000000-0000-4000-8000-000000000003'

function adjustmentGranted(overrides = {}) {
  return {
    id: OUTBOX_ID,
    app_id: APP_ID,
    aggregate_type: 'MEMBERSHIP_ADJUSTMENT',
    aggregate_id: ADJUSTMENT_ID,
    event_type: 'membership.adjustment_granted',
    source_version: 7,
    payload_json: {
      reason: 'SECRET_REASON',
      actorUserId: 'SECRET_ACTOR',
      actorNickname: 'SECRET_NICKNAME',
      recipientUserId: 'ATTACKER_CONTROLLED',
    },
    ...overrides,
  }
}

function currentFact(overrides = {}) {
  return {
    adjustment_id: ADJUSTMENT_ID,
    user_id: USER_ID,
    starts_at: '2026-08-26T08:00:00.000Z',
    ends_at: '2026-09-26T08:00:00.000Z',
    result_chain_version: 7,
    ...overrides,
  }
}

describe('membership adjustment outbox projection', () => {
  it('rehydrates the exact current entitlement fact without selecting or leaking operator details', async () => {
    const event = adjustmentGranted()
    let projectionSql = ''
    const database = {
      async one(sql, params) {
        projectionSql = sql
        assert.match(sql, /FROM mip_membership_adjustments adjustment/)
        assert.match(sql, /mip_membership_entitlements entitlement/)
        assert.match(sql, /entitlement\.source_type = 'ADMIN_ADJUSTMENT'/)
        assert.match(sql, /entitlement\.source_adjustment_id = adjustment\.id/)
        assert.match(sql, /entitlement\.status = 'ACTIVE'/)
        assert.match(sql, /recipient\.status = 'ACTIVE'/)
        assert.match(sql, /adjustment\.result_chain_version = \?/)
        assert.deepEqual(params, [APP_ID, ADJUSTMENT_ID, 7])
        return currentFact()
      },
    }

    const result = await projectEvent(database, event)
    const replay = await projectEvent(database, event)
    assert.deepEqual(result, {
      supported: true,
      notifications: [{
        recipientUserId: USER_ID,
        messageType: 'MEMBERSHIP',
        title: '会员权益已更新',
        body: '会员有效期已更新，请在会员页面查看。',
        dedupeKey: `outbox:${OUTBOX_ID}:membership-adjustment-granted`,
      }],
      growth: [],
      reason: 'PROJECTED',
      continuation: null,
    })
    assert.deepEqual(replay, result)
    assert.equal(Object.hasOwn(result.notifications[0], 'targetType'), false)
    assert.equal(Object.hasOwn(result.notifications[0], 'targetId'), false)
    assert.equal(Object.hasOwn(result.notifications[0], 'external'), false)
    for (const sensitive of ['SECRET_REASON', 'SECRET_ACTOR', 'SECRET_NICKNAME', 'ATTACKER_CONTROLLED']) {
      assert.equal(JSON.stringify(result).includes(sensitive), false)
    }

    const selectClause = projectionSql.slice(0, projectionSql.indexOf('FROM'))
    assert.match(selectClause, /adjustment\.id AS adjustment_id/)
    assert.match(selectClause, /adjustment\.user_id/)
    assert.match(selectClause, /entitlement\.starts_at/)
    assert.match(selectClause, /entitlement\.ends_at/)
    assert.match(selectClause, /adjustment\.result_chain_version/)
    assert.doesNotMatch(projectionSql, /\breason\b|\bactor_user_id\b|\bidempotency_key\b|\brequest_hash\b/i)
  })

  it('drops missing and stale current facts', async () => {
    const missing = await projectEvent({ one: async () => null }, adjustmentGranted())
    assert.equal(missing.reason, 'FACT_NO_LONGER_CURRENT')
    assert.deepEqual(missing.notifications, [])

    const stale = await projectEvent({
      one: async () => currentFact({ result_chain_version: 8 }),
    }, adjustmentGranted())
    assert.equal(stale.reason, 'FACT_NO_LONGER_CURRENT')
    assert.deepEqual(stale.notifications, [])
  })

  it('rejects the wrong aggregate type before querying membership facts', async () => {
    let queried = false
    await assert.rejects(projectEvent({
      async one() {
        queried = true
        return currentFact()
      },
    }, adjustmentGranted({ aggregate_type: 'ORDER' })), /OUTBOX_EVENT_INVALID/)
    assert.equal(queried, false)
  })
})
