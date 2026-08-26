'use strict'

const {
  CAPABILITIES,
  firstGrant,
  visibilityForCapability,
} = require('./capabilities')
const { createAdminAccess } = require('./access')
const { createAdminCommunityGovernance } = require('./community-governance')
const { createDashboardOverview } = require('./dashboard-overview')
const { createEventCatalogAdmin } = require('./event-catalogs')
const { createAdminEventComments } = require('./event-comments')
const { createAdminEvents } = require('./events')
const { createAdminExports } = require('./exports')
const { createAdminGovernance, PLATFORM_SCOPE_ID } = require('./governance')
const { createAdminGrowth } = require('./growth')
const { createAdminBenefitLedger } = require('./benefit-ledger')
const { createAdminMessaging } = require('./messaging')
const { createAdminMemberships } = require('./memberships')
const { createAdminMessageDeliveryReviews } = require('./message-delivery-review-service')
const { createAdminOperationsQueue } = require('./operations-queue')
const { createAdminOpportunities } = require('./opportunities')
const { createAdminOrders } = require('./orders')
const { createAdminUsers } = require('./users')
const { createAdminUserContentGovernance } = require('./user-content-governance')
const { AdminError } = require('./validation')

function createAdminService({
  repository,
  phoneEncryptionKey,
  now = () => new Date(),
  contentSafety = async () => 'ERROR',
  dispatchRefund = async () => ({ status: 'PENDING_RETRY' }),
  dispatchRefunds = async input => ({
    scanned: input.refundIds.length,
    submitted: 0,
    reconciled: 0,
    pending: 0,
    failed: input.refundIds.length,
  }),
  exportStorage = null,
  exportMaxRows = 5_000,
  exportMaxBytes = 8 * 1024 * 1024,
  exportIssuanceTimeoutMs = 15_000,
  profileRefSecret = '',
  reconcileNotificationDelivery = async () => {
    throw new AdminError('DELIVERY_RECONCILE_CONFIG_REQUIRED', '通知投递复核服务尚未配置')
  },
  recalculateMatching = async () => { throw new AdminError('MATCHING_DISPATCH_CONFIG_REQUIRED', '机会撮合重算服务尚未配置') },
}) {
  const access = createAdminAccess({ repository })
  const {
    audit,
    publicBindings,
    session,
  } = access
  const {
    claimCommunityReport,
    closeCommunityReport,
    listCommunityReports,
  } = createAdminCommunityGovernance({ access, repository })
  const {
    changePrimaryBranch,
    getUser,
    listUserInfluence,
    listUsers,
    normalizeExportFilters: normalizeUserFilters,
    setUserControl,
    updateUser,
  } = createAdminUsers({
    access,
    phoneEncryptionKey,
    repository,
  })
  const {
    getUserContent,
    listUserContent,
    saveUserContent,
    archiveUserContent,
    unpublishUserContent,
  } = createAdminUserContentGovernance({ access, contentSafety, repository })
  const {
    archiveEvent,
    changeEventStatus,
    checkIn,
    cloneEvent,
    getEvent,
    getEventInsights,
    getEventPolicy,
    listEventAlbumPhotos,
    listEvents,
    listRoster,
    listRosterAll,
    normalizeExportFilters: normalizeEventFilters,
    publishEventReminder,
    reviewEventAlbumPhoto,
    reviewRegistration,
    saveEvent,
    saveEventPolicy,
    undoCheckIn,
  } = createAdminEvents({
    access,
    contentSafety,
    dispatchCancellationRefunds: dispatchRefundBatchSafely,
    phoneEncryptionKey,
    repository,
  })
  const {
    archiveEventCatalog,
    archiveEventVideoRecap,
    changeEventCatalogStatus,
    changeEventVideoRecapStatus,
    getEventTagAssignments,
    getEventVideoRecap,
    listEventCatalogs,
    listEventVideoRecaps,
    saveEventCatalog,
    saveEventVideoRecap,
    replaceEventTagAssignments,
  } = createEventCatalogAdmin({ access, repository })
  const {
    claimEventCommentReport,
    closeEventCommentReport,
    getEventCommentAdminState,
    moderateEventComment,
    saveEventCommentSettings,
  } = createAdminEventComments({ access, repository })
  const {
    getOrder,
    listOrders,
    normalizeExportFilters: normalizeOrderFilters,
    retryRefund,
    submitRefund,
  } = createAdminOrders({
    access,
    dispatchProviderRefund: dispatchRefund,
    repository,
  })
  const {
    activateMessageTemplate,
    archiveMessageTemplate,
    cancelMessageCampaignSchedule,
    getAnnouncement,
    getMessageCampaign,
    getMessageTemplate,
    listAnnouncements,
    listAnnouncementScopes,
    listMessageCampaignScopes,
    listMessageCampaigns,
    listMessageDeliveryRecords,
    listMessageTemplates,
    publishAnnouncement,
    publishMessageCampaign,
    saveAnnouncement,
    saveMessageCampaign,
    saveMessageTemplate,
    searchMessageRecipients,
    scheduleMessageCampaign,
    setAnnouncementPinned,
    snapshotMessageCampaign,
    withdrawAnnouncement,
    withdrawMessageCampaign,
  } = createAdminMessaging({
    access,
    contentSafety,
    profileRefSecret,
    repository,
  })
  const {
    claimMessageDeliveryReview,
    getMessageDeliveryReview,
    listMessageDeliveryReviews,
    reconcileMessageDeliveryReview,
    resolveMessageDeliveryReview,
  } = createAdminMessageDeliveryReviews({
    access,
    now,
    reconcileNotificationDelivery,
    repository,
  })
  const { listOperationsQueue } = createAdminOperationsQueue({ access, now, repository })
  const {
    archiveOpportunity,
    closeOpportunityCommentReport,
    endOpportunity,
    getMatchingAdminState,
    getOpportunity,
    getOpportunityCommentAdminState,
    getOpportunityEditorOptions,
    listOpportunities,
    moderateOpportunityComment,
    normalizeExportFilters: normalizeOpportunityFilters,
    publishOpportunity,
    recalculateOpportunityMatching,
    saveMatchingSettings,
    saveOpportunity,
    saveOpportunityCommentSettings,
    unpublishOpportunity,
  } = createAdminOpportunities({
    access,
    contentSafety,
    dispatchMatchingRecalculation: recalculateMatching,
    profileRefSecret,
    repository,
  })
  const {
    adjustGrowth,
    grantBadge,
    listBadgeAwards,
    listBadges,
    listGrowthBenefits,
    listGrowthEntries,
    listGrowthLevelTransitions,
    listGrowthLevels,
    listGrowthRules,
    normalizeExportFilters: normalizeGrowthEntryFilters,
    revokeBadge,
    saveBadge,
    saveGrowthBenefit,
    saveGrowthLevel,
    saveGrowthRule,
  } = createAdminGrowth({ access, repository })
  const { listUnifiedBenefitLedger } = createAdminBenefitLedger({ access, repository })
  const {
    getMembership,
    grantMembership,
    listMembershipTimeline,
  } = createAdminMemberships({ access, repository })
  const {
    changeBranchStatus,
    createBranch,
    listAudit,
    listBranches,
    listOperationalExceptions,
    listRoleCapabilityPolicies,
    listRoles,
    searchRoleCandidates,
    setRole,
    updateBranch,
    updateRoleCapabilityPolicy,
  } = createAdminGovernance({ access, now, repository })
  const {
    completeExportDownload,
    createExport,
    getExportStatus,
    prepareExport,
    reserveExportDownload,
  } = createAdminExports({
    access,
    repository,
    exportStorage,
    phoneEncryptionKey,
    filterNormalizers: {
      users: normalizeUserFilters,
      events: normalizeEventFilters,
      orders: normalizeOrderFilters,
      growthEntries: normalizeGrowthEntryFilters,
      opportunities: normalizeOpportunityFilters,
    },
    now,
    maxRows: exportMaxRows,
    maxBytes: exportMaxBytes,
    issuanceTimeoutMs: exportIssuanceTimeoutMs,
  })

  async function health() {
    await repository.health()
    return { persistence: 'cloudbase-mysql' }
  }
  async function dispatchRefundBatchSafely(appId, refundIds) {
    const selected = refundIds.slice(0, 10)
    if (!selected.length) return { requested: 0, attempted: 0, deferred: 0, failed: 0 }
    try {
      const result = await dispatchRefunds({ appId, refundIds: selected })
      return {
        requested: refundIds.length,
        attempted: Number(result?.scanned || 0),
        deferred: Math.max(0, refundIds.length - selected.length),
        failed: Number(result?.failed || 0),
      }
    }
    catch {
      return {
        requested: refundIds.length,
        attempted: selected.length,
        deferred: Math.max(0, refundIds.length - selected.length),
        failed: selected.length,
      }
    }
  }

  async function getSession(caller) {
    const context = await session(caller)
    return {
      enabled: true,
      capabilities: context.capabilities,
      roles: publicBindings(context.bindings),
    }
  }

  async function getDashboard(caller) {
    const context = await session(caller)
    const grant = firstGrant(context.bindings, CAPABILITIES.DASHBOARD)
    const counts = await repository.dashboard(context.caller.appId, {
      users: visibilityForCapability(context.bindings, CAPABILITIES.USERS_READ),
      events: visibilityForCapability(context.bindings, CAPABILITIES.EVENTS_READ),
      orders: visibilityForCapability(context.bindings, CAPABILITIES.ORDERS_READ),
      opportunities: visibilityForCapability(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE),
    })
    await repository.recordAudit(audit(context, grant, {
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      action: 'admin.session.enter',
      resourceType: 'ADMIN_SESSION',
      metadata: {},
    }))
    return {
      session: {
        enabled: true,
        capabilities: context.capabilities,
        roles: publicBindings(context.bindings),
      },
      counts,
    }
  }

  async function getDashboardOverview(caller, input) {
    return createDashboardOverview({ access, repository, clock: now })
      .getOverview(caller, input)
  }

  return {
    activateMessageTemplate,
    cancelMessageCampaignSchedule,
    getAnnouncement,
    adjustGrowth,
    archiveEvent,
    archiveEventCatalog,
    archiveEventVideoRecap,
    archiveOpportunity,
    archiveMessageTemplate,
    closeOpportunityCommentReport,
    changeBranchStatus,
    changeEventStatus,
    changeEventCatalogStatus,
    changeEventVideoRecapStatus,
    checkIn,
    claimEventCommentReport,
    changePrimaryBranch,
    claimCommunityReport,
    claimMessageDeliveryReview,
    cloneEvent,
    closeCommunityReport,
    closeEventCommentReport,
    completeExportDownload,
    createBranch,
    createExport,
    getDashboard,
    getDashboardOverview,
    getEvent,
    getEventVideoRecap,
    getEventCommentAdminState,
    getEventInsights,
    getEventTagAssignments,
    getEventPolicy,
    getOpportunity,
    getMatchingAdminState,
    getOpportunityCommentAdminState,
    getOpportunityEditorOptions,
    getOrder,
    getMessageCampaign,
    getMessageDeliveryReview,
    getMessageTemplate,
    getMembership,
    listMembershipTimeline,
    endOpportunity,
    getExportStatus,
    health,
    getSession,
    getUser,
    getUserContent,
    saveUserContent,
    archiveUserContent,
    listAnnouncements,
    listAnnouncementScopes,
    listAudit,
    listBadges,
    listBadgeAwards,
    listBranches,
    listCommunityReports,
    listEventAlbumPhotos,
    listEventCatalogs,
    listEvents,
    listEventVideoRecaps,
    listGrowthEntries,
    listGrowthLevelTransitions,
    listGrowthBenefits,
    listGrowthLevels,
    listGrowthRules,
    listUnifiedBenefitLedger,
    listOpportunities,
    listOrders,
    listOperationalExceptions,
    listOperationsQueue,
    listMessageCampaignScopes,
    listMessageCampaigns,
    listMessageDeliveryRecords,
    listMessageDeliveryReviews,
    listMessageTemplates,
    listRoles,
    listRoster,
    listRosterAll,
    reviewRegistration,
    reviewEventAlbumPhoto,
    retryRefund,
    prepareExport,
    reserveExportDownload,
    listUserInfluence,
    listUsers,
    listUserContent,
    publishEventReminder,
    publishMessageCampaign,
    publishOpportunity,
    recalculateOpportunityMatching,
    reconcileMessageDeliveryReview,
    moderateOpportunityComment,
    moderateEventComment,
    publishAnnouncement,
    grantBadge,
    grantMembership,
    saveEvent,
    saveEventCatalog,
    saveEventCommentSettings,
    saveEventPolicy,
    saveEventVideoRecap,
    replaceEventTagAssignments,
    saveAnnouncement,
    saveMessageCampaign,
    saveMessageTemplate,
    saveBadge,
    saveGrowthLevel,
    saveGrowthBenefit,
    saveGrowthRule,
    searchRoleCandidates,
    setRole,
    listRoleCapabilityPolicies,
    updateRoleCapabilityPolicy,
    setUserControl,
    submitRefund,
    revokeBadge,
    resolveMessageDeliveryReview,
    setAnnouncementPinned,
    searchMessageRecipients,
    scheduleMessageCampaign,
    snapshotMessageCampaign,
    withdrawAnnouncement,
    withdrawMessageCampaign,
    unpublishOpportunity,
    undoCheckIn,
    updateBranch,
    updateUser,
    unpublishUserContent,
    saveOpportunity,
    saveOpportunityCommentSettings,
    saveMatchingSettings,
  }
}

module.exports = { PLATFORM_SCOPE_ID, createAdminService }
