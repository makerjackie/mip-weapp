'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { decodeCursor } = require('../domain/common')
const { listCooperationCards, normalizeFilter } = require('../domain/cooperation')

const appId = 'wx-cooperation-app'
const branchId = '10000000-0000-4000-8000-000000000001'
const industryId = '20000000-0000-4000-8000-000000000001'
const firstCardId = '30000000-0000-4000-8000-000000000002'
const secondCardId = '30000000-0000-4000-8000-000000000001'

test('cooperation filters normalize keyword, role, city, industry, cursor, and limit', () => {
  const cursor = Buffer.from(JSON.stringify({
    timestamp: '2026-08-24T08:00:00.000Z',
    id: firstCardId,
  }), 'utf8').toString('base64url')
  assert.deepEqual(normalizeFilter({
    keyword: '  品牌_10%  ',
    branchId,
    roleKey: 'strategist',
    industryTagIds: [industryId, industryId],
    cursor,
    limit: 100,
  }), {
    keyword: '品牌_10%',
    branchId,
    roleKey: 'strategist',
    industryTagIds: [industryId],
    cursor: { timestamp: '2026-08-24T08:00:00.000Z', id: firstCardId },
    limit: 30,
  })
  assert.throws(() => normalizeFilter({ roleKey: 'owner' }), /VALIDATION_FAILED/)
  assert.throws(() => normalizeFilter({ branchId: 'not-a-branch' }), /VALIDATION_FAILED/)
  assert.throws(() => normalizeFilter({ cursor: 'not-a-cursor' }), /VALIDATION_FAILED/)
})

test('cooperation discovery applies app-scoped parameterized filters and returns card authors', async () => {
  const calls = []
  const rows = [
    {
      id: firstCardId,
      owner_user_id: '40000000-0000-4000-8000-000000000001',
      role_key: 'strategist',
      positioning: '品牌策划与产品方向',
      target_summary: '完成三个合作项目',
      ability_scores_json: '{"strategy_planning":5}',
      status: 'PUBLISHED',
      published_at: '2026-08-24T08:00:00.000Z',
      nickname: '成员甲',
      headline: '品牌顾问',
      visibility_json: '{}',
      city_name: '深圳',
      industry_tag_id: industryId,
      industry_key: 'brand_consulting',
      industry_label: '品牌咨询',
    },
    {
      id: secondCardId,
      owner_user_id: '40000000-0000-4000-8000-000000000002',
      role_key: 'strategist',
      positioning: '产品策划',
      target_summary: '完成一个合作项目',
      ability_scores_json: '{}',
      status: 'PUBLISHED',
      published_at: '2026-08-23T08:00:00.000Z',
      nickname: '成员乙',
      visibility_json: '{}',
      city_name: '深圳',
    },
  ]
  const database = {
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_city_branches')) return { id: branchId }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_tags t')) {
        return [{
          id: industryId,
          kind: 'INDUSTRY',
          selectable: 1,
          parent_id: '21000000-0000-4000-8000-000000000001',
          parent_kind: 'INDUSTRY',
          parent_parent_id: null,
          parent_selectable: 0,
          parent_enabled: 1,
        }]
      }
      if (sql.includes('FROM mip_cooperation_cards c')) return rows
      throw new Error(`unexpected query: ${sql}`)
    },
  }

  const result = await listCooperationCards(database, {
    appId,
    userId: null,
    profileRefSecret: 'cooperation-profile-reference-secret-more-than-32-characters',
  }, {
    keyword: '品牌_10%',
    branchId,
    roleKey: 'strategist',
    industryTagIds: [industryId],
    limit: 1,
  })

  const listCall = calls.find(call => call.sql.includes('FROM mip_cooperation_cards c'))
  assert.ok(listCall)
  assert.match(listCall.sql, /c\.app_id = \?/)
  assert.match(listCall.sql, /c\.positioning LIKE \? ESCAPE '='/)
  assert.match(listCall.sql, /u\.primary_branch_id = \?/)
  assert.match(listCall.sql, /c\.role_key = \?/)
  assert.match(listCall.sql, /FROM mip_profile_tags industry_filter/)
  assert.match(listCall.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.primaryBranch'\)/)
  assert.match(listCall.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.industry'\)/)
  assert.deepEqual(listCall.params, [
    appId,
    '%品牌=_10=%%', '%品牌=_10=%%', '%品牌=_10=%%', '%品牌=_10=%%', '%品牌=_10=%%',
    branchId,
    'strategist',
    industryId,
  ])
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, firstCardId)
  assert.equal(result.items[0].positioning, '品牌策划与产品方向')
  assert.equal(result.items[0].author.nickname, '成员甲')
  assert.deepEqual(result.items[0].author.primaryIndustry, {
    id: industryId,
    key: 'brand_consulting',
    label: '品牌咨询',
  })
  assert.equal('title' in result.items[0], false)
  assert.equal('valueSummary' in result.items[0], false)
  assert.equal('roles' in result.items[0], false)
  assert.deepEqual(decodeCursor(result.nextCursor), {
    timestamp: '2026-08-24T08:00:00.000Z',
    id: firstCardId,
  })
})

test('cooperation city and industry filters require visible author fields', async () => {
  const calls = []
  await listCooperationCards({
    async one() { return { id: branchId } },
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_tags t')) {
        return [{
          id: industryId,
          kind: 'INDUSTRY',
          selectable: 1,
          parent_id: '21000000-0000-4000-8000-000000000001',
          parent_kind: 'INDUSTRY',
          parent_parent_id: null,
          parent_selectable: 0,
          parent_enabled: 1,
        }]
      }
      return []
    },
  }, {
    appId,
    userId: null,
    profileRefSecret: 'cooperation-profile-reference-secret-more-than-32-characters',
  }, { branchId, industryTagIds: [industryId] })
  const listCall = calls.find(call => call.sql.includes('FROM mip_cooperation_cards c'))
  assert.match(listCall.sql, /primaryBranch[\s\S]*<> 'false'/)
  assert.match(listCall.sql, /industry[\s\S]*<> 'false'/)
})
