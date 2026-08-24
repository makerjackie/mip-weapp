'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { decodeCursor, encodeCursor } = require('../domain/common')
const {
  assertSelectableTags,
  getCatalogs,
  getOpportunity,
  listMine,
  listOpportunities,
  normalizeDraft: normalizeOpportunity,
  saveOpportunity,
} = require('../domain/opportunities')
const { getCooperationCard, normalizeDraft: normalizeCooperation } = require('../domain/cooperation')
const { getSuperCase, normalizeDraft: normalizeCase } = require('../domain/cases')
const { trustedWechatIdentity } = require('../lib/auth')

const id = '00000000-0000-4000-8000-000000000001'

test('trusted identity matches the shared HMAC contract', () => {
  const previousAllowed = process.env.MIP_ALLOWED_APP_IDS
  const previousPepper = process.env.MIP_IDENTITY_PEPPER
  process.env.MIP_ALLOWED_APP_IDS = 'trusted-app'
  process.env.MIP_IDENTITY_PEPPER = 'a-test-pepper-with-at-least-32-characters'
  try {
    const identity = trustedWechatIdentity({ APPID: 'trusted-app', OPENID: 'private-open-id' })
    assert.equal(identity.appId, 'trusted-app')
    assert.match(identity.identityKey, /^[a-f0-9]{64}$/)
    assert.notEqual(identity.identityKey, 'private-open-id')
  }
  finally {
    process.env.MIP_ALLOWED_APP_IDS = previousAllowed
    process.env.MIP_IDENTITY_PEPPER = previousPepper
  }
})

test('stable cursor round trips and rejects malformed input', () => {
  const cursor = encodeCursor('2026-08-24T00:00:00.000Z', id)
  assert.deepEqual(decodeCursor(cursor), { timestamp: '2026-08-24T00:00:00.000Z', id })
  assert.throws(() => decodeCursor('not-a-cursor'), /VALIDATION_FAILED/)
})

test('opportunity server validation enforces trusted role keys and branch scope', () => {
  const input = {
    title: '品牌合作',
    valueSummary: '提供渠道资源',
    targetSummary: '寻找策划伙伴',
    description: '完整合作说明',
    scopeType: 'BRANCH',
    branchId: id,
    roleKeys: ['strategist'],
    industryTagIds: [],
    abilityTagIds: [],
    publish: true,
  }
  assert.equal(normalizeOpportunity(input).branchId, id)
  assert.throws(() => normalizeOpportunity({ ...input, roleKeys: ['owner'] }), /VALIDATION_FAILED/)
})

test('opportunity catalog exposes non-selectable industry parents only as groups', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM mip_city_branches')) return []
      if (sql.includes('FROM mip_tags t')) {
        return [
          {
            id: '21900000-0000-4000-8000-000000000001',
            kind: 'INDUSTRY',
            parent_id: null,
            tag_key: 'internet_ai',
            label: '互联网与人工智能',
            selectable: 0,
            popular: 0,
          },
          {
            id: '21000000-0000-4000-8000-000000000001',
            kind: 'INDUSTRY',
            parent_id: '21900000-0000-4000-8000-000000000001',
            tag_key: 'internet',
            label: '互联网',
            selectable: 1,
            popular: 1,
          },
          {
            id: '20000000-0000-4000-8000-000000000001',
            kind: 'CITY',
            parent_id: null,
            tag_key: 'shenzhen',
            label: '深圳',
            selectable: 1,
            popular: 1,
          },
        ]
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }

  const catalog = await getCatalogs(database, { appId: 'trusted-app' })
  assert.deepEqual(catalog.industryGroups, [{
    id: '21900000-0000-4000-8000-000000000001',
    key: 'internet_ai',
    label: '互联网与人工智能',
    popular: false,
    options: [{
      id: '21000000-0000-4000-8000-000000000001',
      key: 'internet',
      label: '互联网',
      popular: true,
    }],
  }])
  assert.deepEqual(catalog.industryTags, catalog.industryGroups[0].options)
})

test('opportunity industry filters accept multiple child tags with any-match SQL', async () => {
  const industryIds = [
    '21000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000002',
  ]
  const calls = []
  const database = {
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_tags t')) {
        return industryIds.map(tagId => ({
          id: tagId,
          kind: 'INDUSTRY',
          selectable: 1,
          parent_id: '21900000-0000-4000-8000-000000000001',
          parent_kind: 'INDUSTRY',
          parent_parent_id: null,
          parent_selectable: 0,
          parent_enabled: 1,
        }))
      }
      if (sql.includes('FROM mip_opportunities o')) return []
      throw new Error(`unexpected query: ${sql}`)
    },
  }

  assert.deepEqual(await listOpportunities(database, {
    appId: 'trusted-app',
    profileRefSecret: 'profile-reference-secret',
  }, {
    status: 'RECRUITING',
    industryTagIds: industryIds,
  }), { items: [], nextCursor: undefined })
  const listCall = calls.find(call => call.sql.includes('FROM mip_opportunities o'))
  assert.match(listCall.sql, /f\.tag_id IN \(\?, \?\)/)
  assert.deepEqual(listCall.params.slice(2), ['INDUSTRY', ...industryIds])
})

test('opportunity role filter produces one app-scoped EXISTS clause', async () => {
  const calls = []
  await listOpportunities({
    async query(sql, params) {
      calls.push({ sql, params })
      return []
    },
  }, {
    appId: 'trusted-app',
    profileRefSecret: 'profile-reference-secret',
  }, { roleKey: 'strategist' })
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /EXISTS \([\s\S]*FROM mip_opportunity_roles r[\s\S]*r\.role_key = \?[\s\S]*\)/)
  assert.equal((calls[0].sql.match(/r\.role_key = \?/g) || []).length, 1)
  assert.deepEqual(calls[0].params, ['trusted-app', 'PUBLISHED', 'strategist'])
})

test('archived opportunity drafts stay outside owner and detail APIs', async () => {
  const calls = []
  const mine = await listMine({
    async query(sql, params) {
      calls.push({ sql, params })
      return []
    },
  }, { appId: 'trusted-app', userId: id }, {})
  assert.deepEqual(mine, { items: [], nextCursor: undefined })
  assert.match(calls[0].sql, /o\.status <> 'ARCHIVED'/)

  await assert.rejects(() => getOpportunity({
    async one() {
      return {
        id,
        owner_user_id: id,
        status: 'ARCHIVED',
      }
    },
  }, {
    appId: 'trusted-app',
    userId: id,
    grants: [],
    profileRefSecret: 'profile-reference-secret',
  }, id), /NOT_FOUND/)
})

test('an archived opportunity cannot be reopened through the owner save API', async () => {
  const writes = []
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) {
        return { id, status: 'ACTIVE' }
      }
      if (sql.includes('FROM mip_idempotency_keys')) return null
      if (sql.includes('FROM mip_opportunities')) {
        return {
          owner_user_id: id,
          branch_id: null,
          status: 'ARCHIVED',
          version: 4,
        }
      }
      throw new Error(`unexpected query: ${sql}`)
    },
    async query(sql) {
      writes.push(sql)
      return { affectedRows: 1 }
    },
  }
  await assert.rejects(() => saveOpportunity({
    async transaction(work) { return work(tx) },
  }, {
    async assertSafe() {},
  }, {
    appId: 'trusted-app',
    userId: id,
  }, {
    idempotencyKey: 'archive-save-attempt',
    draft: {
      id,
      expectedVersion: 4,
      title: '合作机会',
      valueSummary: '资源',
      targetSummary: '伙伴',
      description: '说明',
      roleKeys: ['strategist'],
      industryTagIds: [],
      abilityTagIds: [],
      publish: false,
    },
  }), /FORBIDDEN/)
  assert.equal(writes.some(sql => sql.includes('UPDATE mip_opportunities')), false)
})

test('opportunity filters reject an industry grouping tag', async () => {
  const groupId = '21900000-0000-4000-8000-000000000001'
  await assert.rejects(
    () => assertSelectableTags({
      async query() {
        return [{ id: groupId, kind: 'INDUSTRY', selectable: 0, parent_id: null }]
      },
    }, 'trusted-app', [[groupId, 'INDUSTRY']]),
    /VALIDATION_FAILED/,
  )
})

test('cooperation server validation requires six explicit scores and role fields', () => {
  const scores = {
    business_development: 3,
    resource_integration: 4,
    capital_operation: 2,
    strategy_planning: 5,
    visual_design: 1,
    delivery_management: 3,
  }
  const value = normalizeCooperation({
    roleKey: 'strategist',
    positioning: '负责产品和创意策划',
    targetSummary: '完成三个产品策划',
    roleFields: { planning_types: ['产品'], methods: '用户研究', target: '三个项目' },
    abilityScores: scores,
    publish: true,
  })
  assert.deepEqual(value.abilityScores, scores)
  assert.throws(() => normalizeCooperation({ ...value, abilityScores: { ...scores, unknown: 1 } }), /VALIDATION_FAILED/)
})

test('super case server validation preserves a valid date range', () => {
  const value = normalizeCase({
    projectName: '品牌升级',
    summary: '完成品牌定位和视觉升级',
    startedOn: '2026-01-01',
    endedOn: '2026-03-01',
    responsibility: '负责策略和统筹',
    description: '项目完整说明',
    mediaAssetIds: [],
    publish: true,
  })
  assert.equal(value.endedOn, '2026-03-01')
  assert.throws(() => normalizeCase({ ...value, endedOn: '2025-01-01' }), /VALIDATION_FAILED/)
})

test('public content author DTOs contain only an opaque profile reference', async () => {
  const ownerUserId = '10000000-0000-4000-8000-000000000002'
  const caller = {
    appId: 'trusted-app',
    userId: null,
    grants: [],
    profileRefSecret: 'author-profile-ref-pepper-with-more-than-32-characters',
  }
  const opportunity = await getOpportunity({
    async one() {
      return {
        id,
        owner_user_id: ownerUserId,
        title: '合作机会',
        value_summary: '资源',
        target_summary: '伙伴',
        description: '说明',
        status: 'PUBLISHED',
        referral_count: 0,
        version: 1,
        published_at: '2026-08-24T00:00:00.000Z',
        nickname: '发布人',
      }
    },
    async query() { return [] },
  }, caller, id)
  const cooperation = await getCooperationCard({
    async one() {
      return {
        id,
        owner_user_id: ownerUserId,
        role_key: 'strategist',
        positioning: '策划',
        target_summary: '目标',
        role_fields_json: '{}',
        ability_scores_json: '{}',
        status: 'PUBLISHED',
        version: 1,
        published_at: '2026-08-24T00:00:00.000Z',
        nickname: '发布人',
      }
    },
  }, caller, id)
  const superCase = await getSuperCase({
    async one() {
      return {
        id,
        owner_user_id: ownerUserId,
        project_name: '案例',
        summary: '摘要',
        responsibility: '职责',
        description: '说明',
        status: 'PUBLISHED',
        version: 1,
        published_at: '2026-08-24T00:00:00.000Z',
        nickname: '发布人',
      }
    },
    async query() { return [] },
  }, caller, id)
  for (const item of [opportunity, cooperation, superCase]) {
    assert.match(item.author.profileRef, /^p1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{48}\.[A-Za-z0-9_-]{22}$/)
    assert.equal(JSON.stringify(item.author).includes(ownerUserId), false)
    assert.equal('userId' in item.author, false)
  }
})
