'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  decodePersonCursor,
  listActiveInfluenceInterests,
  listInfluenceGuests,
  listInfluenceInteractions,
  loadProfileInfluenceSummary,
} = require('../domain/profile-influence')

const appId = 'wx-profile-influence'
const profileUserId = '10000000-0000-4000-8000-000000000001'
const actorUserId = '20000000-0000-4000-8000-000000000001'
const relationId = '30000000-0000-4000-8000-000000000001'
const eventId = '40000000-0000-4000-8000-000000000001'
const pepper = 'profile-influence-pepper-with-more-than-32-characters'
const caller = { appId, userId: profileUserId, profileRefSecret: pepper }

function actorRow(overrides = {}) {
  return {
    actor_user_id: actorUserId,
    actor_nickname: '不应公开的昵称',
    actor_headline: '公开介绍',
    actor_visibility_json: JSON.stringify({ nickname: false }),
    actor_avatar_file_id: 'cloud://avatar',
    is_player: 0,
    updated_at: '2026-08-25T01:00:00.000Z',
    ...overrides,
  }
}

describe('profile influence summary', () => {
  it('uses one app-scoped current fact definition for every count', async () => {
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('mip_event_invitation_attributions')) return { count: 2 }
        if (sql.includes('mip_event_hearts')) return { count: 3 }
        if (sql.includes('mip_profile_interests')) return { count: 4 }
        if (sql.includes('mip_profile_visits')) return { count: 5 }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const result = await loadProfileInfluenceSummary(database, { appId, profileUserId })
    assert.deepEqual(result, {
      guestCount: 2,
      interactionCount: 3,
      interestCount: 4,
      visitorCount: 5,
    })
    const guest = calls.find(call => call.sql.includes('mip_event_invitation_attributions'))
    assert.match(guest.sql, /source_type = 'USER'/)
    assert.match(guest.sql, /registration\.share_profile = 1/)
    assert.match(guest.sql, /registration\.status IN \('REGISTERED', 'ATTENDED'\)/)
    assert.match(guest.sql, /NOT EXISTS \([\s\S]*mip_membership_entitlements/)
    assert.match(guest.sql, /guest\.status = 'ACTIVE'/)
    assert.match(guest.sql, /FROM mip_user_blocks visibility_block/)
    assert.deepEqual(guest.params, [appId, profileUserId, profileUserId, profileUserId])
    assert.match(calls.find(call => call.sql.includes('mip_event_hearts')).sql,
      /target_user_id = \? AND heart\.status = 'ACTIVE'/)
    assert.match(calls.find(call => call.sql.includes('mip_profile_interests')).sql,
      /target_user_id = \? AND interest\.status = 'ACTIVE'/)
    const visitors = calls.find(call => call.sql.includes('mip_profile_visits'))
    assert.match(visitors.sql, /COUNT\(DISTINCT visit\.visitor_user_id\)/)
    assert.match(visitors.sql, /visitor\.status = 'ACTIVE'/)
  })
})

describe('profile influence lists', () => {
  it('lists each currently non-member invited guest once and keeps its cursor opaque', async () => {
    const calls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        return [actorRow({
          guest_user_id: actorUserId,
          invitation_count: 2,
          last_at: '2026-08-25T01:00:00.000Z',
          event_id: eventId,
          event_title: '城市交流会',
        })]
      },
    }
    const result = await listInfluenceGuests(database, caller, { limit: 1 })
    assert.equal(result.items[0].kind, 'GUEST')
    assert.equal(result.items[0].invitationCount, 2)
    assert.equal(result.items[0].actor.nickname, 'MIP 用户')
    assert.equal(result.items[0].actor.userKind, 'GUEST')
    assert.equal(JSON.stringify(result).includes(actorUserId), false)
    const query = calls[0]
    assert.match(query.sql, /WITH mip_ranked_guest_facts AS/)
    assert.match(query.sql, /ROW_NUMBER\(\) OVER/)
    assert.match(query.sql, /fact_position = 1 AND NOT EXISTS/)
    assert.match(query.sql, /registration\.share_profile = 1/)
    assert.match(query.sql, /FROM mip_user_blocks visibility_block/)
  })

  it('lists active heart and interest facts without exposing internal user ids', async () => {
    const database = {
      async query(sql) {
        if (sql.includes('FROM mip_event_hearts heart')) {
          return [actorRow({
            relation_id: relationId,
            event_id: eventId,
            event_title: '城市交流会',
          })]
        }
        if (sql.includes('FROM mip_profile_interests interest')) {
          return [actorRow({
            relation_id: relationId,
            source_type: 'PROFILE',
            source_label: '公开档案',
          })]
        }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const interactions = await listInfluenceInteractions(database, caller, { limit: 20 })
    const interests = await listActiveInfluenceInterests(database, caller, { limit: 20 })
    assert.equal(interactions.items[0].kind, 'INTERACTION')
    assert.equal(interactions.items[0].event.title, '城市交流会')
    assert.equal(interests.items[0].kind, 'ACTIVE_INTEREST')
    assert.equal(interests.items[0].source.label, '公开档案')
    assert.equal(JSON.stringify({ interactions, interests }).includes(actorUserId), false)
  })

  it('round-trips guest pagination without putting a raw user id in the cursor', async () => {
    const database = {
      async query() {
        return [actorRow({
          guest_user_id: actorUserId,
          invitation_count: 1,
          last_at: '2026-08-25T01:00:00.000Z',
          event_id: eventId,
          event_title: '城市交流会',
        }), actorRow({ actor_user_id: '20000000-0000-4000-8000-000000000002' })]
      },
    }
    const result = await listInfluenceGuests(database, caller, { limit: 1 })
    assert.equal(result.nextCursor.includes(actorUserId), false)
    assert.equal(Buffer.from(result.nextCursor, 'base64url').toString('utf8').includes(actorUserId), false)
    assert.deepEqual(decodePersonCursor(result.nextCursor, caller), {
      timestamp: '2026-08-25T01:00:00.000Z',
      userId: actorUserId,
    })
  })
})
