'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { listHeartHistory, markHeartHistoryRead } = require('../domain/event-service')

const appId = 'wx-mip-app'
const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const eventId = '33333333-3333-4333-8333-333333333333'
const profileRefSecret = 'profile-reference-secret-more-than-thirty-two-characters'

function heartRow(id, overrides = {}) {
  return {
    id,
    updated_at: '2026-08-24T10:00:00.000Z',
    event_id: eventId,
    event_title: 'MIP 城市交流活动',
    starts_at: '2026-08-23T10:00:00.000Z',
    ends_at: '2026-08-23T12:00:00.000Z',
    person_user_id: otherUserId,
    nickname: '同行者',
    headline: '品牌设计',
    avatar_file_id: 'cloud://mip/avatar.png',
    ...overrides,
  }
}

describe('MIP heart history', () => {
  it('returns only the caller sent records with opaque public profile references', async () => {
    const calls = []
    const rows = [
      heartRow('44444444-4444-4444-8444-444444444444'),
      heartRow('55555555-5555-4555-8555-555555555555', {
        updated_at: '2026-08-24T09:00:00.000Z',
      }),
    ]
    const database = {
      async one() { return { total_count: 2, unread_count: 1, read_through_at: '2026-09-22T09:00:00.000Z' } },
      async query(sql, params) {
        calls.push({ sql, params })
        return rows
      },
    }
    const result = await listHeartHistory(database, {
      appId,
      userId,
      kind: 'SENT',
      limit: 1,
      profileRefSecret,
    })
    assert.match(calls[0].sql, /h\.voter_user_id = \? AND h\.status = 'ACTIVE'/)
    assert.match(calls[0].sql, /p\.user_id = h\.target_user_id/)
    assert.deepEqual(calls[0].params.slice(0, 2), [appId, userId])
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].person.nickname, '同行者')
    assert.match(result.items[0].person.profileRef, /^p1\./)
    assert.equal(JSON.stringify(result).includes(otherUserId), false)
    assert.ok(result.nextCursor)
    assert.equal(result.unreadCount, 0)
  })

  it('uses the target side for received records and rejects unknown kinds', async () => {
    let sql = ''
    const database = {
      async one() { return { total_count: 2, unread_count: 1, read_through_at: '2026-09-22T09:00:00.000Z' } },
      async query(statement) {
        sql = statement
        return [heartRow('66666666-6666-4666-8666-666666666666')]
      },
    }
    const result = await listHeartHistory(database, {
      appId,
      userId,
      kind: 'RECEIVED',
      profileRefSecret,
    })
    assert.match(sql, /h\.target_user_id = \? AND h\.status = 'ACTIVE'/)
    assert.match(sql, /p\.user_id = h\.voter_user_id/)
    assert.equal(result.kind, 'RECEIVED')
    assert.equal(result.totalCount, 2)
    assert.equal(result.unreadCount, 1)
    assert.equal(result.readThroughAt, '2026-09-22T09:00:00.000Z')
    await assert.rejects(
      listHeartHistory(database, {
        appId,
        userId,
        kind: 'UNKNOWN',
        profileRefSecret,
      }),
      error => error.code === 'VALIDATION_FAILED',
    )
  })

  it('redacts hidden person fields while retaining a usable opaque profile reference', async () => {
    const database = {
      async one() { return { total_count: 1, unread_count: 1, read_through_at: '2026-09-22T10:00:00.000Z' } },
      async query() { return [heartRow('44444444-4444-4444-8444-444444444444', {
        visibility_json: JSON.stringify({ nickname: false, avatar: false, headline: false }),
      })] },
    }
    const page = await listHeartHistory(database, { appId, userId, kind: 'RECEIVED', profileRefSecret })
    assert.deepEqual(page.items[0].person, {
      profileRef: page.items[0].person.profileRef, nickname: 'MIP 用户', avatarUrl: undefined, headline: undefined,
    })
    assert.equal(JSON.stringify(page).includes(otherUserId), false)
  })

  it('marks only received hearts through the load watermark without changing relationship time', async () => {
    const calls = []
    const tx = {
      async one() { return { id: userId, status: 'ACTIVE' } },
      async query(sql, params) { calls.push({ sql, params }); return { affectedRows: 1 } },
    }
    const result = await markHeartHistoryRead({ transaction: work => work(tx) }, {
      appId, userId, readThroughAt: '2026-09-22T10:00:00.000Z',
    })
    assert.equal(result.readAt, '2026-09-22T10:00:00.000Z')
    assert.match(calls[0].sql, /target_user_id = \? AND status = 'ACTIVE'/)
    assert.match(calls[0].sql, /updated_at = updated_at/)
    assert.match(calls[0].sql, /updated_at <= LEAST\(\?, UTC_TIMESTAMP\(3\)\)/)
    assert.deepEqual(calls[0].params.slice(0, 2), [appId, userId])
    await assert.rejects(() => markHeartHistoryRead({}, { appId, userId, readThroughAt: 'invalid' }), /阅读时间无效/)
  })
})
