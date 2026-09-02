import type { MipAdminGateway } from './types'

export type DashboardAdminGateway = Pick<
  MipAdminGateway,
  'getDashboard' | 'getDashboardOverview'
>

interface DashboardAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
}

export interface MipDashboardAdmin {
  get: (force?: boolean) => ReturnType<MipAdminGateway['getDashboard']>
  getOverview: (
    input?: Parameters<MipAdminGateway['getDashboardOverview']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getDashboardOverview']>
}

export function createMipDashboardAdmin(
  gateway: DashboardAdminGateway,
  cache: DashboardAdminCache,
): MipDashboardAdmin {
  return {
    get: (force = false) => cache.query('mip-admin:dashboard', gateway.getDashboard, { force }),
    getOverview: (input = {}, force = false) => cache.query(
      `mip-admin:dashboard-overview:${JSON.stringify(input)}`,
      () => gateway.getDashboardOverview(input),
      { force },
    ),
  }
}
