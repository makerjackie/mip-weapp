import type { AdminMembershipGrantInput } from './memberships'
import type { MipAdminGateway } from './types'
import { createAdminMembershipGetRequest } from './memberships'

interface MembershipsAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

export interface MipMembershipsAdmin {
  get: (userId: string, force?: boolean) => ReturnType<MipAdminGateway['getMembership']>
  grant: (input: AdminMembershipGrantInput) => ReturnType<MipAdminGateway['grantMembership']>
}

const cacheKeys = {
  detail: 'mip-admin:membership',
  users: 'mip-admin:users',
  user: 'mip-admin:user',
} as const

export function createMipMembershipsAdmin(
  gateway: MipAdminGateway,
  cache: MembershipsAdminCache,
): MipMembershipsAdmin {
  return {
    get: (userId, force = false) => {
      const request = createAdminMembershipGetRequest(userId)
      return cache.query(
        `${cacheKeys.detail}:${request.userId}`,
        () => gateway.getMembership(request.userId),
        { force },
      )
    },
    grant: async (input) => {
      const result = await gateway.grantMembership(input)
      cache.invalidate(cacheKeys.detail)
      cache.invalidate(cacheKeys.users)
      cache.invalidate(cacheKeys.user)
      return result
    },
  }
}
