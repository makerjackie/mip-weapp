'use strict'

// MIW-55 回归（2026-10-08 端到端验收发现）：getPublicProfileAggregate 的机会卡
// typeKeys 投影曾对 type_keys_json 直接 `(jsonObject(x) || []).filter(...)`——
// jsonObject 对 NULL/非法 JSON 的兜底是 {}（对象），迁移 081 之前的历史行该列为
// NULL，`{}.filter` 抛 TypeError 让整个聚合接口 500（线上表现为公开档案页
// 「机会服务暂时不可用」）。本套件用 SQL 指纹路由的假数据库钉住 NULL 行不崩、
// 且数组行照常投影。

const assert = require('node:assert/strict')
const test = require('node:test')
const { getPublicProfileAggregate } = require('../domain/discovery')
const { createProfileRef } = require('../lib/profile-ref')

const appId = 'aggregate-test-app'
const viewer = '10000000-0000-4000-8000-000000000001'
const target = '10000000-0000-4000-8000-000000000002'
const opportunityId = '20000000-0000-4000-8000-000000000003'
const secret = 'aggregate-profile-reference-secret-32-characters'

const caller = { appId, userId: viewer, profileRefSecret: secret }

const profileRow = {
  profile_user_id: target,
  joined_at: '2026-08-25T08:00:00.000Z',
  nickname: '历史数据用户',
  real_name: null,
  gender: null,
  career_identity_key: null,
  identity_status: 'ACTIVE',
  headline: '一句话介绍',
  introduction: null,
  companies_json: null,
  organizations_json: null,
  visibility_json: '{}',
  avatar_file_id: null,
  branch_id: null,
  branch_name: null,
  branch_city_name: null,
  industry_tag_id: null,
  industry_key: null,
  industry_label: null,
  is_player: 0,
}

function opportunityRow(typeKeysJson) {
  return {
    id: opportunityId,
    title: '历史机会',
    value_summary: '价值说明',
    target_summary: '寻找伙伴',
    referral_count: 2,
    type_keys_json: typeKeysJson,
    published_at: '2026-08-25T08:00:00.000Z',
    branch_name: null,
    city_label: null,
    cover_file_id: null,
  }
}

function fakeDatabase(opportunityRows) {
  return {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return profileRow
      if (sql.includes('FROM mip_profile_interests')) return null
      return null
    },
    async query(sql) {
      if (/FROM mip_opportunities o\b/.test(sql)) return opportunityRows
      return []
    },
  }
}

test('aggregate keeps historical opportunities with NULL type_keys_json renderable', async () => {
  const profileRef = createProfileRef({ appId, userId: target }, secret)
  const aggregate = await getPublicProfileAggregate(fakeDatabase([opportunityRow(null)]), caller, { profileRef })
  assert.equal(aggregate.opportunities.length, 1)
  assert.deepEqual(aggregate.opportunities[0].typeKeys, [])
  assert.deepEqual(aggregate.opportunities[0].avatars, [])
  assert.equal(aggregate.profile.profileRef, profileRef)
})

test('aggregate projects array and JSON-string type_keys_json into string arrays', async () => {
  const profileRef = createProfileRef({ appId, userId: target }, secret)
  const aggregate = await getPublicProfileAggregate(
    fakeDatabase([opportunityRow(['COMPANY', 42]), opportunityRow(JSON.stringify(['PARTNER']))]),
    caller,
    { profileRef },
  )
  assert.deepEqual(aggregate.opportunities[0].typeKeys, ['COMPANY'])
  assert.deepEqual(aggregate.opportunities[1].typeKeys, ['PARTNER'])
})
