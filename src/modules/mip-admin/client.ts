import type { PendingAdminExportStore } from './pending-export'
import type {
  AdminCapability,
  AdminCapabilityGrant,
  MipAdminGateway,
} from './types'
import { createQueryCache } from '@weapp/shared/cache'
import { createMipCommunityAdmin } from './community-admin'
import { createMipEventsAdmin } from './events-admin'
import { createMipExportsAdmin } from './exports-admin'
import { createMipGovernanceAdmin } from './governance-admin'
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
  const community = createMipCommunityAdmin(gateway, cache)
  const growth = createMipGrowthAdmin(gateway, cache)
  const events = createMipEventsAdmin(gateway, cache)
  const exports = createMipExportsAdmin(gateway, cache, options.pendingExportStore)
  const governance = createMipGovernanceAdmin(gateway, cache)
  const messaging = createMipMessagingAdmin(gateway, cache)
  const opportunities = createMipOpportunityAdmin(gateway, cache)
  const orders = createMipOrdersAdmin(gateway, cache)
  const users = createMipUsersAdmin(gateway, cache)
  return {
    getSession: governance.getSession,
    getDashboard: (force = false) => cache.query('mip-admin:dashboard', gateway.getDashboard, { force }),
    listBranches: governance.listBranches,
    getAnnouncementScopes: messaging.getAnnouncementScopes,
    listAnnouncements: messaging.listAnnouncements,
    getAnnouncement: messaging.getAnnouncement,
    getMessageCampaignScopes: messaging.getCampaignScopes,
    listMessageCampaigns: messaging.listCampaigns,
    getMessageCampaign: messaging.getCampaign,
    searchMessageRecipients: messaging.searchRecipients,
    listMessageTemplates: messaging.listTemplates,
    getMessageTemplate: messaging.getTemplate,
    messaging,
    listCommunityReports: community.listReports,
    community,
    listUsers: users.list,
    getUser: users.get,
    users,
    listEvents: events.list,
    getEventPolicy: events.getPolicy,
    getEvent: events.get,
    getEventInsights: events.getInsights,
    getEventCommentAdminState: events.getCommentState,
    listEventAlbumPhotos: events.listAlbumPhotos,
    listRoster: events.listRoster,
    listRosterAll: events.listRosterAll,
    events,
    listRoles: governance.listRoles,
    listRoleCapabilityPolicies: governance.listRoleCapabilityPolicies,
    searchRoleCandidates: governance.searchRoleCandidates,
    governance,
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
    listOperationalExceptions: governance.listOperationalExceptions,
    listAudit: governance.listAudit,
    exportAndOpen: exports.createAndOpen,
    getPendingExportStatus: exports.getPendingStatus,
    resumePendingExport: exports.resumeAndOpen,
    clearPendingExport: exports.clearPending,
    exports,
    clearSensitive() {
      cache.invalidate('mip-admin:users')
      cache.invalidate('mip-admin:roster')
    },
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
