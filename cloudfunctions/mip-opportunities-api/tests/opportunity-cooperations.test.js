'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { setOpportunityCooperation, listOpportunityCooperators, cooperationSummaries } = require('../domain/opportunity-cooperations')
const caller = { appId: 'wx-test', userId: '10000000-0000-4000-8000-000000000001', profileRefSecret: 'cooperation-tests-secret-over-thirty-two-characters' }
const opportunityId = '20000000-0000-4000-8000-000000000001'
const ownerId = '30000000-0000-4000-8000-000000000001'

function fixture({ stored = null, status = 'PUBLISHED', eligible = true, owner = ownerId } = {}) {
  const writes = []
  const reads = []
  const tx = {
    async one(sql, params) {
      reads.push({ sql, params })
      if (sql.includes('FROM mip_idempotency_keys')) return null
      if (sql.includes('FROM mip_users')) return { id: caller.userId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_opportunities o')) return { id: opportunityId, owner_user_id: owner, status }
      if (sql.includes('FROM mip_membership_entitlements')) return eligible ? { id: 'entitlement' } : null
      if (sql.includes('FROM mip_event_checkins')) return null
      if (sql.includes('FROM mip_opportunity_cooperations')) return stored
      throw new Error('Unexpected query')
    },
    async query(sql, params) { writes.push({ sql, params }); return [] },
  }
  return { ...tx, transaction: async work => work(tx), writes, reads }
}
const input = active => ({ id: opportunityId, active, idempotencyKey: 'cooperation-test-unique-key' })

test('self cooperation creates one independent fact and notification, without referral or reward writes', async () => {
  const db = fixture()
  assert.deepEqual(await setOpportunityCooperation(db, caller, input(true)), { active: true, version: 1 })
  const insert = db.writes.find(row => row.sql.includes('INSERT INTO mip_opportunity_cooperations'))
  assert.equal(insert.params[0], caller.appId)
  assert.equal(insert.params[2], opportunityId)
  assert.equal(insert.params[3], caller.userId)
  assert.ok(db.writes.some(row => row.sql.includes('mip_outbox_events') && row.params.includes('opportunity.cooperation_changed')))
  assert.ok(!db.writes.some(row => /mip_referral_intents|mip_growth_accounts/.test(row.sql)))
  const access = db.reads.find(row => row.sql.includes('FROM mip_opportunities o'))
  assert.match(access.sql, /players_only/)
  assert.match(access.sql, /mip_user_blocks/)
  assert.match(access.sql, /FOR UPDATE/)
})

test('repeat activation is a no-op and cancelled records reactivate in place', async () => {
  const id = '40000000-0000-4000-8000-000000000001'
  const repeat = fixture({ stored: { id, status: 'ACTIVE', version: 2 } })
  assert.deepEqual(await setOpportunityCooperation(repeat, caller, input(true)), { active: true, version: 2 })
  assert.ok(!repeat.writes.some(row => /mip_opportunity_cooperations|mip_outbox_events/.test(row.sql)))
  const reactivate = fixture({ stored: { id, status: 'CANCELLED', version: 2 } })
  assert.deepEqual(await setOpportunityCooperation(reactivate, caller, input(true)), { active: true, version: 3 })
  assert.ok(reactivate.writes.some(row => row.sql.includes('UPDATE mip_opportunity_cooperations') && row.params.includes(id)))
})

test('ended opportunities allow cancellation but reject new intent; ineligible and own intent are rejected', async () => {
  const db = fixture({ status: 'ENDED', stored: { id: opportunityId, status: 'ACTIVE', version: 1 } })
  assert.deepEqual(await setOpportunityCooperation(db, caller, input(false)), { active: false, version: 2 })
  await assert.rejects(setOpportunityCooperation(fixture({ status: 'ENDED' }), caller, input(true)), /CONFLICT/)
  await assert.rejects(setOpportunityCooperation(fixture({ eligible: false }), caller, input(true)), /FORBIDDEN/)
  await assert.rejects(setOpportunityCooperation(fixture({ owner: caller.userId }), caller, input(true)), /CONFLICT/)
  await assert.rejects(setOpportunityCooperation(fixture(), caller, { ...input(true), active: 'true' }), /VALIDATION_FAILED/)
})

test('nonempty cooperator list uses public profile references and respects visibility in both preview and list', async () => {
  const row = { id: opportunityId, opportunity_id: opportunityId, user_id: caller.userId, nickname: 'private nickname',
    avatar_file_id: 'cloud://private-avatar', headline: 'private headline', visibility_json: { nickname: false, avatar: false, headline: false },
    activated_at: '2026-09-26T00:00:00.000Z', cooperation_count: 2 }
  const db = fixture()
  const queries = []
  db.query = async (sql) => {
    queries.push(sql)
    if (sql.includes('FROM mip_opportunity_cooperations')) return [row, { ...row, id: ownerId }]
    // G1：竖版人才卡 enrich（详情/勋章/等级/邀请人），名单外查询回空即不造值。
    return []
  }
  const list = await listOpportunityCooperators(db, caller, { id: opportunityId, limit: 1 })
  assert.equal(list.items.length, 1)
  assert.match(list.items[0].profileRef, /^p1\./)
  assert.equal(list.items[0].nickname, 'MIP 用户')
  assert.equal(list.items[0].avatarUrl, undefined)
  assert.ok(!JSON.stringify(list).includes(caller.userId))
  assert.ok(list.nextCursor)
  const summary = await cooperationSummaries(db, caller, [opportunityId])
  assert.deepEqual(summary.get(opportunityId), { count: 2, avatars: [] })
  assert.ok(queries.filter(sql => sql.includes('FROM mip_opportunity_cooperations'))
    .every(sql => sql.includes('mip_user_blocks') && sql.includes("member.status = 'ACTIVE'")))
})

test('cooperator list enriches public person details and inviter annotations for the talent cards', async () => {
  const row = { id: opportunityId, opportunity_id: opportunityId, user_id: caller.userId, nickname: 'Ame',
    avatar_file_id: 'cloud://avatar', headline: '设计', visibility_json: {},
    activated_at: '2026-09-26T00:00:00.000Z', cooperation_count: 1 }
  const db = fixture()
  db.query = async (sql) => {
    if (sql.includes('FROM mip_opportunity_cooperations')) return [row]
    if (sql.includes('FROM mip_profiles profile')) {
      return [{ user_id: caller.userId, visibility_json: {}, city_name: '深圳', industry_label: '软件',
        identity_status: '创业者', introduction: '帮助团队建立设计系统', experience_balance: 100 }]
    }
    if (sql.includes('FROM mip_growth_levels')) {
      return [{ id: 'lv1', name: '初识', minimum_experience: 0, status: 'ACTIVE' }, { id: 'lv2', name: '共建', minimum_experience: 100, status: 'ACTIVE' }]
    }
    if (sql.includes('FROM mip_event_invitation_attributions')) {
      return [{ guest_user_id: caller.userId, invitation_source_type: 'USER', inviter_nickname: 'Bear',
        inviter_visibility_json: {}, inviter_avatar_file_id: 'cloud://bear' }]
    }
    return []
  }
  const list = await listOpportunityCooperators(db, caller, { id: opportunityId })
  assert.deepEqual(list.items[0], {
    profileRef: list.items[0].profileRef,
    nickname: 'Ame',
    avatarUrl: 'cloud://avatar',
    headline: '设计',
    cityName: '深圳',
    industryLabel: '软件',
    identityStatus: '创业者',
    introduction: '帮助团队建立设计系统',
    level: { number: 2, name: '共建' },
    badges: [],
    inviter: { sourceType: 'USER', displayName: 'Bear', avatarUrl: 'cloud://bear' },
  })
  // 私密开关同样作用于 enrich 字段：关闭行业/简介后省略，不造值。
  const hidden = { ...row, visibility_json: { industry: false, introduction: false } }
  db.query = async (sql) => {
    if (sql.includes('FROM mip_opportunity_cooperations')) return [hidden]
    if (sql.includes('FROM mip_profiles profile')) {
      return [{ user_id: caller.userId, visibility_json: { industry: false, introduction: false }, city_name: '深圳',
        industry_label: '软件', identity_status: '创业者', introduction: '私密', experience_balance: null }]
    }
    return []
  }
  const gated = await listOpportunityCooperators(db, caller, { id: opportunityId })
  assert.equal(gated.items[0].industryLabel, undefined)
  assert.equal(gated.items[0].introduction, undefined)
  assert.equal(gated.items[0].level, undefined)
  assert.equal(gated.items[0].inviter, undefined)
})
