import type {
  BranchId,
  CityBranchSummary,
  EntitlementProjection,
  UserId,
  UserSummary,
} from '../../src/modules/mip'
import { resolveUserKind } from '../../src/modules/mip'

const NOW = new Date('2026-08-24T00:00:00.000Z')

export function userId(value = '10000000-0000-4000-8000-000000000001'): UserId {
  return value as UserId
}

export function branchId(value = '20000000-0000-4000-8000-000000000001'): BranchId {
  return value as BranchId
}

export function activeEntitlement(
  overrides: Partial<EntitlementProjection> = {},
): EntitlementProjection {
  return {
    status: 'ACTIVE',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function cityBranch(overrides: Partial<CityBranchSummary> = {}): CityBranchSummary {
  return {
    id: branchId(),
    name: '深圳分会',
    cityName: '深圳',
    status: 'ACTIVE',
    ...overrides,
  }
}

export function userSummary(options: {
  entitlement?: EntitlementProjection | null
  overrides?: Partial<UserSummary>
} = {}): UserSummary {
  const entitlement = options.entitlement ?? null
  return {
    id: userId(),
    kind: resolveUserKind(entitlement, NOW),
    nickname: '测试用户',
    primaryBranchId: branchId(),
    ...options.overrides,
  }
}
