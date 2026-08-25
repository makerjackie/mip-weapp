import type { AdminAnnouncementFilters } from './announcements'
import type { ExportProgress } from './export-download'
import type { AdminMessageCampaignStatus } from './message-campaigns'
import type { AdminOperationalExceptionFilters } from './operational-exceptions'
import type { PendingAdminExportStore } from './pending-export'
import type {
  AdminCapability,
  AdminCapabilityGrant,
  AdminCommunityReportStatus,
  AdminEventAlbumPhotoStatus,
  AdminOrderListInput,
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
import { createMipOpportunityAdmin } from './opportunity-admin'

export function createMipAdminModule(
  gateway: MipAdminGateway,
  options: { pendingExportStore?: PendingAdminExportStore } = {},
) {
  const cache = createQueryCache(15_000)
  const refresh = () => {
    cache.invalidate('mip-admin')
  }
  const opportunities = createMipOpportunityAdmin(gateway, cache)
  return {
    getSession: (force = false) => cache.query('mip-admin:session', gateway.getSession, { force }),
    getDashboard: (force = false) => cache.query('mip-admin:dashboard', gateway.getDashboard, { force }),
    listBranches: (force = false) => cache.query('mip-admin:branches', gateway.listBranches, { force }),
    getAnnouncementScopes: (force = false) => cache.query(
      'mip-admin:announcement-scopes',
      gateway.getAnnouncementScopes,
      { force },
    ),
    listAnnouncements: (input: AdminAnnouncementFilters = {}, force = false) => cache.query(
      `mip-admin:announcements:${JSON.stringify(input)}`,
      () => gateway.listAnnouncements(input),
      { force },
    ),
    getAnnouncement: (announcementId: string, force = false) => cache.query(
      `mip-admin:announcement:${announcementId}`,
      () => gateway.getAnnouncement(announcementId),
      { force },
    ),
    getMessageCampaignScopes: (force = false) => cache.query(
      'mip-admin:message-campaign-scopes',
      gateway.getMessageCampaignScopes,
      { force },
    ),
    listMessageCampaigns: (
      input: { status?: AdminMessageCampaignStatus | '', query?: string } = {},
      force = false,
    ) => cache.query(
      `mip-admin:message-campaigns:${JSON.stringify(input)}`,
      () => gateway.listMessageCampaigns(input),
      { force },
    ),
    getMessageCampaign: (campaignId: string, force = false) => cache.query(
      `mip-admin:message-campaign:${campaignId}`,
      () => gateway.getMessageCampaign(campaignId),
      { force },
    ),
    searchMessageRecipients: (input: { branchId?: string | null, query?: string } = {}) => (
      gateway.searchMessageRecipients(input)
    ),
    listCommunityReports: (status: AdminCommunityReportStatus, force = false) => cache.query(
      `mip-admin:community-reports:${status}`,
      () => gateway.listCommunityReports(status),
      { force },
    ),
    listUsers: (input: Record<string, unknown> = {}, force = false) => input.includePhone === true
      ? gateway.listUsers(input)
      : cache.query(
          `mip-admin:users:${JSON.stringify(input)}`,
          () => gateway.listUsers(input),
          { force },
        ),
    getUser: (userId: string, includePhone = false, force = false) => includePhone
      ? gateway.getUser(userId, true)
      : cache.query(
          `mip-admin:user:${userId}`,
          () => gateway.getUser(userId, false),
          { force },
        ),
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
    listGrowthLevels: (force = false) => cache.query('mip-admin:growth-levels', gateway.listGrowthLevels, { force }),
    listGrowthBenefits: (force = false) => cache.query('mip-admin:growth-benefits', gateway.listGrowthBenefits, { force }),
    listGrowthRules: (force = false) => cache.query('mip-admin:growth-rules', gateway.listGrowthRules, { force }),
    listGrowthEntries: (input: Record<string, unknown> = {}, force = false) => cache.query(
      `mip-admin:growth-entries:${JSON.stringify(input)}`,
      () => gateway.listGrowthEntries(input),
      { force },
    ),
    listBadges: (force = false) => cache.query('mip-admin:badges', gateway.listBadges, { force }),
    listBadgeAwards: (input: { query?: string, status?: 'ACTIVE' | 'REVOKED' | '' } = {}, force = false) => cache.query(
      `mip-admin:badge-awards:${JSON.stringify(input)}`,
      () => gateway.listBadgeAwards(input),
      { force },
    ),
    listOrders: (input: AdminOrderListInput = {}, force = false) => cache.query(
      `mip-admin:orders:${JSON.stringify(input)}`,
      () => gateway.listOrders(input),
      { force },
    ),
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
