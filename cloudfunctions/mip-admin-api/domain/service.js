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
const { createAdminPaymentAttempts } = require('./payment-attempts')
const { createAdminUsers } = require('./users')
const { createAdminUserContentGovernance } = require('./user-content-governance')
const { createAdminTasks } = require('./tasks')
const { createAdminBanners } = require('./banners')
const { createAdminGame } = require('./game')
const { createAdminMedia } = require('./media')
const { AdminError } = require('./validation')

function createAdminService({
  repository,
  phoneEncryptionKey,
  now = () => new Date(),
  contentSafety = async () => 'ERROR',
  confirmWebLogin: dispatchWebLoginConfirmation = async () => {
    throw new Error('WEB_LOGIN_CONFIG_REQUIRED')
  },
  reportWebLoginAuditFailure = () => {},
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
  tasksClient = null,
  bannersClient = null,
  gameClient = null,
  mediaClient = null,
  knowledgeModule = null,
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
  const { listPaymentAttempts } = createAdminPaymentAttempts({ access, repository })
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
  const taskAdmin = createAdminTasks({
    access,
    client: tasksClient || {
      execute: async () => { throw new AdminError('TASKS_DISPATCH_CONFIG_REQUIRED', '任务服务尚未配置', true) },
    },
  })
  const bannerAdmin = createAdminBanners({
    access,
    client: bannersClient || {
      execute: async () => { throw new AdminError('BANNERS_DISPATCH_CONFIG_REQUIRED', 'Banner 服务尚未配置', true) },
    },
  })
  const gameAdmin = createAdminGame({
    access,
    client: gameClient || {
      execute: async () => { throw new AdminError('GAME_DISPATCH_CONFIG_REQUIRED', '游戏服务尚未配置', true) },
    },
  })
  const mediaAdmin = createAdminMedia({
    access,
    client: mediaClient || {
      execute: async () => { throw new AdminError('MEDIA_DISPATCH_CONFIG_REQUIRED', '素材服务尚未配置', true) },
    },
  })
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

  async function confirmWebLogin(caller, input = {}) {
    const context = await session(caller)
    const challengeCode = typeof input.challengeCode === 'string'
      ? input.challengeCode.trim()
      : ''
    const challengeToken = typeof input.challengeToken === 'string'
      ? input.challengeToken.trim()
      : ''
    const validCode = /^\d{6}$/.test(challengeCode)
    const validToken = /^[A-Za-z0-9_-]{32}$/.test(challengeToken)
    if (validCode === validToken) {
      await recordWebLoginFailureSafely(context, 'INVALID_CHALLENGE')
      throw new AdminError('VALIDATION_FAILED', '网页登录请求无效')
    }
    try {
      await dispatchWebLoginConfirmation({
        appId: caller.appId,
        openId: caller.openId,
        ...(validCode ? { challengeCode } : { challengeToken }),
      })
    }
    catch (error) {
      const failure = webLoginFailure(error)
      await recordWebLoginFailureSafely(context, failure.auditReason)
      throw failure.error
    }
    const grant = context.bindings[0]
    try {
      await repository.recordAudit(audit(context, grant, {
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
        action: 'admin.web_login.confirm',
        resourceType: 'ADMIN_SESSION',
        metadata: { method: validCode ? 'DIGIT_CODE' : 'MINIPROGRAM_CODE' },
      }))
    }
    catch (error) {
      reportWebLoginAuditFailure(error)
    }
    return { confirmed: true }
  }

  async function recordWebLoginFailureSafely(context, reason) {
    const grant = context.bindings[0]
    try {
      await repository.recordAudit(audit(context, grant, {
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
        action: 'admin.web_login.confirm_failed',
        resourceType: 'ADMIN_SESSION',
        metadata: { reason },
      }))
    }
    catch (error) {
      reportWebLoginAuditFailure(error)
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

  const ownerModules = Object.freeze({
    ACCESS: freezeModule({
      getSession,
      confirmWebLogin,
      listBranches,
      listRoles,
      searchRoleCandidates,
      listRoleCapabilityPolicies,
      listAudit,
      createBranch,
      updateBranch,
      changeBranchStatus,
      setRole,
      updateRoleCapabilityPolicy,
    }),
    USERS: freezeModule({
      listUsers,
      getUser,
      listUserInfluence,
      listCommunityReports,
      updateUser,
      changePrimaryBranch,
      setUserControl,
      claimCommunityReport,
      closeCommunityReport,
    }),
    MEMBERSHIPS: freezeModule({
      getMembership,
      listMembershipTimeline,
      grantMembership,
    }),
    EVENTS: freezeModule({
      listEvents,
      listEventCatalogs,
      getEventTagAssignments,
      listEventVideoRecaps,
      getEventVideoRecap,
      getEventPolicy,
      getEvent,
      getEventInsights,
      listEventAlbumPhotos,
      getEventCommentAdminState,
      listRoster,
      listRosterAll,
      saveEventPolicy,
      saveEventCatalog,
      changeEventCatalogStatus,
      archiveEventCatalog,
      replaceEventTagAssignments,
      saveEventVideoRecap,
      changeEventVideoRecapStatus,
      archiveEventVideoRecap,
      saveEvent,
      cloneEvent,
      changeEventStatus,
      archiveEvent,
      reviewEventAlbumPhoto,
      saveEventCommentSettings,
      moderateEventComment,
      claimEventCommentReport,
      closeEventCommentReport,
      publishEventReminder,
      reviewRegistration,
      checkIn,
      undoCheckIn,
    }),
    ORDERS: freezeModule({
      listOrders,
      getOrder,
      listPaymentAttempts,
      submitRefund,
      retryRefund,
    }),
    MESSAGING: freezeModule({
      listAnnouncementScopes,
      listAnnouncements,
      getAnnouncement,
      listMessageCampaignScopes,
      listMessageCampaigns,
      getMessageCampaign,
      searchMessageRecipients,
      listMessageTemplates,
      getMessageTemplate,
      listMessageDeliveryReviews,
      getMessageDeliveryReview,
      listMessageDeliveryRecords,
      saveAnnouncement,
      publishAnnouncement,
      withdrawAnnouncement,
      setAnnouncementPinned,
      saveMessageCampaign,
      snapshotMessageCampaign,
      scheduleMessageCampaign,
      cancelMessageCampaignSchedule,
      publishMessageCampaign,
      withdrawMessageCampaign,
      saveMessageTemplate,
      activateMessageTemplate,
      archiveMessageTemplate,
      claimMessageDeliveryReview,
      reconcileMessageDeliveryReview,
      resolveMessageDeliveryReview,
    }),
    KNOWLEDGE: freezeModule(knowledgeModule || {}),
    OPPORTUNITIES: freezeModule({
      listOpportunities,
      listUserContent,
      getUserContent,
      getOpportunity,
      getOpportunityEditorOptions,
      getMatchingAdminState,
      getOpportunityCommentAdminState,
      saveOpportunity,
      publishOpportunity,
      endOpportunity,
      unpublishOpportunity,
      archiveOpportunity,
      unpublishUserContent,
      saveUserContent,
      archiveUserContent,
      saveMatchingSettings,
      recalculateOpportunityMatching,
      saveOpportunityCommentSettings,
      moderateOpportunityComment,
      closeOpportunityCommentReport,
    }),
    GROWTH: freezeModule({
      listGrowthLevels,
      listGrowthBenefits,
      listGrowthRules,
      listGrowthEntries,
      listUnifiedBenefitLedger,
      listGrowthLevelTransitions,
      listBadges,
      listBadgeAwards,
      saveGrowthBenefit,
      saveGrowthLevel,
      saveGrowthRule,
      adjustGrowth,
      saveBadge,
      grantBadge,
      revokeBadge,
    }),
    TASKS: freezeModule(taskAdmin),
    BANNERS: freezeModule(bannerAdmin),
    GAME: freezeModule(gameAdmin),
    MEDIA: freezeModule(mediaAdmin),
    APPLICATION_WORKFLOW: freezeModule({
      getDashboard,
      getDashboardOverview,
      getExportStatus,
      listOperationalExceptions,
      listOperationsQueue,
      createExport,
      prepareExport,
      reserveExportDownload,
      completeExportDownload,
    }),
  })

  return createServiceFacade(health, ownerModules)
}

function freezeModule(methods) {
  return Object.freeze({ ...methods })
}

function createServiceFacade(health, ownerModules) {
  const service = { health, ownerModules }
  for (const [owner, ownerModule] of Object.entries(ownerModules)) {
    for (const [method, implementation] of Object.entries(ownerModule)) {
      if (Object.hasOwn(service, method)) {
        throw new Error(`ADMIN_SERVICE_METHOD_DUPLICATE:${owner}:${method}`)
      }
      Object.defineProperty(service, method, {
        configurable: false,
        enumerable: true,
        value: implementation,
        writable: false,
      })
    }
  }
  return Object.freeze(service)
}

function webLoginFailure(error) {
  switch (error?.code) {
    case 'WEB_LOGIN_CHALLENGE_NOT_FOUND':
    case 'WEB_LOGIN_CHALLENGE_INVALID':
    case 'WEB_LOGIN_CHALLENGE_EXPIRED':
      return {
        auditReason: 'INVALID_CHALLENGE',
        error: new AdminError('WEB_LOGIN_INVALID_CODE', '登录码无效或已过期'),
      }
    case 'WEB_LOGIN_RATE_LIMITED':
    case 'WEB_LOGIN_LOCKED':
      return {
        auditReason: 'RATE_LIMITED',
        error: new AdminError('WEB_LOGIN_RATE_LIMITED', '尝试次数过多，请稍后在网页获取新的登录码'),
      }
    case 'WEB_LOGIN_REQUEST_INVALID':
      return {
        auditReason: 'CONFIGURATION',
        error: new AdminError('WEB_LOGIN_REQUEST_INVALID', '网页登录确认请求无效，请刷新网页后重试'),
      }
    case 'WEB_LOGIN_CONFIG_REQUIRED':
    case 'WEB_LOGIN_AUTH_REJECTED':
      return {
        auditReason: 'CONFIGURATION',
        error: new AdminError('WEB_LOGIN_CONFIGURATION_ERROR', '网页登录服务配置异常，请联系管理员'),
      }
    case 'WEB_LOGIN_TIMEOUT':
      return {
        auditReason: 'UNAVAILABLE',
        error: new AdminError('WEB_LOGIN_TIMEOUT', '网页登录服务响应超时，请稍后重试', true),
      }
    case 'WEB_LOGIN_NETWORK_ERROR':
      return {
        auditReason: 'UNAVAILABLE',
        error: new AdminError('WEB_LOGIN_NETWORK_ERROR', '网络连接失败，请检查网络后重试', true),
      }
    default:
      return {
        auditReason: 'UNAVAILABLE',
        error: new AdminError('WEB_LOGIN_UNAVAILABLE', '网页登录服务暂时不可用，请稍后重试', true),
      }
  }
}

module.exports = { PLATFORM_SCOPE_ID, createAdminService }
