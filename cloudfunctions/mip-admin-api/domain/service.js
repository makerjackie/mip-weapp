'use strict'

const { createHash } = require('node:crypto')

const {
  CAPABILITIES,
  authorize,
  firstGrant,
  visibilityForCapability,
} = require('./capabilities')
const { createAdminAccess } = require('./access')
const { createAdminCommunityGovernance } = require('./community-governance')
const { createAdminEvents } = require('./events')
const { createAdminGovernance, PLATFORM_SCOPE_ID } = require('./governance')
const { createAdminGrowth } = require('./growth')
const { createAdminMessaging } = require('./messaging')
const { createAdminOpportunities } = require('./opportunities')
const { createAdminOrders } = require('./orders')
const { createAdminUsers } = require('./users')
const { exportFileName, workbookForExport } = require('./export-workbook')
const { XLSX_CONTENT_TYPE, isXlsxBuffer } = require('../lib/xlsx')
const {
  AdminError,
  requiredId,
} = require('./validation')

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

module.exports = { PLATFORM_SCOPE_ID, createAdminService }
