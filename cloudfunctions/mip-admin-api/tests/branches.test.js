'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES, roleCapabilities } = require('../domain/capabilities')
const { createHandler } = require('../domain/handler')
const { createAdminRepository: createProductionAdminRepository } = require('../domain/repository')
const { operationRegistry } = require('../domain/operation-registry')
const { withTestAuthorization } = require('./test-authorization')
const { createServiceDouble } = require('./owner-modules-test-helper')

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

function audit(overrides = {}) {
  return {
    appId: 'wx-app',
    actorUserId: 'admin-user',
    scopeType: 'BRANCH',
    scopeId: 'branch-a',
    action: 'admin.branches.update',
    resourceType: 'CITY_BRANCH',
    resourceId: 'branch-a',
    effectiveRole: 'PLATFORM_OPERATIONS',
    metadata: {},
    ...overrides,
  }
}

function branch(overrides = {}) {
  return {
    id: 'branch-a',
    branchKey: 'shenzhen',
    name: '深圳分会',
    cityName: '深圳',
    summary: '分会简介',
    status: 'ACTIVE',
    version: 1,
    blockers: {
      activeMemberships: 0,
      activeBranchAdmins: 0,
      publishedEvents: 0,
      publishedOpportunities: 0,
    },
    currentPlayerCount: 0,
    branchAdminNames: [],
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
    listBranches: async (appId) => {
      captured.listAppId = appId
      return [branch()]
    },
    createBranch: async (input) => {
      captured.create = input
      captured.createAudit = input.audit('branch-a')
      return branch({
        branchKey: input.branchKey,
        name: input.name,
        cityName: input.cityName,
        summary: input.summary,
      })
    },
    updateBranch: async (input) => {
      captured.update = input
      return branch({
        name: input.name,
        cityName: input.cityName,
        summary: input.summary,
        version: input.expectedVersion + 1,
      })
    },
    changeBranchStatus: async (input) => {
      captured.status = input
      return branch({ status: input.status, version: input.expectedVersion + 1 })
    },
  }
}

describe('admin branch management', () => {
  it('grants branches.manage only to platform owners and platform operations', () => {
    for (const role of ['PLATFORM_OWNER', 'PLATFORM_OPERATIONS']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.BRANCHES_MANAGE), true)
    }
    for (const role of [
      'PLATFORM_FINANCE', 'BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF',
    ]) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.BRANCHES_MANAGE), false)
    }
  })

  it('normalizes create fields and builds a branch-scoped success audit', async () => {
    const repository = serviceRepository()
    const service = createAdminService({ repository })
    const result = await service.createBranch(caller, {
      branchKey: ' SHENZHEN ',
      name: '  深圳\n  分会  ',
      cityName: '  深圳  ',
      summary: '  活动\t与  会员服务  ',
    })

    assert.equal(result.branchKey, 'shenzhen')
    assert.equal(repository.captured.create.appId, 'wx-app')
    assert.equal(repository.captured.create.actorUserId, 'admin-user')
    assert.equal(repository.captured.create.branchKey, 'shenzhen')
    assert.equal(repository.captured.create.name, '深圳 分会')
    assert.equal(repository.captured.create.cityName, '深圳')
    assert.equal(repository.captured.create.summary, '活动 与 会员服务')
    assert.deepEqual(repository.captured.createAudit, audit({
      action: 'admin.branches.create',
      metadata: { branchKey: 'shenzhen', status: 'ACTIVE' },
    }))

    await assert.rejects(() => service.createBranch(caller, {
      branchKey: 'shen_zhen', name: '深圳分会', cityName: '深圳',
    }), error => error.code === 'VALIDATION_FAILED')
  })

  it('keeps branch_key immutable and uses expectedVersion for editable fields', async () => {
    const repository = serviceRepository('PLATFORM_OWNER')
    const service = createAdminService({ repository })
    await assert.rejects(() => service.updateBranch(caller, {
      branchId: 'branch-a',
      branchKey: 'guangzhou',
      name: '广州分会',
      cityName: '广州',
      expectedVersion: 1,
    }), error => error.code === 'VALIDATION_FAILED' && /不可修改/.test(error.message))

    const result = await service.updateBranch(caller, {
      branchId: 'branch-a',
      name: '  深圳  中心分会 ',
      cityName: ' 深圳 ',
      summary: '',
      expectedVersion: 4,
    })
    assert.equal(result.version, 5)
    assert.equal(repository.captured.update.name, '深圳 中心分会')
    assert.equal(Object.hasOwn(repository.captured.update, 'branchKey'), false)
    assert.equal(repository.captured.update.expectedVersion, 4)
    assert.equal(repository.captured.update.audit.action, 'admin.branches.update')
  })

  it('rejects branch and event scoped roles before repository access', async () => {
    for (const role of ['PLATFORM_FINANCE', 'BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF']) {
      const repository = serviceRepository(role, role === 'PLATFORM_FINANCE' ? 'PLATFORM' : 'BRANCH')
      const service = createAdminService({ repository })
      await assert.rejects(() => service.listBranches(caller), error => error.code === 'FORBIDDEN')
      await assert.rejects(() => service.createBranch(caller, {
        branchKey: 'foshan', name: '佛山分会', cityName: '佛山',
      }), error => error.code === 'FORBIDDEN')
      assert.equal(repository.captured.listAppId, undefined)
      assert.equal(repository.captured.create, undefined)
    }
  })

  it('exposes the four stable transport actions and preserves blocker details', async () => {
    for (const action of [
      'mip.admin.branches.list',
      'mip.admin.branches.create',
      'mip.admin.branches.update',
      'mip.admin.branches.changeStatus',
    ]) {
      assert.notEqual(operationRegistry.operationByAction[action], undefined)
    }
    const handler = createHandler({
      getContext: () => ({ FROM_APPID: 'wx-app', FROM_OPENID: 'openid' }),
      resolveCaller: () => caller,
      service: createServiceDouble({
        async changeBranchStatus() {
          const error = new Error('BRANCH_DEACTIVATION_BLOCKED')
          error.code = 'BRANCH_DEACTIVATION_BLOCKED'
          error.details = {
            blockers: {
              activeMemberships: 2,
              activeBranchAdmins: 1,
              publishedEvents: 3,
              publishedOpportunities: 4,
            },
          }
          throw error
        },
      }),
    })
    const response = await handler({ action: 'mip.admin.branches.changeStatus' })
    assert.deepEqual(response.error, {
      code: 'BRANCH_DEACTIVATION_BLOCKED',
      message: '分会仍有关联的有效记录，无法停用',
      retryable: false,
      details: {
        blockers: {
          activeMemberships: 2,
          activeBranchAdmins: 1,
          publishedEvents: 3,
          publishedOpportunities: 4,
        },
      },
    })
  })

  it('lists only app-scoped branches with all server blocker counts', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async query(sql, params) {
        calls.push({ sql, params })
        return [{
          id: 'branch-a', branch_key: 'shenzhen', name: '深圳分会', city_name: '深圳',
          summary: null, status: 'ACTIVE', version: 7, active_memberships: 12,
          current_player_count: 8,
          branch_admin_names_json: '["管理员甲","管理员乙"]', active_branch_admins: 2,
          published_events: 3, published_opportunities: 4,
        }]
      },
    }))
    const result = await repository.listBranches('wx-app')
    assert.deepEqual(result, [branch({
      summary: '',
      version: 7,
      currentPlayerCount: 8,
      branchAdminNames: ['管理员甲', '管理员乙'],
      blockers: {
        activeMemberships: 12,
        activeBranchAdmins: 2,
        publishedEvents: 3,
        publishedOpportunities: 4,
      },
    })])
    assert.deepEqual(calls[0].params, ['wx-app'])
    assert.match(calls[0].sql, /FROM mip_city_branches b[\s\S]*WHERE b\.app_id = \?/)
    assert.match(calls[0].sql, /FROM mip_branch_memberships/)
    assert.match(calls[0].sql, /mip_membership_entitlements/)
    assert.match(calls[0].sql, /mip_profiles/)
    assert.match(calls[0].sql, /FROM mip_admin_role_bindings/)
    assert.match(calls[0].sql, /FROM mip_events/)
    assert.match(calls[0].sql, /FROM mip_opportunities/)
  })

  it('creates and audits in one transaction and maps the scoped key constraint', async () => {
    const calls = []
    const repository = createAdminRepository(transactionDatabase({
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }), { id: () => 'branch-a' })
    const result = await repository.createBranch({
      appId: 'wx-app', actorUserId: 'admin-user', branchKey: 'shenzhen',
      name: '深圳分会', cityName: '深圳', summary: '',
      audit: branchId => audit({ action: 'admin.branches.create', resourceId: branchId }),
    })
    assert.deepEqual(result, branch({ summary: '' }))
    const insertIndex = calls.findIndex(call => call.sql.includes('INSERT INTO mip_city_branches'))
    const auditIndex = calls.findIndex(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(insertIndex >= 0 && auditIndex > insertIndex)
    assert.deepEqual(calls[insertIndex].params.slice(0, 3), ['branch-a', 'wx-app', 'shenzhen'])
    assert.equal(calls.some(call => /\bDELETE\s+FROM\b/i.test(call.sql)), false)

    const duplicate = createAdminRepository(transactionDatabase({
      async query(sql) {
        if (sql.includes('INSERT INTO mip_city_branches')) {
          const error = new Error('Duplicate entry for key mip_city_branches_key_uk')
          error.code = 'ER_DUP_ENTRY'
          throw error
        }
        return { affectedRows: 1 }
      },
    }), { id: () => 'branch-b' })
    await assert.rejects(() => duplicate.createBranch({
      appId: 'wx-app', actorUserId: 'admin-user', branchKey: 'shenzhen',
      name: '深圳分会', cityName: '深圳', summary: '',
      audit: () => audit(),
    }), error => error.code === 'BRANCH_KEY_CONFLICT')
  })

  it('updates editable fields with an app-scoped optimistic lock and never writes branch_key', async () => {
    const oneCalls = []
    const queryCalls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql, params) {
        oneCalls.push({ sql, params })
        if (sql.includes('FROM mip_city_branches')) {
          return {
            id: 'branch-a', branch_key: 'shenzhen', name: '深圳分会', city_name: '深圳',
            summary: '', status: 'ACTIVE', version: 4,
          }
        }
        return { total: 0 }
      },
      async query(sql, params) {
        queryCalls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    const result = await repository.updateBranch({
      appId: 'wx-app', actorUserId: 'admin-user', branchId: 'branch-a', expectedVersion: 4,
      name: '深圳中心分会', cityName: '深圳', summary: '新简介', audit: audit(),
    })
    assert.equal(result.version, 5)
    assert.deepEqual(oneCalls[0].params, ['wx-app', 'branch-a'])
    assert.match(oneCalls[0].sql, /FOR UPDATE/)
    const update = queryCalls.find(call => call.sql.includes('UPDATE mip_city_branches'))
    assert.ok(update)
    assert.doesNotMatch(update.sql, /branch_key\s*=/)
    assert.match(update.sql, /WHERE app_id = \? AND id = \? AND version = \?/)
    assert.deepEqual(update.params.slice(-3), ['wx-app', 'branch-a', 4])
    const updateIndex = queryCalls.indexOf(update)
    const auditIndex = queryCalls.findIndex(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(auditIndex > updateIndex)
  })

  it('rejects a stale branch version before writing or auditing', async () => {
    const queryCalls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_city_branches')) {
          return {
            id: 'branch-a', branch_key: 'shenzhen', name: '深圳分会', city_name: '深圳',
            summary: '', status: 'ACTIVE', version: 6,
          }
        }
        return { total: 0 }
      },
      async query(sql, params) {
        queryCalls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    await assert.rejects(() => repository.updateBranch({
      appId: 'wx-app', actorUserId: 'admin-user', branchId: 'branch-a', expectedVersion: 5,
      name: '深圳中心分会', cityName: '深圳', summary: '', audit: audit(),
    }), error => error.code === 'CONFLICT')
    assert.equal(queryCalls.some(call => call.sql.includes('UPDATE mip_city_branches')), false)
    assert.equal(queryCalls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
  })

  it('fails closed with all blocker counts before deactivation or audit', async () => {
    const oneCalls = []
    const queryCalls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql, params) {
        oneCalls.push({ sql, params })
        if (sql.includes('FROM mip_city_branches')) {
          return {
            id: 'branch-a', branch_key: 'shenzhen', name: '深圳分会', city_name: '深圳',
            summary: '', status: 'ACTIVE', version: 3,
          }
        }
        if (sql.includes('FROM mip_branch_memberships')) return { total: 2 }
        if (sql.includes('FROM mip_admin_role_bindings')) return { total: 1 }
        if (sql.includes('FROM mip_events')) return { total: 3 }
        if (sql.includes('FROM mip_opportunities')) return { total: 4 }
        return { total: 0 }
      },
      async query(sql, params) {
        queryCalls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    await assert.rejects(() => repository.changeBranchStatus({
      appId: 'wx-app', actorUserId: 'admin-user', branchId: 'branch-a',
      expectedVersion: 3, status: 'INACTIVE', audit: audit(),
    }), (error) => {
      assert.equal(error.code, 'BRANCH_DEACTIVATION_BLOCKED')
      assert.deepEqual(error.details, {
        blockers: {
          activeMemberships: 2,
          activeBranchAdmins: 1,
          publishedEvents: 3,
          publishedOpportunities: 4,
        },
      })
      return true
    })
    assert.match(oneCalls[0].sql, /FROM mip_city_branches[\s\S]*app_id = \?[\s\S]*FOR UPDATE/)
    for (const call of oneCalls.slice(1)) {
      assert.deepEqual(call.params, ['wx-app', 'branch-a'])
      assert.match(call.sql, /FOR UPDATE$/)
    }
    assert.equal(queryCalls.some(call => call.sql.includes('UPDATE mip_city_branches')), false)
    assert.equal(queryCalls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')), false)
  })

  it('deactivates an unblocked branch and audits after the versioned status write', async () => {
    const queryCalls = []
    const repository = createAdminRepository(transactionDatabase({
      async one(sql) {
        if (sql.includes('FROM mip_city_branches')) {
          return {
            id: 'branch-a', branch_key: 'shenzhen', name: '深圳分会', city_name: '深圳',
            summary: '', status: 'ACTIVE', version: 8,
          }
        }
        return { total: 0 }
      },
      async query(sql, params) {
        queryCalls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }))
    const result = await repository.changeBranchStatus({
      appId: 'wx-app', actorUserId: 'admin-user', branchId: 'branch-a',
      expectedVersion: 8, status: 'INACTIVE', audit: audit({ action: 'admin.branches.status.change' }),
    })
    assert.deepEqual(result, branch({ status: 'INACTIVE', version: 9, summary: '' }))
    const updateIndex = queryCalls.findIndex(call => call.sql.includes('UPDATE mip_city_branches'))
    const auditIndex = queryCalls.findIndex(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(updateIndex >= 0 && auditIndex > updateIndex)
    assert.deepEqual(queryCalls[updateIndex].params, ['INACTIVE', 'wx-app', 'branch-a', 8])
  })
})
