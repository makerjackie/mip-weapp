import type { AdminCommunityReportStatus, MipAdminGateway } from './types'

export type CommunityAdminGateway = Pick<
  MipAdminGateway,
  'listCommunityReports' | 'claimCommunityReport' | 'closeCommunityReport'
>

interface CommunityAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

export interface MipCommunityAdmin {
  listReports: (
    status: AdminCommunityReportStatus,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listCommunityReports']>
  claimReport: MipAdminGateway['claimCommunityReport']
  closeReport: MipAdminGateway['closeCommunityReport']
}

const cacheKeys = {
  reports: 'mip-admin:community-reports',
  audit: 'mip-admin:audit',
} as const

export function createMipCommunityAdmin(
  gateway: CommunityAdminGateway,
  cache: CommunityAdminCache,
): MipCommunityAdmin {
  const mutate = async <T>(work: () => Promise<T>) => {
    const result = await work()
    cache.invalidate(cacheKeys.reports)
    cache.invalidate(cacheKeys.audit)
    return result
  }

  return {
    listReports: (status, force = false) => cache.query(
      `${cacheKeys.reports}:${status}`,
      () => gateway.listCommunityReports(status),
      { force },
    ),
    claimReport: input => mutate(() => gateway.claimCommunityReport(input)),
    closeReport: input => mutate(() => gateway.closeCommunityReport(input)),
  }
}
