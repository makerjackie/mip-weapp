'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  listReceivedInteractions,
  markReceivedInteractionRead,
  normalizeListInput,
} = require('../domain/received-interactions')

const caller = {
  appId: 'wx-app',
  userId: '10000000-0000-4000-8000-000000000001',
  profileRefSecret: 'received-interactions-profile-ref-pepper-32-chars',
}
const actorId = '20000000-0000-4000-8000-000000000001'
const relationId = '30000000-0000-4000-8000-000000000001'
const opportunityId = '40000000-0000-4000-8000-000000000001'
const messageId = '50000000-0000-4000-8000-000000000001'

describe('received interaction queries', () => {
  it('lists received referrals from scoped relationship and public profile facts', async () => {
    const calls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_referral_intents r')) {
          return [{
            relation_id: relationId,
            status: 'ACTIVE',
            note: '可以引荐渠道负责人',
            updated_at: '2026-08-24T01:00:00.000Z',
            opportunity_id: opportunityId,
            opportunity_title: '城市品牌合作',
            opportunity_status: 'PUBLISHED',
            actor_user_id: actorId,
            actor_nickname: '不应展示的昵称',
            actor_headline: '不应展示的简介',
            actor_visibility_json: JSON.stringify({ nickname: false, avatar: false, headline: false }),
            actor_avatar_file_id: 'cloud://private-looking-file-id',
          }]
        }
        if (sql.includes('FROM mip_outbox_events e')) {
          return [{
            relation_id: relationId,
            id: messageId,
            read_at: null,
            created_at: '2026-08-24T01:01:00.000Z',
          }]
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async one(sql, params) {
        calls.push({ sql, params })
        assert.match(sql, /ROW_NUMBER\(\) OVER/)
        assert.match(sql, /latest\.message_position = 1/)
        return { count: 1 }
      },
    }
    const result = await listReceivedInteractions(database, caller, {
      category: 'REFERRAL',
      limit: 20,
    })

    assert.equal(result.unreadCount, 1)
    assert.equal(result.items[0].unread, true)
    assert.equal(result.items[0].messageId, messageId)
    assert.equal(result.items[0].actor.nickname, 'MIP 用户')
    assert.equal(result.items[0].actor.headline, undefined)
    assert.match(result.items[0].actor.profileRef, /^p1\./)
    assert.equal(result.items[0].opportunity.id, opportunityId)
    const serialized = JSON.stringify(result)
    assert.equal(serialized.includes(actorId), false)
    assert.equal(serialized.includes('cloud://private-looking-file-id'), false)

    const relationQuery = calls.find(call => call.sql.includes('FROM mip_referral_intents r'))
    assert.match(relationQuery.sql, /o\.owner_user_id = \?/)
    assert.match(relationQuery.sql, /r\.app_id = \?/)
    assert.match(relationQuery.sql, /FROM mip_user_blocks visibility_block/)
    assert.match(relationQuery.sql, /visibility_block\.app_id = r\.app_id/)
    assert.match(relationQuery.sql, /blocker_user_id = \? AND visibility_block\.blocked_user_id = r\.actor_user_id/)
    assert.match(relationQuery.sql, /blocker_user_id = r\.actor_user_id AND visibility_block\.blocked_user_id = \?/)
    assert.match(relationQuery.sql, /ORDER BY r\.updated_at DESC, r\.id DESC/)
    assert.deepEqual(relationQuery.params, [
      caller.userId,
      caller.appId,
      caller.userId,
      caller.userId,
    ])
    const unreadQuery = calls.find(call => call.sql.includes('ROW_NUMBER() OVER'))
    assert.match(unreadQuery.sql, /visibility_block\.app_id = r\.app_id/)
    assert.deepEqual(unreadQuery.params.slice(-3), [caller.userId, caller.userId, caller.userId])
  })

  it('lists historical profile interests while rechecking source ownership and actor visibility', async () => {
    const database = {
      async query(sql, params) {
        if (sql.includes('FROM mip_profile_interests i')) {
          assert.match(sql, /i\.target_user_id = \?/)
          assert.match(sql, /COALESCE\(opportunity\.id, cooperation\.id, super_case\.id\) IS NOT NULL/)
          assert.match(sql, /visibility_block\.app_id = i\.app_id/)
          assert.match(sql, /blocker_user_id = \? AND visibility_block\.blocked_user_id = i\.actor_user_id/)
          assert.deepEqual(params.slice(0, 4), [caller.appId, caller.userId, caller.userId, caller.userId])
          assert.match(sql, /ORDER BY i\.updated_at DESC, i\.id DESC/)
          return [{
            relation_id: relationId,
            status: 'CANCELLED',
            source_type: 'COOPERATION_CARD',
            source_label: '负责项目策略与推进',
            source_status: 'PUBLISHED',
            updated_at: '2026-08-24T02:00:00.000Z',
            actor_user_id: actorId,
            actor_nickname: '林野',
            actor_headline: '产品负责人',
            actor_visibility_json: '{}',
          }]
        }
        if (sql.includes('FROM mip_outbox_events e')) return []
        throw new Error(`unexpected query: ${sql}`)
      },
      async one(sql, params) {
        assert.match(sql, /visibility_block\.app_id = i\.app_id/)
        assert.deepEqual(params.slice(-3), [caller.userId, caller.userId, caller.userId])
        return { count: 0 }
      },
    }
    const result = await listReceivedInteractions(database, caller, {
      category: 'PROFILE_INTEREST',
    })
    assert.deepEqual(result.items[0].source, {
      type: 'COOPERATION_CARD',
      label: '负责项目策略与推进',
      status: 'PUBLISHED',
    })
    assert.equal(result.items[0].status, 'CANCELLED')
    assert.equal(result.items[0].actor.nickname, '林野')
    assert.equal(JSON.stringify(result).includes(actorId), false)
  })

  it('rejects unknown categories before querying', () => {
    assert.throws(() => normalizeListInput({ category: 'FOLLOWER' }), /VALIDATION_FAILED/)
  })
})

describe('received interaction read state', () => {
  it('uses inbox read_at as the idempotent authority and audits only the first transition', async () => {
    let idempotency = null
    let readAt = null
    let auditCount = 0
    let inboxUpdateCount = 0
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return idempotency
        if (sql.includes('FROM mip_users')) return { id: caller.userId, status: 'ACTIVE' }
        if (sql.includes('FROM mip_inbox_messages m')) {
          assert.match(sql, /m\.recipient_user_id = \?/)
          assert.match(sql, /o\.owner_user_id = \?/)
          assert.match(sql, /i\.target_user_id = \?/)
          assert.match(sql, /visibility_block\.app_id = r\.app_id/)
          assert.match(sql, /visibility_block\.app_id = i\.app_id/)
          return {
            id: messageId,
            read_at: readAt,
            aggregate_type: 'REFERRAL_INTENT',
            aggregate_id: relationId,
          }
        }
        if (sql.includes('SELECT read_at FROM mip_inbox_messages')) return { read_at: readAt }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        if (sql.includes('INSERT INTO mip_idempotency_keys')) {
          idempotency = { request_hash: params[5], status: 'RUNNING', response_json: null }
          return { affectedRows: 1 }
        }
        if (sql.includes('UPDATE mip_inbox_messages')) {
          readAt = '2026-08-24T03:00:00.000Z'
          inboxUpdateCount += 1
          return { affectedRows: 1 }
        }
        if (sql.includes('INSERT INTO mip_audit_logs')) {
          auditCount += 1
          return { affectedRows: 1 }
        }
        if (sql.includes('UPDATE mip_idempotency_keys')) {
          idempotency = {
            ...idempotency,
            status: 'COMPLETED',
            response_json: params[0],
          }
          return { affectedRows: 1 }
        }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const database = { transaction: work => work(tx) }
    const input = {
      messageId,
      idempotencyKey: 'received-read:stable-key',
    }
    const first = await markReceivedInteractionRead(database, caller, input)
    const replay = await markReceivedInteractionRead(database, caller, input)

    assert.deepEqual(first, { messageId, readAt: '2026-08-24T03:00:00.000Z' })
    assert.deepEqual(replay, first)
    assert.equal(inboxUpdateCount, 1)
    assert.equal(auditCount, 1)
  })

  it('rejects a closed caller before reading or updating inbox state', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ kind: 'one', sql, params })
        if (sql.includes('FROM mip_idempotency_keys')) return null
        if (sql.includes('FROM mip_users')) return { id: caller.userId, status: 'CLOSED' }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params })
        if (sql.includes('INSERT INTO mip_idempotency_keys')) return { affectedRows: 1 }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const database = { transaction: work => work(tx) }

    await assert.rejects(
      markReceivedInteractionRead(database, caller, {
        messageId,
        idempotencyKey: 'received-read:closed-user',
      }),
      /FORBIDDEN/,
    )

    const userLockIndex = calls.findIndex(call => call.sql.includes('FROM mip_users'))
    assert.notEqual(userLockIndex, -1)
    assert.match(calls[userLockIndex].sql, /FOR UPDATE/)
    assert.equal(calls.some(call => call.sql.includes('FROM mip_inbox_messages m')), false)
    assert.equal(calls.some(call => call.sql.includes('UPDATE mip_inbox_messages')), false)
  })
})
