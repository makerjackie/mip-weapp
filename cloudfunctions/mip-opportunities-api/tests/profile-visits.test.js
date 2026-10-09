'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')
const {
  encodeVisitorCursor,
  listProfileVisitors,
  markProfileVisitorRead,
  recordProfileVisit,
} = require('../domain/profile-visits')

const pepper = 'profile-visits-test-pepper-more-than-32-characters'
const appId = 'wx-app'
const ownerId = '10000000-0000-4000-8000-000000000001'
const visitId = '30000000-0000-4000-8000-000000000001'
const visitorId = '20000000-0000-4000-8000-000000000001'
const owner = { appId, userId: ownerId, profileRefSecret: pepper }
const visitorRef = createProfileRef({ appId, userId: visitorId }, pepper)

describe('profile visits', () => {
  it('records an opaque profile visit idempotently and never trusts a raw target id', async () => {
    let idempotency
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return idempotency
        if (sql.includes('FROM mip_users') && sql.includes('FOR UPDATE')) return { id: visitorId, status: 'ACTIVE' }
        if (sql.includes('FROM mip_users visitor') && sql.includes('INNER JOIN mip_profiles profile')) {
          return { user_id: visitorId }
        }
        if (sql.includes('FROM mip_users target')) return { id: ownerId }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        if (sql.includes('INSERT INTO mip_idempotency_keys')) {
          idempotency = { request_hash: params[5], status: 'RUNNING' }
        }
        if (sql.includes('UPDATE mip_idempotency_keys')) idempotency.status = 'COMPLETED'
        return { affectedRows: 1 }
      },
    }
    const database = { transaction: work => work(tx) }
    const result = await recordProfileVisit(database, {
      appId,
      userId: visitorId,
      profileRefSecret: pepper,
    }, {
      profileRef: createProfileRef({ appId, userId: ownerId }, pepper),
      visitKey: 'visit-key-00000001',
    })
    assert.deepEqual(result, { recorded: true })
    assert.match(writes.find(call => call.sql.includes('INSERT INTO mip_profile_visits')).sql, /ON DUPLICATE KEY UPDATE/)
    assert.equal(JSON.stringify(result).includes(ownerId), false)
  })

  it('does not record visits from active users without a displayable profile', async () => {
    let idempotency
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return idempotency
        if (sql.includes('FROM mip_users') && sql.includes('FOR UPDATE')) {
          return { id: visitorId, status: 'ACTIVE' }
        }
        if (sql.includes('FROM mip_users visitor') && sql.includes('INNER JOIN mip_profiles profile')) {
          return null
        }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        if (sql.includes('INSERT INTO mip_idempotency_keys')) {
          idempotency = { request_hash: params[5], status: 'RUNNING' }
        }
        if (sql.includes('UPDATE mip_idempotency_keys')) idempotency.status = 'COMPLETED'
        return { affectedRows: 1 }
      },
    }
    const result = await recordProfileVisit({ transaction: work => work(tx) }, {
      appId,
      userId: visitorId,
      profileRefSecret: pepper,
    }, {
      profileRef: createProfileRef({ appId, userId: ownerId }, pepper),
      visitKey: 'visit-key-no-profile',
    })
    assert.deepEqual(result, { recorded: false })
    assert.equal(writes.some(call => call.sql.includes('INSERT INTO mip_profile_visits')), false)
  })

  it('returns each visit separately, filters inactive visitors and returns opaque profile refs', async () => {
    const calls = []
    const oneCalls = []
    const database = {
      async query(sql, params) {
        // MIW-64：邀请归档批量查询（loadHeartInviters），无归档回空即省略 inviter。
        if (sql.includes('FROM mip_profiles profile') || sql.includes('FROM mip_user_badge_equipment')
          || sql.includes('FROM mip_growth_levels') || sql.includes('FROM mip_event_invitation_attributions')) return []
        calls.push({ sql, params })
        assert.match(sql, /FROM mip_profile_visits/)
        assert.doesNotMatch(sql, /GROUP BY visitor_user_id/)
        assert.match(sql, /visitor\.status = 'ACTIVE'/)
        return [{
          visit_id: visitId,
          visitor_id: visitorId,
          visit_count: 3,
          last_visited_at: '2026-08-24T03:00:00.000Z',
          has_unread: 1,
          visitor_nickname: '访客甲',
          visitor_headline: '公开介绍',
          visibility_json: '{}',
          is_player: 1,
        }]
      },
      async one(sql, params) {
        oneCalls.push({ sql, params })
        return { count: sql.includes('visit.read_at IS NULL') ? 1 : 7 }
      },
    }
    const result = await listProfileVisitors(database, owner, { limit: 20 })
    assert.equal(result.unreadCount, 1)
    assert.equal(result.totalViewCount, 7)
    assert.equal(result.items[0].visitCount, 1)
    assert.equal(result.items[0].visitId, visitId)
    assert.equal(result.items[0].nickname, '访客甲')
    assert.match(result.items[0].profileRef, /^p1\./)
    assert.equal(JSON.stringify(result).includes(visitorId), false)
    assert.deepEqual(calls[0].params, [appId, ownerId, ownerId, ownerId])
    assert.equal(calls.length, 1)
    assert.deepEqual(oneCalls[0].params, [appId, ownerId, ownerId, ownerId])
    assert.match(oneCalls[0].sql, /visit\.read_at IS NULL/)
    assert.match(oneCalls[0].sql, /INNER JOIN mip_profiles visitor_profile/)
    assert.deepEqual(oneCalls[1].params, [appId, ownerId, ownerId, ownerId])
    assert.match(oneCalls[1].sql, /FROM mip_profile_visits/)
    assert.match(oneCalls[1].sql, /visitor\.status = 'ACTIVE'/)
    assert.match(oneCalls[1].sql, /INNER JOIN mip_profiles visitor_profile/)
    assert.match(oneCalls[1].sql, /FROM mip_user_blocks visibility_block/)

    const cursor = encodeVisitorCursor('2026-08-24T03:00:00.000Z', visitId)
    await listProfileVisitors(database, owner, { cursor, limit: 20 })
    assert.deepEqual(calls[1].params, [
      appId,
      ownerId,
      ownerId,
      ownerId,
      '2026-08-24T03:00:00.000Z',
      '2026-08-24T03:00:00.000Z',
      visitId,
    ])
    assert.deepEqual(oneCalls[2].params, [appId, ownerId, ownerId, ownerId])
    assert.deepEqual(oneCalls[3].params, [appId, ownerId, ownerId, ownerId])
  })

  it('round-trips a visitor cursor without placing a raw id in the cursor', () => {
    const cursor = encodeVisitorCursor('2026-08-24T03:00:00.000Z', visitId)
    assert.equal(cursor.includes(visitorId), false)
    assert.equal(Buffer.from(cursor, 'base64url').toString('utf8').includes(visitorId), false)
  })

  // MIW-64：访客卡 footer 邀请人与互动过/心动值列表同口径（loadHeartInviters，按页过滤，
  // USER 走邀请人 visibility 门控 / PLATFORM 平台标注，无归档省略不造值）。
  it('merges the latest invitation archive as inviter annotation and omits it without one', async () => {
    const visitRow = {
      visit_id: visitId,
      visitor_id: visitorId,
      last_visited_at: '2026-08-24T03:00:00.000Z',
      has_unread: 1,
      visitor_nickname: '访客甲',
      visitor_headline: '公开介绍',
      visibility_json: '{}',
      is_player: 1,
    }
    const calls = []
    const database = inviters => ({
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_profiles profile') || sql.includes('FROM mip_user_badge_equipment') || sql.includes('FROM mip_growth_levels')) return []
        if (sql.includes('FROM mip_event_invitation_attributions')) {
          // 邀请归档查询按当前页访客过滤（appId + 页内 visitor_id），不扫全表。
          assert.deepEqual(params, [appId, visitorId, appId, visitorId])
          return inviters
        }
        return [visitRow]
      },
      async one(sql) { return { count: sql.includes('visit.read_at IS NULL') ? 1 : 7 } },
    })
    const bear = [{ guest_user_id: visitorId, invitation_source_type: 'USER', inviter_nickname: 'Bear', inviter_visibility_json: {}, inviter_avatar_file_id: 'cloud://bear' }]
    const result = await listProfileVisitors(database(bear), owner, { limit: 20 })
    assert.deepEqual(result.items[0].inviter, { sourceType: 'USER', displayName: 'Bear', avatarUrl: 'cloud://bear' })
    const platform = await listProfileVisitors(database([{ guest_user_id: visitorId, invitation_source_type: 'PLATFORM' }]), owner, { limit: 20 })
    assert.deepEqual(platform.items[0].inviter, { sourceType: 'PLATFORM', displayName: 'MIP 平台' })
    const noArchive = await listProfileVisitors(database([]), owner, { limit: 20 })
    assert.equal(noArchive.items[0].inviter, undefined)
  })

  it('keeps repeated visits by the same user as separate ordered records', async () => {
    const rows = [
      { visit_id: visitId, visitor_id: visitorId, last_visited_at: '2026-09-22T09:00:00.000Z', visitor_nickname: '访客甲', has_unread: 1 },
      { visit_id: '30000000-0000-4000-8000-000000000002', visitor_id: visitorId, last_visited_at: '2026-09-22T08:00:00.000Z', visitor_nickname: '访客甲', has_unread: 1 },
    ]
    const database = {
      async query(sql) {
        if (sql.includes('FROM mip_event_invitation_attributions')) return []
        return rows
      },
      async one() { return { count: 2, read_through_at: '2026-09-22T10:00:00.000Z' } },
    }
    const page = await listProfileVisitors(database, owner)
    assert.equal(page.items.length, 2)
    assert.equal(readProfileRef(page.items[0].profileRef, appId, pepper), visitorId)
    assert.equal(readProfileRef(page.items[1].profileRef, appId, pepper), visitorId)
    assert.notEqual(page.items[0].visitId, page.items[1].visitId)
    assert.equal(page.totalViewCount, 2)
    assert.equal(page.readThroughAt, '2026-09-22T10:00:00.000Z')
  })

  it('acknowledges only owner visits through the loaded watermark, preserving later arrivals', async () => {
    let idempotency
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return idempotency
        if (sql.includes('FROM mip_users') && sql.includes('FOR UPDATE')) return { id: ownerId, status: 'ACTIVE' }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        if (sql.includes('INSERT INTO mip_idempotency_keys')) idempotency = { request_hash: params[5], status: 'RUNNING' }
        if (sql.includes('UPDATE mip_idempotency_keys')) idempotency.status = 'COMPLETED'
        return { affectedRows: 2 }
      },
    }
    await markProfileVisitorRead({ transaction: work => work(tx) }, owner, {
      readThroughAt: '2026-09-22T10:00:00.000Z', idempotencyKey: 'all-visitors-read-0001',
    })
    const update = writes.find(call => call.sql.includes('UPDATE mip_profile_visits'))
    assert.match(update.sql, /profile_user_id = \? AND read_at IS NULL/)
    assert.match(update.sql, /visited_at <= LEAST\(\?, UTC_TIMESTAMP\(3\)\)/)
    assert.deepEqual(update.params.slice(0, 2), [appId, ownerId])
    assert.equal(update.params[2].toISOString(), '2026-09-22T10:00:00.000Z')
  })

  it('marks the whole visitor group read with the owner boundary', async () => {
    let idempotency
    let updated = 0
    const tx = {
      lastReadSql: '',
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return idempotency
        if (sql.includes('FROM mip_users') && sql.includes('FOR UPDATE')) return { id: ownerId, status: 'ACTIVE' }
        if (sql.includes('MAX(v.visited_at)')) {
          this.lastReadSql = sql
          return { last_visited_at: '2026-08-24T03:00:00.000Z' }
        }
        if (sql.includes('MAX(read_at)')) return { read_at: '2026-08-24T04:00:00.000Z' }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        if (sql.includes('INSERT INTO mip_idempotency_keys')) idempotency = { request_hash: params[5], status: 'RUNNING' }
        if (sql.includes('INSERT INTO mip_audit_logs')) {
          assert.equal(params[7], visitorId)
          assert.ok(params[7].length <= 36, 'audit resource_id must fit the database column')
          assert.equal(JSON.parse(params[9]).profileRef, visitorRef)
        }
        if (sql.includes('UPDATE mip_profile_visits')) updated += 1
        if (sql.includes('UPDATE mip_idempotency_keys')) idempotency.status = 'COMPLETED'
        return { affectedRows: 1 }
      },
    }
    const result = await markProfileVisitorRead({ transaction: work => work(tx) }, owner, {
      profileRef: visitorRef,
      idempotencyKey: 'read-visitor-key-0001',
    })
    assert.equal(result.profileRef, visitorRef)
    assert.equal(updated, 1)
    assert.match(tx.lastReadSql || '', /INNER JOIN mip_profiles visitor_profile/)
  })
})
