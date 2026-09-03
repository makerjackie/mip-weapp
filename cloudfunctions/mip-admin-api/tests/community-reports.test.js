'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES, roleCapabilities } = require('../domain/capabilities')
const { createAdminRepository: createProductionAdminRepository } = require('../domain/repository')
const { operationRegistry } = require('../domain/operation-registry')
const { withTestAuthorization } = require('./test-authorization')

function createAdminRepository(database, options) {
  return createProductionAdminRepository(database, withTestAuthorization(options))
}
const { createAdminService } = require('../domain/service')

const caller = { appId: 'wx-app', identityKey: 'identity-key' }

function transactionDatabase({ one = async () => null, query = async () => ({ affectedRows: 1 }) } = {}) {
  return {
    one,
    query,
    async transaction(work) {
      return work({ one, query })
    },
  }
}

function reportRow(overrides = {}) {
  return {
    id: 'report-a',
    category: 'FRAUD',
    description: '疑似虚假交易信息',
    status: 'PENDING',
    version: 2,
    resolution_reason: null,
    created_at: '2026-08-24T08:00:00.000Z',
    updated_at: '2026-08-24T08:00:00.000Z',
    reviewed_at: null,
    reporter_nickname: '举报人',
    reporter_headline: '产品经理',
    reporter_visibility_json: '{}',
    reporter_city_name: '深圳',
    target_nickname: '被举报人',
    target_headline: '项目负责人',
    target_visibility_json: '{}',
    target_city_name: '广州',
    ...overrides,
  }
}

function reportDto(overrides = {}) {
  return {
    reportId: 'report-a',
    category: 'FRAUD',
    description: '疑似虚假交易信息',
    status: 'PENDING',
    version: 2,
    reporter: { nickname: '举报人', headline: '产品经理', cityName: '深圳' },
    target: { nickname: '被举报人', headline: '项目负责人', cityName: '广州' },
    resolutionReason: '',
    createdAt: '2026-08-24T08:00:00.000Z',
    updatedAt: '2026-08-24T08:00:00.000Z',
    reviewedAt: null,
    ...overrides,
  }
}

function audit(overrides = {}) {
  return {
    appId: 'wx-app',
    actorUserId: 'admin-user',
    scopeType: 'PLATFORM',
    scopeId: null,
    action: 'admin.community_reports.claim',
    resourceType: 'COMMUNITY_REPORT',
    resourceId: 'report-a',
    effectiveRole: 'PLATFORM_OPERATIONS',
    metadata: {},
    ...overrides,
  }
}

function serviceRepository(roleKey = 'PLATFORM_OPERATIONS', scopeType = 'PLATFORM') {
  const captured = {}
  return {
    captured,
    resolveUser: async () => ({
      id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true,
      phoneBound: true, profileComplete: true,
    }),
    listRoleBindings: async () => [{ roleKey, scopeType, scopeId: scopeType === 'PLATFORM' ? null : 'branch-a' }],
    listCommunityReports: async (appId, status, pageLimit) => {
      captured.list = { appId, status, pageLimit }
      return [reportDto()]
    },
    claimCommunityReport: async (input) => {
      captured.claim = input
      return reportDto({ status: 'REVIEWING', version: input.expectedVersion + 1 })
    },
    closeCommunityReport: async (input) => {
      captured.close = input
      return reportDto({
        status: input.outcome,
        version: input.expectedVersion + 1,
        resolutionReason: input.reason,
      })
    },
  }
}

describe('admin community report review', () => {
  it('grants community.reports.manage only to platform owners and operations', () => {
    for (const role of ['PLATFORM_OWNER', 'PLATFORM_OPERATIONS']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.COMMUNITY_REPORTS_MANAGE), true)
    }
    for (const role of [
      'PLATFORM_FINANCE', 'BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF',
    ]) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.COMMUNITY_REPORTS_MANAGE), false)
    }
  })

  it('exposes only the list, claim and close review actions', () => {
    assert.notEqual(operationRegistry.operationByAction['mip.admin.communityReports.list'], undefined)
    assert.notEqual(operationRegistry.operationByAction['mip.admin.communityReports.claim'], undefined)
    assert.notEqual(operationRegistry.operationByAction['mip.admin.communityReports.close'], undefined)
  })

  it('normalizes filters and reasons while keeping a claim reason audit-only', async () => {
    const repository = serviceRepository()
    const service = createAdminService({ repository })
    const page = await service.listCommunityReports(caller, { status: ' reviewing ' })
    assert.equal(page.items.length, 1)
    assert.deepEqual(repository.captured.list, { appId: 'wx-app', status: 'REVIEWING', pageLimit: 20 })

    await service.claimCommunityReport(caller, {
      reportId: 'report-a', expectedVersion: 2, reason: '  开始\n  核实举报内容  ',
    })
    assert.equal(Object.hasOwn(repository.captured.claim, 'reason'), false)
    assert.deepEqual(repository.captured.claim.audit, audit({
      metadata: { expectedVersion: 2, reason: '开始 核实举报内容' },
    }))

    await service.closeCommunityReport(caller, {
      reportId: 'report-a', expectedVersion: 3, outcome: 'dismissed',
      reason: '  核实后\t未发现违规  ',
    })
    assert.equal(repository.captured.close.outcome, 'DISMISSED')
    assert.equal(repository.captured.close.reason, '核实后 未发现违规')
    assert.equal(repository.captured.close.audit.action, 'admin.community_reports.dismiss')
    assert.deepEqual(repository.captured.close.audit.metadata, {
      expectedVersion: 3,
      outcome: 'DISMISSED',
      reason: '核实后 未发现违规',
    })
  })

  it('rejects invalid filters, outcomes and required bounded reasons', async () => {
    const service = createAdminService({ repository: serviceRepository() })
    await assert.rejects(() => service.listCommunityReports(caller, { status: 'UNKNOWN' }),
      error => error.code === 'VALIDATION_FAILED')
    await assert.rejects(() => service.claimCommunityReport(caller, {
      reportId: 'report-a', expectedVersion: 2, reason: '   ',
    }), error => error.code === 'VALIDATION_FAILED')
    await assert.rejects(() => service.closeCommunityReport(caller, {
      reportId: 'report-a', expectedVersion: 2, outcome: 'REVIEWING', reason: '继续核实',
    }), error => error.code === 'VALIDATION_FAILED')
    await assert.rejects(() => service.closeCommunityReport(caller, {
      reportId: 'report-a', expectedVersion: 2, outcome: 'RESOLVED', reason: 'a'.repeat(301),
    }), error => error.code === 'VALIDATION_FAILED')
  })

  it('rejects every non-platform-review role before repository access', async () => {
    for (const role of ['PLATFORM_FINANCE', 'BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF']) {
      const repository = serviceRepository(role, role === 'PLATFORM_FINANCE' ? 'PLATFORM' : 'BRANCH')
      const service = createAdminService({ repository })
      await assert.rejects(() => service.listCommunityReports(caller, {}), error => error.code === 'FORBIDDEN')
      await assert.rejects(() => service.claimCommunityReport(caller, {
        reportId: 'report-a', expectedVersion: 2, reason: '开始核实',
      }), error => error.code === 'FORBIDDEN')
      assert.equal(repository.captured.list, undefined)
      assert.equal(repository.captured.claim, undefined)
    }
  })

  it('lists app-scoped reports and returns only visibility-controlled public summaries', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async query(sql, params) {
        calls.push({ sql, params })
        return [reportRow({
          reporter_visibility_json: JSON.stringify({ nickname: false, primaryBranch: false }),
          target_visibility_json: JSON.stringify({ headline: false }),
        })]
      },
    }))
    const result = await repository.listCommunityReports('wx-app', 'PENDING', 20)
    assert.deepEqual(result, [reportDto({
      reporter: { nickname: 'MIP 用户', headline: '产品经理', cityName: '' },
      target: { nickname: '被举报人', headline: '', cityName: '广州' },
    })])
    assert.deepEqual(calls[0].params, ['wx-app', 'PENDING', 20])
    assert.match(calls[0].sql, /WHERE r\.app_id = \? AND r\.status = \?/)
    const projection = calls[0].sql.slice(0, calls[0].sql.indexOf('FROM mip_reports'))
    assert.doesNotMatch(projection, /reporter_user_id|target_user_id|reviewed_by_user_id|openid|phone|cloud_file/i)
    const serialized = JSON.stringify(result)
    assert.doesNotMatch(serialized, /reporter_user_id|target_user_id|reviewed_by_user_id|openid|phone|profileRef|visibility_json|cloud:\/\//i)
  })

  it('claims only PENDING with a locked versioned write and same-transaction audit', async () => {
    const queryCalls = []
    const oneCalls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql, params) {
        oneCalls.push({ sql, params })
        if (sql.includes('FROM mip_reports r')) {
          return reportRow({
            status: 'REVIEWING', version: 3,
            reviewed_at: '2026-08-24T09:00:00.000Z',
            updated_at: '2026-08-24T09:00:00.000Z',
          })
        }
        return { id: 'report-a', status: 'PENDING', version: 2 }
      },
      async query(sql, params) {
        queryCalls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    const result = await repository.claimCommunityReport({
      appId: 'wx-app', actorUserId: 'admin-user', reportId: 'report-a', expectedVersion: 2,
      audit: audit({ metadata: { expectedVersion: 2, reason: '开始核实' } }),
    })
    assert.equal(result.status, 'REVIEWING')
    assert.equal(result.version, 3)
    assert.match(oneCalls[0].sql, /WHERE app_id = \? AND id = \? FOR UPDATE/)
    assert.deepEqual(oneCalls[0].params, ['wx-app', 'report-a'])
    const update = queryCalls.find(call => call.sql.includes('UPDATE mip_reports'))
    assert.match(update.sql, /status = 'REVIEWING'/)
    assert.match(update.sql, /status = 'PENDING'/)
    assert.doesNotMatch(update.sql, /resolution_reason/)
    assert.deepEqual(update.params, ['admin-user', 'wx-app', 'report-a', 2])
    const updateIndex = queryCalls.indexOf(update)
    const auditIndex = queryCalls.findIndex(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(auditIndex > updateIndex)
  })

  it('closes only REVIEWING and persists the bounded reason with an audit', async () => {
    const queryCalls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_reports r')) {
          return reportRow({
            status: 'RESOLVED', version: 4, resolution_reason: '确认违规信息',
            reviewed_at: '2026-08-24T10:00:00.000Z',
            updated_at: '2026-08-24T10:00:00.000Z',
          })
        }
        return { id: 'report-a', status: 'REVIEWING', version: 3 }
      },
      async query(sql, params) {
        queryCalls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    const result = await repository.closeCommunityReport({
      appId: 'wx-app', actorUserId: 'admin-user', reportId: 'report-a', expectedVersion: 3,
      outcome: 'RESOLVED', reason: '确认违规信息',
      audit: audit({ action: 'admin.community_reports.resolve' }),
    })
    assert.equal(result.status, 'RESOLVED')
    assert.equal(result.resolutionReason, '确认违规信息')
    const update = queryCalls.find(call => call.sql.includes('UPDATE mip_reports'))
    assert.match(update.sql, /resolution_reason = \?/)
    assert.match(update.sql, /status = 'REVIEWING'/)
    assert.deepEqual(update.params, [
      'RESOLVED', 'admin-user', '确认违规信息', 'wx-app', 'report-a', 3,
    ])
    const updateIndex = queryCalls.indexOf(update)
    const auditIndex = queryCalls.findIndex(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(auditIndex > updateIndex)
  })

  it('rejects stale versions and invalid transitions before any mutation or audit', async () => {
    const cases = [
      { method: 'claimCommunityReport', current: { status: 'PENDING', version: 4 }, expectedVersion: 3, code: 'CONFLICT' },
      { method: 'claimCommunityReport', current: { status: 'REVIEWING', version: 4 }, expectedVersion: 4, code: 'INVALID_STATE' },
      { method: 'closeCommunityReport', current: { status: 'PENDING', version: 4 }, expectedVersion: 4, code: 'INVALID_STATE' },
    ]
    for (const scenario of cases) {
      const queryCalls = []
      const repository = createAdminRepository(transactionDatabase({
        async one() { return { id: 'report-a', ...scenario.current } },
        async query(sql, params) {
          queryCalls.push({ sql, params })
          return { affectedRows: 1 }
        },
      }))
      await assert.rejects(() => repository[scenario.method]({
        appId: 'wx-app', actorUserId: 'admin-user', reportId: 'report-a',
        expectedVersion: scenario.expectedVersion, outcome: 'RESOLVED', reason: '核实完成', audit: audit(),
      }), error => error.code === scenario.code)
      assert.equal(queryCalls.some(call => call.sql.includes('UPDATE mip_reports')), false)
      assert.equal(queryCalls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
    }
  })

  it('never changes user, profile, block or notification facts during review', async () => {
    const writes = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_reports r')) {
          return reportRow({ status: 'DISMISSED', version: 3, resolution_reason: '证据不足' })
        }
        return { id: 'report-a', status: 'REVIEWING', version: 2 }
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    await repository.closeCommunityReport({
      appId: 'wx-app', actorUserId: 'admin-user', reportId: 'report-a', expectedVersion: 2,
      outcome: 'DISMISSED', reason: '证据不足', audit: audit(),
    })
    assert.equal(writes.some(call => /UPDATE mip_(?:users|profiles|user_blocks)/.test(call.sql)), false)
    assert.equal(writes.some(call => /outbox|inbox|notification/i.test(call.sql)), false)
    assert.equal(writes.some(call => /\bDELETE\s+FROM\b/i.test(call.sql)), false)
  })
})
