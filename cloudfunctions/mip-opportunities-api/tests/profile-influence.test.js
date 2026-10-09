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
        if (sql.includes('mip_event_checkins own_checkin')) return { count: 3 }
        if (sql.includes('mip_profile_interests')) return { count: 4 }
        if (sql.includes('mip_profile_visits')) return { count: 5 }
        if (sql.includes('FROM mip_event_hearts')) return { count: 6 }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const result = await loadProfileInfluenceSummary(database, { appId, profileUserId })
    assert.deepEqual(result, {
      guestCount: 2,
      interactionCount: 3,
      interestCount: 4,
      visitorCount: 5,
      heartCount: 6,
    })
    const guest = calls.find(call => call.sql.includes('mip_event_invitation_attributions'))
    assert.match(guest.sql, /source_type = 'USER'/)
    assert.match(guest.sql, /registration\.share_profile = 1/)
    assert.match(guest.sql, /registration\.status = 'ATTENDED'/)
    assert.match(guest.sql, /checkin\.status = 'ACTIVE'/)
    assert.match(guest.sql, /NOT EXISTS \([\s\S]*mip_membership_entitlements/)
    assert.match(guest.sql, /guest\.status = 'ACTIVE'/)
    assert.match(guest.sql, /FROM mip_user_blocks visibility_block/)
    assert.deepEqual(guest.params, [appId, profileUserId, profileUserId, profileUserId])
    const interaction = calls.find(call => call.sql.includes('mip_event_checkins own_checkin'))
    assert.match(interaction.sql, /COUNT\(DISTINCT peer_checkin\.user_id\)/)
    assert.match(interaction.sql, /own_checkin\.status = 'ACTIVE'/)
    assert.match(interaction.sql, /peer_checkin\.status = 'ACTIVE'/)
    assert.match(interaction.sql, /peer_registration\.share_profile = 1/)
    assert.match(calls.find(call => call.sql.includes('mip_profile_interests')).sql,
      /target_user_id = \? AND interest\.status = 'ACTIVE'/)
    const visitors = calls.find(call => call.sql.includes('mip_profile_visits'))
    assert.match(visitors.sql, /COUNT\(\*\)/)
    assert.match(visitors.sql, /visitor\.status = 'ACTIVE'/)
    // 心动值 = 收到的当前有效活动红心票，与 events-api listHeartHistory('RECEIVED') 同口径。
    const hearts = calls.find(call => call.sql.includes('FROM mip_event_hearts'))
    assert.match(hearts.sql, /target_user_id = \? AND heart\.status = 'ACTIVE'/)
    assert.match(hearts.sql, /voter\.status = 'ACTIVE'/)
    assert.match(hearts.sql, /FROM mip_user_blocks visibility_block/)
    assert.deepEqual(hearts.params, [appId, profileUserId, profileUserId, profileUserId])
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

  it('lists co-attendance and active interest facts without exposing internal user ids', async () => {
    const database = {
      async query(sql) {
        if (sql.includes('WITH co_attendance AS')) {
          return [actorRow({
            relation_id: relationId,
            interaction_count: 4,
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
        // MIW-59：两个列表都会经 loadPublicPersonDetails 补公开详情（此处返回空详情）。
        if (sql.includes('FROM mip_profiles profile')) return []
        if (sql.includes('FROM mip_user_badge_equipment')) return []
        if (sql.includes('FROM mip_growth_levels')) return []
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const interactions = await listInfluenceInteractions(database, caller, { limit: 20 })
    const interests = await listActiveInfluenceInterests(database, caller, { limit: 20 })
    assert.equal(interactions.items[0].kind, 'INTERACTION')
    assert.equal(interactions.items[0].interactionCount, 4)
    assert.equal(interactions.items[0].event.title, '城市交流会')
    assert.equal(interests.items[0].kind, 'ACTIVE_INTEREST')
    assert.equal(interests.items[0].source.label, '公开档案')
    assert.equal(JSON.stringify({ interactions, interests }).includes(actorUserId), false)
  })

  // MIW-59：互动过/心动值(对我心动) 卡与嘉宾/访客同口径——竖版卡的 Lv/三标签行/一句话介绍/
  // 佩戴勋章都来自 loadPublicPersonDetails；visibility 关闭的字段不返回，未返回不造值。
  it('enriches co-attendance and active-interest actors with public person details', async () => {
    const calls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('WITH co_attendance AS')) {
          return [actorRow({ relation_id: relationId, interaction_count: 3, event_id: eventId, event_title: '城市交流会' })]
        }
        if (sql.includes('FROM mip_profile_interests interest')) {
          return [actorRow({ relation_id: relationId, source_type: 'PROFILE', source_label: '公开档案' })]
        }
        if (sql.includes('FROM mip_profiles profile')) {
          return [{
            user_id: actorUserId,
            visibility_json: JSON.stringify({ introduction: false }),
            identity_status: '深度链接中',
            introduction: '专注供应链的连续创业者',
            city_name: '广州',
            experience_balance: 120,
            industry_label: '供应链',
          }]
        }
        if (sql.includes('FROM mip_user_badge_equipment')) {
          return [{ user_id: actorUserId, slot_no: 1, id: 'badge-pioneer', name: '先行者', image_url: 'cloud://badge' }]
        }
        if (sql.includes('FROM mip_growth_levels')) {
          return [
            { id: 1, name: '链接者', minimum_experience: 0, status: 'ACTIVE' },
            { id: 2, name: '共建者', minimum_experience: 100, status: 'ACTIVE' },
          ]
        }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const interactions = await listInfluenceInteractions(database, caller, { limit: 20 })
    const interests = await listActiveInfluenceInterests(database, caller, { limit: 20 })
    for (const item of [...interactions.items, ...interests.items]) {
      assert.deepEqual(item.actor.level, { number: 2, name: '共建者' })
      assert.equal(item.actor.cityName, '广州')
      assert.equal(item.actor.industryLabel, '供应链')
      assert.equal(item.actor.identityStatus, '深度链接中')
      // visibility.introduction=false 的字段不返回。
      assert.equal(item.actor.introduction, undefined)
      assert.deepEqual(item.actor.badges, [{ id: 'badge-pioneer', name: '先行者', imageUrl: 'cloud://badge' }])
      assert.equal(item.actor.nickname, 'MIP 用户')
      assert.equal(JSON.stringify(item).includes(actorUserId), false)
    }
    // 详情查询按当前页人员过滤（appId + 页内 user_id），不扫全表。
    const detailCall = calls.find(call => call.sql.includes('FROM mip_profiles profile'))
    assert.deepEqual(detailCall.params, [appId, actorUserId])
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

  it('searches all co-attendees before pagination and returns full server counts', async () => {
    const calls = []
    const database = { async query(sql, params) {
      calls.push({ sql, params })
      return [actorRow({ interaction_count: 12, event_id: eventId, event_title: '最近同场' }),
        actorRow({ actor_user_id: '20000000-0000-4000-8000-000000000002' })]
    } }
    const first = await listInfluenceInteractions(database, caller, { keyword: '金融_50%', limit: 1 })
    assert.equal(first.items.length, 1)
    assert.equal(first.items[0].interactionCount, 12)
    assert.deepEqual(decodePersonCursor(first.nextCursor, caller), {
      timestamp: '2026-08-25T01:00:00.000Z', userId: actorUserId,
    })
    assert.match(calls[0].sql, /COUNT\(\*\) OVER \(PARTITION BY peer_checkin.user_id\)/)
    assert.match(calls[0].sql, /peer_checkin\.user_id <> own_checkin\.user_id/)
    assert.match(calls[0].sql, /peer_registration\.status = 'ATTENDED' AND peer_registration\.share_profile = 1/)
    assert.match(calls[0].sql, /visibility_json, '\$\.industry'/)
    assert.match(calls[0].sql, /industry\.label LIKE \? ESCAPE '='/)
    assert.equal(calls[0].params.filter(value => value === '%金融=_50=%%').length, 4)
    await listInfluenceInteractions(database, caller, { keyword: '金融_50%', cursor: first.nextCursor, limit: 1 })
    // MIW-59：列表查询后新增了 loadPublicPersonDetails 的 3 条富化查询，按列表 SQL 过滤再取游标参数。
    const listCalls = calls.filter(call => call.sql.includes('WITH co_attendance AS'))
    assert.deepEqual(listCalls[1].params.slice(-3), ['2026-08-25T01:00:00.000Z', '2026-08-25T01:00:00.000Z', actorUserId])
  })
})
