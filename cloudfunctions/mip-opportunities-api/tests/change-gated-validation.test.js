'use strict'

// MIW-50（2026-10-07 客户确认）：小程序编辑器只保留主表单，行业/能力/分会/封面/
// 团队等 ride-along 字段随存量机会原样带回。保存时只对「相对存量发生变化」的
// 引用做校验：目录漂移（标签停用、分会停用、素材清理、成员资格过期）不得卡死
// 「什么都没改」的编辑保存；真正改动的值仍走完整校验。

const assert = require('node:assert/strict')
const test = require('node:test')
const { saveOpportunity } = require('../domain/opportunities')
const { createProfileRef } = require('../lib/profile-ref')

const appId = 'gated-test-app'
const owner = '10000000-0000-4000-8000-000000000001'
const id = '20000000-0000-4000-8000-000000000002'
const teammate = '10000000-0000-4000-8000-000000000003'
const abilityTagA = '21000000-0000-4000-8000-000000000001'
const abilityTagB = '21000000-0000-4000-8000-000000000002'
const caller = { appId, userId: owner, profileRefSecret: 'gated-profile-reference-secret-32-characters' }

const draft = {
  id, expectedVersion: 4, title: '资源合作', valueSummary: '渠道资源',
  targetSummary: '寻找伙伴', description: '项目说明', roleKeys: [],
  typeKeys: ['COMPANY', 'PARTNER'], regionText: '南山十亩地',
  industryTagIds: [], abilityTagIds: [abilityTagA], publish: true,
}

function selectableAbilityRow(tagId) {
  return {
    id: tagId,
    kind: 'ABILITY',
    selectable: 1,
    parent_id: null,
    parent_kind: null,
    parent_parent_id: null,
    parent_selectable: null,
    parent_enabled: null,
  }
}

// 存量行 + 可按 SQL 指纹路由的假事务：默认「标签可用、成员资格在册」，
// 测试按需覆写单个指纹来模拟目录漂移。
function fixture({
  existing = {},
  storedTags = [[abilityTagA, 'ABILITY']],
  storedTeam = [teammate],
  selectableTagIds = [abilityTagA, abilityTagB],
  eligibleTeamUserIds = storedTeam,
} = {}) {
  const calls = []
  const row = {
    owner_user_id: owner, branch_id: null, city_tag_id: null, cover_asset_id: null,
    status: 'PUBLISHED', version: 4, ...existing,
  }
  const tx = {
    async one(sql) {
      calls.push({ sql })
      if (sql.includes('FROM mip_users')) return { id: owner, status: 'ACTIVE' }
      if (sql.includes('FROM mip_idempotency_keys')) return null
      if (sql.includes('FROM mip_opportunities')) return row
      if (sql.includes('FROM mip_city_branches') || sql.includes('FROM mip_media_assets')) return null
      return null
    },
    async query(sql, params) {
      calls.push({ sql, params })
      if (/^\s*SELECT/.test(sql)) {
        if (sql.includes('FROM mip_opportunity_tags')) {
          return storedTags.map(([tagId, relation]) => ({ tag_id: tagId, relation }))
        }
        if (sql.includes('FROM mip_tags t')) {
          return selectableTagIds.map(selectableAbilityRow)
        }
        if (sql.includes('FROM mip_opportunity_team_members')) return storedTeam.map(userId => ({ user_id: userId }))
        if (sql.includes('INNER JOIN mip_profiles')) {
          return eligibleTeamUserIds.map(userId => ({ id: userId }))
        }
        if (sql.includes('FROM mip_opportunity_commercial_terms') || sql.includes('FROM mip_opportunity_locations')) return []
        return []
      }
      return { affectedRows: 1 }
    },
  }
  return { calls, db: { ...tx, async transaction(work) { return work(tx) } } }
}

function run(f, overrides = {}) {
  return saveOpportunity(f.db, { async assertSafe() {} }, caller, {
    draft: { ...draft, ...overrides }, idempotencyKey: 'gated-save-idempotency-key',
  })
}

test('untouched ride-along tag saves even after the tag was disabled since', async () => {
  const f = fixture({ selectableTagIds: [] })
  const result = await run(f)
  assert.equal(result.status, 'PUBLISHED')
  assert.ok(f.calls.some(call => call.sql.includes('UPDATE mip_opportunities')))
  assert.equal(f.calls.some(call => call.sql.includes('FROM mip_tags t')), false)
})

test('changed tag is still fully validated and a disabled target is rejected', async () => {
  const f = fixture({ selectableTagIds: [] })
  await assert.rejects(() => run(f, { abilityTagIds: [abilityTagB] }), /VALIDATION_FAILED/)
  assert.equal(f.calls.some(call => call.sql.includes('UPDATE mip_opportunities')), false)
})

test('changed tag that resolves to a selectable tag saves', async () => {
  const f = fixture()
  const result = await run(f, { abilityTagIds: [abilityTagB] })
  assert.equal(result.version, 5)
  const tagInsert = f.calls.find(call => call.sql.includes('INSERT INTO mip_opportunity_tags'))
  assert.ok(tagInsert.params.includes(abilityTagB))
})

test('unchanged team roster skips the membership re-check that would now fail', async () => {
  const f = fixture({ eligibleTeamUserIds: [] })
  const profileRef = createProfileRef({ appId, userId: teammate }, caller.profileRefSecret)
  const result = await run(f, { teamProfileRefs: [profileRef] })
  assert.equal(result.version, 5)
  assert.equal(f.calls.some(call => call.sql.includes('INNER JOIN mip_profiles')), false)
})

test('changed team roster still re-checks membership eligibility', async () => {
  const newcomer = '10000000-0000-4000-8000-000000000004'
  const f = fixture({ eligibleTeamUserIds: [teammate] })
  const profileRef = createProfileRef({ appId, userId: teammate }, caller.profileRefSecret)
  const newcomerRef = createProfileRef({ appId, userId: newcomer }, caller.profileRefSecret)
  await assert.rejects(() => run(f, { teamProfileRefs: [profileRef, newcomerRef] }), /VALIDATION_FAILED/)
  assert.equal(f.calls.some(call => call.sql.includes('UPDATE mip_opportunities')), false)
})

test('unchanged branch skips the ACTIVE branch check; a changed unknown branch is rejected', async () => {
  const branchId = '30000000-0000-4000-8000-000000000001'
  const untouched = fixture({ existing: { branch_id: branchId } })
  const result = await run(untouched, { scopeType: 'BRANCH', branchId })
  assert.equal(result.version, 5)
  assert.equal(untouched.calls.some(call => call.sql.includes('FROM mip_city_branches')), false)

  const changed = fixture({ existing: { branch_id: null } })
  await assert.rejects(() => run(changed, { scopeType: 'BRANCH', branchId }), /VALIDATION_FAILED/)
})

test('create with no cooperation roles is accepted (MIW-50 mini-program form)', async () => {
  const f = fixture()
  const result = await run(f, { id: undefined, expectedVersion: undefined })
  assert.ok(result.id)
  assert.equal(result.version, 1)
  assert.ok(f.calls.some(call => call.sql.includes('INSERT INTO mip_opportunities')))
  assert.equal(f.calls.some(call => call.sql.includes('INSERT INTO mip_opportunity_roles')), false)
})
