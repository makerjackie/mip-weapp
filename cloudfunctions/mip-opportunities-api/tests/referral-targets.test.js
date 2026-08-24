'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  getOpportunity,
  resolveReferralTarget,
  setReferral,
} = require('../domain/opportunities')
const { createProfileRef } = require('../lib/profile-ref')

const appId = 'wx-app'
const actorUserId = '10000000-0000-4000-8000-000000000001'
const ownerUserId = '20000000-0000-4000-8000-000000000001'
const targetUserId = '30000000-0000-4000-8000-000000000001'
const previousTargetUserId = '40000000-0000-4000-8000-000000000001'
const opportunityId = '50000000-0000-4000-8000-000000000001'
const referralId = '60000000-0000-4000-8000-000000000001'
const profileRefSecret = 'referral-target-test-profile-reference-secret'
const caller = { appId, userId: actorUserId, profileRefSecret, grants: [] }
const targetProfileRef = createProfileRef({ appId, userId: targetUserId }, profileRefSecret)

describe('opportunity referral targets', () => {
  it('resolves an opaque target only from an active app-scoped visible profile', async () => {
    const calls = []
    const target = await resolveReferralTarget({
      async one(sql, params) {
        calls.push({ sql, params })
        return { id: targetUserId }
      },
    }, caller, targetProfileRef)

    assert.equal(target, targetUserId)
    assert.match(calls[0].sql, /target\.app_id = \? AND target\.id = \?/)
    assert.match(calls[0].sql, /target\.status = 'ACTIVE'/)
    assert.match(calls[0].sql, /INNER JOIN mip_profiles profile/)
    assert.match(calls[0].sql, /FROM mip_user_blocks visibility_block/)
    assert.match(calls[0].sql, /FOR UPDATE/)
    assert.deepEqual(calls[0].params, [appId, targetUserId, actorUserId, actorUserId])
    await assert.rejects(
      resolveReferralTarget({ one: async () => null }, caller, targetProfileRef),
      /NOT_FOUND/,
    )
  })

  it('retargets one actor-opportunity relationship without increasing the referral count', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return null
        if (sql.includes('FROM mip_users') && !sql.includes('FROM mip_users target')) {
          return { id: actorUserId, status: 'ACTIVE' }
        }
        if (sql.includes('FROM mip_opportunities o')) {
          return { owner_user_id: ownerUserId, referral_count: 7, status: 'PUBLISHED' }
        }
        if (sql.includes('FROM mip_users target')) return { id: targetUserId }
        if (sql.includes('FROM mip_referral_intents')) {
          return {
            id: referralId,
            status: 'ACTIVE',
            target_user_id: previousTargetUserId,
            version: 2,
          }
        }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const result = await setReferral({ transaction: work => work(tx) }, caller, {
      id: opportunityId,
      active: true,
      targetProfileRef,
      note: '可以交流渠道合作',
      idempotencyKey: 'referral-retarget-stable-key',
    })

    assert.deepEqual(result, { active: true, version: 3, referralCount: 7 })
    const relationWrite = writes.find(call => call.sql.includes('UPDATE mip_referral_intents'))
    assert.match(relationWrite.sql, /target_user_id = CASE WHEN \? = 1 THEN \? ELSE target_user_id END/)
    assert.equal(relationWrite.params.includes(targetUserId), true)
    assert.equal(writes.some(call => call.sql.includes('UPDATE mip_opportunities')), false)
    const outbox = writes.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
    assert.doesNotMatch(String(outbox.params.at(-1)), /recipientUserId|targetUserId/)
    assert.equal(JSON.stringify(result).includes(targetUserId), false)
  })

  it('returns the active referral target as an opaque public projection', async () => {
    const database = {
      async one(sql) {
        if (sql.includes('FROM mip_opportunities o')) {
          return {
            id: opportunityId,
            owner_user_id: ownerUserId,
            branch_id: null,
            title: '品牌合作',
            value_summary: '提供渠道',
            target_summary: '寻找合作伙伴',
            description: '合作说明',
            city_tag_id: null,
            status: 'PUBLISHED',
            cover_asset_id: null,
            referral_count: 1,
            version: 2,
            published_at: '2026-08-24T01:00:00.000Z',
            updated_at: '2026-08-24T01:00:00.000Z',
            nickname: '发布人',
            visibility_json: '{}',
          }
        }
        if (sql.includes('FROM mip_referral_intents referral')) {
          return {
            status: 'ACTIVE',
            visible_target_user_id: targetUserId,
            nickname: '目标用户',
            headline: '产品负责人',
            visibility_json: '{}',
          }
        }
        if (sql.includes('FROM mip_profile_interests')) return null
        throw new Error(`unexpected one: ${sql}`)
      },
      async query() {
        return []
      },
    }
    const detail = await getOpportunity(database, caller, opportunityId)

    assert.equal(detail.referralActive, true)
    assert.equal(detail.referralTarget.nickname, '目标用户')
    assert.match(detail.referralTarget.profileRef, /^p1\./)
    assert.equal(JSON.stringify(detail).includes(targetUserId), false)
    assert.equal(JSON.stringify(detail).includes(ownerUserId), false)
  })
})
