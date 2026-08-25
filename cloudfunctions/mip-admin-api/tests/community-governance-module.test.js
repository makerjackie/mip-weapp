'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { createAdminAccess } = require('../domain/access')
const { CAPABILITIES } = require('../domain/capabilities')
const { createAdminCommunityGovernance } = require('../domain/community-governance')
const { createAdminService } = require('../domain/service')
const { AdminError } = require('../domain/validation')

const APP_ID = 'wx-community-governance'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const REPORT_ID = '20000000-0000-4000-8000-000000000002'
const BRANCH_ID = '30000000-0000-4000-8000-000000000003'
const caller = {
  appId: APP_ID,
  identityKey: 'wechat-identity',
  roles: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
  userId: 'forged-client-user',
}

function report(overrides = {}) {
  return {
    reportId: REPORT_ID,
    category: 'FRAUD',
    description: '疑似虚假交易信息',
    status: 'PENDING',
    version: 2,
    reporter: { nickname: '举报人', headline: '产品经理', cityName: '深圳' },
    target: { nickname: '被举报人', headline: '项目负责人', cityName: '广州' },
    resolutionReason: '',
    createdAt: '2030-08-24T08:00:00.000Z',
    updatedAt: '2030-08-24T08:00:00.000Z',
    reviewedAt: null,
    ...overrides,
  }
}

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
    calls: [],
    resolveReads: 0,
    listReads: 0,
    writes: 0,
    async resolveUser(input) {
      repo.resolveReads += 1
      repo.calls.push({ type: 'resolveUser', input })
      return { ...repo.user }
    },
    async listRoleBindings(appId, userId) {
      repo.calls.push({ type: 'listRoleBindings', appId, userId })
      return repo.roleBindings.map(binding => ({ ...binding }))
    },
    async listCommunityReports(appId, status, pageLimit) {
      repo.listReads += 1
      repo.calls.push({ type: 'listCommunityReports', appId, status, pageLimit })
      return [report()]
    },
    async claimCommunityReport(input) {
      repo.writes += 1
      repo.calls.push({ type: 'claimCommunityReport', input })
      return report({
        status: 'REVIEWING',
        version: input.expectedVersion + 1,
      })
    },
    async closeCommunityReport(input) {
      repo.writes += 1
      repo.calls.push({ type: 'closeCommunityReport', input })
      return report({
        status: input.outcome,
        version: input.expectedVersion + 1,
        resolutionReason: input.reason,
      })
    },
    ...overrides,
  }
  return repo
}

function communityGovernance(repo) {
  return createAdminCommunityGovernance({
    repository: repo,
    access: createAdminAccess({ repository: repo }),
  })
}

function lastCall(repo, type) {
  return repo.calls.findLast(call => call.type === type)
}

function mutationAuthorization() {
  return {
    capability: CAPABILITIES.COMMUNITY_REPORTS_MANAGE,
    effectiveGrant: {
      roleKey: 'PLATFORM_OPERATIONS',
      scopeType: 'PLATFORM',
      scopeId: null,
    },
  }
}

function audit(action, metadata) {
  return {
    appId: APP_ID,
    actorUserId: ACTOR_ID,
    scopeType: 'PLATFORM',
    scopeId: null,
    action,
    resourceType: 'COMMUNITY_REPORT',
    resourceId: REPORT_ID,
    effectiveRole: 'PLATFORM_OPERATIONS',
    metadata,
  }
}

describe('admin community governance deep module', () => {
  it('exposes only the report-review interface', () => {
    const module = createAdminCommunityGovernance({ repository: {}, access: {} })
    assert.deepEqual(Object.keys(module).sort(), [
      'claimCommunityReport',
      'closeCommunityReport',
      'listCommunityReports',
    ])
  })

  it('reloads full-access and current role facts for every request', async () => {
    const repo = repository()
    const module = communityGovernance(repo)

    await module.listCommunityReports(caller)
    repo.roleBindings = [{ roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null }]
    await assert.rejects(
      () => module.listCommunityReports(caller),
      error => error?.code === 'FORBIDDEN',
    )
    repo.roleBindings = [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }]
    repo.user.agreementsAccepted = false
    await assert.rejects(
      () => module.listCommunityReports(caller),
      error => error?.message === 'AGREEMENT_REQUIRED',
    )

    assert.equal(repo.resolveReads, 3)
    assert.equal(repo.listReads, 1)
    assert.equal(lastCall(repo, 'listRoleBindings').userId, ACTOR_ID)
  })

  it('normalizes list filters and keeps the stable non-cursor page DTO', async () => {
    const repo = repository()
    const module = communityGovernance(repo)

    const filtered = await module.listCommunityReports(caller, {
      status: ' reviewing ',
      limit: 500,
    })
    assert.deepEqual(filtered, { items: [report()], nextCursor: null })
    assert.deepEqual(lastCall(repo, 'listCommunityReports'), {
      type: 'listCommunityReports',
      appId: APP_ID,
      status: 'REVIEWING',
      pageLimit: 50,
    })

    await module.listCommunityReports(caller, {})
    assert.deepEqual(lastCall(repo, 'listCommunityReports'), {
      type: 'listCommunityReports',
      appId: APP_ID,
      status: '',
      pageLimit: 20,
    })

    const reads = repo.listReads
    await assert.rejects(
      () => module.listCommunityReports(caller, { status: 'UNKNOWN' }),
      error => error?.code === 'VALIDATION_FAILED' && error.message === '举报状态无效',
    )
    await assert.rejects(
      () => module.listCommunityReports(caller, { limit: -1 }),
      error => error?.code === 'VALIDATION_FAILED' && error.message === '分页数量无效',
    )
    assert.equal(repo.listReads, reads)
  })

  it('claims with server-owned platform authorization and keeps the reason audit-only', async () => {
    const repo = repository()
    const module = communityGovernance(repo)

    const result = await module.claimCommunityReport(caller, {
      reportId: `  ${REPORT_ID}  `,
      expectedVersion: '2',
      reason: '  开始\n  核实举报内容  ',
    })

    assert.equal(result.status, 'REVIEWING')
    const input = lastCall(repo, 'claimCommunityReport').input
    assert.equal(input.appId, APP_ID)
    assert.equal(input.actorUserId, ACTOR_ID)
    assert.equal(input.reportId, REPORT_ID)
    assert.equal(input.expectedVersion, 2)
    assert.equal(Object.hasOwn(input, 'reason'), false)
    assert.deepEqual(input.authorization, mutationAuthorization())
    assert.deepEqual(input.audit, audit('admin.community_reports.claim', {
      expectedVersion: 2,
      reason: '开始 核实举报内容',
    }))
  })

  it('closes with the normalized outcome, persisted reason, and exact audit action', async () => {
    const repo = repository()
    const module = communityGovernance(repo)

    const dismissed = await module.closeCommunityReport(caller, {
      reportId: REPORT_ID,
      expectedVersion: 3,
      outcome: ' dismissed ',
      reason: '  核实后\t未发现违规  ',
    })
    assert.equal(dismissed.status, 'DISMISSED')
    let input = lastCall(repo, 'closeCommunityReport').input
    assert.equal(input.outcome, 'DISMISSED')
    assert.equal(input.reason, '核实后 未发现违规')
    assert.deepEqual(input.authorization, mutationAuthorization())
    assert.deepEqual(input.audit, audit('admin.community_reports.dismiss', {
      expectedVersion: 3,
      outcome: 'DISMISSED',
      reason: '核实后 未发现违规',
    }))

    await module.closeCommunityReport(caller, {
      reportId: REPORT_ID,
      expectedVersion: 4,
      outcome: 'resolved',
      reason: '确认违规',
    })
    input = lastCall(repo, 'closeCommunityReport').input
    assert.deepEqual(input.audit, audit('admin.community_reports.resolve', {
      expectedVersion: 4,
      outcome: 'RESOLVED',
      reason: '确认违规',
    }))
  })

  it('rejects invalid mutation input before any repository write', async () => {
    const repo = repository()
    const module = communityGovernance(repo)
    const cases = [
      () => module.claimCommunityReport(caller, {
        reportId: '',
        expectedVersion: 2,
        reason: '开始核实',
      }),
      () => module.claimCommunityReport(caller, {
        reportId: REPORT_ID,
        expectedVersion: 0,
        reason: '开始核实',
      }),
      () => module.claimCommunityReport(caller, {
        reportId: REPORT_ID,
        expectedVersion: 2,
        reason: '   ',
      }),
      () => module.closeCommunityReport(caller, {
        reportId: REPORT_ID,
        expectedVersion: 2,
        outcome: 'REVIEWING',
        reason: '继续核实',
      }),
      () => module.closeCommunityReport(caller, {
        reportId: REPORT_ID,
        expectedVersion: 2,
        outcome: 'RESOLVED',
        reason: 'a'.repeat(301),
      }),
    ]
    for (const invoke of cases) {
      await assert.rejects(
        invoke,
        error => error?.code === 'VALIDATION_FAILED',
      )
    }
    assert.equal(repo.writes, 0)
  })

  it('rejects non-review roles before reading or mutating reports', async () => {
    const roles = [
      { roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null },
      { roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID },
      { roleKey: 'EVENT_OWNER', scopeType: 'EVENT', scopeId: 'event-a' },
      { roleKey: 'EVENT_MANAGER', scopeType: 'EVENT', scopeId: 'event-a' },
      { roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: 'event-a' },
    ]
    for (const binding of roles) {
      const repo = repository({ roleBindings: [binding] })
      const module = communityGovernance(repo)
      await assert.rejects(
        () => module.listCommunityReports(caller),
        error => error?.code === 'FORBIDDEN',
      )
      await assert.rejects(
        () => module.claimCommunityReport(caller, {
          reportId: REPORT_ID,
          expectedVersion: 2,
          reason: '开始核实',
        }),
        error => error?.code === 'FORBIDDEN',
      )
      assert.equal(repo.listReads, 0)
      assert.equal(repo.writes, 0)
    }
  })

  it('preserves repository NOT_FOUND, CAS, and state-machine errors', async () => {
    const notFound = new AdminError('NOT_FOUND', '社区举报不存在')
    const conflict = new AdminError('CONFLICT', '数据已变更')
    const invalidState = new AdminError('INVALID_STATE', '社区举报状态已变更')
    const repo = repository({
      async claimCommunityReport(input) {
        repo.calls.push({ type: 'claimCommunityReport', input })
        if (input.reportId === 'missing-report') {
          throw notFound
        }
        throw conflict
      },
      async closeCommunityReport(input) {
        repo.calls.push({ type: 'closeCommunityReport', input })
        throw invalidState
      },
    })
    const module = communityGovernance(repo)

    await assert.rejects(
      () => module.claimCommunityReport(caller, {
        reportId: 'missing-report',
        expectedVersion: 2,
        reason: '开始核实',
      }),
      error => error === notFound,
    )
    await assert.rejects(
      () => module.claimCommunityReport(caller, {
        reportId: REPORT_ID,
        expectedVersion: 2,
        reason: '开始核实',
      }),
      error => error === conflict,
    )
    await assert.rejects(
      () => module.closeCommunityReport(caller, {
        reportId: REPORT_ID,
        expectedVersion: 2,
        outcome: 'RESOLVED',
        reason: '核实完成',
      }),
      error => error === invalidState,
    )
  })

  it('keeps createAdminService composition and external method names compatible', async () => {
    const repo = repository()
    const service = createAdminService({ repository: repo })
    assert.equal(typeof service.listCommunityReports, 'function')
    assert.equal(typeof service.claimCommunityReport, 'function')
    assert.equal(typeof service.closeCommunityReport, 'function')

    const page = await service.listCommunityReports(caller, { status: 'pending' })
    assert.deepEqual(page, { items: [report()], nextCursor: null })
  })
})
