import type { MipGovernanceAdmin } from '../src/modules/mip-admin/governance-admin'
import type { AdminBranch, AdminRoleCapabilityPolicy, MipAdminGateway } from '../src/modules/mip-admin/types'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { MipAdminError } from '../src/modules/mip-admin/types'

const branch: AdminBranch = {
  id: 'branch-a',
  branchKey: 'shenzhen',
  name: '深圳分会',
  cityName: '深圳',
  summary: '深圳城市分会',
  status: 'ACTIVE',
  version: 1,
  currentPlayerCount: 4,
  branchAdminNames: ['管理员甲'],
  blockers: {
    activeMemberships: 0,
    activeBranchAdmins: 0,
    publishedEvents: 0,
    publishedOpportunities: 0,
  },
}

const rolePolicy: AdminRoleCapabilityPolicy = {
  roleKey: 'PLATFORM_OPERATIONS',
  scopeType: 'PLATFORM',
  allowedCapabilities: ['users.read', 'events.read'],
  capabilities: ['users.read'],
  version: 1,
  source: 'CUSTOM',
  updatedAt: '2026-08-25T00:00:00.000Z',
}

function createHarness() {
  const spies = {
    getSession: vi.fn<MipAdminGateway['getSession']>(async () => ({
      enabled: true,
      capabilities: [],
      roles: [],
    })),
    listBranches: vi.fn<MipAdminGateway['listBranches']>(async () => ({ items: [branch], nextCursor: null })),
    createBranch: vi.fn<MipAdminGateway['createBranch']>(async () => branch),
    updateBranch: vi.fn<MipAdminGateway['updateBranch']>(async () => ({ ...branch, version: 2 })),
    changeBranchStatus: vi.fn<MipAdminGateway['changeBranchStatus']>(async input => ({
      ...branch,
      status: input.status,
      version: 2,
    })),
    listRoles: vi.fn<MipAdminGateway['listRoles']>(async () => ({ items: [], nextCursor: null })),
    searchRoleCandidates: vi.fn<MipAdminGateway['searchRoleCandidates']>(async () => ({
      items: [],
      nextCursor: null,
    })),
    setRole: vi.fn<MipAdminGateway['setRole']>(async () => ({ active: true })),
    listRoleCapabilityPolicies: vi.fn<MipAdminGateway['listRoleCapabilityPolicies']>(async () => ({
      items: [rolePolicy],
      nextCursor: null,
    })),
    updateRoleCapabilityPolicy: vi.fn<MipAdminGateway['updateRoleCapabilityPolicy']>(async input => ({
      ...rolePolicy,
      capabilities: input.capabilities,
      version: 2,
    })),
    resetRoleCapabilityPolicy: vi.fn<MipAdminGateway['resetRoleCapabilityPolicy']>(async () => ({
      ...rolePolicy,
      capabilities: [],
      version: 2,
      source: 'DEFAULT',
    })),
    listAudit: vi.fn<MipAdminGateway['listAudit']>(async () => ({ items: [], nextCursor: null })),
    listOperationalExceptions: vi.fn<MipAdminGateway['listOperationalExceptions']>(async () => ({
      items: [],
      nextCursor: null,
      availableTypes: [],
    })),
    listEvents: vi.fn<MipAdminGateway['listEvents']>(async () => ({ items: [], nextCursor: null })),
    listUsers: vi.fn<MipAdminGateway['listUsers']>(async () => ({ items: [], nextCursor: null })),
  }
  const gateway = spies as unknown as MipAdminGateway
  return { module: createMipAdminModule(gateway), spies }
}

const auditInput = {
  filters: { action: 'admin.roles.grant', resourceType: 'ROLE_BINDING' },
  cursor: 'audit-cursor-a',
  limit: 25,
}
const exceptionInput = {
  type: 'REFUND' as const,
  status: 'FAILED' as const,
  cursor: 'exception-cursor-a',
  limit: 25,
}
const eventListInput = { filters: { branchId: branch.id }, cursor: 'event-cursor-a', limit: 25 }
const userListInput = { includePhone: false, filters: { branchId: branch.id }, cursor: 'user-cursor-a', limit: 25 }

const createBranchInput = {
  branchKey: 'guangzhou',
  name: '广州分会',
  cityName: '广州',
  summary: '广州城市分会',
}
const updateBranchInput = {
  branchId: branch.id,
  name: '深圳城市分会',
  cityName: '深圳',
  summary: '更新后的分会介绍',
  expectedVersion: 1,
}
const branchStatusInput = { branchId: branch.id, status: 'INACTIVE' as const, expectedVersion: 1 }
const roleInput = { userId: 'user-a', roleKey: 'EVENT_STAFF', scopeId: 'event-a', active: true }
const branchRoleInput = { userId: 'user-a', roleKey: 'BRANCH_ADMIN', scopeId: branch.id, active: true }
const updatePolicyInput: Parameters<MipAdminGateway['updateRoleCapabilityPolicy']>[0] = {
  roleKey: rolePolicy.roleKey,
  capabilities: ['users.read', 'events.read'],
  expectedVersion: 1,
}
const resetPolicyInput = { roleKey: rolePolicy.roleKey, expectedVersion: 1 }

type QuerySpyName
  = | 'getSession'
    | 'listBranches'
    | 'listRoles'
    | 'listRoleCapabilityPolicies'
    | 'listAudit'
    | 'listOperationalExceptions'
    | 'listEvents'
    | 'listUsers'

const querySpies: QuerySpyName[] = [
  'getSession',
  'listBranches',
  'listRoles',
  'listRoleCapabilityPolicies',
  'listAudit',
  'listOperationalExceptions',
  'listEvents',
  'listUsers',
]

async function warmQueries(module: ReturnType<typeof createHarness>['module']) {
  await Promise.all([
    module.governance.getSession(),
    module.governance.listBranches(),
    module.governance.listRoles(),
    module.governance.listRoleCapabilityPolicies(),
    module.governance.listAudit(auditInput),
    module.governance.listOperationalExceptions(exceptionInput),
    module.events.list(eventListInput),
    module.users.list(userListInput),
  ])
}

interface FullInvalidationMutation {
  name: string
  execute: (governance: MipGovernanceAdmin) => Promise<unknown>
  spy:
    | 'createBranch'
    | 'updateBranch'
    | 'changeBranchStatus'
    | 'updateRoleCapabilityPolicy'
    | 'resetRoleCapabilityPolicy'
  input: unknown
}

function fullInvalidationMutations(): FullInvalidationMutation[] {
  return [
    {
      name: 'createBranch',
      execute: governance => governance.createBranch(createBranchInput),
      spy: 'createBranch',
      input: createBranchInput,
    },
    {
      name: 'updateBranch',
      execute: governance => governance.updateBranch(updateBranchInput),
      spy: 'updateBranch',
      input: updateBranchInput,
    },
    {
      name: 'changeBranchStatus',
      execute: governance => governance.changeBranchStatus(branchStatusInput),
      spy: 'changeBranchStatus',
      input: branchStatusInput,
    },
    {
      name: 'updateRoleCapabilityPolicy',
      execute: governance => governance.updateRoleCapabilityPolicy(updatePolicyInput),
      spy: 'updateRoleCapabilityPolicy',
      input: updatePolicyInput,
    },
    {
      name: 'resetRoleCapabilityPolicy',
      execute: governance => governance.resetRoleCapabilityPolicy(resetPolicyInput),
      spy: 'resetRoleCapabilityPolicy',
      input: resetPolicyInput,
    },
  ]
}

describe('MIP admin governance facade', () => {
  it('uses complete filters, cursors, and limits for audit and exception cache keys', async () => {
    const { module, spies } = createHarness()

    await module.governance.listAudit(auditInput)
    await module.governance.listAudit(auditInput)
    await module.governance.listAudit({ ...auditInput, cursor: 'audit-cursor-b' })
    await module.governance.listAudit({ ...auditInput, limit: 50 })
    await module.governance.listAudit({
      ...auditInput,
      filters: { ...auditInput.filters, resourceType: 'EVENT' },
    })

    await module.governance.listOperationalExceptions(exceptionInput)
    await module.governance.listOperationalExceptions(exceptionInput)
    await module.governance.listOperationalExceptions({ ...exceptionInput, cursor: 'exception-cursor-b' })
    await module.governance.listOperationalExceptions({ ...exceptionInput, limit: 50 })
    await module.governance.listOperationalExceptions({ ...exceptionInput, type: 'PAYMENT' })

    expect(spies.listAudit).toHaveBeenCalledTimes(4)
    expect(spies.listOperationalExceptions).toHaveBeenCalledTimes(4)
    expect(spies.listAudit.mock.calls[0]?.[0]).toBe(auditInput)
    expect(spies.listOperationalExceptions.mock.calls[0]?.[0]).toBe(exceptionInput)
  })

  it('keeps legacy query aliases on the same cache and candidates uncached', async () => {
    const { module, spies } = createHarness()

    await module.getSession()
    await module.governance.getSession()
    await module.listBranches()
    await module.governance.listBranches()
    await module.listRoles()
    await module.governance.listRoles()
    await module.listRoleCapabilityPolicies()
    await module.governance.listRoleCapabilityPolicies()
    await module.listAudit(auditInput)
    await module.governance.listAudit(auditInput)
    await module.listOperationalExceptions(exceptionInput)
    await module.governance.listOperationalExceptions(exceptionInput)
    await module.searchRoleCandidates('event-a', '林')
    await module.governance.searchRoleCandidates('event-a', '林')

    expect(spies.getSession).toHaveBeenCalledTimes(1)
    expect(spies.listBranches).toHaveBeenCalledTimes(1)
    expect(spies.listRoles).toHaveBeenCalledTimes(1)
    expect(spies.listRoleCapabilityPolicies).toHaveBeenCalledTimes(1)
    expect(spies.listAudit).toHaveBeenCalledTimes(1)
    expect(spies.listOperationalExceptions).toHaveBeenCalledTimes(1)
    expect(spies.searchRoleCandidates).toHaveBeenCalledTimes(2)
    expect(spies.searchRoleCandidates.mock.calls).toEqual([
      ['event-a', '林'],
      ['event-a', '林'],
    ])
  })

  it('passes every governance mutation input to the neutral gateway unchanged', async () => {
    const { module, spies } = createHarness()

    for (const mutation of fullInvalidationMutations()) {
      await mutation.execute(module.governance)
      expect(spies[mutation.spy].mock.calls[0]?.[0]).toBe(mutation.input)
    }
    await module.governance.setRole(roleInput)
    expect(spies.setRole.mock.calls[0]?.[0]).toBe(roleInput)
  })

  for (const mutation of fullInvalidationMutations()) {
    it(`conservatively invalidates the full admin cache after ${mutation.name}`, async () => {
      const { module, spies } = createHarness()
      await warmQueries(module)
      await warmQueries(module)

      await mutation.execute(module.governance)
      await warmQueries(module)

      for (const query of querySpies) {
        expect(spies[query]).toHaveBeenCalledTimes(2)
      }
    })
  }

  it('invalidates role, session, and audit caches after an event role change', async () => {
    const { module, spies } = createHarness()
    await warmQueries(module)
    await warmQueries(module)

    await module.governance.setRole(roleInput)
    await warmQueries(module)

    for (const query of querySpies) {
      const invalidated = ['getSession', 'listRoles', 'listAudit'].includes(query)
      expect(spies[query]).toHaveBeenCalledTimes(invalidated ? 2 : 1)
    }
  })

  it('also refreshes branch blockers after a branch-admin role change', async () => {
    const { module, spies } = createHarness()
    await module.governance.listBranches()
    await module.governance.listBranches()

    await module.governance.setRole(branchRoleInput)
    await module.governance.listBranches()

    expect(spies.listBranches).toHaveBeenCalledTimes(2)
    expect(spies.setRole.mock.calls[0]?.[0]).toBe(branchRoleInput)
  })

  it.each([
    ['createBranch', new MipAdminError('CONFLICT', '分会信息已变化')],
    ['setRole', new MipAdminError('FORBIDDEN', '当前账号不能设置该角色')],
    ['updateRoleCapabilityPolicy', new MipAdminError('CONFLICT', '权限策略已变化')],
  ] as const)('keeps cached reads and the original %s failure', async (name, failure) => {
    const { module, spies } = createHarness()
    spies[name].mockRejectedValueOnce(failure)
    await warmQueries(module)

    const work = name === 'createBranch'
      ? module.governance.createBranch(createBranchInput)
      : name === 'setRole'
        ? module.governance.setRole(roleInput)
        : module.governance.updateRoleCapabilityPolicy(updatePolicyInput)
    await expect(work).rejects.toBe(failure)
    await warmQueries(module)

    for (const query of querySpies) {
      expect(spies[query]).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps governance pages behind the governance, events, and users facades', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const pages = [
      'src/packages/admin/branches/index.ts',
      'src/packages/admin/roles/index.ts',
      'src/packages/admin/event-managers/index.ts',
      'src/packages/admin/audit/index.ts',
      'src/packages/admin/exceptions/index.ts',
    ]
    const sources: string[] = []
    for (const page of pages) {
      const source = fs.readFileSync(path.join(root, page), 'utf8')
      sources.push(source)
      expect(source).toContain('mipAdminModule.governance.')
      expect(source).not.toContain('mipAdminModule.gateway')
      expect(source).not.toContain('mipAdminModule.mutate')
      expect(source).not.toContain('mipAdminModule.setRole')
    }
    const roles = sources[1]
    const eventManagers = sources[2]
    expect(roles).toContain('mipAdminModule.events.list(')
    expect(roles).toContain('mipAdminModule.users.list(')
    expect(eventManagers).toContain('mipAdminModule.events.get(')
    const mutationCalls = new Set([...sources.join('\n').matchAll(
      /mipAdminModule\.governance\.(createBranch|updateBranch|changeBranchStatus|setRole|updateRoleCapabilityPolicy|resetRoleCapabilityPolicy)\(/g,
    )].map(match => match[1]))
    expect([...mutationCalls].sort()).toEqual([
      'changeBranchStatus',
      'createBranch',
      'resetRoleCapabilityPolicy',
      'setRole',
      'updateBranch',
      'updateRoleCapabilityPolicy',
    ].sort())
  })
})
