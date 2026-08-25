import type { ExportProgress } from './export-download'
import type { AdminOperationalExceptionFilters } from './operational-exceptions'
import type { PendingAdminExportStore } from './pending-export'
import type {
  AdminCapability,
  AdminCapabilityGrant,
  AdminCommunityReportStatus,
  AdminEventAlbumPhotoStatus,
  AdminRosterAllListInput,
  AdminRosterListInput,
  MipAdminGateway,
} from './types'
import { createQueryCache } from '@weapp/shared/cache'
import {
  createAndOpenExport,
  getPendingAdminExportStatus,
  resumeAndOpenPendingAdminExport,
} from './export-download'
import { createMipGrowthAdmin } from './growth-admin'
import { createMipMessagingAdmin } from './messaging-admin'
import { createMipOpportunityAdmin } from './opportunity-admin'
import { createMipOrdersAdmin } from './orders-admin'
import { createMipUsersAdmin } from './users-admin'

export function createMipAdminModule(
  gateway: MipAdminGateway,
  options: { pendingExportStore?: PendingAdminExportStore } = {},
) {
  const cache = createQueryCache(15_000)
  const refresh = () => {
    cache.invalidate('mip-admin')
  }
  const growth = createMipGrowthAdmin(gateway, cache)
  const messaging = createMipMessagingAdmin(gateway, cache)
  const opportunities = createMipOpportunityAdmin(gateway, cache)
  const orders = createMipOrdersAdmin(gateway, cache)
  const users = createMipUsersAdmin(gateway, cache)
  return {
    getSession: (force = false) => cache.query('mip-admin:session', gateway.getSession, { force }),
    getDashboard: (force = false) => cache.query('mip-admin:dashboard', gateway.getDashboard, { force }),
    listBranches: (force = false) => cache.query('mip-admin:branches', gateway.listBranches, { force }),
    getAnnouncementScopes: messaging.getAnnouncementScopes,
    listAnnouncements: messaging.listAnnouncements,
    getAnnouncement: messaging.getAnnouncement,
    getMessageCampaignScopes: messaging.getCampaignScopes,
    listMessageCampaigns: messaging.listCampaigns,
    getMessageCampaign: messaging.getCampaign,
    searchMessageRecipients: messaging.searchRecipients,
    messaging,
    listCommunityReports: (status: AdminCommunityReportStatus, force = false) => cache.query(
      `mip-admin:community-reports:${status}`,
      () => gateway.listCommunityReports(status),
      { force },
    ),
    listUsers: users.list,
    getUser: users.get,
    users,
    listEvents: (input: Record<string, unknown> = {}, force = false) => cache.query(
      `mip-admin:events:${JSON.stringify(input)}`,
      () => gateway.listEvents(input),
      { force },
    ),
    getEventPolicy: (force = false) => cache.query(
      'mip-admin:event-policy',
      gateway.getEventPolicy,
      { force },
    ),
    getEvent: (eventId: string, force = false) => cache.query(
      `mip-admin:event:${eventId}`,
      () => gateway.getEvent(eventId),
      { force },
    ),
    listEventAlbumPhotos: (eventId: string, status: AdminEventAlbumPhotoStatus, force = false) => cache.query(
      `mip-admin:event-album:${eventId}:${status}`,
      () => gateway.listEventAlbumPhotos(eventId, status),
      { force },
    ),
    listRoster: (input: AdminRosterListInput, force = false) => input.includePhone === true
      ? gateway.listRoster(input)
      : cache.query(
          `mip-admin:roster:${JSON.stringify(input)}`,
          () => gateway.listRoster(input),
          { force },
        ),
    listRosterAll: (input: AdminRosterAllListInput = {}, force = false) => input.includePhone === true
      ? gateway.listRosterAll(input)
      : cache.query(
          `mip-admin:roster-all:${JSON.stringify(input)}`,
          () => gateway.listRosterAll(input),
          { force },
        ),
    listRoles: (force = false) => cache.query('mip-admin:roles', gateway.listRoles, { force }),
    listRoleCapabilityPolicies: (force = false) => cache.query(
      'mip-admin:role-capability-policies',
      gateway.listRoleCapabilityPolicies,
      { force },
    ),
    searchRoleCandidates: (eventId: string, query: string) => gateway.searchRoleCandidates(eventId, query),
    listOpportunities: opportunities.list,
    getOpportunity: opportunities.get,
    getOpportunityCommentAdminState: opportunities.getCommentState,
    getMatchingAdminState: opportunities.getMatchingState,
    getOpportunityEditorOptions: opportunities.getEditorOptions,
    opportunities,
    listGrowthLevels: growth.listLevels,
    listGrowthBenefits: growth.listBenefits,
    listGrowthRules: growth.listRules,
    listGrowthEntries: growth.listEntries,
    listBadges: growth.listBadges,
    listBadgeAwards: growth.listBadgeAwards,
    growth,
    listOrders: orders.list,
    orders,
    listOperationalExceptions: (input: AdminOperationalExceptionFilters = {}, force = false) => cache.query(
      `mip-admin:exceptions:${JSON.stringify(input)}`,
      () => gateway.listOperationalExceptions(input),
      { force },
    ),
    listAudit: (input: Record<string, unknown> = {}, force = false) => cache.query(
      `mip-admin:audit:${JSON.stringify(input)}`,
      () => gateway.listAudit(input),
      { force },
    ),
    async mutate<T>(work: () => Promise<T>) {
      const result = await work()
      refresh()
      return result
    },
    exportAndOpen(input: Record<string, unknown>, onProgress?: (progress: ExportProgress) => void) {
      return createAndOpenExport(gateway, input, {
        onProgress,
        pendingStore: options.pendingExportStore,
      })
    },
    getPendingExportStatus(onProgress?: (progress: ExportProgress) => void) {
      return getPendingAdminExportStatus(gateway, {
        onProgress,
        pendingStore: options.pendingExportStore,
      })
    },
    resumePendingExport(onProgress?: (progress: ExportProgress) => void) {
      return resumeAndOpenPendingAdminExport(gateway, {
        onProgress,
        pendingStore: options.pendingExportStore,
      })
    },
    clearPendingExport(ticketId?: string) {
      options.pendingExportStore?.clear(ticketId)
    },
    clearSensitive() {
      cache.invalidate('mip-admin:users')
      cache.invalidate('mip-admin:roster')
    },
    gateway,
  }
}

export function hasCapability(grants: AdminCapabilityGrant[], capability: AdminCapability) {
  return grants.some(item => item.capability === capability)
}

export function hasScopedCapability(
  grants: AdminCapabilityGrant[],
  capability: AdminCapability,
  scope: { scopeType: 'PLATFORM' | 'BRANCH' | 'EVENT', scopeId: string | null, branchId?: string | null },
) {
  return grants.some(item => item.capability === capability && (
    item.scopeType === 'PLATFORM'
    || (item.scopeType === scope.scopeType && item.scopeId === scope.scopeId)
    || (item.scopeType === 'BRANCH' && scope.scopeType === 'EVENT' && item.scopeId === scope.branchId)
  ))
}
