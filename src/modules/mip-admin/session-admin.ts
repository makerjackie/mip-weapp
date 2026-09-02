import type { MipAdminGateway } from './types'

export type SessionAdminGateway = Pick<
  MipAdminGateway,
  'getSession' | 'confirmWebLogin'
>

interface SessionAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
}

export interface MipAdminSessionModule {
  get: (force?: boolean) => ReturnType<MipAdminGateway['getSession']>
  confirmWebLogin: MipAdminGateway['confirmWebLogin']
}

export function createMipAdminSession(
  gateway: SessionAdminGateway,
  cache: SessionAdminCache,
): MipAdminSessionModule {
  return {
    get: (force = false) => cache.query('mip-admin:session', gateway.getSession, { force }),
    confirmWebLogin: gateway.confirmWebLogin,
  }
}
