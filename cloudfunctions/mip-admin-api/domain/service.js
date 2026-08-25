'use strict'

const {
  CAPABILITIES,
  firstGrant,
  visibilityForCapability,
} = require('./capabilities')
const { createAdminAccess } = require('./access')
const { createAdminCommunityGovernance } = require('./community-governance')
const { createAdminEventComments } = require('./event-comments')
const { createAdminEvents } = require('./events')
const { createAdminExports } = require('./exports')
const { createAdminGovernance, PLATFORM_SCOPE_ID } = require('./governance')
const { createAdminGrowth } = require('./growth')
const { createAdminMessaging } = require('./messaging')
const { createAdminMessageDeliveryReviews } = require('./message-delivery-review-service')
const { createAdminOpportunities } = require('./opportunities')
const { createAdminOrders } = require('./orders')
const { createAdminUsers } = require('./users')
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
    getUser,
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
    claimEventCommentReport,
    closeEventCommentReport,
    getEventCommentAdminState,
    moderateEventComment,
    saveEventCommentSettings,
  } = createAdminEventComments({ access, repository })
  const {
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
    listGrowthLevels,
    listGrowthRules,
    normalizeExportFilters: normalizeGrowthEntryFilters,
    revokeBadge,
    saveBadge,
    saveGrowthBenefit,
    saveGrowthLevel,
    saveGrowthRule,
  } = createAdminGrowth({ access, repository })
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

  return {
    activateMessageTemplate,
    cancelMessageCampaignSchedule,
    getAnnouncement,
    adjustGrowth,
    archiveEvent,
    archiveOpportunity,
    archiveMessageTemplate,
    closeOpportunityCommentReport,
    changeBranchStatus,
    changeEventStatus,
    checkIn,
    claimEventCommentReport,
    claimCommunityReport,
    claimMessageDeliveryReview,
    cloneEvent,
    closeCommunityReport,
    closeEventCommentReport,
    completeExportDownload,
    createBranch,
    createExport,
    getDashboard,
    getEvent,
    getEventCommentAdminState,
    getEventInsights,
    getEventPolicy,
    getOpportunity,
    getMatchingAdminState,
    getOpportunityCommentAdminState,
    getOpportunityEditorOptions,
    getMessageCampaign,
    getMessageDeliveryReview,
    getMessageTemplate,
    endOpportunity,
    getExportStatus,
    health,
    getSession,
    getUser,
    listAnnouncements,
    listAnnouncementScopes,
    listAudit,
    listBadges,
    listBadgeAwards,
    listBranches,
    listCommunityReports,
    listEventAlbumPhotos,
    listEvents,
    listGrowthEntries,
    listGrowthBenefits,
    listGrowthLevels,
    listGrowthRules,
    listOpportunities,
    listOrders,
    listOperationalExceptions,
    listMessageCampaignScopes,
    listMessageCampaigns,
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
    listUsers,
    publishEventReminder,
    publishMessageCampaign,
    publishOpportunity,
    recalculateOpportunityMatching,
    reconcileMessageDeliveryReview,
    moderateOpportunityComment,
    moderateEventComment,
    publishAnnouncement,
    grantBadge,
    saveEvent,
    saveEventCommentSettings,
    saveEventPolicy,
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
    saveOpportunity,
    saveOpportunityCommentSettings,
    saveMatchingSettings,
  }
}

module.exports = { PLATFORM_SCOPE_ID, createAdminService }
