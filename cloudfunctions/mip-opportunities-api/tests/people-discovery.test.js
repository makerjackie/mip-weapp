'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  decodePeopleCursor,
  encodePeopleCursor,
  getPublicProfileAggregate,
  listPeople,
  normalizePeopleFilter,
} = require('../domain/discovery')
const { setProfileInterest } = require('../domain/opportunities')
const { createProfileRef } = require('../lib/profile-ref')

const appId = 'wx-people-app'
const viewerUserId = '10000000-0000-4000-8000-000000000001'
const targetUserId = '20000000-0000-4000-8000-000000000001'
const secondUserId = '20000000-0000-4000-8000-000000000002'
const branchId = '30000000-0000-4000-8000-000000000001'
const industryId = '40000000-0000-4000-8000-000000000001'
const abilityId = '50000000-0000-4000-8000-000000000001'
const pepper = 'people-profile-reference-secret-more-than-32-characters'
const caller = { appId, userId: viewerUserId, profileRefSecret: pepper }

function profileRow(overrides = {}) {
  return {
    profile_user_id: targetUserId,
    joined_at: '2026-08-24T08:00:00.000Z',
    nickname: '林野',
    identity_status: '创业者',
    headline: '品牌与产品负责人',
    introduction: '关注消费品牌和城市合作。',
    companies_json: '[{"name":"示例公司","role":"负责人","phone":"private"}]',
    organizations_json: '[]',
    visibility_json: '{}',
    avatar_file_id: 'cloud://mip/avatar',
    branch_id: branchId,
    branch_name: '深圳分会',
    branch_city_name: '深圳',
    industry_tag_id: industryId,
    industry_key: 'brand_consulting',
    industry_label: '品牌咨询',
    is_player: 1,
    phone_ciphertext: 'private',
    openid: 'private',
    ...overrides,
  }
}

describe('people discovery', () => {
  it('uses an encrypted profile reference inside its cursor instead of a raw user id', () => {
    const cursor = encodePeopleCursor('2026-08-24T08:00:00.000Z', targetUserId, caller)
    const decodedText = Buffer.from(cursor, 'base64url').toString('utf8')
    assert.equal(cursor.includes(targetUserId), false)
    assert.equal(decodedText.includes(targetUserId), false)
    assert.match(decodedText, /"profileRef":"p1\./)
    assert.deepEqual(decodePeopleCursor(cursor, caller), {
      timestamp: '2026-08-24T08:00:00.000Z',
      userId: targetUserId,
    })
    assert.throws(() => decodePeopleCursor(cursor, { ...caller, appId: 'wx-other-app' }), /VALIDATION_FAILED/)
  })

  it('normalizes player scope, branch, industry, ability, keyword and limit filters', () => {
    assert.deepEqual(normalizePeopleFilter({
      scope: 'player',
      keyword: '  品牌_10%  ',
      branchId,
      industryTagIds: [industryId, industryId],
      abilityTagIds: [abilityId, abilityId],
      limit: 100,
    }, caller), {
      scope: 'PLAYER',
      keyword: '品牌_10%',
      branchId,
      industryTagIds: [industryId],
      abilityTagIds: [abilityId],
      cursor: null,
      limit: 30,
    })
    assert.throws(() => normalizePeopleFilter({ kind: 'OWNER' }, caller), /VALIDATION_FAILED/)
    assert.throws(() => normalizePeopleFilter({ scope: 'GUEST' }, caller), /VALIDATION_FAILED/)
  })

  it('orders by join time, applies visible app-scoped filters, and returns only public fields', async () => {
    const calls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_tags t')) {
          return [
            {
              id: industryId,
              kind: 'INDUSTRY',
              selectable: 1,
              parent_id: '40000000-0000-4000-8000-000000000099',
              parent_kind: 'INDUSTRY',
              parent_parent_id: null,
              parent_selectable: 0,
              parent_enabled: 1,
            },
            { id: abilityId, kind: 'ABILITY', selectable: 1 },
          ]
        }
        if (sql.includes('FROM mip_users u')) {
          return [
            profileRow(),
            profileRow({
              profile_user_id: secondUserId,
              joined_at: '2026-08-23T08:00:00.000Z',
              nickname: '成员乙',
              is_player: 0,
            }),
          ]
        }
        if (sql.includes('FROM mip_profile_tags pt')) {
          return [{
            user_id: targetUserId,
            relation: 'ABILITY',
            id: abilityId,
            tag_key: 'delivery_management',
            label: '项目管理',
          }]
        }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const result = await listPeople(database, caller, {
      kind: 'PLAYER',
      keyword: '品牌_10%',
      branchId,
      industryTagIds: [industryId],
      abilityTagIds: [abilityId],
      limit: 1,
    })
    const listCall = calls.find(call => call.sql.includes('FROM mip_users u'))
    assert.match(listCall.sql, /ORDER BY u\.created_at DESC, u\.id DESC/)
    assert.match(listCall.sql, /mip_membership_entitlements/)
    assert.match(listCall.sql, /FROM mip_user_blocks visibility_block/)
    assert.match(listCall.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.industry'\)/)
    assert.match(listCall.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.primaryBranch'\)/)
    assert.match(listCall.sql, /industry_filter\.tag_id IN \(\?\)/)
    assert.match(listCall.sql, /ability_filter\.tag_id IN \(\?\)/)
    assert.match(listCall.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.abilities'\)/)
    assert.equal(listCall.sql.includes('mip_private_profiles'), false)
    assert.equal(listCall.sql.includes('mip_user_identities'), false)
    assert.equal(listCall.params[0], appId)
    assert.deepEqual(listCall.params.slice(1, 3), [viewerUserId, viewerUserId])
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].nickname, '林野')
    assert.equal(result.items[0].userKind, 'PLAYER')
    assert.equal(result.items[0].abilities[0].label, '项目管理')
    assert.match(result.items[0].profileRef, /^p1\./)
    assert.equal(result.items[0].companies[0].phone, undefined)
    const serialized = JSON.stringify(result)
    assert.equal(serialized.includes(targetUserId), false)
    assert.equal(serialized.includes('phone_ciphertext'), false)
    assert.equal(serialized.includes('private-openid'), false)
    assert.deepEqual(decodePeopleCursor(result.nextCursor, caller), {
      timestamp: '2026-08-24T08:00:00.000Z',
      userId: targetUserId,
    })
  })

  it('defaults to global scope and returns both players and guests', async () => {
    const calls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_users u')) {
          return [
            profileRow(),
            profileRow({
              profile_user_id: secondUserId,
              nickname: '嘉宾乙',
              is_player: 0,
            }),
          ]
        }
        if (sql.includes('FROM mip_profile_tags pt')) return []
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const result = await listPeople(database, caller, { limit: 2 })
    const listCall = calls.find(call => call.sql.includes('FROM mip_users u'))
    assert.equal(listCall.sql.match(/mip_membership_entitlements/g).length, 1)
    assert.deepEqual(result.items.map(item => item.userKind), ['PLAYER', 'GUEST'])
  })

  it('rejects app-scoped tags that are missing, disabled or have the wrong kind', async () => {
    await assert.rejects(
      () => listPeople({ query: async () => [] }, caller, { abilityTagIds: [abilityId] }),
      /VALIDATION_FAILED/,
    )
  })
})

describe('public profile aggregate', () => {
  it('returns profile, published cards, cases, recruiting opportunities and viewer interest in one DTO', async () => {
    const profileRef = createProfileRef({ appId, userId: targetUserId }, pepper)
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_users u')) {
          return profileRow({
            visibility_json: JSON.stringify({ nickname: false, companies: false }),
          })
        }
        if (sql.includes('FROM mip_profile_interests')) return { status: 'ACTIVE' }
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_profile_tags pt')) return []
        if (sql.includes('FROM mip_cooperation_cards')) {
          return [{
            id: '60000000-0000-4000-8000-000000000001',
            role_key: 'strategist',
            positioning: '品牌和产品策划',
            target_summary: '完成三个合作项目',
            ability_scores_json: '{"strategy_planning":5}',
            published_at: '2026-08-24T07:00:00.000Z',
          }]
        }
        if (sql.includes('FROM mip_super_cases c')) {
          return [{
            id: '70000000-0000-4000-8000-000000000001',
            project_name: '品牌升级',
            summary: '完成品牌定位和视觉升级',
            responsibility: '负责策略和统筹',
            published_at: '2026-08-24T06:00:00.000Z',
          }]
        }
        if (sql.includes('FROM mip_opportunities o')) {
          return [{
            id: '80000000-0000-4000-8000-000000000001',
            title: '城市品牌合作',
            value_summary: '提供品牌和渠道资源',
            target_summary: '寻找策划伙伴',
            referral_count: 2,
            published_at: '2026-08-24T05:00:00.000Z',
          }]
        }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const result = await getPublicProfileAggregate(database, caller, { profileRef })
    assert.equal(result.profile.nickname, undefined)
    assert.equal(result.profile.companies, undefined)
    assert.equal(result.profile.userKind, 'PLAYER')
    assert.equal(result.cooperationCards[0].roleKey, 'strategist')
    assert.equal(result.superCases[0].projectName, '品牌升级')
    assert.equal(result.opportunities[0].status, 'PUBLISHED')
    assert.equal(result.interestActive, true)
    const profileQuery = calls.find(call => call.sql.includes('FROM mip_users u'))
    assert.match(profileQuery.sql, /FROM mip_user_blocks visibility_block/)
    assert.deepEqual(profileQuery.params, [appId, targetUserId, viewerUserId, viewerUserId])
    const serialized = JSON.stringify(result)
    assert.equal(serialized.includes(targetUserId), false)
    for (const forbidden of ['phone', 'openid', 'userId', 'user_id', 'profile_user_id']) {
      assert.equal(serialized.includes(forbidden), false)
    }
  })

  it('does not reveal whether a blocked profile exists', async () => {
    const profileRef = createProfileRef({ appId, userId: targetUserId }, pepper)
    await assert.rejects(
      () => getPublicProfileAggregate({ one: async () => null }, caller, { profileRef }),
      /NOT_FOUND/,
    )
  })
})

describe('direct profile interest', () => {
  it('resolves only an opaque profile reference and stores a PROFILE-sourced user relation', async () => {
    const profileRef = createProfileRef({ appId, userId: targetUserId }, pepper)
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_idempotency_keys')) return null
        if (sql.includes('SELECT id, status FROM mip_users')) {
          return { id: viewerUserId, status: 'ACTIVE' }
        }
        if (sql.includes('FROM mip_users target')) {
          assert.match(sql, /FROM mip_user_blocks visibility_block/)
          return { owner_user_id: targetUserId }
        }
        if (sql.includes('FROM mip_profile_interests')) return null
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const result = await setProfileInterest({ transaction: work => work(tx) }, caller, {
      sourceType: 'PROFILE',
      profileRef,
      active: true,
      idempotencyKey: 'direct-profile-interest-stable-key',
    })
    const insert = writes.find(call => call.sql.includes('INSERT INTO mip_profile_interests'))
    assert.ok(insert)
    assert.deepEqual(insert.params.slice(1), [
      appId,
      viewerUserId,
      targetUserId,
      'PROFILE',
      targetUserId,
    ])
    assert.deepEqual(result, { active: true, version: 1 })
    assert.equal(JSON.stringify(result).includes(targetUserId), false)
    const outbox = writes.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
    assert.match(outbox.params[6], /"sourceType":"PROFILE"/)
  })
})
