'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { createAdminAccess } = require('../domain/access')
const { CAPABILITIES, roleCapabilities } = require('../domain/capabilities')
const {
  createAdminGovernance,
  PLATFORM_SCOPE_ID,
} = require('../domain/governance')
const { encodeCursor } = require('../domain/pagination')
const {
  createAdminService,
  PLATFORM_SCOPE_ID: SERVICE_PLATFORM_SCOPE_ID,
} = require('../domain/service')
const { AdminError } = require('../domain/validation')

const APP_ID = 'wx-governance-app'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const TARGET_ID = '20000000-0000-4000-8000-000000000002'
const BRANCH_A = '30000000-0000-4000-8000-000000000003'
const BRANCH_B = '40000000-0000-4000-8000-000000000004'
const EVENT_ID = '50000000-0000-4000-8000-000000000005'
const AUDIT_ID = '60000000-0000-4000-8000-000000000006'
const NOW = new Date('2030-08-25T00:00:00.000Z')
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
    eventScope: { scopeType: 'EVENT', scopeId: EVENT_ID, branchId: BRANCH_A },
    storedPolicies: [],
    calls: [],
    audits: [],
    resolveReads: 0,
    branchReads: 0,
    roleReads: 0,
    candidateReads: 0,
    auditReads: 0,
    exceptionReads: 0,
    mutationWrites: 0,
    async resolveUser() {
      repo.resolveReads += 1
      return { ...repo.user }
    },
    async listRoleBindings() {
      return repo.roleBindings
    },
    async getEventScope(_appId, eventId) {
      repo.calls.push({ type: 'eventScope', eventId })
      return eventId === 'missing-event' ? null : repo.eventScope
    },
    async listBranches(appId) {
      repo.branchReads += 1
      repo.calls.push({ type: 'listBranches', appId })
      return [branchRow()]
    },
    async createBranch(input) {
      repo.mutationWrites += 1
      repo.calls.push({ type: 'createBranch', input })
      repo.audits.push(input.audit(BRANCH_A))
      return branchRow({
        branchKey: input.branchKey,
        name: input.name,
        cityName: input.cityName,
        summary: input.summary,
      })
    },
    async updateBranch(input) {
      return staticAuditMutation(repo, 'updateBranch', input, branchRow({
        name: input.name,
        cityName: input.cityName,
        summary: input.summary,
        version: input.expectedVersion + 1,
      }))
    },
    async changeBranchStatus(input) {
      return staticAuditMutation(repo, 'changeBranchStatus', input, branchRow({
        status: input.status,
        version: input.expectedVersion + 1,
      }))
    },
    async listRoles(appId, visibility, options) {
      repo.roleReads += 1
      repo.calls.push({ type: 'listRoles', appId, visibility, options })
      return [{
        id: 'binding-a',
        userId: TARGET_ID,
        nickname: '运营成员',
        scopeType: 'EVENT',
        scopeId: EVENT_ID,
        scopeName: '会员活动',
        branchId: BRANCH_A,
        roleKey: 'EVENT_MANAGER',
        status: 'ACTIVE',
        grantedAt: '2030-08-20T00:00:00.000Z',
        revokedAt: null,
      }]
    },
    async searchRoleCandidates(appId, query, pageLimit) {
      repo.candidateReads += 1
      repo.calls.push({ type: 'searchRoleCandidates', appId, query, pageLimit })
      return [{ id: TARGET_ID, nickname: '运营成员', cityName: '广州' }]
    },
    async setRole(input) {
      repo.mutationWrites += 1
      repo.calls.push({ type: 'setRole', input })
      repo.audits.push(input.audit)
      return {
        userId: input.userId,
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeType === 'PLATFORM' ? null : input.scope.scopeId,
        roleKey: input.roleKey,
      }
    },
    async listRoleCapabilityPolicies(appId) {
      repo.calls.push({ type: 'listRoleCapabilityPolicies', appId })
      return repo.storedPolicies
    },
    async updateRoleCapabilityPolicy(input) {
      return policyMutation(repo, 'updateRoleCapabilityPolicy', input, 'CUSTOM')
    },
    async resetRoleCapabilityPolicy(input) {
      return policyMutation(repo, 'resetRoleCapabilityPolicy', input, 'DEFAULT')
    },
    async listAudit(...args) {
      repo.auditReads += 1
      repo.calls.push({ type: 'listAudit', args })
      return {
        items: [{
          id: AUDIT_ID,
          actorUserId: ACTOR_ID,
          actorNickname: '管理员',
          scopeType: 'BRANCH',
          scopeId: BRANCH_A,
          action: 'admin.events.update',
          resourceType: 'EVENT',
          resourceId: EVENT_ID,
          effectiveRole: 'BRANCH_ADMIN',
          metadata: {},
          createdAt: '2030-08-24T00:00:00.000Z',
        }],
        nextCursor: 'next-audit',
      }
    },
    async listOperationalExceptions(appId, request) {
      repo.exceptionReads += 1
      repo.calls.push({ type: 'listOperationalExceptions', appId, request })
      return [{
        id: 'PAYMENT:failure-a',
        source: 'PAYMENT',
        status: 'FAILED',
        title: '支付处理失败',
        summary: '一笔支付未完成处理。',
        occurredAt: '2030-08-24T00:00:00.000Z',
        target: null,
      }]
    },
    async recordAudit(value) {
      repo.audits.push(value)
    },
    ...overrides,
  }
  return repo
}

function staticAuditMutation(repo, type, input, result) {
  repo.mutationWrites += 1
  repo.calls.push({ type, input })
  repo.audits.push(input.audit)
  return result
}

function policyMutation(repo, type, input, mode) {
  repo.mutationWrites += 1
  repo.calls.push({ type, input })
  repo.audits.push(input.audit)
  return {
    roleKey: input.roleKey,
    capabilities: mode === 'CUSTOM' ? input.capabilities : roleCapabilities[input.roleKey],
    mode,
    version: input.expectedVersion + 1,
    updatedAt: input.now.toISOString(),
  }
}

function governance(repo, now = () => NOW) {
  return createAdminGovernance({
    repository: repo,
    access: createAdminAccess({ repository: repo }),
    now,
  })
}

function branchRow(overrides = {}) {
  return {
    id: BRANCH_A,
    branchKey: 'guangzhou',
    name: '广州分会',
    cityName: '广州',
    summary: '城市会员活动',
    status: 'ACTIVE',
    version: 3,
    blockers: {
      activeMemberships: 0,
      activeBranchAdmins: 0,
      publishedEvents: 0,
      publishedOpportunities: 0,
    },
    ...overrides,
  }
}

function lastCall(repo, type) {
  return repo.calls.findLast(call => call.type === type)
}

describe('admin governance deep module', () => {
  it('exposes only branch, role, policy, audit, and exception governance', () => {
    const api = createAdminGovernance({ repository: {}, access: {} })
    assert.deepEqual(Object.keys(api).sort(), [
      'changeBranchStatus',
      'createBranch',
      'listAudit',
      'listBranches',
      'listOperationalExceptions',
      'listRoleCapabilityPolicies',
      'listRoles',
      'searchRoleCandidates',
      'setRole',
      'updateBranch',
      'updateRoleCapabilityPolicy',
    ])
  })

  it('reloads full-access and role facts before every governance request', async () => {
    const repo = repository()
    const service = governance(repo)

    await service.listBranches({
      ...caller,
      roles: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
    })
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    await assert.rejects(
      () => service.listBranches(caller),
      error => error?.code === 'FORBIDDEN',
    )
    repo.roleBindings = [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }]
    repo.user.agreementsAccepted = false
    await assert.rejects(
      () => service.listBranches(caller),
      error => error?.message === 'AGREEMENT_REQUIRED',
    )

    assert.equal(repo.resolveReads, 3)
    assert.equal(repo.branchReads, 1)
  })

  it('keeps branch writes platform-scoped, versioned, authorized, and audited', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }]
    const service = governance(repo)

    await service.createBranch(caller, {
      branchKey: ' GUANGZHOU-NORTH ',
      name: ' 广州\n 北部 分会 ',
      cityName: ' 广州 ',
      summary: ' 城市\t会员  活动 ',
    })
    await service.updateBranch(caller, {
      branchId: BRANCH_A,
      expectedVersion: 3,
      name: ' 广州中心分会 ',
      cityName: ' 广州 ',
      summary: ' 城市会员服务 ',
    })
    await service.changeBranchStatus(caller, {
      branchId: BRANCH_A,
      expectedVersion: 4,
      status: 'INACTIVE',
    })

    const create = lastCall(repo, 'createBranch').input
    const update = lastCall(repo, 'updateBranch').input
    const status = lastCall(repo, 'changeBranchStatus').input
    assert.deepEqual({
      branchKey: create.branchKey,
      name: create.name,
      cityName: create.cityName,
      summary: create.summary,
    }, {
      branchKey: 'guangzhou-north',
      name: '广州 北部 分会',
      cityName: '广州',
      summary: '城市 会员 活动',
    })
    assert.deepEqual(create.authorization, {
      capability: 'branches.manage',
      effectiveGrant: {
        roleKey: 'PLATFORM_OPERATIONS',
        scopeType: 'PLATFORM',
        scopeId: null,
      },
    })
    assert.equal(update.expectedVersion, 3)
    assert.equal(status.expectedVersion, 4)
    assert.deepEqual(repo.audits.map(item => ({
      scopeType: item.scopeType,
      scopeId: item.scopeId,
      action: item.action,
      resourceType: item.resourceType,
      resourceId: item.resourceId,
      metadata: item.metadata,
    })), [
      {
        scopeType: 'BRANCH',
        scopeId: BRANCH_A,
        action: 'admin.branches.create',
        resourceType: 'CITY_BRANCH',
        resourceId: BRANCH_A,
        metadata: { branchKey: 'guangzhou-north', status: 'ACTIVE' },
      },
      {
        scopeType: 'BRANCH',
        scopeId: BRANCH_A,
        action: 'admin.branches.update',
        resourceType: 'CITY_BRANCH',
        resourceId: BRANCH_A,
        metadata: {
          expectedVersion: 3,
          fields: ['name', 'cityName', 'summary'],
        },
      },
      {
        scopeType: 'BRANCH',
        scopeId: BRANCH_A,
        action: 'admin.branches.status.change',
        resourceType: 'CITY_BRANCH',
        resourceId: BRANCH_A,
        metadata: { status: 'INACTIVE', expectedVersion: 4 },
      },
    ])
    assert.equal(repo.audits.every(item => item.appId === APP_ID
      && item.actorUserId === ACTOR_ID
      && item.effectiveRole === 'PLATFORM_OPERATIONS'), true)
  })

  it('rejects branch escalation and preserves repository version conflicts', async () => {
    const conflict = new AdminError('CONFLICT', '记录已被更新')
    const repo = repository({
      async updateBranch() {
        throw conflict
      },
    })
    const service = governance(repo)

    await assert.rejects(
      () => service.updateBranch(caller, {
        branchId: BRANCH_A,
        branchKey: 'changed',
        expectedVersion: 3,
        name: '广州分会',
        cityName: '广州',
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    await assert.rejects(
      () => service.updateBranch(caller, {
        branchId: BRANCH_A,
        expectedVersion: 3,
        name: '广州分会',
        cityName: '广州',
      }),
      error => error === conflict,
    )

    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    await assert.rejects(
      () => service.createBranch(caller, {
        branchKey: 'foshan',
        name: '佛山分会',
        cityName: '佛山',
      }),
      error => error?.code === 'FORBIDDEN',
    )
  })

  it('uses server event scope for role delegation and keeps candidate search scoped', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = governance(repo)

    const result = await service.setRole(caller, {
      userId: TARGET_ID,
      roleKey: 'EVENT_OWNER',
      scopeId: EVENT_ID,
      branchId: BRANCH_B,
      active: true,
    })
    const set = lastCall(repo, 'setRole').input
    assert.deepEqual(result, {
      userId: TARGET_ID,
      scopeType: 'EVENT',
      scopeId: EVENT_ID,
      roleKey: 'EVENT_OWNER',
    })
    assert.deepEqual(set.authorizedScope, {
      scopeType: 'EVENT',
      scopeId: EVENT_ID,
      branchId: BRANCH_A,
    })
    assert.deepEqual(set.scope, {
      scopeType: 'EVENT',
      scopeId: EVENT_ID,
      branchId: BRANCH_A,
    })
    assert.equal(set.authorization.capability, 'roles.change')
    assert.deepEqual(set.audit, {
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'EVENT',
      scopeId: EVENT_ID,
      action: 'admin.roles.grant',
      resourceType: 'ADMIN_ROLE_BINDING',
      resourceId: TARGET_ID,
      effectiveRole: 'BRANCH_ADMIN',
      metadata: { roleKey: 'EVENT_OWNER', active: true },
    })

    const candidates = await service.searchRoleCandidates(caller, {
      eventId: EVENT_ID,
      query: ' 运营成员 ',
      limit: 100,
    })
    assert.equal(candidates.items[0].id, TARGET_ID)
    assert.deepEqual(lastCall(repo, 'searchRoleCandidates'), {
      type: 'searchRoleCandidates',
      appId: APP_ID,
      query: '运营成员',
      pageLimit: 20,
    })

    const writes = repo.mutationWrites
    await assert.rejects(
      () => service.setRole(caller, {
        userId: TARGET_ID,
        roleKey: 'EVENT_OWNER',
        scopeId: 'missing-event',
        active: true,
      }),
      error => error?.code === 'NOT_FOUND',
    )
    repo.roleBindings = [{ roleKey: 'EVENT_MANAGER', scopeType: 'EVENT', scopeId: EVENT_ID }]
    await assert.rejects(
      () => service.setRole(caller, {
        userId: TARGET_ID,
        roleKey: 'EVENT_OWNER',
        scopeId: EVENT_ID,
        active: true,
      }),
      error => error?.message === '当前账号不能设置活动负责人',
    )
    assert.equal(repo.mutationWrites, writes)
  })

  it('encodes platform role scope server-side and prevents owner self-revocation', async () => {
    const repo = repository()
    const service = governance(repo)

    await service.setRole(caller, {
      userId: TARGET_ID,
      roleKey: 'PLATFORM_OPERATIONS',
      active: true,
    })
    const set = lastCall(repo, 'setRole').input
    assert.equal(set.scope.scopeId, PLATFORM_SCOPE_ID)
    assert.deepEqual(set.authorizedScope, { scopeType: 'PLATFORM', scopeId: null })

    const writes = repo.mutationWrites
    await assert.rejects(
      () => service.setRole(caller, {
        userId: ACTOR_ID,
        roleKey: 'PLATFORM_OWNER',
        active: false,
      }),
      error => error?.code === 'INVALID_STATE',
    )
    assert.equal(repo.mutationWrites, writes)
  })

  it('lists role visibility with a read audit and hides administrative scopes from branch roles', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = governance(repo)
    const page = await service.listRoles(caller)
    const call = lastCall(repo, 'listRoles')

    assert.equal(page.items.length, 1)
    assert.deepEqual(call.visibility, {
      platform: false,
      branchIds: [BRANCH_A],
      eventIds: [],
    })
    assert.deepEqual(call.options, { includeAdministrativeScopes: false })
    assert.deepEqual(repo.audits.at(-1), {
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'BRANCH',
      scopeId: BRANCH_A,
      action: 'admin.roles.view',
      resourceType: 'ADMIN_ROLE_BINDING_LIST',
      resourceId: null,
      effectiveRole: 'BRANCH_ADMIN',
      metadata: { count: 1 },
    })
  })

  it('keeps capability policy defaults and custom projections owner-only', async () => {
    const repo = repository()
    repo.storedPolicies = [{
      roleKey: 'EVENT_STAFF',
      capabilities: [CAPABILITIES.DASHBOARD, CAPABILITIES.EVENTS_READ],
      mode: 'CUSTOM',
      version: 7,
      updatedAt: '2030-08-24T00:00:00.000Z',
    }]
    const service = governance(repo)

    const page = await service.listRoleCapabilityPolicies(caller)
    const custom = page.items.find(item => item.roleKey === 'EVENT_STAFF')
    const defaultPolicy = page.items.find(item => item.roleKey === 'BRANCH_ADMIN')
    assert.equal(page.items.length, 6)
    assert.equal(page.items.some(item => item.roleKey === 'PLATFORM_OWNER'), false)
    assert.deepEqual(custom, {
      roleKey: 'EVENT_STAFF',
      scopeType: 'EVENT',
      allowedCapabilities: roleCapabilities.EVENT_STAFF,
      capabilities: [CAPABILITIES.DASHBOARD, CAPABILITIES.EVENTS_READ],
      version: 7,
      source: 'CUSTOM',
      updatedAt: '2030-08-24T00:00:00.000Z',
    })
    assert.equal(defaultPolicy.source, 'DEFAULT')
    assert.deepEqual(defaultPolicy.capabilities, roleCapabilities.BRANCH_ADMIN)
    assert.equal(repo.audits.at(-1).action, 'admin.role_capability_policies.view')

    const updated = await service.updateRoleCapabilityPolicy(caller, {
      roleKey: 'EVENT_STAFF',
      capabilities: [CAPABILITIES.EVENTS_READ, CAPABILITIES.DASHBOARD],
      expectedVersion: 7,
    })
    assert.deepEqual(updated.capabilities, [CAPABILITIES.DASHBOARD, CAPABILITIES.EVENTS_READ])
    assert.equal(updated.version, 8)
    assert.equal(updated.source, 'CUSTOM')
    const update = lastCall(repo, 'updateRoleCapabilityPolicy').input
    assert.equal(update.now, NOW)
    assert.equal(update.authorization.effectiveGrant.roleKey, 'PLATFORM_OWNER')
    assert.deepEqual(update.audit.metadata, {
      roleKey: 'EVENT_STAFF',
      expectedVersion: 7,
      capabilities: [CAPABILITIES.DASHBOARD, CAPABILITIES.EVENTS_READ],
    })

    const reset = await service.updateRoleCapabilityPolicy(caller, {
      roleKey: 'EVENT_STAFF',
      expectedVersion: 8,
      reset: true,
    })
    assert.equal(reset.source, 'DEFAULT')
    assert.deepEqual(reset.capabilities, roleCapabilities.EVENT_STAFF)
    assert.deepEqual(lastCall(repo, 'resetRoleCapabilityPolicy').input.audit.metadata, {
      roleKey: 'EVENT_STAFF',
      expectedVersion: 8,
    })

    repo.roleBindings = [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }]
    await assert.rejects(
      () => service.listRoleCapabilityPolicies(caller),
      error => error?.code === 'FORBIDDEN',
    )
  })

  it('preserves policy validation and repository CAS errors', async () => {
    const conflict = new AdminError('CONFLICT', '权限策略已更新')
    const repo = repository({
      async updateRoleCapabilityPolicy() {
        throw conflict
      },
    })
    const service = governance(repo)

    await assert.rejects(
      () => service.updateRoleCapabilityPolicy(caller, {
        roleKey: 'EVENT_STAFF',
        capabilities: [CAPABILITIES.REFUNDS_SUBMIT],
        expectedVersion: 0,
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    await assert.rejects(
      () => service.updateRoleCapabilityPolicy(caller, {
        roleKey: 'EVENT_STAFF',
        capabilities: [CAPABILITIES.EVENTS_READ],
        expectedVersion: 0,
      }),
      error => error === conflict,
    )
  })

  it('applies capability visibility, cursor, and read auditing to audit history', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = governance(repo)
    const cursor = encodeCursor({ createdAt: '2030-08-24T00:00:00.000Z', id: AUDIT_ID })
    const filters = { action: 'admin.events.update', resourceType: 'EVENT' }

    const page = await service.listAudit(caller, { filters, limit: 500, cursor })
    const call = lastCall(repo, 'listAudit')
    assert.equal(page.nextCursor, 'next-audit')
    assert.deepEqual(call.args, [
      APP_ID,
      { platform: false, branchIds: [BRANCH_A], eventIds: [] },
      filters,
      50,
      { v: 1, createdAt: '2030-08-24T00:00:00.000Z', id: AUDIT_ID },
    ])
    assert.deepEqual(repo.audits.at(-1), {
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'BRANCH',
      scopeId: BRANCH_A,
      action: 'admin.audit.view',
      resourceType: 'AUDIT_LOG_LIST',
      resourceId: null,
      effectiveRole: 'BRANCH_ADMIN',
      metadata: { count: 1, filters },
    })

    repo.roleBindings = [{ roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: EVENT_ID }]
    await assert.rejects(
      () => service.listAudit(caller),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(repo.auditReads, 1)
  })

  it('limits operational exceptions by current platform role and audits successful reads', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null }]
    const service = governance(repo)

    const page = await service.listOperationalExceptions(caller, {
      type: 'payment',
      status: 'failed',
      limit: 500,
    })
    assert.deepEqual(page.availableTypes, ['REFUND', 'PAYMENT'])
    assert.equal(page.nextCursor, null)
    assert.deepEqual(lastCall(repo, 'listOperationalExceptions').request, {
      types: ['PAYMENT'],
      statuses: ['FAILED'],
      type: 'PAYMENT',
      status: 'FAILED',
      limit: 100,
    })
    assert.deepEqual(repo.audits.at(-1), {
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.operational_exceptions.view',
      resourceType: 'OPERATIONAL_EXCEPTION_LIST',
      resourceId: null,
      effectiveRole: 'PLATFORM_FINANCE',
      metadata: { count: 1, type: 'PAYMENT', status: 'FAILED', limit: 100 },
    })

    repo.roleBindings = [{ roleKey: 'EVENT_OWNER', scopeType: 'EVENT', scopeId: EVENT_ID }]
    await assert.rejects(
      () => service.listOperationalExceptions(caller),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(repo.exceptionReads, 1)
  })

  it('composes governance into the service while preserving the platform scope export', async () => {
    const repo = repository()
    const service = createAdminService({ repository: repo, now: () => NOW })

    assert.equal(SERVICE_PLATFORM_SCOPE_ID, PLATFORM_SCOPE_ID)
    assert.deepEqual(await service.listBranches(caller), {
      items: [branchRow()],
      nextCursor: null,
    })
    const policies = await service.listRoleCapabilityPolicies(caller)
    assert.equal(policies.items.length, 6)
  })
})
