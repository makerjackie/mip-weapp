'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { decodeCursor } = require('../domain/common')
const {
  listCooperationCards,
  listCooperationTalents,
  normalizeFilter,
} = require('../domain/cooperation')
const { createTalentCursor, readTalentCursor } = require('../lib/talent-cursor')

const appId = 'wx-cooperation-app'
const branchId = '10000000-0000-4000-8000-000000000001'
const industryId = '20000000-0000-4000-8000-000000000001'
const abilityId = '22000000-0000-4000-8000-000000000001'
const firstCardId = '30000000-0000-4000-8000-000000000002'
const secondCardId = '30000000-0000-4000-8000-000000000001'
const firstOwnerId = '40000000-0000-4000-8000-000000000002'
const secondOwnerId = '40000000-0000-4000-8000-000000000001'
const secret = 'cooperation-profile-reference-secret-more-than-32-characters'
const snapshotAt = '2026-08-25T08:00:00.000Z'

test('cooperation filters normalize keyword, role, city, industry, cursor, and limit', () => {
  const cursor = Buffer.from(JSON.stringify({
    timestamp: '2026-08-24T08:00:00.000Z',
    id: firstOwnerId,
  }), 'utf8').toString('base64url')
  assert.deepEqual(normalizeFilter({
    keyword: '  品牌_10%  ',
    branchId,
    roleKey: 'strategist',
    industryTagIds: [industryId, industryId],
    abilityTagIds: [abilityId, abilityId],
    cursor,
    limit: 100,
  }), {
    keyword: '品牌_10%',
    branchId,
    roleKey: 'strategist',
    industryTagIds: [industryId],
    abilityTagIds: [abilityId],
    cursor: { timestamp: '2026-08-24T08:00:00.000Z', id: firstOwnerId },
    limit: 30,
  })
  assert.throws(() => normalizeFilter({ roleKey: 'owner' }), /VALIDATION_FAILED/)
  assert.throws(() => normalizeFilter({ branchId: 'not-a-branch' }), /VALIDATION_FAILED/)
  assert.throws(() => normalizeFilter({ cursor: 'not-a-cursor' }), /VALIDATION_FAILED/)
  assert.throws(() => normalizeFilter({ abilityTagIds: ['not-a-tag'] }), /VALIDATION_FAILED/)
})

test('legacy cooperation-card action preserves the card-level response contract', async () => {
  const row = {
    id: firstCardId,
    owner_user_id: firstOwnerId,
    role_key: 'strategist',
    positioning: '品牌策划与产品方向',
    target_summary: '完成三个合作项目',
    ability_scores_json: '{"strategy_planning":5}',
    status: 'PUBLISHED',
    published_at: '2026-08-24T08:00:00.000Z',
    nickname: '成员甲',
    visibility_json: '{}',
  }
  const result = await listCooperationCards({ async query() { return [row] } }, {
    appId,
    userId: null,
    profileRefSecret: secret,
  }, { limit: 1 })
  assert.equal(result.items[0].id, firstCardId)
  assert.equal(result.items[0].roleKey, 'strategist')
  assert.equal(result.items[0].positioning, '品牌策划与产品方向')
  assert.equal('cards' in result.items[0], false)
  assert.equal('talentKey' in result.items[0], false)
})

test('cooperation talent discovery uses a frozen user keyset and aggregates all public role cards', async () => {
  const calls = []
  const rows = [
    {
      owner_user_id: firstOwnerId,
      user_created_at: '2026-06-24T08:00:00.000Z',
      nickname: '成员甲',
      headline: '品牌顾问',
      visibility_json: '{}',
      city_name: '深圳',
      industry_tag_id: industryId,
      industry_key: 'brand_consulting',
      industry_label: '品牌咨询',
      snapshot_at: snapshotAt,
      id: firstCardId,
      role_key: 'strategist',
      positioning: '品牌策划与产品方向',
      target_summary: '完成三个合作项目',
      ability_scores_json: '{"strategy_planning":5}',
      published_at: '2026-08-24T08:00:00.000Z',
    },
    {
      owner_user_id: firstOwnerId,
      user_created_at: '2026-06-24T08:00:00.000Z',
      nickname: '成员甲',
      visibility_json: '{}',
      city_name: '深圳',
      industry_tag_id: industryId,
      industry_key: 'brand_consulting',
      industry_label: '品牌咨询',
      snapshot_at: snapshotAt,
      id: secondCardId,
      role_key: 'visual_designer',
      positioning: '品牌视觉设计',
      target_summary: '完成两个品牌项目',
      ability_scores_json: '{}',
      published_at: '2026-08-23T08:00:00.000Z',
    },
    {
      owner_user_id: secondOwnerId,
      user_created_at: '2026-06-22T08:00:00.000Z',
      nickname: '成员乙',
      visibility_json: '{}',
      city_name: '深圳',
      snapshot_at: snapshotAt,
      id: '30000000-0000-4000-8000-000000000003',
      role_key: 'strategist',
      positioning: '品牌_10% 产品策划',
      target_summary: '完成一个合作项目',
      ability_scores_json: '{}',
      published_at: '2026-08-22T08:00:00.000Z',
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
        return [
          {
            id: industryId,
            kind: 'INDUSTRY',
            selectable: 1,
            parent_id: '21000000-0000-4000-8000-000000000001',
            parent_kind: 'INDUSTRY',
            parent_parent_id: null,
            parent_selectable: 0,
            parent_enabled: 1,
          },
          { id: abilityId, kind: 'ABILITY', selectable: 1, parent_id: null, parent_kind: null, parent_parent_id: null, parent_selectable: 0, parent_enabled: 1 },
        ]
      }
      if (sql.includes('FROM mip_users u')) return rows
      // 人才卡公开详情：身份状态/等级/佩戴勋章与邀请人归档（与竖版用户卡同口径）。
      if (sql.includes('FROM mip_profiles profile')) {
        return [
          {
            user_id: firstOwnerId,
            visibility_json: '{}',
            identity_status: '公司在职',
            introduction: '十年品牌咨询',
            city_name: '深圳',
            experience_balance: 120,
            industry_label: '品牌咨询',
          },
        ]
      }
      if (sql.includes('FROM mip_user_badge_equipment')) {
        return [
          { user_id: firstOwnerId, slot_no: 1, id: '50000000-0000-4000-8000-000000000001', name: '城主', image_url: 'badge-1.png' },
          { user_id: firstOwnerId, slot_no: 2, id: '50000000-0000-4000-8000-000000000002', name: '公会长' },
        ]
      }
      if (sql.includes('FROM mip_growth_levels')) {
        return [
          { id: '60000000-0000-4000-8000-000000000001', name: 'Lv1', minimum_experience: 0, status: 'ACTIVE' },
          { id: '60000000-0000-4000-8000-000000000002', name: 'Lv2', minimum_experience: 100, status: 'ACTIVE' },
        ]
      }
      if (sql.includes('FROM mip_event_invitation_attributions attribution')) {
        return [
          {
            guest_user_id: firstOwnerId,
            invitation_source_type: 'USER',
            inviter_nickname: '邀请人甲',
            inviter_visibility_json: '{}',
            inviter_avatar_file_id: 'inviter-avatar.png',
          },
        ]
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }

  const result = await listCooperationTalents(database, {
    appId,
    userId: null,
    profileRefSecret: secret,
  }, {
    keyword: '品牌_10%',
    branchId,
    roleKey: 'strategist',
    industryTagIds: [industryId],
    abilityTagIds: [abilityId],
    limit: 1,
  })

  const listCall = calls.find(call => call.sql.includes('FROM mip_users u'))
  assert.ok(listCall)
  assert.match(listCall.sql, /u\.app_id = \?/)
  assert.match(listCall.sql, /WITH snapshot AS/)
  assert.match(listCall.sql, /FROM mip_users u\s+CROSS JOIN snapshot\s+LEFT JOIN mip_profiles p/)
  assert.match(listCall.sql, /LEFT JOIN mip_cooperation_cards c\s+ON c\.app_id = u\.app_id AND c\.owner_user_id = u\.id/)
  assert.match(listCall.sql, /GROUP BY u\.id, u\.created_at, snapshot\.snapshot_at/)
  assert.match(listCall.sql, /ORDER BY user_created_at DESC, owner_user_id DESC/)
  assert.equal((listCall.sql.match(/u\.status = 'ACTIVE'/g) || []).length, 2)
  assert.equal((listCall.sql.match(/c\.published_at <=/g) || []).length, 2)
  assert.match(listCall.sql, /c\.positioning LIKE \? ESCAPE '='/)
  assert.match(listCall.sql, /u\.primary_branch_id = \?/)
  assert.equal((listCall.sql.match(/c\.role_key = \?/g) || []).length, 1)
  assert.match(listCall.sql, /FROM mip_profile_tags industry_filter/)
  assert.match(listCall.sql, /industry_filter\.user_id = u\.id/)
  assert.match(listCall.sql, /FROM mip_profile_tags ability_filter/)
  assert.match(listCall.sql, /ability_filter\.relation = 'ABILITY'/)
  assert.match(listCall.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.talentSearch'\)/)
  assert.match(listCall.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.primaryBranch'\)/)
  assert.match(listCall.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.industry'\)/)
  assert.match(listCall.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.abilities'\)/)
  assert.deepEqual(listCall.params, [
    appId,
    '%品牌=_10=%%', '%品牌=_10=%%', '%品牌=_10=%%', '%品牌=_10=%%', '%品牌=_10=%%',
    branchId,
    'strategist',
    industryId,
    abilityId,
    appId,
  ])
  assert.equal(result.items.length, 1)
  assert.match(result.items[0].talentKey, /^mctk1\./)
  assert.match(result.items[0].profileRef, /^p1\./)
  assert.equal(result.items[0].author.nickname, '成员甲')
  assert.deepEqual(result.items[0].author.primaryIndustry, {
    id: industryId,
    key: 'brand_consulting',
    label: '品牌咨询',
  })
  // 人才卡公开详情（figma 1768_37534）：身份状态/等级/佩戴勋章（槽位序）/邀请人，
  // 不泄露内部 user id。
  assert.equal(result.items[0].author.identityStatus, '公司在职')
  assert.deepEqual(result.items[0].author.level, { number: 2, name: 'Lv2' })
  assert.deepEqual(result.items[0].author.badges, [
    { id: '50000000-0000-4000-8000-000000000001', name: '城主', imageUrl: 'badge-1.png' },
    { id: '50000000-0000-4000-8000-000000000002', name: '公会长', imageUrl: undefined },
  ])
  assert.deepEqual(result.items[0].author.inviter, {
    sourceType: 'USER',
    displayName: '邀请人甲',
    avatarUrl: 'inviter-avatar.png',
  })
  assert.equal(JSON.stringify(result.items[0]).includes(firstOwnerId), false)
  assert.deepEqual(result.items[0].cards.map(card => ({
    id: card.id,
    roleKey: card.roleKey,
    positioning: card.positioning,
  })), [
    { id: firstCardId, roleKey: 'strategist', positioning: '品牌策划与产品方向' },
    { id: secondCardId, roleKey: 'visual_designer', positioning: '品牌视觉设计' },
  ])
  assert.equal(JSON.stringify(result.items[0]).includes(firstOwnerId), false)
  assert.equal('userId' in result.items[0], false)
  assert.equal('userId' in result.items[0].author, false)
  assert.equal(result.nextCursor.includes(firstOwnerId), false)
  assert.deepEqual(readTalentCursor(result.nextCursor, {
    appId,
    viewerId: '',
    keyword: '品牌_10%',
    branchId,
    roleKey: 'strategist',
    industryTagIds: [industryId],
    abilityTagIds: [abilityId],
  }, secret), {
    snapshotAt,
    createdAt: '2026-06-24T08:00:00.000Z',
    userId: firstOwnerId,
  })
})

// MIW-78 名单册：名单覆盖全部 ACTIVE 用户——无发布卡、只有草稿卡或无档案的用户也在列，
// cards 为空数组；仅发布后快照可见的卡片参与展示与关键词/角色匹配。
test('cooperation talent roster includes users without published cards or profiles', async () => {
  const calls = []
  const cardlessOwnerId = '44000000-0000-4000-8000-000000000001'
  const rows = [
    {
      owner_user_id: firstOwnerId,
      user_created_at: '2026-06-24T08:00:00.000Z',
      nickname: '成员甲',
      headline: null,
      visibility_json: '{}',
      city_name: '深圳',
      snapshot_at: snapshotAt,
      id: firstCardId,
      role_key: 'strategist',
      positioning: '品牌策划',
      target_summary: '目标',
      ability_scores_json: '{}',
      published_at: '2026-08-24T08:00:00.000Z',
    },
    {
      // 无档案用户：LEFT JOIN 档案全空，昵称走 MIP 用户占位，cards 为空。
      owner_user_id: cardlessOwnerId,
      user_created_at: '2026-06-20T08:00:00.000Z',
      nickname: null,
      headline: null,
      visibility_json: null,
      city_name: null,
      snapshot_at: snapshotAt,
      id: null,
      role_key: null,
      positioning: null,
      target_summary: null,
      ability_scores_json: null,
      published_at: null,
    },
  ]
  const result = await listCooperationTalents({
    async one() { throw new Error('unexpected one') },
    async query(sql) {
      calls.push({ sql })
      if (sql.includes('FROM mip_tags t')) return []
      if (sql.includes('FROM mip_users u')) return rows
      if (sql.includes('FROM mip_profiles profile')) return []
      if (sql.includes('FROM mip_user_badge_equipment')) return []
      if (sql.includes('FROM mip_growth_levels')) return []
      if (sql.includes('FROM mip_event_invitation_attributions attribution')) return []
      throw new Error(`unexpected query: ${sql}`)
    },
  }, {
    appId,
    userId: null,
    profileRefSecret: secret,
  }, { limit: 10 })
  const listCall = calls.find(call => call.sql.includes('FROM mip_users u'))
  assert.match(listCall.sql, /COALESCE\(JSON_UNQUOTE\(JSON_EXTRACT\(p\.visibility_json, '\$\.talentSearch'\)\), 'true'\)/)
  assert.equal(result.items.length, 2)
  const [withCards, withoutCards] = result.items
  assert.equal(withCards.author.nickname, '成员甲')
  assert.equal(withCards.cards.length, 1)
  assert.equal(withoutCards.author.nickname, 'MIP 用户')
  assert.equal(withoutCards.author.avatarUrl, undefined)
  assert.deepEqual(withoutCards.cards, [])
})

test('cooperation talent cursor keeps the original snapshot and applies to the immutable user keyset', async () => {
  const context = {
    appId,
    viewerId: '',
    keyword: '',
    branchId: '',
    roleKey: 'strategist',
    industryTagIds: [],
  }
  const cursor = createTalentCursor(context, {
    snapshotAt,
    createdAt: '2026-06-24T08:00:00.000Z',
    userId: firstOwnerId,
  }, secret)
  const calls = []
  await listCooperationTalents({
    async query(sql, params) {
      calls.push({ sql, params })
      return []
    },
  }, {
    appId,
    userId: null,
    profileRefSecret: secret,
  }, { cursor, limit: 1, roleKey: 'strategist' })
  assert.match(calls[0].sql, /c\.role_key = \?/)
  assert.match(calls[0].sql, /WHERE user_created_at < \?/)
  assert.deepEqual(calls[0].params, [
    '2026-08-25 08:00:00.000',
    appId,
    'strategist',
    '2026-06-24 08:00:00.000',
    '2026-06-24 08:00:00.000',
    firstOwnerId,
    appId,
  ])
})

test('cooperation city and industry filters require visible author fields', async () => {
  const calls = []
  await listCooperationTalents({
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
    profileRefSecret: secret,
  }, { branchId, industryTagIds: [industryId] })
  const listCall = calls.find(call => call.sql.includes('FROM mip_users u'))
  assert.match(listCall.sql, /primaryBranch[\s\S]*<> 'false'/)
  assert.match(listCall.sql, /industry[\s\S]*<> 'false'/)
})
