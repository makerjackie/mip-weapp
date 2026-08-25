'use strict'

const assert = require('node:assert/strict')
const { Buffer } = require('node:buffer')
const { describe, it } = require('node:test')

const { createAdminAccess } = require('../domain/access')
const { createAdminOpportunities } = require('../domain/opportunities')
const { AdminError } = require('../domain/validation')
const { readProfileRef } = require('../lib/profile-ref')

const APP_ID = 'wx-opportunities-app'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const OWNER_ID = '20000000-0000-4000-8000-000000000002'
const AUTHOR_ID = '30000000-0000-4000-8000-000000000003'
const REPORTER_ID = '40000000-0000-4000-8000-000000000004'
const OPPORTUNITY_ID = '50000000-0000-4000-8000-000000000005'
const MISSING_OPPORTUNITY_ID = '50000000-0000-4000-8000-000000000099'
const COMMENT_ID = '60000000-0000-4000-8000-000000000006'
const REPORT_ID = '70000000-0000-4000-8000-000000000007'
const BRANCH_A = '80000000-0000-4000-8000-000000000008'
const BRANCH_B = '90000000-0000-4000-8000-000000000009'
const PROFILE_REF_SECRET = 'opportunity-profile-reference-secret-2026'
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
    roleBindings: [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }],
    opportunityScope: {
      scopeType: 'BRANCH',
      scopeId: BRANCH_A,
      branchId: BRANCH_A,
      status: 'DRAFT',
      version: 4,
    },
    calls: [],
    resolveReads: 0,
    listReads: 0,
    detailReads: 0,
    commentReads: 0,
    archiveReads: 0,
    async resolveUser() {
      repo.resolveReads += 1
      return { ...repo.user }
    },
    async listRoleBindings() {
      return repo.roleBindings
    },
    async listOpportunities(appId, visibility, filters, pageLimit, cursor) {
      repo.listReads += 1
      repo.calls.push({ type: 'list', appId, visibility, filters, pageLimit, cursor })
      return { items: [opportunityRow()], nextCursor: 'next-page' }
    },
    async getOpportunityScope(_appId, opportunityId) {
      repo.calls.push({ type: 'scope', opportunityId })
      return opportunityId === MISSING_OPPORTUNITY_ID ? null : repo.opportunityScope
    },
    async getOpportunityDetail(_appId, opportunityId) {
      repo.detailReads += 1
      return opportunityRow({ id: opportunityId, ownerUserId: OWNER_ID })
    },
    async getOpportunityEditorOptions(appId, visibility) {
      repo.calls.push({ type: 'options', appId, visibility })
      return { branches: [], owners: [], cities: [], tags: [], roles: [] }
    },
    async saveOpportunity(input) {
      repo.calls.push({ type: 'save', input })
      return opportunityRow({
        id: input.opportunityId || OPPORTUNITY_ID,
        scopeType: input.draft.scopeType,
        branchId: input.draft.branchId,
        version: input.opportunityId ? input.expectedVersion + 1 : 1,
      })
    },
    async publishOpportunity(input) {
      repo.calls.push({ type: 'publish', input })
      return { id: input.opportunityId, status: 'PUBLISHED', version: input.expectedVersion + 1 }
    },
    async endOpportunity(input) {
      repo.calls.push({ type: 'end', input })
      return { id: input.opportunityId, status: 'ENDED', version: input.expectedVersion + 1 }
    },
    async unpublishOpportunity(input) {
      repo.calls.push({ type: 'unpublish', input })
      return { id: input.opportunityId, status: 'UNPUBLISHED', version: input.expectedVersion + 1 }
    },
    async getOpportunityArchiveScope(_appId, opportunityId) {
      repo.archiveReads += 1
      return opportunityId === MISSING_OPPORTUNITY_ID ? null : repo.opportunityScope
    },
    async archiveOpportunity(input) {
      repo.calls.push({ type: 'archive', input })
      return { id: input.opportunityId, status: 'ARCHIVED', version: input.expectedVersion + 1 }
    },
    async getMatchingAdminState(appId, visibility, input) {
      repo.calls.push({ type: 'matchingState', appId, visibility, input })
      return { settings: matchingSettings(), requests: [] }
    },
    async saveMatchingSettings(input) {
      repo.calls.push({ type: 'matchingSave', input })
      return { ...input.settings, version: input.expectedVersion + 1 }
    },
    async getMatchingRecalculationTarget(_appId, opportunityId) {
      if (opportunityId === MISSING_OPPORTUNITY_ID) {
        return null
      }
      return matchingTarget()
    },
    async authorizeMatchingRecalculation(input) {
      repo.calls.push({ type: 'matchingAuthorize', input })
      return matchingTarget()
    },
    async getOpportunityCommentAdminState() {
      repo.commentReads += 1
      return commentState()
    },
    async saveOpportunityCommentSettings(input) {
      repo.calls.push({ type: 'commentSettings', input })
      return { ...input.settings, version: input.expectedVersion + 1 }
    },
    async moderateOpportunityComment(input) {
      repo.calls.push({ type: 'commentModerate', input })
      return { id: input.commentId, status: input.action === 'PUBLISH' ? 'PUBLISHED' : 'HIDDEN', version: input.expectedVersion + 1 }
    },
    async closeOpportunityCommentReport(input) {
      repo.calls.push({ type: 'reportClose', input })
      return { id: input.reportId, status: input.decision, version: input.expectedVersion + 1 }
    },
    ...overrides,
  }
  return repo
}

function opportunities(repo, ports = {}) {
  return createAdminOpportunities({
    repository: repo,
    access: createAdminAccess({ repository: repo }),
    profileRefSecret: PROFILE_REF_SECRET,
    ...ports,
  })
}

function opportunityDraft(overrides = {}) {
  return {
    ownerUserId: OWNER_ID,
    scopeType: 'BRANCH',
    branchId: BRANCH_A,
    title: '寻找品牌视觉合作伙伴',
    valueSummary: '共同完成品牌升级',
    targetSummary: '视觉设计与品牌经验',
    description: '项目计划在两个月内完成。',
    cityTagId: null,
    roleKeys: ['visual_designer'],
    tagIds: [],
    deadlineAt: '2030-10-01T00:00:00.000Z',
    ...overrides,
  }
}

function opportunityRow(overrides = {}) {
  return {
    id: OPPORTUNITY_ID,
    title: '寻找品牌视觉合作伙伴',
    valueSummary: '共同完成品牌升级',
    targetSummary: '视觉设计与品牌经验',
    description: '项目计划在两个月内完成。',
    scopeType: 'BRANCH',
    branchId: BRANCH_A,
    branchName: '广州分会',
    cityName: '广州',
    ownerNickname: '发布人',
    status: 'DRAFT',
    contentSafetyStatus: 'APPROVED',
    referralCount: 0,
    version: 4,
    updatedAt: '2030-08-25T00:00:00.000Z',
    ...overrides,
  }
}

function matchingSettings(overrides = {}) {
  return {
    scopeKey: `BRANCH:${BRANCH_A}`,
    scopeType: 'BRANCH',
    scopeId: BRANCH_A,
    talentMinScore: 35,
    projectMinScore: 30,
    maximumCandidates: 100,
    externalProviderEnabled: false,
    version: 2,
    ...overrides,
  }
}

function matchingTarget(overrides = {}) {
  return {
    id: OPPORTUNITY_ID,
    owner_user_id: OWNER_ID,
    branch_id: BRANCH_A,
    status: 'PUBLISHED',
    version: 7,
    ...overrides,
  }
}

function commentState() {
  return {
    settings: {
      commentsEnabled: true,
      reviewsEnabled: true,
      callsEnabled: false,
      moderationMode: 'REVIEW',
      version: 3,
    },
    comments: [{
      id: COMMENT_ID,
      authorUserId: AUTHOR_ID,
      authorNickname: '评论用户',
      type: 'REVIEW',
      body: '合作过程清晰。',
      rating: 5,
      participant: true,
      status: 'PUBLISHED',
      callCount: 2,
      version: 3,
      createdAt: '2030-08-20T00:00:00.000Z',
      editedAt: null,
      phoneCiphertext: Buffer.from('private'),
      openId: 'private-openid',
      internalScore: 99,
    }],
    reports: [{
      id: REPORT_ID,
      commentId: COMMENT_ID,
      reporterUserId: REPORTER_ID,
      reporterNickname: '举报用户',
      category: 'SPAM',
      description: '重复内容',
      status: 'PENDING',
      version: 2,
      createdAt: '2030-08-21T00:00:00.000Z',
      phoneNumber: '18800000000',
      identityKey: 'private-identity',
    }],
  }
}

describe('admin opportunities deep module', () => {
  it('exposes only opportunity administration and its export filter seam', () => {
    const api = createAdminOpportunities({ repository: {}, access: {} })
    assert.deepEqual(Object.keys(api).sort(), [
      'archiveOpportunity',
      'closeOpportunityCommentReport',
      'endOpportunity',
      'getMatchingAdminState',
      'getOpportunity',
      'getOpportunityCommentAdminState',
      'getOpportunityEditorOptions',
      'listOpportunities',
      'moderateOpportunityComment',
      'normalizeExportFilters',
      'publishOpportunity',
      'recalculateOpportunityMatching',
      'saveMatchingSettings',
      'saveOpportunity',
      'saveOpportunityCommentSettings',
      'unpublishOpportunity',
    ])
  })

  it('reloads current user, agreement, and role facts before every request', async () => {
    const repo = repository()
    const service = opportunities(repo)

    await service.listOpportunities({
      ...caller,
      roles: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
    })
    repo.roleBindings = [{ roleKey: 'EVENT_MANAGER', scopeType: 'EVENT', scopeId: 'event-a' }]
    await assert.rejects(
      () => service.listOpportunities(caller),
      error => error?.code === 'FORBIDDEN',
    )
    repo.roleBindings = [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }]
    repo.user.agreementsAccepted = false
    await assert.rejects(
      () => service.listOpportunities(caller),
      error => error?.message === 'AGREEMENT_REQUIRED',
    )

    assert.equal(repo.resolveReads, 3)
    assert.equal(repo.listReads, 1)
  })

  it('uses capability visibility and resolves missing resources before exact scope authorization', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = opportunities(repo)

    const page = await service.listOpportunities(caller, { filters: {
      query: ' 品牌 ',
      ownerQuery: ' 发布人 ',
      cityQuery: ' 广州 ',
      status: 'published',
      updatedFrom: '2030-08-01T00:00:00.000Z',
      updatedTo: '2030-08-31T23:59:59.999Z',
    } })
    assert.equal(page.nextCursor, 'next-page')
    assert.deepEqual(repo.calls.find(call => call.type === 'list').visibility, {
      platform: false,
      branchIds: [BRANCH_A],
      eventIds: [],
    })
    await service.getOpportunityEditorOptions(caller)
    assert.deepEqual(repo.calls.find(call => call.type === 'options'), {
      type: 'options',
      appId: APP_ID,
      visibility: { platform: false, branchIds: [BRANCH_A], eventIds: [] },
    })
    assert.deepEqual(repo.calls.find(call => call.type === 'list').filters, {
      query: '品牌',
      ownerQuery: '发布人',
      cityQuery: '广州',
      status: 'PUBLISHED',
      updatedFrom: '2030-08-01 00:00:00.000',
      updatedTo: '2030-08-31 23:59:59.999',
      deadlineFrom: '',
      deadlineTo: '',
    })

    repo.opportunityScope = { scopeType: 'BRANCH', scopeId: BRANCH_B, branchId: BRANCH_B }
    await assert.rejects(
      () => service.getOpportunity(caller, { opportunityId: OPPORTUNITY_ID }),
      error => error?.code === 'FORBIDDEN',
    )
    repo.roleBindings = [{ roleKey: 'EVENT_MANAGER', scopeType: 'EVENT', scopeId: 'event-a' }]
    await assert.rejects(
      () => service.getOpportunity(caller, { opportunityId: MISSING_OPPORTUNITY_ID }),
      error => error?.code === 'NOT_FOUND',
    )
    assert.equal(repo.detailReads, 0)

    assert.throws(
      () => service.normalizeExportFilters({
        deadlineFrom: '2030-10-02T00:00:00.000Z',
        deadlineTo: '2030-10-01T00:00:00.000Z',
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
  })

  it('authorizes both existing and requested scopes before safety checks and persistence', async () => {
    let safetyReads = 0
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = opportunities(repo, {
      async contentSafety() {
        safetyReads += 1
        return 'PASSED'
      },
    })

    await assert.rejects(
      () => service.saveOpportunity(caller, {
        opportunityId: MISSING_OPPORTUNITY_ID,
        expectedVersion: 4,
        draft: null,
      }),
      error => error?.code === 'NOT_FOUND',
    )
    await assert.rejects(
      () => service.saveOpportunity(caller, {
        opportunityId: OPPORTUNITY_ID,
        expectedVersion: 4,
        draft: opportunityDraft({ branchId: BRANCH_B }),
      }),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(safetyReads, 0)
    assert.equal(repo.calls.filter(call => call.type === 'save').length, 0)

    const saved = await service.saveOpportunity(caller, {
      opportunityId: OPPORTUNITY_ID,
      expectedVersion: 4,
      draft: opportunityDraft(),
    })
    assert.equal(saved.version, 5)
    assert.equal(safetyReads, 1)
    const write = repo.calls.find(call => call.type === 'save').input
    assert.equal(write.contentSafetyStatus, 'APPROVED')
    assert.equal(write.expectedVersion, 4)
    assert.deepEqual(write.authorizedScope, {
      scopeType: 'BRANCH',
      scopeId: BRANCH_A,
      branchId: BRANCH_A,
      status: 'DRAFT',
      version: 4,
    })
    assert.deepEqual(write.authorization, {
      capability: 'opportunities.moderate',
      effectiveGrant: { roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A },
    })
    assert.equal(write.audit(OPPORTUNITY_ID).action, 'admin.opportunities.update')

    repo.saveOpportunity = async () => {
      throw new AdminError('CONFLICT', '记录状态已变化')
    }
    await assert.rejects(
      () => service.saveOpportunity(caller, {
        opportunityId: OPPORTUNITY_ID,
        expectedVersion: 4,
        draft: opportunityDraft(),
      }),
      error => error?.code === 'CONFLICT',
    )
  })

  it('preserves lifecycle version, reason, scoped audit, and platform-only archive contracts', async () => {
    const repo = repository()
    const service = opportunities(repo)

    for (const [method, type, action, status] of [
      ['publishOpportunity', 'publish', 'admin.opportunities.publish', 'PUBLISHED'],
      ['endOpportunity', 'end', 'admin.opportunities.end', 'ENDED'],
    ]) {
      const result = await service[method](caller, {
        opportunityId: OPPORTUNITY_ID,
        expectedVersion: 4,
      })
      assert.equal(result.status, status)
      const input = repo.calls.find(call => call.type === type).input
      assert.equal(input.expectedVersion, 4)
      assert.equal(input.audit.action, action)
      assert.deepEqual(input.audit.metadata, { expectedVersion: 4 })
    }

    await service.unpublishOpportunity(caller, {
      opportunityId: OPPORTUNITY_ID,
      expectedVersion: 4,
      reason: ' 内容需要调整 ',
    })
    const unpublish = repo.calls.find(call => call.type === 'unpublish').input
    assert.equal(unpublish.reason, '内容需要调整')
    assert.deepEqual(unpublish.audit.metadata, { reasonLength: 6, expectedVersion: 4 })

    const archived = await service.archiveOpportunity(caller, {
      opportunityId: OPPORTUNITY_ID,
      expectedVersion: 4,
      reason: ' 不再使用 ',
    })
    assert.equal(archived.status, 'ARCHIVED')
    const archive = repo.calls.find(call => call.type === 'archive').input
    assert.equal(archive.reason, '不再使用')
    assert.equal(archive.authorization.capability, 'opportunities.archive')
    assert.equal(archive.effectiveRole, 'PLATFORM_OPERATIONS')

    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    await assert.rejects(
      () => service.archiveOpportunity(caller, {
        opportunityId: MISSING_OPPORTUNITY_ID,
        expectedVersion: 4,
        reason: '不再使用',
      }),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(repo.archiveReads, 1)
  })

  it('keeps matching settings scoped and dispatches only committed server facts', async () => {
    let releaseAuthorization
    let authorizationStarted
    const started = new Promise((resolve) => {
      authorizationStarted = resolve
    })
    const authorizationGate = new Promise((resolve) => {
      releaseAuthorization = resolve
    })
    const dispatches = []
    const repo = repository({
      async authorizeMatchingRecalculation(input) {
        repo.calls.push({ type: 'matchingAuthorize', input })
        authorizationStarted()
        return authorizationGate
      },
    })
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = opportunities(repo, {
      async dispatchMatchingRecalculation(input) {
        dispatches.push(input)
        return { requestId: 'matching-request-a', status: 'COMPLETED' }
      },
    })

    await service.getMatchingAdminState(caller, { branchId: BRANCH_A })
    const stateCall = repo.calls.find(call => call.type === 'matchingState')
    assert.deepEqual(stateCall.visibility, {
      platform: false,
      branchIds: [BRANCH_A],
      eventIds: [],
    })
    await service.saveMatchingSettings(caller, {
      branchId: BRANCH_A,
      expectedVersion: 2,
      settings: {
        talentMinScore: 40,
        projectMinScore: 45,
        maximumCandidates: 80,
        externalProviderEnabled: true,
      },
    })
    const settingsWrite = repo.calls.find(call => call.type === 'matchingSave').input
    assert.equal(settingsWrite.audit(3).action, 'admin.matching.settings.update')
    assert.equal(settingsWrite.authorization.capability, 'opportunities.moderate')
    await assert.rejects(
      () => service.getMatchingAdminState(caller, { branchId: BRANCH_B }),
      error => error?.code === 'FORBIDDEN',
    )
    await assert.rejects(
      () => service.saveMatchingSettings(caller, {
        branchId: BRANCH_B,
        expectedVersion: 2,
        settings: {
          talentMinScore: 40,
          projectMinScore: 45,
          maximumCandidates: 80,
          externalProviderEnabled: true,
        },
      }),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(repo.calls.filter(call => call.type === 'matchingState').length, 1)
    assert.equal(repo.calls.filter(call => call.type === 'matchingSave').length, 1)

    const recalculation = service.recalculateOpportunityMatching(caller, {
      opportunityId: OPPORTUNITY_ID,
      idempotencyKey: ' matching-request-0001 ',
      requesterUserId: REPORTER_ID,
      sourceVersion: 999,
      status: 'ENDED',
      score: 100,
    })
    await started
    assert.equal(dispatches.length, 0)
    releaseAuthorization(matchingTarget({ owner_user_id: AUTHOR_ID, version: 8 }))
    assert.deepEqual(await recalculation, {
      requestId: 'matching-request-a',
      status: 'COMPLETED',
    })
    assert.deepEqual(dispatches, [{
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      requesterUserId: AUTHOR_ID,
      opportunityId: OPPORTUNITY_ID,
      sourceVersion: 8,
      idempotencyKey: 'matching-request-0001',
    }])
    const authorized = repo.calls.find(call => call.type === 'matchingAuthorize').input
    assert.equal(authorized.expectedVersion, 7)
    assert.equal(Object.hasOwn(authorized, 'status'), false)
    assert.equal(Object.hasOwn(authorized, 'score'), false)
  })

  it('preserves transaction authorization errors and maps only dispatch-port failures', async () => {
    let dispatches = 0
    const conflict = new AdminError('CONFLICT', '记录状态已变化')
    const repo = repository({
      async authorizeMatchingRecalculation() {
        throw conflict
      },
    })
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = opportunities(repo, {
      async dispatchMatchingRecalculation() {
        dispatches += 1
        throw new Error('MATCHING_DISPATCH_CONFIG_REQUIRED')
      },
    })

    await assert.rejects(
      () => service.recalculateOpportunityMatching(caller, {
        opportunityId: OPPORTUNITY_ID,
        idempotencyKey: 'matching-request-0002',
      }),
      error => error === conflict,
    )
    assert.equal(dispatches, 0)

    repo.authorizeMatchingRecalculation = async () => matchingTarget()
    await assert.rejects(
      () => service.recalculateOpportunityMatching(caller, {
        opportunityId: OPPORTUNITY_ID,
        idempotencyKey: 'matching-request-0002',
      }),
      error => error?.code === 'MATCHING_DISPATCH_CONFIG_REQUIRED'
        && error?.message === '机会撮合重算服务暂时不可用',
    )
    assert.equal(dispatches, 1)

    repo.getMatchingRecalculationTarget = async () => matchingTarget({ status: 'ENDED' })
    await assert.rejects(
      () => service.recalculateOpportunityMatching(caller, {
        opportunityId: OPPORTUNITY_ID,
        idempotencyKey: 'matching-request-0003',
      }),
      error => error?.code === 'INVALID_STATE',
    )
    assert.equal(dispatches, 1)
  })

  it('keeps comment/report DTO parity while replacing private user ids with app-bound refs', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = opportunities(repo)

    const state = await service.getOpportunityCommentAdminState(caller, {
      opportunityId: OPPORTUNITY_ID,
    })
    assert.deepEqual(state.settings, commentState().settings)
    assert.deepEqual(state.comments[0], {
      id: COMMENT_ID,
      authorNickname: '评论用户',
      type: 'REVIEW',
      body: '合作过程清晰。',
      rating: 5,
      participant: true,
      status: 'PUBLISHED',
      callCount: 2,
      version: 3,
      createdAt: '2030-08-20T00:00:00.000Z',
      editedAt: null,
      authorProfileRef: state.comments[0].authorProfileRef,
    })
    assert.deepEqual(state.reports[0], {
      id: REPORT_ID,
      commentId: COMMENT_ID,
      reporterNickname: '举报用户',
      category: 'SPAM',
      description: '重复内容',
      status: 'PENDING',
      version: 2,
      createdAt: '2030-08-21T00:00:00.000Z',
      reporterProfileRef: state.reports[0].reporterProfileRef,
    })
    assert.equal(readProfileRef(state.comments[0].authorProfileRef, APP_ID, PROFILE_REF_SECRET), AUTHOR_ID)
    assert.equal(readProfileRef(state.reports[0].reporterProfileRef, APP_ID, PROFILE_REF_SECRET), REPORTER_ID)
    for (const privateKey of [
      'authorUserId',
      'reporterUserId',
      'phoneCiphertext',
      'phoneNumber',
      'openId',
      'identityKey',
      'internalScore',
    ]) {
      assert.equal(JSON.stringify(state).includes(privateKey), false)
    }

    repo.opportunityScope = { scopeType: 'BRANCH', scopeId: BRANCH_B, branchId: BRANCH_B }
    await assert.rejects(
      () => service.getOpportunityCommentAdminState(caller, { opportunityId: OPPORTUNITY_ID }),
      error => error?.code === 'FORBIDDEN',
    )
    await assert.rejects(
      () => service.getOpportunityCommentAdminState(caller, {
        opportunityId: MISSING_OPPORTUNITY_ID,
      }),
      error => error?.code === 'NOT_FOUND',
    )
    assert.equal(repo.commentReads, 1)
  })

  it('keeps comment settings and moderation inside scoped versioned repository mutations', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = opportunities(repo)

    await service.saveOpportunityCommentSettings(caller, {
      opportunityId: OPPORTUNITY_ID,
      expectedVersion: 0,
      settings: {
        commentsEnabled: true,
        reviewsEnabled: false,
        callsEnabled: true,
        moderationMode: 'AUTO',
      },
    })
    const settings = repo.calls.find(call => call.type === 'commentSettings').input
    assert.equal(settings.authorization.capability, 'messages.manage')
    assert.deepEqual(settings.audit(1).metadata, { expectedVersion: 0, nextVersion: 1 })

    await service.moderateOpportunityComment(caller, {
      opportunityId: OPPORTUNITY_ID,
      commentId: COMMENT_ID,
      action: 'HIDE',
      reason: '包含无关内容',
      expectedVersion: 3,
    })
    const moderation = repo.calls.find(call => call.type === 'commentModerate').input
    assert.equal(moderation.audit(OPPORTUNITY_ID, 'HIDDEN').action, 'admin.opportunity_comments.hide')
    assert.throws(
      () => moderation.audit(MISSING_OPPORTUNITY_ID, 'HIDDEN'),
      error => error?.code === 'CONFLICT',
    )

    await service.closeOpportunityCommentReport(caller, {
      opportunityId: OPPORTUNITY_ID,
      reportId: REPORT_ID,
      decision: 'RESOLVED',
      reason: '确认重复内容',
      expectedVersion: 2,
    })
    const report = repo.calls.find(call => call.type === 'reportClose').input
    const reportAudit = report.audit(OPPORTUNITY_ID, COMMENT_ID, 'RESOLVED')
    assert.equal(reportAudit.action, 'admin.opportunity_comment_reports.close')
    assert.deepEqual(reportAudit.metadata, {
      opportunityId: OPPORTUNITY_ID,
      commentId: COMMENT_ID,
      status: 'RESOLVED',
      expectedVersion: 2,
      reasonLength: 6,
    })
    assert.throws(
      () => report.audit(MISSING_OPPORTUNITY_ID, COMMENT_ID, 'RESOLVED'),
      error => error?.code === 'CONFLICT',
    )

    repo.closeOpportunityCommentReport = async () => {
      throw new AdminError('CONFLICT', '记录状态已变化')
    }
    await assert.rejects(
      () => service.closeOpportunityCommentReport(caller, {
        opportunityId: OPPORTUNITY_ID,
        reportId: REPORT_ID,
        decision: 'DISMISSED',
        reason: '证据不足',
        expectedVersion: 2,
      }),
      error => error?.code === 'CONFLICT',
    )
  })
})
