'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createProfileRef } = require('../lib/profile-ref')
const {
  encodeVisitorCursor,
  listProfileVisitors,
  markProfileVisitorRead,
  recordProfileVisit,
} = require('../domain/profile-visits')

const pepper = 'profile-visits-test-pepper-more-than-32-characters'
const appId = 'wx-app'
const ownerId = '10000000-0000-4000-8000-000000000001'
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

  it('groups visits by visitor, filters inactive visitors and returns opaque profile refs', async () => {
    const calls = []
    const oneCalls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        assert.match(sql, /FROM mip_profile_visits/)
        assert.match(sql, /GROUP BY visitor_user_id/)
        assert.match(sql, /visitor\.status = 'ACTIVE'/)
        return [{
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
        return { count: sql.includes('unread_groups') ? 1 : 7 }
      },
    }
    const result = await listProfileVisitors(database, owner, { limit: 20 })
    assert.equal(result.unreadCount, 1)
    assert.equal(result.totalViewCount, 7)
    assert.equal(result.items[0].visitCount, 3)
    assert.equal(result.items[0].nickname, '访客甲')
    assert.match(result.items[0].profileRef, /^p1\./)
    assert.equal(JSON.stringify(result).includes(visitorId), false)
    assert.deepEqual(calls[0].params, [appId, ownerId, appId, ownerId, ownerId])
    assert.equal(calls.length, 1)
    assert.deepEqual(oneCalls[0].params, [appId, ownerId, appId, ownerId, ownerId])
    assert.match(oneCalls[0].sql, /unread_groups/)
    assert.match(oneCalls[0].sql, /INNER JOIN mip_profiles visitor_profile/)
    assert.deepEqual(oneCalls[1].params, [appId, ownerId, ownerId, ownerId])
    assert.match(oneCalls[1].sql, /FROM mip_profile_visits/)
    assert.match(oneCalls[1].sql, /visitor\.status = 'ACTIVE'/)
    assert.match(oneCalls[1].sql, /INNER JOIN mip_profiles visitor_profile/)
    assert.match(oneCalls[1].sql, /FROM mip_user_blocks visibility_block/)

    const cursor = encodeVisitorCursor('2026-08-24T03:00:00.000Z', visitorId, owner)
    await listProfileVisitors(database, owner, { cursor, limit: 20 })
    assert.deepEqual(calls[1].params, [
      appId,
      ownerId,
      appId,
      ownerId,
      ownerId,
      '2026-08-24T03:00:00.000Z',
      '2026-08-24T03:00:00.000Z',
      visitorId,
    ])
    assert.deepEqual(oneCalls[2].params, [appId, ownerId, appId, ownerId, ownerId])
    assert.deepEqual(oneCalls[3].params, [appId, ownerId, ownerId, ownerId])
  })

  it('round-trips a visitor cursor without placing a raw id in the cursor', () => {
    const cursor = encodeVisitorCursor('2026-08-24T03:00:00.000Z', visitorId, owner)
    assert.equal(cursor.includes(visitorId), false)
    assert.equal(Buffer.from(cursor, 'base64url').toString('utf8').includes(visitorId), false)
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
