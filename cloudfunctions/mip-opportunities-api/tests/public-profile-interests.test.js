'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')
const { listPublicProfileInterests, decodePersonCursor, loadProfileInfluenceSummary } = require('../domain/profile-influence')

const appId = 'wx-profile-roster'
const secret = 'profile-roster-secret-with-at-least-thirty-two-characters'
const viewer = '10000000-0000-4000-8000-000000000001'
const owner = '20000000-0000-4000-8000-000000000001'
const actor = '30000000-0000-4000-8000-000000000001'
const caller = { appId, userId: viewer, profileRefSecret: secret }
const profileRef = createProfileRef({ appId, userId: owner }, secret)
const row = { actor_user_id: actor, actor_nickname: 'Ame', actor_headline: '产品设计', actor_visibility_json: {}, is_player: 1, updated_at: '2026-09-22T02:30:00.000Z' }

function database(options = {}) {
  const calls = []
  return {
    calls,
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_users target')) return options.target === undefined ? { viewer_is_player: 1, visibility_json: { influence: true } } : options.target
      return { count: 2 }
    },
    async query(sql, params) {
      calls.push({ sql, params })
      return options.rows || [row, { ...row, actor_user_id: '30000000-0000-4000-8000-000000000002' }]
    },
  }
}

describe('public profile interest roster', () => {
  it('returns real public people, a total matching the profile count and opaque stable pagination', async () => {
    const db = database()
    const result = await listPublicProfileInterests(db, caller, { profileRef, limit: 1 })
    assert.equal(result.totalCount, 2)
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].nickname, 'Ame')
    assert.equal(readProfileRef(result.items[0].profileRef, appId, secret), actor)
    assert.equal(JSON.stringify(result).includes(actor), false)
    const cursor = decodePersonCursor(result.nextCursor, caller)
    assert.equal(cursor.userId, actor)
    assert.equal(cursor.timestamp, row.updated_at)
    const roster = db.calls.find(call => call.sql.startsWith('SELECT actor.id'))
    assert.match(roster.sql, /interest\.status = 'ACTIVE'/)
    assert.match(roster.sql, /actor\.status = 'ACTIVE'/)
    assert.match(roster.sql, /ORDER BY interest.updated_at DESC, actor.id DESC/)
    assert.deepEqual(roster.params, [appId, owner, owner, owner, viewer, viewer, 2])
    const count = db.calls.find(call => call.sql.includes('SELECT COUNT(*)'))
    const summaryDb = database()
    await loadProfileInfluenceSummary(summaryDb, { appId, profileUserId: owner, viewerUserId: viewer })
    const summaryCount = summaryDb.calls.find(call => call.sql.includes('FROM mip_profile_interests interest'))
    assert.equal(count.sql, summaryCount.sql)
    assert.deepEqual(count.params, summaryCount.params)
    await listPublicProfileInterests(db, caller, { profileRef, cursor: result.nextCursor, limit: 1 })
    assert.deepEqual(db.calls.at(-1).params.slice(-4), [row.updated_at, row.updated_at, actor, 2])
  })

  it('enforces trusted membership, target visibility, blocks and app-bound references before returning identities', async () => {
    await assert.rejects(() => listPublicProfileInterests(database(), { ...caller, userId: null }, { profileRef }), /AUTH_REQUIRED/)
    for (const target of [null, { viewer_is_player: 0, visibility_json: { influence: true } }, { viewer_is_player: 1, visibility_json: {} }]) {
      const db = database({ target })
      await assert.rejects(() => listPublicProfileInterests(db, caller, { profileRef }), /NOT_FOUND|FORBIDDEN/)
      assert.equal(db.calls.length, 1)
    }
    await assert.rejects(() => listPublicProfileInterests(database(), { ...caller, appId: 'another-app' }, { profileRef }), /NOT_FOUND/)
    const db = database({ rows: [{ ...row, actor_visibility_json: { nickname: false, avatar: false, headline: false } }] })
    const result = await listPublicProfileInterests(db, caller, { profileRef })
    assert.equal(result.items[0].nickname, 'MIP 用户')
    assert.equal(result.items[0].headline, undefined)
    assert.equal(result.items[0].avatarUrl, undefined)
    assert.match(db.calls[0].sql, /membership.ends_at > UTC_TIMESTAMP/)
    assert.match(db.calls[0].sql, /FROM mip_user_blocks/)
  })
})
