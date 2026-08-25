'use strict'

const { createHash } = require('node:crypto')

const {
  CAPABILITIES,
  authorize,
  firstGrant,
  roleCapabilities,
  visibilityForCapability,
} = require('./capabilities')
const { createAdminAccess } = require('./access')
const { createAdminEvents } = require('./events')
const { createAdminGrowth } = require('./growth')
const { createAdminMessaging } = require('./messaging')
const { createAdminOpportunities } = require('./opportunities')
const { createAdminOrders } = require('./orders')
const { createAdminUsers } = require('./users')
const { configurableRoleKeys } = require('./role-capability-policies')
const { exportFileName, workbookForExport } = require('./export-workbook')
const {
  availableExceptionTypes,
  normalizeExceptionRequest,
} = require('./operational-exception-access')
const { XLSX_CONTENT_TYPE, isXlsxBuffer } = require('../lib/xlsx')
const {
  AdminError,
  expectedVersion,
  limit,
  requiredId,
  stableKey,
  text,
} = require('./validation')
const { decodeCursor } = require('./pagination')

const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'
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
  recalculateMatching = async () => { throw new AdminError('MATCHING_DISPATCH_CONFIG_REQUIRED', '机会撮合重算服务尚未配置') },
}) {
  const access = createAdminAccess({ repository })
  const {
    audit,
    eventAuthorization,
    mutationAuthorization,
    publicBindings,
    requirePlatformOwner,
    session,
  } = access
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
    getAnnouncement,
    getMessageCampaign,
    listAnnouncements,
    listAnnouncementScopes,
    listMessageCampaignScopes,
    listMessageCampaigns,
    publishAnnouncement,
    publishMessageCampaign,
    saveAnnouncement,
    saveMessageCampaign,
    searchMessageRecipients,
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

  function pageResult(value) {
    if (Array.isArray(value)) return { items: value, nextCursor: null }
    return {
      items: Array.isArray(value?.items) ? value.items : [],
      nextCursor: typeof value?.nextCursor === 'string' ? value.nextCursor : null,
    }
  }
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

  async function listBranches(caller) {
    const context = await session(caller)
    authorize(context.bindings, CAPABILITIES.BRANCHES_MANAGE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    return {
      items: await repository.listBranches(context.caller.appId),
      nextCursor: null,
    }
  }

  async function createBranch(caller, input = {}) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.BRANCHES_MANAGE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    const draft = normalizeBranchDraft(input, { includeKey: true })
    return repository.createBranch({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ...draft,
      authorization: mutationAuthorization(grant, CAPABILITIES.BRANCHES_MANAGE),
      audit: branchId => audit(context, grant, {
        scopeType: 'BRANCH',
        scopeId: branchId,
        action: 'admin.branches.create',
        resourceType: 'CITY_BRANCH',
        resourceId: branchId,
        metadata: { branchKey: draft.branchKey, status: 'ACTIVE' },
      }),
    })
  }

  async function updateBranch(caller, input = {}) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.BRANCHES_MANAGE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    if (Object.hasOwn(input, 'branchKey')) {
      throw new AdminError('VALIDATION_FAILED', '分会标识创建后不可修改')
    }
    const branchId = requiredId(input.branchId, '城市分会')
    const version = expectedVersion(input.expectedVersion)
    const draft = normalizeBranchDraft(input)
    return repository.updateBranch({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      branchId,
      expectedVersion: version,
      ...draft,
      authorization: mutationAuthorization(grant, CAPABILITIES.BRANCHES_MANAGE),
      audit: audit(context, grant, {
        scopeType: 'BRANCH',
        scopeId: branchId,
        action: 'admin.branches.update',
        resourceType: 'CITY_BRANCH',
        resourceId: branchId,
        metadata: { expectedVersion: version, fields: ['name', 'cityName', 'summary'] },
      }),
    })
  }

  async function changeBranchStatus(caller, input = {}) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.BRANCHES_MANAGE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    const branchId = requiredId(input.branchId, '城市分会')
    const version = expectedVersion(input.expectedVersion)
    const status = ['ACTIVE', 'INACTIVE'].includes(input.status) ? input.status : null
    if (!status) throw new AdminError('VALIDATION_FAILED', '分会状态无效')
    return repository.changeBranchStatus({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      branchId,
      expectedVersion: version,
      status,
      authorization: mutationAuthorization(grant, CAPABILITIES.BRANCHES_MANAGE),
      audit: audit(context, grant, {
        scopeType: 'BRANCH',
        scopeId: branchId,
        action: 'admin.branches.status.change',
        resourceType: 'CITY_BRANCH',
        resourceId: branchId,
        metadata: { status, expectedVersion: version },
      }),
    })
  }

  async function listCommunityReports(caller, input = {}) {
    const context = await session(caller)
    authorize(context.bindings, CAPABILITIES.COMMUNITY_REPORTS_MANAGE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    const status = normalizeCommunityReportStatus(input.status, { optional: true })
    return {
      items: await repository.listCommunityReports(
        context.caller.appId,
        status,
        limit(input.limit, 50),
      ),
      nextCursor: null,
    }
  }

  async function claimCommunityReport(caller, input = {}) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.COMMUNITY_REPORTS_MANAGE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    const reportId = requiredId(input.reportId, '社区举报')
    const version = expectedVersion(input.expectedVersion)
    const reason = normalizedCommunityReportReason(input.reason)
    return repository.claimCommunityReport({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      reportId,
      expectedVersion: version,
      authorization: mutationAuthorization(grant, CAPABILITIES.COMMUNITY_REPORTS_MANAGE),
      audit: audit(context, grant, {
        scopeType: 'PLATFORM',
        scopeId: null,
        action: 'admin.community_reports.claim',
        resourceType: 'COMMUNITY_REPORT',
        resourceId: reportId,
        metadata: { expectedVersion: version, reason },
      }),
    })
  }

  async function closeCommunityReport(caller, input = {}) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.COMMUNITY_REPORTS_MANAGE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    const reportId = requiredId(input.reportId, '社区举报')
    const version = expectedVersion(input.expectedVersion)
    const outcome = normalizeCommunityReportStatus(input.outcome)
    if (!['RESOLVED', 'DISMISSED'].includes(outcome)) {
      throw new AdminError('VALIDATION_FAILED', '举报处理结果无效')
    }
    const reason = normalizedCommunityReportReason(input.reason)
    return repository.closeCommunityReport({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      reportId,
      expectedVersion: version,
      outcome,
      reason,
      authorization: mutationAuthorization(grant, CAPABILITIES.COMMUNITY_REPORTS_MANAGE),
      audit: audit(context, grant, {
        scopeType: 'PLATFORM',
        scopeId: null,
        action: outcome === 'RESOLVED'
          ? 'admin.community_reports.resolve'
          : 'admin.community_reports.dismiss',
        resourceType: 'COMMUNITY_REPORT',
        resourceId: reportId,
        metadata: { expectedVersion: version, outcome, reason },
      }),
    })
  }

  async function createExport(caller, input) {
    const context = await session(caller)
    const exportType = [
      'USERS', 'EVENT_ROSTER', 'EVENT_ROSTER_ALL', 'EVENT_ORDERS', 'ORDERS',
      'GROWTH_ENTRIES', 'OPPORTUNITIES',
    ].includes(input.exportType)
      ? input.exportType
      : null
    if (!exportType) throw new AdminError('VALIDATION_FAILED', '导出类型无效')
    const scope = await exportScope(context, exportType, input)
    const grant = authorize(context.bindings, CAPABILITIES.EXPORT_CREATE, scope)
    if (grant.roleKey === 'PLATFORM_FINANCE'
      && !['ORDERS', 'EVENT_ORDERS'].includes(exportType)) {
      throw new AdminError('FORBIDDEN', '当前账号不能创建该类导出')
    }
    const includesPhone = input.includesPhone === true
    if (includesPhone && !['USERS', 'EVENT_ROSTER', 'EVENT_ROSTER_ALL'].includes(exportType)) {
      throw new AdminError('VALIDATION_FAILED', '该导出不包含手机号')
    }
    const phoneGrant = includesPhone
      ? authorize(context.bindings, CAPABILITIES.USERS_PHONE_READ, scope)
      : null
    const filters = normalizeExportFilters(
      exportType,
      input.filters,
      scope,
      normalizeUserFilters,
      normalizeEventFilters,
      normalizeOrderFilters,
      normalizeGrowthEntryFilters,
      normalizeOpportunityFilters,
    )
    return repository.createExportTicket({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      exportType,
      scope,
      filters,
      includesPhone,
      authorizedScope: scope,
      authorization: mutationAuthorization(grant, CAPABILITIES.EXPORT_CREATE),
      phoneAuthorization: phoneGrant
        ? mutationAuthorization(phoneGrant, CAPABILITIES.USERS_PHONE_READ)
        : null,
      now: now(),
      audit: audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.export.request',
        resourceType: 'EXPORT_TICKET',
        metadata: { exportType, includesPhone },
      }),
    })
  }

  async function exportAuthorization(caller, input) {
    const context = await session(caller)
    const ticketId = requiredId(input.ticketId, '导出票据')
    const tokenHash = hashExportToken(input.token)
    const ticket = await repository.getExportTicket({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ticketId,
      tokenHash,
    })
    let scope = { scopeType: ticket.scopeType, scopeId: ticket.scopeId }
    if (ticket.scopeType === 'EVENT') {
      const eventScope = await repository.getEventScope(context.caller.appId, ticket.scopeId)
      if (!eventScope) throw new AdminError('EXPORT_NOT_FOUND', '导出任务不存在')
      scope = eventScope
    }
    const grant = authorize(context.bindings, CAPABILITIES.EXPORT_CREATE, scope)
    if (grant.roleKey === 'PLATFORM_FINANCE'
      && !['ORDERS', 'EVENT_ORDERS'].includes(ticket.exportType)) {
      throw new AdminError('FORBIDDEN', '当前账号不能处理该类导出')
    }
    const phoneGrant = ticket.includesPhone
      ? authorize(context.bindings, CAPABILITIES.USERS_PHONE_READ, scope)
      : null
    return { context, grant, phoneGrant, scope, ticket, ticketId, tokenHash }
  }

  function exportMutationAuthorization(request) {
    return {
      authorization: mutationAuthorization(request.grant, CAPABILITIES.EXPORT_CREATE),
      phoneAuthorization: request.phoneGrant
        ? mutationAuthorization(request.phoneGrant, CAPABILITIES.USERS_PHONE_READ)
        : null,
      includesPhone: request.ticket.includesPhone,
      authorizedScope: request.scope,
    }
  }

  async function prepareExport(caller, input) {
    const request = await exportAuthorization(caller, input)
    requireExportStorage(exportStorage)
    const current = now()
    const reservedUntil = new Date(current.getTime() + 60_000)
    const claim = await repository.claimExportBuild({
      appId: request.context.caller.appId,
      actorUserId: request.context.caller.userId,
      ticketId: request.ticketId,
      tokenHash: request.tokenHash,
      now: current,
      reservedUntil,
      ...exportMutationAuthorization(request),
    })
    if (claim.state === 'READY') return exportStatus(claim.ticket)
    if (claim.state === 'BUSY') return { ...exportStatus(claim.ticket), retryAfterMs: 1_000 }
    const ticket = claim.ticket
    let uploadedFileId = ''
    try {
      const rows = await repository.listExportRows(ticket, exportMaxRows + 1)
      if (rows.length > exportMaxRows) throw new AdminError('EXPORT_TOO_LARGE', '导出记录过多，请缩小筛选范围')
      const workbook = workbookForExport({
        appId: request.context.caller.appId,
        exportType: ticket.exportType,
        includesPhone: ticket.includesPhone,
        phoneEncryptionKey,
        rows,
      })
      if (workbook.content.length > exportMaxBytes) {
        throw new AdminError('EXPORT_TOO_LARGE', '导出文件过大，请缩小筛选范围')
      }
      const uploaded = await exportStorage.put({
        appId: request.context.caller.appId,
        ticketId: request.ticketId,
        objectKey: ticket.objectKey,
        content: workbook.content,
      })
      uploadedFileId = uploaded.fileId
      const contentSha256 = createHash('sha256').update(workbook.content).digest('hex')
      await repository.finishExportBuild({
        appId: request.context.caller.appId,
        actorUserId: request.context.caller.userId,
        ticketId: request.ticketId,
        tokenHash: request.tokenHash,
        reservedUntil,
        fileId: uploadedFileId,
        contentSha256,
        contentBytes: workbook.content.length,
        rowCount: workbook.rowCount,
        now: now(),
        ...exportMutationAuthorization(request),
        audit: audit(request.context, request.phoneGrant || request.grant, {
          scopeType: request.scope.scopeType,
          scopeId: request.scope.scopeId,
          action: ticket.includesPhone ? 'admin.export.phone.prepare' : 'admin.export.prepare',
          resourceType: 'EXPORT_TICKET',
          resourceId: request.ticketId,
          metadata: { exportType: ticket.exportType, rowCount: workbook.rowCount },
        }),
      })
      return {
        status: 'READY',
        rowCount: workbook.rowCount,
        expiresAt: ticket.expiresAt,
        fileName: exportFileName(ticket.exportType, ticket.createdAt),
        failureCode: null,
      }
    }
    catch (error) {
      if (uploadedFileId && (error?.code || error?.message) !== 'EXPORT_LEASE_LOST') {
        await exportStorage.delete({
          appId: request.context.caller.appId,
          ticketId: request.ticketId,
          objectKey: ticket.objectKey,
          fileId: uploadedFileId,
        }).catch(() => {})
      }
      await repository.failExportBuild({
        appId: request.context.caller.appId,
        actorUserId: request.context.caller.userId,
        ticketId: request.ticketId,
        tokenHash: request.tokenHash,
        reservedUntil,
        reasonCode: exportFailureCode(error),
        ...exportMutationAuthorization(request),
      }).catch(() => {})
      throw exportError(error)
    }
  }

  async function getExportStatus(caller, input) {
    const request = await exportAuthorization(caller, input)
    if (new Date(request.ticket.expiresAt) <= now()
      && !['CONSUMED', 'FAILED', 'REVOKED'].includes(request.ticket.status)) {
      return { ...exportStatus(request.ticket), status: 'EXPIRED' }
    }
    return exportStatus(request.ticket)
  }

  async function reserveExportDownload(caller, input) {
    const request = await exportAuthorization(caller, input)
    requireExportStorage(exportStorage)
    const current = now()
    const ticketExpiresAt = new Date(request.ticket.expiresAt)
    const reservedUntil = new Date(Math.min(current.getTime() + 120_000, ticketExpiresAt.getTime()))
    let result
    try {
      result = await repository.issueExportDownload({
        appId: request.context.caller.appId,
        actorUserId: request.context.caller.userId,
        ticketId: request.ticketId,
        tokenHash: request.tokenHash,
        now: current,
        reservedUntil,
        ...exportMutationAuthorization(request),
        audit: audit(request.context, request.grant, {
          scopeType: request.scope.scopeType,
          scopeId: request.scope.scopeId,
          action: 'admin.export.download.reserve',
          resourceType: 'EXPORT_TICKET',
          resourceId: request.ticketId,
          metadata: {
            exportType: request.ticket.exportType,
            contentBytes: request.ticket.contentBytes,
          },
        }),
      }, async (ticket) => {
        return withExportIssuanceTimeout(async (assertActive) => {
          const content = await exportStorage.read({
            appId: request.context.caller.appId,
            ticketId: request.ticketId,
            objectKey: ticket.objectKey,
            fileId: ticket.fileId,
          })
          assertActive()
          const digest = createHash('sha256').update(content).digest('hex')
          if (!isXlsxBuffer(content)
            || content.length !== ticket.contentBytes
            || digest !== ticket.contentSha256) {
            return { state: 'REVOKED', reasonCode: 'EXPORT_INTEGRITY_FAILED' }
          }
          const maximumAgeSeconds = exportUrlMaximumAge({
            current: now(),
            reservedUntil,
            ticketExpiresAt: new Date(ticket.expiresAt),
          })
          assertActive()
          const tempUrl = await exportStorage.temporaryUrl({
            appId: request.context.caller.appId,
            ticketId: request.ticketId,
            objectKey: ticket.objectKey,
            fileId: ticket.fileId,
            maxAgeSeconds: maximumAgeSeconds,
          })
          assertActive()
          return { state: 'ISSUED', value: { tempUrl } }
        }, exportIssuanceTimeoutMs)
      })
    }
    catch (error) {
      throw exportError(error)
    }
    const ticket = result.ticket
    if (result.state === 'REVOKED') {
      await exportStorage.delete({
        appId: request.context.caller.appId,
        ticketId: request.ticketId,
        objectKey: ticket.objectKey,
        fileId: ticket.fileId,
      }).catch(() => {})
      throw new AdminError('EXPORT_INTEGRITY_FAILED', '导出文件校验失败')
    }
    return {
      status: 'RESERVED',
      tempUrl: result.value.tempUrl,
      fileName: exportFileName(ticket.exportType, ticket.createdAt),
      contentType: XLSX_CONTENT_TYPE,
      contentBytes: ticket.contentBytes,
      contentSha256: ticket.contentSha256,
      reservationExpiresAt: reservedUntil.toISOString(),
    }
  }

  async function completeExportDownload(caller, input) {
    const request = await exportAuthorization(caller, input)
    requireExportStorage(exportStorage)
    const result = await repository.consumeExportDownload({
      appId: request.context.caller.appId,
      actorUserId: request.context.caller.userId,
      ticketId: request.ticketId,
      tokenHash: request.tokenHash,
      now: now(),
      ...exportMutationAuthorization(request),
      audit: audit(request.context, request.grant, {
        scopeType: request.scope.scopeType,
        scopeId: request.scope.scopeId,
        action: 'admin.export.download.consume',
        resourceType: 'EXPORT_TICKET',
        resourceId: request.ticketId,
        metadata: { exportType: request.ticket.exportType },
      }),
    })
    await exportStorage.delete({
      appId: request.context.caller.appId,
      ticketId: request.ticketId,
      objectKey: result.objectKey,
      fileId: result.fileId,
    }).catch(() => {})
    return { status: 'CONSUMED', consumedAt: result.consumedAt }
  }

  async function exportScope(context, exportType, input) {
    if (exportType === 'EVENT_ROSTER' || exportType === 'EVENT_ORDERS') {
      return (await eventAuthorization(context, input.eventId, CAPABILITIES.EXPORT_CREATE)).scope
    }
    if (input.branchId) {
      return { scopeType: 'BRANCH', scopeId: requiredId(input.branchId, '城市分会') }
    }
    const visibility = visibilityForCapability(context.bindings, CAPABILITIES.EXPORT_CREATE)
    if (!visibility.platform && visibility.branchIds.length === 1) {
      return { scopeType: 'BRANCH', scopeId: visibility.branchIds[0] }
    }
    return { scopeType: 'PLATFORM', scopeId: null }
  }

  async function listRoles(caller) {
    const context = await session(caller)
    const grant = firstGrant(context.bindings, CAPABILITIES.ROLES_CHANGE)
    const roleChangeVisibility = visibilityForCapability(context.bindings, CAPABILITIES.ROLES_CHANGE)
    const items = await repository.listRoles(
      context.caller.appId,
      roleChangeVisibility,
      { includeAdministrativeScopes: roleChangeVisibility.platform },
    )
    await repository.recordAudit(audit(context, grant, {
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      action: 'admin.roles.view',
      resourceType: 'ADMIN_ROLE_BINDING_LIST',
      metadata: { count: items.length },
    }))
    return { items }
  }

  async function searchRoleCandidates(caller, input) {
    const context = await session(caller)
    await eventAuthorization(context, input.eventId, CAPABILITIES.ROLES_CHANGE)
    const query = text(input.query, 80, { required: true, label: '搜索内容' })
    return { items: await repository.searchRoleCandidates(context.caller.appId, query, limit(input.limit, 20)) }
  }

  async function setRole(caller, input) {
    const context = await session(caller)
    const roleKey = normalizeRole(input.roleKey)
    const requestedScope = normalizeRoleScope(roleKey, input)
    const { scope, grant } = requestedScope.scopeType === 'EVENT'
      ? await eventAuthorization(context, requestedScope.scopeId, CAPABILITIES.ROLES_CHANGE)
      : { scope: requestedScope, grant: authorize(context.bindings, CAPABILITIES.ROLES_CHANGE, requestedScope) }
    assertRoleDelegation(grant.roleKey, roleKey)
    const userId = requiredId(input.userId, '用户')
    if (typeof input.active !== 'boolean') throw new AdminError('VALIDATION_FAILED', '角色状态无效')
    if (!input.active && roleKey === 'PLATFORM_OWNER' && userId === context.caller.userId) {
      throw new AdminError('INVALID_STATE', '平台超级管理员不能撤销自己的角色')
    }
    return repository.setRole({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      userId,
      roleKey,
      active: input.active,
      scope: {
        ...scope,
        scopeId: scope.scopeType === 'PLATFORM' ? PLATFORM_SCOPE_ID : scope.scopeId,
      },
      authorization: mutationAuthorization(grant, CAPABILITIES.ROLES_CHANGE),
      authorizedScope: scope,
      audit: audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: input.active ? 'admin.roles.grant' : 'admin.roles.revoke',
        resourceType: 'ADMIN_ROLE_BINDING',
        resourceId: userId,
        metadata: { roleKey, active: input.active },
      }),
    })
  }

  async function listRoleCapabilityPolicies(caller) {
    const context = await session(caller)
    const grant = requirePlatformOwner(context)
    const stored = new Map(
      (await repository.listRoleCapabilityPolicies(context.caller.appId))
        .map(policy => [policy.roleKey, policy]),
    )
    const items = configurableRoleKeys.map((roleKey) => {
      const policy = stored.get(roleKey)
      return roleCapabilityPolicyView(
        roleKey,
        policy,
        policy?.mode === 'CUSTOM' ? 'CUSTOM' : 'DEFAULT',
      )
    })
    await repository.recordAudit(audit(context, grant, {
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.role_capability_policies.view',
      resourceType: 'ROLE_CAPABILITY_POLICY_LIST',
      metadata: { count: items.length },
    }))
    return { items }
  }

  async function updateRoleCapabilityPolicy(caller, input = {}) {
    const context = await session(caller)
    const grant = requirePlatformOwner(context)
    const roleKey = normalizeConfigurableRole(input.roleKey)
    const policyVersion = Number(input.expectedVersion)
    if (!Number.isInteger(policyVersion) || policyVersion < 0) {
      throw new AdminError('VALIDATION_FAILED', '权限版本无效')
    }
    if (input.reset !== undefined && input.reset !== true) {
      throw new AdminError('VALIDATION_FAILED', '恢复默认设置无效')
    }
    const resetting = input.reset === true
    const capabilities = resetting ? null : normalizeRoleCapabilities(roleKey, input.capabilities)
    const mutationInput = {
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      roleKey,
      expectedVersion: policyVersion,
      now: now(),
      authorization: mutationAuthorization(grant, CAPABILITIES.ROLES_CHANGE),
      audit: audit(context, grant, {
        scopeType: 'PLATFORM',
        scopeId: null,
        action: resetting
          ? 'admin.role_capability_policies.reset'
          : 'admin.role_capability_policies.update',
        resourceType: 'ROLE_CAPABILITY_POLICY',
        resourceId: roleKey,
        metadata: {
          roleKey,
          expectedVersion: policyVersion,
          ...(capabilities ? { capabilities } : {}),
        },
      }),
    }
    if (resetting) {
      const policy = await repository.resetRoleCapabilityPolicy(mutationInput)
      return roleCapabilityPolicyView(roleKey, policy, 'DEFAULT')
    }
    const policy = await repository.updateRoleCapabilityPolicy({
      ...mutationInput,
      capabilities,
    })
    return roleCapabilityPolicyView(roleKey, policy, 'CUSTOM')
  }

  async function listAudit(caller, input = {}) {
    const context = await session(caller)
    const grant = firstGrant(context.bindings, CAPABILITIES.AUDIT_READ)
    const filters = normalizeFilters(input.filters)
    const page = pageResult(await repository.listAudit(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.AUDIT_READ),
      filters,
      limit(input.limit),
      decodeCursor(input.cursor, ['createdAt', 'id']),
    ))
    await repository.recordAudit(audit(context, grant, {
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      action: 'admin.audit.view',
      resourceType: 'AUDIT_LOG_LIST',
      metadata: { count: page.items.length, filters },
    }))
    return page
  }

  async function listOperationalExceptions(caller, input = {}) {
    const context = await session(caller)
    const authorizedGrant = authorize(context.bindings, CAPABILITIES.OPERATIONS_EXCEPTIONS_READ, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    const availableTypes = availableExceptionTypes(context.bindings)
    const request = normalizeExceptionRequest(input, availableTypes)
    const items = await repository.listOperationalExceptions(context.caller.appId, request)
    const fullGrant = context.bindings.find(binding => binding.scopeType === 'PLATFORM'
      && ['PLATFORM_OWNER', 'PLATFORM_OPERATIONS'].includes(binding.roleKey))
    const grant = fullGrant || authorizedGrant
    await repository.recordAudit(audit(context, grant, {
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.operational_exceptions.view',
      resourceType: 'OPERATIONAL_EXCEPTION_LIST',
      metadata: {
        count: items.length,
        type: request.type || null,
        status: request.status || null,
        limit: request.limit,
      },
    }))
    return { items, nextCursor: null, availableTypes }
  }

  return {
    getAnnouncement,
    adjustGrowth,
    archiveEvent,
    archiveOpportunity,
    closeOpportunityCommentReport,
    changeBranchStatus,
    changeEventStatus,
    checkIn,
    claimCommunityReport,
    cloneEvent,
    closeCommunityReport,
    completeExportDownload,
    createBranch,
    createExport,
    getDashboard,
    getEvent,
    getEventPolicy,
    getOpportunity,
    getMatchingAdminState,
    getOpportunityCommentAdminState,
    getOpportunityEditorOptions,
    getMessageCampaign,
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
    moderateOpportunityComment,
    publishAnnouncement,
    grantBadge,
    saveEvent,
    saveEventPolicy,
    saveAnnouncement,
    saveMessageCampaign,
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
    setAnnouncementPinned,
    searchMessageRecipients,
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

function hashExportToken(value) {
  const token = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{32,96}$/.test(token)) {
    throw new AdminError('VALIDATION_FAILED', '导出令牌无效')
  }
  return createHash('sha256').update(token).digest('hex')
}

function exportStatus(ticket) {
  return {
    status: ticket.status,
    rowCount: ticket.rowCount,
    expiresAt: ticket.expiresAt,
    fileName: exportFileName(ticket.exportType, ticket.createdAt),
    failureCode: ticket.failedReasonCode,
  }
}

function requireExportStorage(storage) {
  if (!storage) throw new AdminError('EXPORT_STORAGE_UNAVAILABLE', '导出存储尚未配置', true)
}

async function withExportIssuanceTimeout(work, timeoutMs) {
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000
  let timedOut = false
  let timeout
  const timeoutError = () => new AdminError(
    'EXPORT_URL_UNAVAILABLE',
    '导出下载地址暂时不可用',
    true,
  )
  const assertActive = () => {
    if (timedOut) throw timeoutError()
  }
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(assertActive)),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true
          reject(timeoutError())
        }, duration)
      }),
    ])
  }
  finally {
    if (timeout) clearTimeout(timeout)
  }
}

function exportUrlMaximumAge({ current, reservedUntil, ticketExpiresAt }) {
  const maximumEnd = Math.min(reservedUntil.getTime(), ticketExpiresAt.getTime())
  const seconds = Math.floor((maximumEnd - current.getTime()) / 1_000)
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new AdminError('EXPORT_EXPIRED', '导出任务已过期')
  }
  return Math.min(120, seconds)
}

function exportFailureCode(error) {
  const allowed = new Set([
    'EXPORT_TOO_LARGE',
    'PHONE_ENCRYPTION_NOT_CONFIGURED',
    'PHONE_CIPHERTEXT_INVALID',
    'EXPORT_STORAGE_UNAVAILABLE',
  ])
  return allowed.has(error?.code || error?.message) ? (error.code || error.message) : 'EXPORT_BUILD_FAILED'
}

function exportError(error) {
  if (error instanceof AdminError) return error
  const code = error?.code || error?.message
  const known = {
    EXPORT_NOT_FOUND: '导出任务不存在',
    EXPORT_EXPIRED: '导出任务已过期',
    EXPORT_BUSY: '导出任务正在处理',
    EXPORT_NOT_READY: '导出文件尚未就绪',
    EXPORT_CONSUMED: '导出文件已下载',
    EXPORT_FAILED: '导出任务处理失败',
    EXPORT_INTEGRITY_FAILED: '导出文件校验失败',
    EXPORT_FILE_MISSING: '导出文件不存在',
    EXPORT_URL_UNAVAILABLE: '导出下载地址暂时不可用',
    EXPORT_STORAGE_NOT_CONFIGURED: '导出存储尚未配置',
    PHONE_ENCRYPTION_NOT_CONFIGURED: '手机号服务尚未配置',
    PHONE_CIPHERTEXT_INVALID: '手机号数据无法读取',
  }
  if (known[code]) return new AdminError(code, known[code], ['EXPORT_BUSY', 'EXPORT_URL_UNAVAILABLE'].includes(code))
  return new AdminError('EXPORT_SERVICE_UNAVAILABLE', '导出服务暂时不可用', true)
}

function normalizeBranchDraft(value, { includeKey = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '分会内容无效')
  }
  const draft = {
    name: normalizedBranchText(value.name, 80, { required: true, label: '分会名称' }),
    cityName: normalizedBranchText(value.cityName, 80, { required: true, label: '城市名称' }),
    summary: normalizedBranchText(value.summary, 500, { label: '分会简介' }),
  }
  if (includeKey) {
    const rawKey = typeof value.branchKey === 'string'
      ? value.branchKey.normalize('NFKC').toLowerCase()
      : value.branchKey
    const branchKey = stableKey(rawKey, '分会', 64)
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(branchKey)) {
      throw new AdminError('VALIDATION_FAILED', '分会标识格式无效')
    }
    draft.branchKey = branchKey
  }
  return draft
}

function normalizedBranchText(value, maximum, options) {
  const normalized = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : value
  return text(normalized, maximum, options)
}

function normalizeCommunityReportStatus(value, { optional = false } = {}) {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (optional && !status) return ''
  if (!['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'].includes(status)) {
    throw new AdminError('VALIDATION_FAILED', '举报状态无效')
  }
  return status
}

function normalizedCommunityReportReason(value) {
  const normalized = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : value
  return text(normalized, 300, { required: true, label: '处理原因' })
}

function normalizeFilters(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

function normalizeExportFilters(
  exportType,
  value,
  scope,
  normalizeUsers,
  normalizeEvents,
  normalizeOrders,
  normalizeGrowth,
  normalizeOpportunities,
) {
  const filters = normalizeFilters(value)
  const normalized = {}
  if (exportType === 'USERS') {
    Object.assign(normalized, normalizeUsers(filters))
  }
  else if (exportType === 'EVENT_ROSTER') {
    Object.assign(normalized, normalizeEvents(exportType, filters), { eventId: scope.scopeId })
  }
  else if (exportType === 'EVENT_ROSTER_ALL') {
    Object.assign(normalized, normalizeEvents(exportType, filters))
  }
  else if (exportType === 'EVENT_ORDERS') {
    Object.assign(normalized, normalizeOrders({ ...filters, eventId: scope.scopeId }))
  }
  else if (exportType === 'ORDERS') {
    Object.assign(normalized, normalizeOrders(filters))
  }
  else if (exportType === 'GROWTH_ENTRIES') {
    Object.assign(normalized, normalizeGrowth(filters))
  }
  else if (exportType === 'OPPORTUNITIES') {
    Object.assign(normalized, normalizeOpportunities(filters))
  }
  if (scope.scopeType === 'BRANCH') normalized.branchId = scope.scopeId
  return normalized
}

function normalizeRole(value) {
  const roles = ['PLATFORM_OWNER', 'PLATFORM_OPERATIONS', 'PLATFORM_FINANCE', 'BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF']
  if (!roles.includes(value)) throw new AdminError('VALIDATION_FAILED', '角色无效')
  return value
}

function normalizeConfigurableRole(value) {
  if (!configurableRoleKeys.includes(value)) {
    throw new AdminError('VALIDATION_FAILED', '权限模板角色无效')
  }
  return value
}

function normalizeRoleCapabilities(roleKey, value) {
  if (!Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '权限列表无效')
  }
  const safeMaximum = roleCapabilities[roleKey] || []
  const requested = new Set(value)
  if (requested.size !== value.length
    || value.some(item => typeof item !== 'string' || !safeMaximum.includes(item))) {
    throw new AdminError('VALIDATION_FAILED', '权限列表包含当前角色不可授予的能力')
  }
  return safeMaximum.filter(capability => requested.has(capability))
}

function roleCapabilityPolicyView(roleKey, policy, source) {
  return {
    roleKey,
    scopeType: roleKey.startsWith('PLATFORM_')
      ? 'PLATFORM'
      : roleKey === 'BRANCH_ADMIN' ? 'BRANCH' : 'EVENT',
    allowedCapabilities: roleCapabilities[roleKey],
    capabilities: source === 'DEFAULT'
      ? roleCapabilities[roleKey]
      : policy?.capabilities || [],
    version: Number(policy?.version || 0),
    source,
    updatedAt: policy?.updatedAt || null,
  }
}

function assertRoleDelegation(actorRole, targetRole) {
  if (actorRole === 'PLATFORM_OWNER') return
  if (actorRole === 'BRANCH_ADMIN' && ['EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF'].includes(targetRole)) return
  if (actorRole === 'EVENT_OWNER' && ['EVENT_MANAGER', 'EVENT_STAFF'].includes(targetRole)) return
  if (actorRole === 'EVENT_MANAGER' && targetRole === 'EVENT_STAFF') return
  if (targetRole === 'EVENT_OWNER') {
    throw new AdminError('FORBIDDEN', '当前账号不能设置活动负责人')
  }
  throw new AdminError('FORBIDDEN', '当前账号不能设置该角色')
}

function normalizeRoleScope(roleKey, input) {
  if (roleKey.startsWith('PLATFORM_')) return { scopeType: 'PLATFORM', scopeId: null }
  if (roleKey === 'BRANCH_ADMIN') return { scopeType: 'BRANCH', scopeId: requiredId(input.scopeId, '城市分会') }
  return { scopeType: 'EVENT', scopeId: requiredId(input.scopeId, '活动'), branchId: input.branchId || null }
}

module.exports = { PLATFORM_SCOPE_ID, createAdminService }
