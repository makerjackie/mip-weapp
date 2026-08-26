'use strict'

const assert = require('node:assert/strict')
const { Buffer } = require('node:buffer')
const { describe, it } = require('node:test')

const { createAdminAccess } = require('../domain/access')
const { createAdminGrowth } = require('../domain/growth')
const { encodeCursor } = require('../domain/pagination')
const { createAdminService } = require('../domain/service')
const { AdminError } = require('../domain/validation')

const APP_ID = 'wx-growth-app'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const BRANCH_ID = '30000000-0000-4000-8000-000000000003'
const BENEFIT_ID = '40000000-0000-4000-8000-000000000004'
const LEVEL_ID = '50000000-0000-4000-8000-000000000005'
const RULE_ID = '60000000-0000-4000-8000-000000000006'
const BADGE_ID = '70000000-0000-4000-8000-000000000007'
const AWARD_ID = '80000000-0000-4000-8000-000000000008'
const ENTRY_ID = '90000000-0000-4000-8000-000000000009'
const caller = { appId: APP_ID, identityKey: 'wechat-identity' }

function repository(overrides = {}) {
  const repo = {
    user: {
      id: ACTOR_ID,
      status: 'ACTIVE',
      agreementsAccepted: true,
      phoneBound: true,
      profileComplete: true,
    },
    roleBindings: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
    userScope: { scopeType: 'BRANCH', scopeId: BRANCH_ID },
    calls: [],
    audits: [],
    resolveReads: 0,
    growthEntryReads: 0,
    mutationWrites: 0,
    badgeReads: 0,
    async resolveUser() {
      repo.resolveReads += 1
      return { ...repo.user }
    },
    async listRoleBindings() {
      return repo.roleBindings
    },
    async getUserScope(_appId, userId) {
      repo.calls.push({ type: 'userScope', userId })
      return userId === 'missing-user' ? null : repo.userScope
    },
    async listGrowthLevelsV2() {
      repo.calls.push({ type: 'listGrowthLevels' })
      return [{ id: LEVEL_ID, name: '基础会员', version: 3 }]
    },
    async listGrowthBenefits() {
      repo.calls.push({ type: 'listGrowthBenefits' })
      return [{ id: BENEFIT_ID, name: '活动权益', version: 2 }]
    },
    async listGrowthRules() {
      repo.calls.push({ type: 'listGrowthRules' })
      return [{ id: RULE_ID, name: '完成活动签到', version: 4 }]
    },
    async listGrowthEntries(...args) {
      repo.growthEntryReads += 1
      repo.calls.push({ type: 'listGrowthEntries', args })
      return {
        items: [{ id: ENTRY_ID, userId: USER_ID, metric: 'EXPERIENCE' }],
        nextCursor: 'next-page',
      }
    },
    async saveGrowthBenefit(input) {
      return mutationResult(repo, 'saveGrowthBenefit', input, input.benefitId || BENEFIT_ID)
    },
    async saveGrowthLevelV2(input) {
      return mutationResult(repo, 'saveGrowthLevel', input, input.levelId || LEVEL_ID)
    },
    async saveGrowthRule(input) {
      return mutationResult(repo, 'saveGrowthRule', input, input.ruleId)
    },
    async adjustGrowth(input) {
      mutationResult(repo, 'adjustGrowth', input, ENTRY_ID)
      return {
        id: ENTRY_ID,
        userId: input.userId,
        metric: input.metric,
        deltaValue: input.deltaValue,
        balanceAfter: 120,
        idempotent: true,
      }
    },
    async listBadges() {
      repo.badgeReads += 1
      return [badgeRow()]
    },
    async listBadgeAwards(_appId, filters) {
      repo.calls.push({ type: 'listBadgeAwards', filters })
      return [badgeAwardRow()]
    },
    async saveBadge(input) {
      return mutationResult(repo, 'saveBadge', input, input.badgeId || BADGE_ID)
    },
    async grantBadge(input) {
      mutationResult(repo, 'grantBadge', input, AWARD_ID)
      return { id: AWARD_ID, status: 'ACTIVE', version: 1, idempotent: false }
    },
    async revokeBadge(input) {
      mutationResult(repo, 'revokeBadge', input, input.awardId)
      return { id: input.awardId, status: 'REVOKED', version: input.expectedVersion + 1 }
    },
    async createExportTicket(input) {
      repo.calls.push({ type: 'createExport', input })
      return { ticketId: 'ticket-a', token: 'export-token', status: 'PENDING' }
    },
    ...overrides,
  }
  return repo
}

function mutationResult(repo, type, input, resourceId) {
  repo.mutationWrites += 1
  repo.calls.push({ type, input })
  repo.audits.push(input.audit(resourceId))
  return {
    id: resourceId,
    version: input.expectedVersion ? input.expectedVersion + 1 : 1,
  }
}

function growth(repo) {
  return createAdminGrowth({
    repository: repo,
    access: createAdminAccess({ repository: repo }),
  })
}

function benefitDraft(overrides = {}) {
  return {
    name: '活动权益',
    description: '会员活动优先报名',
    sortOrder: 20,
    status: 'ACTIVE',
    ...overrides,
  }
}

function levelDraft(overrides = {}) {
  return {
    levelKey: 'member_basic',
    name: '基础会员',
    minimumExperience: 0,
    displayBadge: '基础',
    sortOrder: 10,
    benefitIds: [BENEFIT_ID],
    status: 'ACTIVE',
    ...overrides,
  }
}

function ruleDraft(overrides = {}) {
  return {
    ruleKey: 'event_attended',
    name: '完成活动签到',
    metric: 'EXPERIENCE',
    deltaValue: 100,
    dailyLimitValue: 300,
    sourceEventType: 'event.checked_in',
    status: 'ACTIVE',
    ...overrides,
  }
}

function badgeDraft(overrides = {}) {
  return {
    key: 'event_participant',
    name: '活动参与',
    description: '完成活动签到',
    iconName: 'calendar-check',
    imageUrl: 'https://example.com/badge.png',
    placeholderShape: 'DIAMOND',
    sortOrder: 30,
    status: 'ACTIVE',
    ...overrides,
  }
}

function badgeRow(overrides = {}) {
  return {
    id: BADGE_ID,
    key: 'event_participant',
    name: '活动参与',
    description: '完成活动签到',
    iconName: 'calendar-check',
    imageUrl: 'https://example.com/badge.png',
    placeholderShape: 'DIAMOND',
    sortOrder: 30,
    status: 'ACTIVE',
    version: 6,
    createdAt: '2030-08-01T00:00:00.000Z',
    updatedAt: '2030-08-24T00:00:00.000Z',
    createdByUserId: 'private-user',
    ...overrides,
  }
}

function badgeAwardRow(overrides = {}) {
  return {
    id: AWARD_ID,
    userId: USER_ID,
    nickname: '会员用户',
    badgeId: BADGE_ID,
    badgeName: '活动参与',
    status: 'ACTIVE',
    awardReason: '完成活动参与记录',
    awardedAt: '2030-08-20T00:00:00.000Z',
    revokeReason: '',
    revokedAt: null,
    equipped: true,
    version: 5,
    phoneCiphertext: Buffer.from('private-phone'),
    identityKey: 'private-identity',
    awardedByUserId: 'private-operator',
    ...overrides,
  }
}

function lastCall(repo, type) {
  return repo.calls.findLast(call => call.type === type)
}

describe('admin growth deep module', () => {
  it('exposes only growth, badge, and growth export operations', () => {
    const api = createAdminGrowth({ repository: {}, access: {} })
    assert.deepEqual(Object.keys(api).sort(), [
      'adjustGrowth',
      'grantBadge',
      'listBadgeAwards',
      'listBadges',
      'listGrowthBenefits',
      'listGrowthEntries',
      'listGrowthLevels',
      'listGrowthRules',
      'normalizeExportFilters',
      'revokeBadge',
      'saveBadge',
      'saveGrowthBenefit',
      'saveGrowthLevel',
      'saveGrowthRule',
    ])
  })

  it('reloads full-access and current roles before every request', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }]
    const service = growth(repo)

    await service.listGrowthLevels({
      ...caller,
      roles: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
    })
    repo.roleBindings = [{ roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: 'event-a' }]
    await assert.rejects(
      () => service.listGrowthLevels(caller),
      error => error?.code === 'FORBIDDEN',
    )
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }]
    repo.user.agreementsAccepted = false
    await assert.rejects(
      () => service.listGrowthLevels(caller),
      error => error?.message === 'AGREEMENT_REQUIRED',
    )

    assert.equal(repo.resolveReads, 3)
    assert.equal(repo.calls.filter(call => call.type === 'listGrowthLevels').length, 1)
  })

  it('normalizes filters and cursor once for scoped lists and exports', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }]
    const service = growth(repo)
    const cursor = encodeCursor({ createdAt: '2030-08-20T00:00:00.000Z', id: ENTRY_ID })
    const filters = {
      userId: ` ${USER_ID} `,
      metric: 'EXPERIENCE',
      sourceEventType: ' event.checked_in ',
      createdFrom: '2030-08-01T00:00:00.000Z',
      createdTo: '2030-08-24T23:59:59.999Z',
    }

    const page = await service.listGrowthEntries(caller, { filters, cursor, limit: 500 })
    const call = lastCall(repo, 'listGrowthEntries')
    assert.equal(page.nextCursor, 'next-page')
    assert.deepEqual(call.args, [
      APP_ID,
      { platform: false, branchIds: [BRANCH_ID], eventIds: [] },
      {
        userId: USER_ID,
        metric: 'EXPERIENCE',
        sourceEventType: 'event.checked_in',
        createdFrom: '2030-08-01 00:00:00.000',
        createdTo: '2030-08-24 23:59:59.999',
      },
      50,
      { v: 1, createdAt: '2030-08-20T00:00:00.000Z', id: ENTRY_ID },
    ])
    assert.deepEqual(service.normalizeExportFilters(filters), call.args[2])

    await assert.rejects(
      () => service.listGrowthEntries(caller, { filters: {
        createdFrom: '2030-08-25T00:00:00.000Z',
        createdTo: '2030-08-24T00:00:00.000Z',
      } }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    assert.equal(repo.growthEntryReads, 1)
    assert.throws(
      () => service.normalizeExportFilters({ metric: 'CLIENT_TRUSTED_VALUE' }),
      error => error?.code === 'VALIDATION_FAILED',
    )
  })

  it('resolves the target user scope on the server before adjustment authorization', async () => {
    const repo = repository()
    const service = growth(repo)
    const result = await service.adjustGrowth(caller, {
      userId: USER_ID,
      metric: 'EXPERIENCE',
      deltaValue: 25,
      reason: ' 补录活动签到 ',
      idempotencyKey: 'growth-adjustment-20300825',
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    const call = lastCall(repo, 'adjustGrowth')

    assert.equal(result.idempotent, true)
    assert.deepEqual(repo.calls.slice(-2).map(item => item.type), ['userScope', 'adjustGrowth'])
    assert.deepEqual(call.input.authorizedScope, { scopeType: 'BRANCH', scopeId: BRANCH_ID })
    assert.deepEqual(call.input.authorization, {
      capability: 'growth.adjust',
      effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
    })
    assert.equal(call.input.reason, '补录活动签到')
    assert.equal(call.input.idempotencyKey, 'growth-adjustment-20300825')
    assert.deepEqual(repo.audits.at(-1), {
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'BRANCH',
      scopeId: BRANCH_ID,
      action: 'admin.growth.adjust',
      resourceType: 'GROWTH_ENTRY',
      resourceId: ENTRY_ID,
      effectiveRole: 'PLATFORM_OWNER',
      metadata: {
        userId: USER_ID,
        metric: 'EXPERIENCE',
        deltaValue: 25,
        reasonLength: 6,
      },
    })

    const writes = repo.mutationWrites
    repo.roleBindings = [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }]
    await assert.rejects(
      () => service.adjustGrowth(caller, {
        userId: USER_ID,
        metric: 'EXPERIENCE',
        deltaValue: 1,
        reason: '补录',
        idempotencyKey: 'forbidden-adjustment',
      }),
      error => error?.code === 'FORBIDDEN',
    )
    await assert.rejects(
      () => service.adjustGrowth(caller, {
        userId: 'missing-user',
        metric: 'EXPERIENCE',
        deltaValue: 1,
        reason: '补录',
        idempotencyKey: 'missing-user-adjustment',
      }),
      error => error?.code === 'NOT_FOUND',
    )
    assert.equal(repo.mutationWrites, writes)
  })

  it('keeps configuration and badge management at platform scope', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }]
    const service = growth(repo)

    await service.listGrowthBenefits(caller)
    await assert.rejects(
      () => service.saveGrowthBenefit(caller, { draft: benefitDraft() }),
      error => error?.code === 'FORBIDDEN',
    )
    await assert.rejects(
      () => service.listBadges(caller),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(repo.mutationWrites, 0)
    assert.equal(repo.badgeReads, 0)

    repo.roleBindings = [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }]
    await service.saveGrowthBenefit(caller, { draft: benefitDraft() })
    await service.listBadges(caller)
    assert.equal(repo.mutationWrites, 1)
    assert.equal(repo.badgeReads, 1)
  })

  it('normalizes all mutation inputs and builds complete audit metadata', async () => {
    const repo = repository()
    const service = growth(repo)

    await service.saveGrowthBenefit(caller, { draft: benefitDraft() })
    await service.saveGrowthLevel(caller, { draft: levelDraft() })
    await service.saveBadge(caller, { draft: badgeDraft() })
    await service.saveGrowthBenefit(caller, {
      benefitId: BENEFIT_ID,
      expectedVersion: 2,
      draft: benefitDraft(),
    })
    await service.saveGrowthLevel(caller, {
      levelId: LEVEL_ID,
      expectedVersion: 3,
      draft: levelDraft({ benefitIds: [BENEFIT_ID, BENEFIT_ID] }),
    })
    await service.saveGrowthRule(caller, {
      ruleId: RULE_ID,
      expectedVersion: 4,
      draft: ruleDraft(),
    })
    await service.saveBadge(caller, {
      badgeId: BADGE_ID,
      expectedVersion: 6,
      draft: badgeDraft(),
    })
    await service.grantBadge(caller, {
      userId: USER_ID,
      badgeId: BADGE_ID,
      reason: ' 完成活动参与记录 ',
    })
    await service.revokeBadge(caller, {
      awardId: AWARD_ID,
      expectedVersion: 5,
      reason: ' 信息复核 ',
    })

    assert.equal(lastCall(repo, 'saveGrowthBenefit').input.expectedVersion, 2)
    assert.deepEqual(lastCall(repo, 'saveGrowthLevel').input.draft.benefitIds, [BENEFIT_ID])
    assert.equal(lastCall(repo, 'saveGrowthRule').input.draft.dailyLimitValue, 300)
    assert.equal(lastCall(repo, 'saveBadge').input.expectedVersion, 6)
    assert.equal(lastCall(repo, 'grantBadge').input.reason, '完成活动参与记录')
    assert.equal(lastCall(repo, 'revokeBadge').input.expectedVersion, 5)
    assert.equal(repo.audits.every(item => item.appId === APP_ID
      && item.actorUserId === ACTOR_ID
      && item.scopeType === 'PLATFORM'
      && item.scopeId === null
      && item.effectiveRole === 'PLATFORM_OWNER'), true)
    assert.deepEqual(repo.audits.map(item => ({
      action: item.action,
      resourceType: item.resourceType,
      resourceId: item.resourceId,
      metadata: item.metadata,
    })), [
      {
        action: 'admin.growth.benefit.create',
        resourceType: 'GROWTH_BENEFIT',
        resourceId: BENEFIT_ID,
        metadata: { status: 'ACTIVE', sortOrder: 20 },
      },
      {
        action: 'admin.growth.level.create',
        resourceType: 'GROWTH_LEVEL',
        resourceId: LEVEL_ID,
        metadata: { status: 'ACTIVE', minimumExperience: 0 },
      },
      {
        action: 'admin.badge.create',
        resourceType: 'BADGE',
        resourceId: BADGE_ID,
        metadata: { status: 'ACTIVE', sortOrder: 30 },
      },
      {
        action: 'admin.growth.benefit.update',
        resourceType: 'GROWTH_BENEFIT',
        resourceId: BENEFIT_ID,
        metadata: { status: 'ACTIVE', sortOrder: 20 },
      },
      {
        action: 'admin.growth.level.update',
        resourceType: 'GROWTH_LEVEL',
        resourceId: LEVEL_ID,
        metadata: { status: 'ACTIVE', minimumExperience: 0 },
      },
      {
        action: 'admin.growth.rule.update',
        resourceType: 'GROWTH_RULE',
        resourceId: RULE_ID,
        metadata: {
          metric: 'EXPERIENCE',
          deltaValue: 100,
          status: 'ACTIVE',
          scopeType: 'PLATFORM',
          scopeId: null,
          effectiveFrom: null,
          effectiveTo: null,
        },
      },
      {
        action: 'admin.badge.update',
        resourceType: 'BADGE',
        resourceId: BADGE_ID,
        metadata: { status: 'ACTIVE', sortOrder: 30 },
      },
      {
        action: 'admin.badge.grant',
        resourceType: 'USER_BADGE',
        resourceId: AWARD_ID,
        metadata: { userId: USER_ID, badgeId: BADGE_ID, reasonLength: 8 },
      },
      {
        action: 'admin.badge.revoke',
        resourceType: 'USER_BADGE',
        resourceId: AWARD_ID,
        metadata: { reasonLength: 4, expectedVersion: 5 },
      },
    ])
    assert.equal(lastCall(repo, 'saveGrowthLevel').input.authorization.capability, 'growth.configure')
    assert.equal(lastCall(repo, 'revokeBadge').input.authorization.capability, 'badges.manage')
  })

  it('preserves repository conflict and idempotency results without rewriting errors', async () => {
    const conflict = new AdminError('CONFLICT', '记录已被更新')
    const repo = repository({
      async saveGrowthLevelV2() {
        throw conflict
      },
      async grantBadge(input) {
        repo.calls.push({ type: 'grantBadge', input })
        return { id: AWARD_ID, status: 'ACTIVE', version: 5, idempotent: true }
      },
    })
    const service = growth(repo)

    await assert.rejects(
      () => service.saveGrowthLevel(caller, {
        levelId: LEVEL_ID,
        expectedVersion: 3,
        draft: levelDraft(),
      }),
      error => error === conflict,
    )
    assert.deepEqual(await service.grantBadge(caller, {
      userId: USER_ID,
      badgeId: BADGE_ID,
      reason: '重复请求',
    }), {
      id: AWARD_ID,
      status: 'ACTIVE',
      version: 5,
      idempotent: true,
    })
  })

  it('projects badge DTOs without private operator or identity facts and retains versions', async () => {
    const repo = repository()
    const service = growth(repo)
    const badges = await service.listBadges(caller)
    const awards = await service.listBadgeAwards(caller, {
      status: 'ACTIVE',
      query: ' 会员用户 ',
    })

    assert.deepEqual(Object.keys(badges.items[0]), [
      'id',
      'key',
      'name',
      'description',
      'iconName',
      'imageUrl',
      'placeholderShape',
      'sortOrder',
      'status',
      'version',
      'createdAt',
      'updatedAt',
    ])
    assert.equal(badges.items[0].version, 6)
    assert.deepEqual(awards.items[0], {
      id: AWARD_ID,
      userId: USER_ID,
      nickname: '会员用户',
      badgeId: BADGE_ID,
      badgeName: '活动参与',
      status: 'ACTIVE',
      awardReason: '完成活动参与记录',
      awardedAt: '2030-08-20T00:00:00.000Z',
      revokeReason: '',
      revokedAt: null,
      equipped: true,
      version: 5,
    })
    assert.deepEqual(lastCall(repo, 'listBadgeAwards').filters, {
      status: 'ACTIVE',
      query: '会员用户',
    })
  })

  it('composes the module into the service and reuses its filter seam for exports', async () => {
    const repo = repository()
    const service = createAdminService({ repository: repo, phoneEncryptionKey: '' })

    assert.deepEqual(await service.listGrowthLevels(caller), {
      items: [{ id: LEVEL_ID, name: '基础会员', version: 3 }],
    })
    await service.createExport(caller, {
      exportType: 'GROWTH_ENTRIES',
      filters: {
        userId: USER_ID,
        metric: 'CONTRIBUTION',
        sourceEventType: ' case.published ',
        createdFrom: '2030-08-01T00:00:00.000Z',
        createdTo: '2030-08-31T23:59:59.999Z',
      },
    })
    assert.deepEqual(lastCall(repo, 'createExport').input.filters, {
      userId: USER_ID,
      metric: 'CONTRIBUTION',
      sourceEventType: 'case.published',
      createdFrom: '2030-08-01 00:00:00.000',
      createdTo: '2030-08-31 23:59:59.999',
    })
  })
})
