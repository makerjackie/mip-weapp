import type { MipAdminGateway } from './types'

interface UsersAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

type UserListInput = NonNullable<Parameters<MipAdminGateway['listUsers']>[0]>

export interface MipUsersAdmin {
  list: (
    input?: UserListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listUsers']>
  get: (
    userId: Parameters<MipAdminGateway['getUser']>[0],
    includePhone?: Parameters<MipAdminGateway['getUser']>[1],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getUser']>
  update: MipAdminGateway['updateUser']
  setControl: MipAdminGateway['setUserControl']
}

const cacheKeys = {
  lists: 'mip-admin:users',
  detail: 'mip-admin:user',
} as const

export function createMipUsersAdmin(
  gateway: MipAdminGateway,
  cache: UsersAdminCache,
): MipUsersAdmin {
  const mutate = async <T>(work: () => Promise<T>) => {
    const result = await work()
    cache.invalidate(cacheKeys.lists)
    cache.invalidate(cacheKeys.detail)
    return result
  }

  return {
    list: (input: UserListInput = {}, force = false) => input.includePhone === true
      ? gateway.listUsers(input)
      : cache.query(
          `${cacheKeys.lists}:${JSON.stringify(input)}`,
          () => gateway.listUsers(input),
          { force },
        ),
    get: (userId, includePhone = false, force = false) => includePhone
      ? gateway.getUser(userId, true)
      : cache.query(
          `${cacheKeys.detail}:${userId}`,
          () => gateway.getUser(userId, false),
          { force },
        ),
    update: input => mutate(() => gateway.updateUser(input)),
    setControl: input => mutate(() => gateway.setUserControl(input)),
  }
}
