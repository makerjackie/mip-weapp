import type { AdminOperationsQueueState } from './operations-queue'
import type { MipAdminGateway } from './types'

interface GovernanceAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

type AuditListInput = NonNullable<Parameters<MipAdminGateway['listAudit']>[0]>
type OperationalExceptionListInput
  = NonNullable<Parameters<MipAdminGateway['listOperationalExceptions']>[0]>
    & { cursor?: string }

export interface MipGovernanceAdmin {
  getSession: (force?: boolean) => ReturnType<MipAdminGateway['getSession']>
  listBranches: (force?: boolean) => ReturnType<MipAdminGateway['listBranches']>
  createBranch: MipAdminGateway['createBranch']
  updateBranch: MipAdminGateway['updateBranch']
  changeBranchStatus: MipAdminGateway['changeBranchStatus']
  listRoles: (force?: boolean) => ReturnType<MipAdminGateway['listRoles']>
  searchRoleCandidates: MipAdminGateway['searchRoleCandidates']
  setRole: MipAdminGateway['setRole']
  listRoleCapabilityPolicies: (
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listRoleCapabilityPolicies']>
  updateRoleCapabilityPolicy: MipAdminGateway['updateRoleCapabilityPolicy']
  resetRoleCapabilityPolicy: MipAdminGateway['resetRoleCapabilityPolicy']
  listAudit: (
    input?: AuditListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listAudit']>
  listOperationalExceptions: (
    input?: OperationalExceptionListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listOperationalExceptions']>
  listOperationsQueue: (
    input?: { state?: AdminOperationsQueueState | '', cursor?: string, limit?: number },
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listOperationsQueue']>
}

const cacheKeys = {
  admin: 'mip-admin',
  session: 'mip-admin:session',
  branches: 'mip-admin:branches',
  roles: 'mip-admin:roles',
  rolePolicies: 'mip-admin:role-capability-policies',
  audit: 'mip-admin:audit',
  exceptions: 'mip-admin:exceptions',
  operationsQueue: 'mip-admin:operations-queue',
} as const

export function createMipGovernanceAdmin(
  gateway: MipAdminGateway,
  cache: GovernanceAdminCache,
): MipGovernanceAdmin {
  const mutate = async <T>(work: () => Promise<T>, invalidate: () => void) => {
    const result = await work()
    invalidate()
    return result
  }
  const invalidateAdmin = () => cache.invalidate(cacheKeys.admin)
  const invalidateRoleBinding = (input: Record<string, unknown>) => {
    cache.invalidate(cacheKeys.roles)
    cache.invalidate(cacheKeys.session)
    cache.invalidate(cacheKeys.audit)
    if (typeof input.userId === 'string') {
      cache.invalidate(`mip-admin:user:${input.userId}`)
    }
    if (input.roleKey === 'BRANCH_ADMIN') {
      cache.invalidate(cacheKeys.branches)
    }
  }

  return {
    getSession: (force = false) => cache.query(cacheKeys.session, gateway.getSession, { force }),
    listBranches: (force = false) => cache.query(cacheKeys.branches, gateway.listBranches, { force }),
    createBranch: input => mutate(() => gateway.createBranch(input), invalidateAdmin),
    updateBranch: input => mutate(() => gateway.updateBranch(input), invalidateAdmin),
    changeBranchStatus: input => mutate(() => gateway.changeBranchStatus(input), invalidateAdmin),
    listRoles: (force = false) => cache.query(cacheKeys.roles, gateway.listRoles, { force }),
    searchRoleCandidates: (eventId, query) => gateway.searchRoleCandidates(eventId, query),
    setRole: input => mutate(() => gateway.setRole(input), () => invalidateRoleBinding(input)),
    listRoleCapabilityPolicies: (force = false) => cache.query(
      cacheKeys.rolePolicies,
      gateway.listRoleCapabilityPolicies,
      { force },
    ),
    updateRoleCapabilityPolicy: input => mutate(
      () => gateway.updateRoleCapabilityPolicy(input),
      invalidateAdmin,
    ),
    resetRoleCapabilityPolicy: input => mutate(
      () => gateway.resetRoleCapabilityPolicy(input),
      invalidateAdmin,
    ),
    listAudit: (input: AuditListInput = {}, force = false) => cache.query(
      `${cacheKeys.audit}:${JSON.stringify(input)}`,
      () => gateway.listAudit(input),
      { force },
    ),
    listOperationalExceptions: (
      input: OperationalExceptionListInput = {},
      force = false,
    ) => cache.query(
      `${cacheKeys.exceptions}:${JSON.stringify(input)}`,
      () => gateway.listOperationalExceptions(input),
      { force },
    ),
    listOperationsQueue: (input = {}, force = false) => cache.query(
      `${cacheKeys.operationsQueue}:${JSON.stringify(input)}`,
      () => gateway.listOperationsQueue(input),
      { force },
    ),
  }
}
