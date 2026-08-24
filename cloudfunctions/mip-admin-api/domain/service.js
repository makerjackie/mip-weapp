'use strict'

const { createHash } = require('node:crypto')

const { assertFullAccessUser } = require('./full-access')
const {
  CAPABILITIES,
  authorize,
  capabilitySnapshot,
  firstGrant,
  isValidRoleBinding,
  roleCapabilities,
  visibilityForCapability,
} = require('./capabilities')
const { configurableRoleKeys } = require('./role-capability-policies')
const {
  normalizeAnnouncementDraft,
  normalizeAnnouncementFilters,
  normalizeAnnouncementReason,
} = require('./announcement-validation')
const {
  normalizeMessageCampaignDraft,
  normalizeMessageCampaignFilters,
  normalizePublishKey,
  normalizeRecipientSearch,
} = require('./message-campaign-validation')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')
const { decryptPhone } = require('../lib/phone')
const { exportFileName, workbookForExport } = require('./export-workbook')
const { createOpportunityArchiveService } = require('./opportunity-archive')
const {
  availableExceptionTypes,
  normalizeExceptionRequest,
} = require('./operational-exception-access')
const { XLSX_CONTENT_TYPE, isXlsxBuffer } = require('../lib/xlsx')
const {
  AdminError,
  delta,
  expectedVersion,
  limit,
  metric,
  requiredId,
  stableKey,
  text,
} = require('./validation')
const { decodeCursor } = require('./pagination')

const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'
const ORDER_STATUSES = [
  'CREATED', 'PAYMENT_CREATED', 'PAID', 'FAILED', 'CLOSED',
  'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED',
]
const REFUND_STATUSES = ['NONE', 'PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED']
const ROSTER_STATUSES = [
  'PENDING_REVIEW', 'WAITLISTED', 'PAYMENT_PENDING', 'REGISTERED',
  'CANCELLATION_PENDING', 'CANCELLED', 'REJECTED', 'ATTENDED',
]

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
  async function session(caller) {
    const user = assertFullAccessUser(await repository.resolveUser(caller))
    const bindings = (await repository.listRoleBindings(caller.appId, user.id))
      .filter(isValidRoleBinding)
    if (!bindings.length) {
      throw new AdminError('FORBIDDEN', '当前账号没有运营权限')
    }
    return {
      caller: { appId: caller.appId, userId: user.id },
      bindings,
      capabilities: capabilitySnapshot(bindings),
    }
  }

  function publicBindings(bindings) {
    return bindings.map(binding => ({
      roleKey: binding.roleKey,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
    }))
  }

  function requirePlatformOwner(context) {
    const grant = context.bindings.find(binding => binding.roleKey === 'PLATFORM_OWNER'
      && binding.scopeType === 'PLATFORM'
      && (binding.scopeId === null || binding.scopeId === undefined))
    if (!grant) throw new AdminError('FORBIDDEN', '当前账号没有权限配置权限')
    return grant
  }

  function audit(context, grant, input) {
    return {
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      scopeType: input.scopeType,
      scopeId: input.scopeId || null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId || null,
      effectiveRole: grant.roleKey,
      metadata: input.metadata || {},
    }
  }

  function mutationAuthorization(grant, capability) {
    return {
      capability,
      effectiveGrant: {
        roleKey: grant.roleKey,
        scopeType: grant.scopeType,
        scopeId: grant.scopeType === 'PLATFORM' ? null : grant.scopeId,
      },
    }
  }

  async function dispatchRefundSafely(appId, refundId) {
    try {
      const result = await dispatchRefund({ appId, refundId })
      const status = ['PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED'].includes(result?.status)
        ? result.status
        : 'PENDING_RETRY'
      return { status }
    }
    catch {
      return { status: 'PENDING_RETRY' }
    }
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

  async function eventAuthorization(context, eventId, capability) {
    const scope = await repository.getEventScope(context.caller.appId, requiredId(eventId, '活动'))
    if (!scope) throw new AdminError('NOT_FOUND', '活动不存在')
    return { scope, grant: authorize(context.bindings, capability, scope) }
  }

  async function userAuthorization(context, userId, capability) {
    const scope = await repository.getUserScope(context.caller.appId, requiredId(userId, '用户'))
    if (!scope) throw new AdminError('NOT_FOUND', '用户不存在')
    return { scope, grant: authorize(context.bindings, capability, scope) }
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

  function announcementScope(draft) {
    return {
      scopeType: draft.scopeType,
      scopeId: draft.scopeType === 'BRANCH' ? draft.branchId : null,
    }
  }

  async function announcementAuthorization(context, announcementId) {
    const scope = await repository.getAnnouncementScope(context.caller.appId, requiredId(announcementId, '公告'))
    if (!scope) throw new AdminError('NOT_FOUND', '公告不存在')
    return {
      scope,
      grant: authorize(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE, scope),
    }
  }

  async function listAnnouncementScopes(caller) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE)
    return repository.listAnnouncementScopes(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
    )
  }

  async function listAnnouncements(caller, input = {}) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE)
    return {
      items: await repository.listAnnouncements(
        context.caller.appId,
        visibilityForCapability(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
        normalizeAnnouncementFilters(input),
        limit(input.limit, 50),
      ),
      nextCursor: null,
    }
  }

  async function getAnnouncement(caller, input = {}) {
    const context = await session(caller)
    const announcementId = requiredId(input.announcementId, '公告')
    await announcementAuthorization(context, announcementId)
    const item = await repository.getAnnouncement(context.caller.appId, announcementId)
    if (!item) throw new AdminError('NOT_FOUND', '公告不存在')
    return item
  }

  async function saveAnnouncement(caller, input = {}) {
    const context = await session(caller)
    const draft = normalizeAnnouncementDraft(input)
    const requestedScope = announcementScope(draft)
    const announcementId = input.announcementId ? requiredId(input.announcementId, '公告') : null
    const existingAuthorization = announcementId
      ? await announcementAuthorization(context, announcementId)
      : null
    const grant = authorize(context.bindings, CAPABILITIES.ANNOUNCEMENTS_MANAGE, requestedScope)
    const version = announcementId ? expectedVersion(input.expectedVersion) : null
    const contentSafetyStatus = await contentSafety(draft, caller)
    return repository.saveAnnouncement({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      announcementId,
      expectedVersion: version,
      draft,
      contentSafetyStatus,
      authorization: mutationAuthorization(grant, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      authorizedExistingScope: existingAuthorization?.scope || null,
      audit: (resourceId, action, metadata) => audit(context, grant, {
        ...requestedScope,
        action,
        resourceType: 'ANNOUNCEMENT',
        resourceId,
        metadata,
      }),
    })
  }

  async function messageCampaignAuthorization(context, campaignId) {
    const scope = await repository.getCampaignScope(
      context.caller.appId,
      requiredId(campaignId, '消息活动'),
    )
    if (!scope) throw new AdminError('NOT_FOUND', '消息活动不存在')
    return {
      scope,
      grant: authorize(context.bindings, CAPABILITIES.MESSAGES_MANAGE, scope),
    }
  }

  function publicCampaign(item, appId) {
    const {
      audienceUserIds = [],
      publishIdempotencyKey: _publishIdempotencyKey,
      publishRequestHash: _publishRequestHash,
      ...safe
    } = item
    return {
      ...safe,
      recipientRefs: audienceUserIds.map(userId => createProfileRef({ appId, userId }, profileRefSecret)),
    }
  }

  async function listMessageCampaignScopes(caller) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.MESSAGES_MANAGE)
    return repository.listScopes(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.MESSAGES_MANAGE),
    )
  }

  async function listMessageCampaigns(caller, input = {}) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.MESSAGES_MANAGE)
    const filters = normalizeMessageCampaignFilters(input)
    const items = await repository.listCampaigns(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.MESSAGES_MANAGE),
      filters,
      limit(input.limit, 50),
    )
    return { items: items.map(item => publicCampaign(item, context.caller.appId)), nextCursor: null }
  }

  async function getMessageCampaign(caller, input = {}) {
    const context = await session(caller)
    const campaignId = requiredId(input.campaignId, '消息活动')
    await messageCampaignAuthorization(context, campaignId)
    const item = await repository.getCampaign(context.caller.appId, campaignId)
    if (!item) throw new AdminError('NOT_FOUND', '消息活动不存在')
    return publicCampaign(item, context.caller.appId)
  }

  async function searchMessageRecipients(caller, input = {}) {
    const context = await session(caller)
    const request = normalizeRecipientSearch(input)
    const scope = request.branchId
      ? { scopeType: 'BRANCH', scopeId: request.branchId }
      : { scopeType: 'PLATFORM', scopeId: null }
    authorize(context.bindings, CAPABILITIES.MESSAGES_MANAGE, scope)
    const rows = await repository.searchRecipients(
      context.caller.appId,
      scope,
      request.query,
      limit(input.limit, 50),
    )
    return {
      items: rows.map(row => ({
        profileRef: createProfileRef({ appId: context.caller.appId, userId: row.id }, profileRefSecret),
        nickname: row.nickname,
        headline: row.headline,
        branchName: row.branch_name || '',
      })),
      nextCursor: null,
    }
  }

  async function saveMessageCampaign(caller, input = {}) {
    const context = await session(caller)
    const normalized = normalizeMessageCampaignDraft(input)
    const requestedScope = {
      scopeType: normalized.scopeType,
      scopeId: normalized.scopeType === 'BRANCH' ? normalized.branchId : null,
    }
    const campaignId = input.campaignId ? requiredId(input.campaignId, '消息活动') : null
    const existingAuthorization = campaignId
      ? await messageCampaignAuthorization(context, campaignId)
      : null
    const grant = authorize(context.bindings, CAPABILITIES.MESSAGES_MANAGE, requestedScope)
    const audienceUserIds = normalized.recipientRefs.map((profileRef) => {
      try {
        return readProfileRef(profileRef, context.caller.appId, profileRefSecret)
      }
      catch (error) {
        if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
        throw new AdminError('MESSAGE_RECIPIENT_INVALID', '收件人信息已失效')
      }
    })
    const draft = { ...normalized, audienceUserIds }
    delete draft.recipientRefs
    const contentSafetyStatus = await contentSafety(draft, caller)
    const item = await repository.saveCampaign({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      campaignId,
      expectedVersion: campaignId ? expectedVersion(input.expectedVersion) : null,
      draft,
      contentSafetyStatus,
      authorization: mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedExistingScope: existingAuthorization?.scope || null,
      audit: (resourceId, action, metadata) => audit(context, grant, {
        scopeType: requestedScope.scopeType,
        scopeId: requestedScope.scopeId,
        action,
        resourceType: 'MESSAGE_CAMPAIGN',
        resourceId,
        metadata,
      }),
    })
    return publicCampaign(item, context.caller.appId)
  }

  async function snapshotMessageCampaign(caller, input = {}) {
    const context = await session(caller)
    const campaignId = requiredId(input.campaignId, '消息活动')
    const { scope, grant } = await messageCampaignAuthorization(context, campaignId)
    const item = await repository.snapshotCampaign({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      campaignId,
      expectedVersion: expectedVersion(input.expectedVersion),
      authorization: mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'MESSAGE_CAMPAIGN',
        resourceId,
        metadata,
      }),
    })
    return publicCampaign(item, context.caller.appId)
  }

  async function publishMessageCampaign(caller, input = {}) {
    const context = await session(caller)
    const campaignId = requiredId(input.campaignId, '消息活动')
    const { scope, grant } = await messageCampaignAuthorization(context, campaignId)
    return repository.publishCampaign({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      campaignId,
      expectedVersion: expectedVersion(input.expectedVersion),
      idempotencyKey: normalizePublishKey(input.idempotencyKey),
      authorization: mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'MESSAGE_CAMPAIGN',
        resourceId,
        metadata,
      }),
    })
  }

  async function withdrawMessageCampaign(caller, input = {}) {
    const context = await session(caller)
    const campaignId = requiredId(input.campaignId, '消息活动')
    const { scope, grant } = await messageCampaignAuthorization(context, campaignId)
    const item = await repository.withdrawCampaign({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      campaignId,
      expectedVersion: expectedVersion(input.expectedVersion),
      reason: text(input.reason, 300, { required: true, label: '撤销原因' }),
      authorization: mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'MESSAGE_CAMPAIGN',
        resourceId,
        metadata,
      }),
    })
    return publicCampaign(item, context.caller.appId)
  }

  async function publishAnnouncement(caller, input = {}) {
    const context = await session(caller)
    const announcementId = requiredId(input.announcementId, '公告')
    const { scope, grant } = await announcementAuthorization(context, announcementId)
    const version = expectedVersion(input.expectedVersion)
    return repository.publishAnnouncement({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      announcementId,
      expectedVersion: version,
      authorization: mutationAuthorization(grant, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'ANNOUNCEMENT',
        resourceId,
        metadata,
      }),
    })
  }

  async function withdrawAnnouncement(caller, input = {}) {
    const context = await session(caller)
    const announcementId = requiredId(input.announcementId, '公告')
    const { scope, grant } = await announcementAuthorization(context, announcementId)
    const version = expectedVersion(input.expectedVersion)
    const reason = normalizeAnnouncementReason(input.reason)
    return repository.withdrawAnnouncement({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      announcementId,
      expectedVersion: version,
      reason,
      authorization: mutationAuthorization(grant, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'ANNOUNCEMENT',
        resourceId,
        metadata,
      }),
    })
  }

  async function setAnnouncementPinned(caller, input = {}) {
    const context = await session(caller)
    const announcementId = requiredId(input.announcementId, '公告')
    const { scope, grant } = await announcementAuthorization(context, announcementId)
    const version = expectedVersion(input.expectedVersion)
    if (typeof input.pinned !== 'boolean') throw new AdminError('VALIDATION_FAILED', '置顶状态无效')
    return repository.setAnnouncementPinned({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      announcementId,
      expectedVersion: version,
      pinned: input.pinned,
      authorization: mutationAuthorization(grant, CAPABILITIES.ANNOUNCEMENTS_MANAGE),
      authorizedScope: scope,
      audit: (resourceId, action, metadata) => audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action,
        resourceType: 'ANNOUNCEMENT',
        resourceId,
        metadata,
      }),
    })
  }

  async function listUsers(caller, input = {}) {
    const context = await session(caller)
    const grant = firstGrant(context.bindings, CAPABILITIES.USERS_READ)
    const filters = normalizeUserFilters(input.filters || {})
    const includePhone = input.includePhone === true
    const phoneGrant = includePhone
      ? firstGrant(context.bindings, CAPABILITIES.USERS_PHONE_READ)
      : null
    const pageLimit = limit(input.limit)
    const cursor = decodeCursor(input.cursor, ['updatedAt', 'id'])
    const page = pageResult(await repository.listUsers(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.USERS_READ),
      filters,
      pageLimit,
      cursor,
    ))
    const result = page.items.map((item) => {
      const rawPhone = includePhone && item.phoneCiphertext
        ? decryptPhone(item.phoneCiphertext, phoneEncryptionKey, { appId: context.caller.appId, userId: item.id })
        : null
      const { phoneCiphertext, ...safe } = item
      return {
        ...safe,
        phoneNumber: rawPhone,
      }
    })
    if (includePhone) {
      await repository.recordAudit(audit(context, phoneGrant, {
        scopeType: phoneGrant.scopeType,
        scopeId: phoneGrant.scopeId,
        action: 'admin.users.phone.view',
        resourceType: 'USER_LIST',
        metadata: { count: result.length, filters, cursor: Boolean(cursor) },
      }))
    }
    return { items: result, nextCursor: page.nextCursor }
  }

  async function getUser(caller, input = {}) {
    const context = await session(caller)
    const userId = requiredId(input.userId, '用户')
    const { scope } = await userAuthorization(context, userId, CAPABILITIES.USERS_READ)
    const includePhone = input.includePhone === true
    const phoneGrant = includePhone
      ? authorize(context.bindings, CAPABILITIES.USERS_PHONE_READ, scope)
      : null
    const item = await repository.getUserDetail(context.caller.appId, userId)
    if (!item) throw new AdminError('NOT_FOUND', '用户不存在')
    const rawPhone = includePhone && item.phoneCiphertext
      ? decryptPhone(item.phoneCiphertext, phoneEncryptionKey, { appId: context.caller.appId, userId })
      : null
    const { phoneCiphertext, ...safe } = item
    if (includePhone) {
      await repository.recordAudit(audit(context, phoneGrant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.users.phone.view',
        resourceType: 'USER',
        resourceId: userId,
        metadata: { detail: true },
      }))
    }
    const relatedRecords = typeof repository.getUserRelatedRecords === 'function'
      ? await repository.getUserRelatedRecords(context.caller.appId, userId)
      : { superCases: [], opportunities: [], registrations: [], orders: [] }
    return { ...safe, phoneNumber: rawPhone, relatedRecords }
  }

  async function updateUser(caller, input) {
    const context = await session(caller)
    const userId = requiredId(input.userId, '用户')
    const { scope, grant } = await userAuthorization(context, userId, CAPABILITIES.USERS_EDIT)
    const fields = normalizeEditableFields(input.fields)
    const version = nonNegativeVersion(input.expectedVersion)
    return repository.updateUserFields({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      userId,
      expectedVersion: version,
      fields,
      authorizedScope: scope,
      authorization: mutationAuthorization(grant, CAPABILITIES.USERS_EDIT),
      audit: audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.users.fields.update',
        resourceType: 'USER',
        resourceId: userId,
        metadata: { fields: Object.keys(fields), expectedVersion: version },
      }),
    })
  }

  async function setUserControl(caller, input) {
    const context = await session(caller)
    const userId = requiredId(input.userId, '用户')
    const { scope, grant } = await userAuthorization(context, userId, CAPABILITIES.USERS_CONTROL)
    const controlType = ['ALLOWLIST', 'BLOCKLIST'].includes(input.controlType) ? input.controlType : null
    if (!controlType || typeof input.active !== 'boolean') throw new AdminError('VALIDATION_FAILED', '名单设置无效')
    const reason = text(input.reason, 300, { required: true, label: '原因' })
    return repository.setUserControl({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      userId,
      controlType,
      active: input.active,
      reason,
      authorizedScope: scope,
      authorization: mutationAuthorization(grant, CAPABILITIES.USERS_CONTROL),
      audit: audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: input.active ? 'admin.users.access.activate' : 'admin.users.access.revoke',
        resourceType: 'USER_ACCESS_CONTROL',
        resourceId: userId,
        metadata: { controlType, reasonLength: reason.length },
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
    const filters = normalizeExportFilters(exportType, input.filters, scope)
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

  async function archiveEvent(caller, input = {}) {
    const context = await session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await eventAuthorization(context, eventId, CAPABILITIES.EVENTS_WRITE)
    const version = expectedVersion(input.expectedVersion)
    const reason = text(input.reason, 300, { required: true, label: '归档原因' })
    return repository.archiveEvent({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      expectedVersion: version,
      reason,
      authorizedScope: scope,
      authorization: mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      audit: audit(context, grant, {
        scopeType: 'EVENT', scopeId: eventId,
        action: 'admin.events.archive', resourceType: 'EVENT', resourceId: eventId,
        metadata: { expectedVersion: version, reasonLength: reason.length },
      }),
    })
  }

  async function listEvents(caller, input = {}) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.EVENTS_READ)
    const page = pageResult(await repository.listEvents(
        context.caller.appId,
        visibilityForCapability(context.bindings, CAPABILITIES.EVENTS_READ),
        normalizeFilters(input.filters),
        limit(input.limit),
        decodeCursor(input.cursor, ['startsAt', 'id']),
      ))
    return page
  }

  async function getEventPolicy(caller) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.EVENTS_WRITE)
    return repository.getEventPolicy(context.caller.appId)
  }

  async function saveEventPolicy(caller, input = {}) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.EVENTS_WRITE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    const cancellationHoursBeforeStart = Number(input.cancellationHoursBeforeStart)
    if (!Number.isInteger(cancellationHoursBeforeStart)
      || cancellationHoursBeforeStart < 0
      || cancellationHoursBeforeStart > 720) {
      throw new AdminError('VALIDATION_FAILED', '默认取消时间无效')
    }
    const version = nonNegativeVersion(input.expectedVersion)
    return repository.saveEventPolicy({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      expectedVersion: version,
      cancellationHoursBeforeStart,
      authorization: mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      audit: audit(context, grant, {
        scopeType: 'PLATFORM',
        scopeId: null,
        action: 'admin.events.policy.update',
        resourceType: 'APP_SETTING',
        metadata: { expectedVersion: version, cancellationHoursBeforeStart },
      }),
    })
  }

  async function getEvent(caller, input) {
    const context = await session(caller)
    const eventId = requiredId(input.eventId, '活动')
    await eventAuthorization(context, eventId, CAPABILITIES.EVENTS_READ)
    const event = await repository.getEvent(context.caller.appId, eventId)
    if (!event) throw new AdminError('NOT_FOUND', '活动不存在')
    return event
  }

  async function listEventAlbumPhotos(caller, input = {}) {
    const context = await session(caller)
    const eventId = requiredId(input.eventId, '活动')
    await eventAuthorization(context, eventId, CAPABILITIES.EVENTS_ALBUM_MANAGE)
    const status = ['PENDING', 'PUBLISHED', 'REJECTED'].includes(input.status)
      ? input.status
      : null
    if (!status) throw new AdminError('VALIDATION_FAILED', '相册筛选状态无效')
    return {
      items: await repository.listEventAlbumPhotos(
        context.caller.appId,
        eventId,
        status,
        limit(input.limit, 100),
      ),
      nextCursor: null,
    }
  }

  async function reviewEventAlbumPhoto(caller, input = {}) {
    const context = await session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const photoId = requiredId(input.photoId, '照片')
    const { scope, grant } = await eventAuthorization(context, eventId, CAPABILITIES.EVENTS_ALBUM_MANAGE)
    const decision = input.decision === 'APPROVE'
      ? { status: 'PUBLISHED', action: 'admin.events.album.approve' }
      : input.decision === 'REJECT'
        ? { status: 'REJECTED', action: 'admin.events.album.reject' }
        : null
    if (!decision) throw new AdminError('VALIDATION_FAILED', '相册审核结论无效')
    const reason = text(input.reason, 300, { required: true, label: '审核原因' })
    const version = expectedVersion(input.expectedVersion)
    return repository.reviewEventAlbumPhoto({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      photoId,
      expectedVersion: version,
      status: decision.status,
      reason,
      authorization: mutationAuthorization(grant, CAPABILITIES.EVENTS_ALBUM_MANAGE),
      authorizedScope: scope,
      audit: audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: decision.action,
        resourceType: 'EVENT_ALBUM_PHOTO',
        resourceId: photoId,
        metadata: { expectedVersion: version, reason },
      }),
    })
  }

  async function saveEvent(caller, input) {
    const context = await session(caller)
    let grant
    let existingScope = null
    if (input.eventId) {
      const authorization = await eventAuthorization(context, input.eventId, CAPABILITIES.EVENTS_WRITE)
      grant = authorization.grant
      existingScope = authorization.scope
    }
    else {
      const scope = input.draft?.scopeType === 'BRANCH'
        ? { scopeType: 'BRANCH', scopeId: requiredId(input.draft.branchId, '城市分会') }
        : { scopeType: 'PLATFORM', scopeId: null }
      grant = authorize(context.bindings, CAPABILITIES.EVENTS_WRITE, scope)
    }
    const draft = normalizeEventDraft(input.draft)
    if (existingScope && grant.scopeType !== 'PLATFORM') {
      const scopeChanged = draft.scopeType !== existingScope.eventScopeType
        || (draft.branchId || null) !== (existingScope.branchId || null)
      if (scopeChanged) throw new AdminError('FORBIDDEN', '当前账号不能修改活动归属')
    }
    const version = input.eventId ? expectedVersion(input.expectedVersion) : 0
    const checkedContentSafetyStatus = await contentSafety({
      title: draft.title,
      summary: draft.summary,
      description: draft.description,
      notices: draft.notices,
    }, caller)
    const contentSafetyStatus = ['PASSED', 'REJECTED', 'ERROR'].includes(checkedContentSafetyStatus)
      ? checkedContentSafetyStatus
      : 'ERROR'
    return repository.saveEvent({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId: input.eventId ? requiredId(input.eventId, '活动') : null,
      expectedVersion: version,
      draft,
      contentSafetyStatus,
      authorization: mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      authorizedScope: existingScope,
      audit: eventId => audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: input.eventId ? 'admin.events.update' : 'admin.events.create',
        resourceType: 'EVENT',
        resourceId: eventId,
        metadata: { expectedVersion: version },
      }),
    })
  }

  async function cloneEvent(caller, input) {
    const context = await session(caller)
    const sourceEventId = requiredId(input.sourceEventId, '活动')
    const { scope, grant } = await eventAuthorization(context, sourceEventId, CAPABILITIES.EVENTS_WRITE)
    const version = expectedVersion(input.expectedVersion)
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    const source = await repository.getEvent(context.caller.appId, sourceEventId)
    if (!source) throw new AdminError('NOT_FOUND', '活动不存在')
    if (source.version !== version) throw new AdminError('CONFLICT', '活动信息已更新，请刷新后重试')
    const title = cloneEventTitle(source.title)
    const checkedContentSafetyStatus = await contentSafety({
      title,
      summary: source.summary,
      description: source.description,
      notices: source.notices,
    }, caller)
    const contentSafetyStatus = ['PASSED', 'REJECTED', 'ERROR'].includes(checkedContentSafetyStatus)
      ? checkedContentSafetyStatus
      : 'ERROR'
    return repository.cloneEvent({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      sourceEventId,
      expectedVersion: version,
      idempotencyKey,
      title,
      contentSafetyStatus,
      authorization: mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      authorizedScope: scope,
      audit: eventId => audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: 'admin.events.clone',
        resourceType: 'EVENT',
        resourceId: eventId,
        metadata: { sourceEventId, sourceVersion: version },
      }),
    })
  }

  async function changeEventStatus(caller, input) {
    const context = await session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await eventAuthorization(context, eventId, CAPABILITIES.EVENTS_WRITE)
    if (!['PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED'].includes(input.status)) {
      throw new AdminError('VALIDATION_FAILED', '活动状态无效')
    }
    const reason = input.status === 'CANCELLED'
      ? text(input.reason, 300, { required: true, label: '取消原因' })
      : ''
    const version = expectedVersion(input.expectedVersion)
    const result = await repository.changeEventStatus({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      expectedVersion: version,
      status: input.status,
      reason,
      authorization: mutationAuthorization(grant, CAPABILITIES.EVENTS_WRITE),
      authorizedScope: scope,
      audit: audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: 'admin.events.status.change',
        resourceType: 'EVENT',
        resourceId: eventId,
        metadata: {
          status: input.status,
          previousStatus: scope.status,
          expectedVersion: version,
          reasonLength: reason.length,
        },
      }),
    })
    const refundIds = Array.isArray(result.refundIds) ? result.refundIds : []
    const refundDispatch = await dispatchRefundBatchSafely(context.caller.appId, refundIds)
    return {
      id: result.id,
      status: result.status,
      version: result.version,
      affectedCount: result.affectedCount,
      refundDispatch,
    }
  }

  async function publishEventReminder(caller, input) {
    const context = await session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await eventAuthorization(context, eventId, CAPABILITIES.COMMUNICATIONS_PUBLISH)
    const version = expectedVersion(input.expectedVersion)
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    if (typeof input.sendWechatReminder !== 'boolean') {
      throw new AdminError('VALIDATION_FAILED', '微信提醒设置无效')
    }
    return repository.publishEventReminder({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      expectedVersion: version,
      idempotencyKey,
      sendWechatReminder: input.sendWechatReminder,
      authorization: mutationAuthorization(grant, CAPABILITIES.COMMUNICATIONS_PUBLISH),
      authorizedScope: scope,
      audit: (publicationId, result) => audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: 'admin.communications.publish',
        resourceType: 'OPERATIONS_PUBLICATION',
        resourceId: publicationId,
        metadata: {
          eventId,
          expectedVersion: version,
          recipientCount: result.recipientCount,
          sendWechatReminder: result.sendWechatReminder,
        },
      }),
    })
  }

  async function listRoster(caller, input) {
    const context = await session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await eventAuthorization(context, eventId, CAPABILITIES.EVENTS_ROSTER)
    const includePhone = input.includePhone === true
    const phoneGrant = includePhone
      ? authorize(context.bindings, CAPABILITIES.USERS_PHONE_READ, scope)
      : null
    const page = pageResult(await repository.listRoster(
      context.caller.appId,
      eventId,
      normalizeRosterFilters(input.filters),
      limit(input.limit),
      decodeCursor(input.cursor, ['submittedAt', 'id']),
    ))
    const safeItems = page.items.map((item) => {
      const rawPhone = includePhone && item.phoneCiphertext
        ? decryptPhone(item.phoneCiphertext, phoneEncryptionKey, { appId: context.caller.appId, userId: item.userId })
        : null
      const { phoneCiphertext, userId, ...safe } = item
      return {
        ...safe,
        phoneNumber: rawPhone,
      }
    })
    if (includePhone) {
      await repository.recordAudit(audit(context, phoneGrant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: 'admin.events.roster.phone.view',
        resourceType: 'EVENT_ROSTER',
        resourceId: eventId,
        metadata: { count: safeItems.length },
      }))
    }
    return { items: safeItems, nextCursor: page.nextCursor }
  }

  async function listRosterAll(caller, input = {}) {
    const context = await session(caller)
    const grant = firstGrant(context.bindings, CAPABILITIES.EVENTS_ROSTER)
    const includePhone = input.includePhone === true
    const scope = { scopeType: grant.scopeType, scopeId: grant.scopeId }
    const phoneGrant = includePhone
      ? authorize(context.bindings, CAPABILITIES.USERS_PHONE_READ, scope)
      : null
    const page = pageResult(await repository.listRosterAll(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.EVENTS_ROSTER),
      normalizeRosterAllFilters(input.filters),
      limit(input.limit),
      decodeCursor(input.cursor, ['submittedAt', 'id']),
    ))
    const items = page.items.map((item) => {
      const phoneNumber = includePhone && item.phoneCiphertext
        ? decryptPhone(item.phoneCiphertext, phoneEncryptionKey, { appId: context.caller.appId, userId: item.userId })
        : null
      const { phoneCiphertext, ...safe } = item
      return { ...safe, phoneNumber }
    })
    if (includePhone) {
      await repository.recordAudit(audit(context, phoneGrant, {
        scopeType: scope.scopeType, scopeId: scope.scopeId,
        action: 'admin.events.roster.all.phone.view', resourceType: 'EVENT_ROSTER',
        metadata: { count: items.length },
      }))
    }
    return { items, nextCursor: page.nextCursor }
  }

  async function checkIn(caller, input) {
    const context = await session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await eventAuthorization(context, eventId, CAPABILITIES.EVENTS_CHECKIN)
    const registrationId = requiredId(input.registrationId, '报名')
    const version = expectedVersion(input.expectedVersion)
    return repository.checkIn({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      registrationId,
      expectedVersion: version,
      authorization: mutationAuthorization(grant, CAPABILITIES.EVENTS_CHECKIN),
      authorizedScope: scope,
      audit: audit(context, grant, {
        scopeType: 'EVENT', scopeId: eventId, action: 'admin.events.checkin',
        resourceType: 'EVENT_REGISTRATION', resourceId: registrationId,
        metadata: { expectedVersion: version },
      }),
    })
  }

  async function undoCheckIn(caller, input = {}) {
    const context = await session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await eventAuthorization(context, eventId, CAPABILITIES.EVENTS_CHECKIN_UNDO)
    const registrationId = requiredId(input.registrationId, '报名')
    const version = expectedVersion(input.expectedVersion)
    const reason = text(input.reason, 120, { required: true, label: '撤销原因' })
    return repository.undoCheckIn({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      registrationId,
      expectedVersion: version,
      reason,
      authorization: mutationAuthorization(grant, CAPABILITIES.EVENTS_CHECKIN_UNDO),
      authorizedScope: scope,
      audit: audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: 'admin.events.checkin.undo',
        resourceType: 'EVENT_REGISTRATION',
        resourceId: registrationId,
        metadata: { expectedVersion: version, reason },
      }),
    })
  }

  async function reviewRegistration(caller, input) {
    const context = await session(caller)
    const eventId = requiredId(input.eventId, '活动')
    const { scope, grant } = await eventAuthorization(context, eventId, CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE)
    const registrationId = requiredId(input.registrationId, '报名')
    const version = expectedVersion(input.expectedVersion)
    const decision = ['APPROVE', 'REJECT'].includes(input.decision) ? input.decision : null
    if (!decision) throw new AdminError('VALIDATION_FAILED', '审核结果无效')
    return repository.reviewRegistration({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      eventId,
      registrationId,
      expectedVersion: version,
      decision,
      authorization: mutationAuthorization(grant, CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE),
      authorizedScope: scope,
      audit: status => audit(context, grant, {
        scopeType: 'EVENT',
        scopeId: eventId,
        action: decision === 'APPROVE'
          ? 'admin.events.registration.approve'
          : 'admin.events.registration.reject',
        resourceType: 'EVENT_REGISTRATION',
        resourceId: registrationId,
        metadata: { decision, status, expectedVersion: version },
      }),
    })
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

  async function listOpportunities(caller, input = {}) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE)
    const readOpportunities = repository.listOpportunitiesV2 || repository.listOpportunities
    const page = pageResult(await readOpportunities(
        context.caller.appId,
        visibilityForCapability(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE),
        normalizeOpportunityFilters(input.filters),
        limit(input.limit),
        decodeCursor(input.cursor, ['updatedAt', 'id']),
      ))
    return page
  }

  async function getOpportunity(caller, input = {}) {
    const context = await session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const scope = await repository.getOpportunityScope(context.caller.appId, opportunityId)
    if (!scope) throw new AdminError('NOT_FOUND', '机会不存在')
    authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, scope)
    const item = await repository.getOpportunityDetail(context.caller.appId, opportunityId)
    if (!item) throw new AdminError('NOT_FOUND', '机会不存在')
    return item
  }

  async function getOpportunityEditorOptions(caller) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE)
    return repository.getOpportunityEditorOptions(context.caller.appId)
  }

  async function saveOpportunity(caller, input = {}) {
    const context = await session(caller)
    const draft = normalizeOpportunityDraft(input.draft)
    const existingId = input.opportunityId ? requiredId(input.opportunityId, '机会') : null
    let existingScope = null
    let grant
    if (existingId) {
      existingScope = await repository.getOpportunityScope(context.caller.appId, existingId)
      if (!existingScope) throw new AdminError('NOT_FOUND', '机会不存在')
      grant = authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, existingScope)
    }
    else {
      grant = authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, {
        scopeType: draft.scopeType,
        scopeId: draft.branchId,
      })
    }
    const checked = await contentSafety({
      title: draft.title,
      summary: `${draft.valueSummary}\n${draft.targetSummary}`,
      description: draft.description,
    }, caller)
    const contentSafetyStatus = checked === 'PASSED' || checked === 'APPROVED'
      ? 'APPROVED'
      : checked === 'REJECTED' ? 'REJECTED' : 'ERROR'
    const version = existingId ? expectedVersion(input.expectedVersion) : 0
    return repository.saveOpportunity({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId: existingId,
      expectedVersion: version,
      draft,
      contentSafetyStatus,
      authorizedScope: existingScope,
      authorization: mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
      audit: opportunityId => audit(context, grant, {
        scopeType: draft.scopeType, scopeId: draft.branchId,
        action: existingId ? 'admin.opportunities.update' : 'admin.opportunities.create',
        resourceType: 'OPPORTUNITY', resourceId: opportunityId,
        metadata: { expectedVersion: version },
      }),
    })
  }

  async function publishOpportunity(caller, input = {}) {
    const context = await session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const scope = await repository.getOpportunityScope(context.caller.appId, opportunityId)
    if (!scope) throw new AdminError('NOT_FOUND', '机会不存在')
    const grant = authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, scope)
    const version = expectedVersion(input.expectedVersion)
    return repository.publishOpportunity({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      expectedVersion: version,
      authorizedScope: scope,
      authorization: mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
      audit: audit(context, grant, {
        scopeType: scope.scopeType, scopeId: scope.scopeId,
        action: 'admin.opportunities.publish', resourceType: 'OPPORTUNITY', resourceId: opportunityId,
        metadata: { expectedVersion: version },
      }),
    })
  }

  async function endOpportunity(caller, input = {}) {
    const context = await session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const scope = await repository.getOpportunityScope(context.caller.appId, opportunityId)
    if (!scope) throw new AdminError('NOT_FOUND', '机会不存在')
    const grant = authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, scope)
    const version = expectedVersion(input.expectedVersion)
    return repository.endOpportunity({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      expectedVersion: version,
      authorizedScope: scope,
      authorization: mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
      audit: audit(context, grant, {
        scopeType: scope.scopeType, scopeId: scope.scopeId,
        action: 'admin.opportunities.end', resourceType: 'OPPORTUNITY', resourceId: opportunityId,
        metadata: { expectedVersion: version },
      }),
    })
  }

  async function unpublishOpportunity(caller, input) {
    const context = await session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const scope = await repository.getOpportunityScope(context.caller.appId, opportunityId)
    if (!scope) throw new AdminError('NOT_FOUND', '机会不存在')
    const grant = authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, scope)
    const reason = text(input.reason, 240, { required: true, label: '下架原因' })
    const version = expectedVersion(input.expectedVersion)
    return repository.unpublishOpportunity({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      expectedVersion: version,
      reason,
      authorization: mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
      authorizedScope: scope,
      audit: audit(context, grant, {
        scopeType: scope.scopeType, scopeId: scope.scopeId,
        action: 'admin.opportunities.unpublish', resourceType: 'OPPORTUNITY', resourceId: opportunityId,
        metadata: { reasonLength: reason.length, expectedVersion: version },
      }),
    })
  }

  async function archiveOpportunity(caller, input = {}) {
    const context = await session(caller)
    authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_ARCHIVE, {
      scopeType: 'PLATFORM',
      scopeId: null,
    })
    return createOpportunityArchiveService({
      repository,
      authorize: archiveContext => authorize(
        archiveContext.bindings,
        CAPABILITIES.OPPORTUNITIES_ARCHIVE,
        { scopeType: 'PLATFORM', scopeId: null },
      ),
    }).archiveOpportunity(context, input)
  }

  async function getMatchingAdminState(caller, input = {}) {
    const context = await session(caller)
    const branchId = input.branchId ? requiredId(input.branchId, '城市分会') : null
    if (branchId) {
      authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, {
        scopeType: 'BRANCH',
        scopeId: branchId,
      })
    }
    else {
      authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, {
        scopeType: 'PLATFORM',
        scopeId: null,
      })
    }
    return repository.getMatchingAdminState(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE),
      { branchId },
    )
  }

  async function saveMatchingSettings(caller, input = {}) {
    const context = await session(caller)
    const branchId = input.branchId ? requiredId(input.branchId, '城市分会') : null
    const scope = branchId
      ? { scopeType: 'BRANCH', scopeId: branchId }
      : { scopeType: 'PLATFORM', scopeId: null }
    const grant = authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, scope)
    const settings = normalizeMatchingSettings(input.settings)
    const version = nonNegativeVersion(input.expectedVersion)
    return repository.saveMatchingSettings({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      scope,
      expectedVersion: version,
      settings,
      authorization: mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
      audit: nextVersion => audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.matching.settings.update',
        resourceType: 'MATCHING_SETTINGS',
        resourceId: scope.scopeId,
        metadata: { expectedVersion: version, nextVersion, ...settings },
      }),
    })
  }

  async function recalculateOpportunityMatching(caller, input = {}) {
    const context = await session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const target = await repository.getMatchingRecalculationTarget(context.caller.appId, opportunityId)
    if (!target) throw new AdminError('NOT_FOUND', '机会不存在')
    const scope = target.branch_id
      ? { scopeType: 'BRANCH', scopeId: target.branch_id }
      : { scopeType: 'PLATFORM', scopeId: null }
    const grant = authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, scope)
    if (target.status !== 'PUBLISHED') throw new AdminError('INVALID_STATE', '只有已发布机会可以重算撮合结果')
    const idempotencyKey = text(input.idempotencyKey, 128, {
      required: true,
      label: '幂等标识',
    })
    if (idempotencyKey.length < 12) throw new AdminError('VALIDATION_FAILED', '幂等标识无效')
    try {
      const authorizedTarget = await repository.authorizeMatchingRecalculation({
        appId: context.caller.appId,
        actorUserId: context.caller.userId,
        opportunityId,
        expectedVersion: Number(target.version),
        authorization: mutationAuthorization(grant, CAPABILITIES.OPPORTUNITIES_MODERATE),
      })
      return await recalculateMatching({
        appId: context.caller.appId,
        actorUserId: context.caller.userId,
        requesterUserId: authorizedTarget.owner_user_id,
        opportunityId,
        sourceVersion: Number(authorizedTarget.version),
        idempotencyKey,
      })
    }
    catch (error) {
      const code = String(error?.message || '')
      if (['MATCHING_DISPATCH_CONFIG_REQUIRED', 'MATCHING_DISPATCH_UNAVAILABLE'].includes(code)) {
        throw new AdminError(code, '机会撮合重算服务暂时不可用')
      }
      throw new AdminError('MATCHING_DISPATCH_UNAVAILABLE', '机会撮合重算服务暂时不可用')
    }
  }

  async function opportunityCommentAuthorization(context, opportunityId) {
    const scope = await repository.getOpportunityScope(context.caller.appId, opportunityId)
    if (!scope) throw new AdminError('NOT_FOUND', '机会不存在')
    return { scope, grant: authorize(context.bindings, CAPABILITIES.MESSAGES_MANAGE, scope) }
  }

  async function getOpportunityCommentAdminState(caller, input = {}) {
    const context = await session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    await opportunityCommentAuthorization(context, opportunityId)
    const state = await repository.getOpportunityCommentAdminState(context.caller.appId, opportunityId)
    return {
      settings: state.settings,
      comments: state.comments.map(({ authorUserId, ...comment }) => ({
        ...comment,
        authorProfileRef: createProfileRef(
          { appId: context.caller.appId, userId: authorUserId },
          profileRefSecret,
        ),
      })),
      reports: state.reports.map(({ reporterUserId, ...report }) => ({
        ...report,
        reporterProfileRef: createProfileRef(
          { appId: context.caller.appId, userId: reporterUserId },
          profileRefSecret,
        ),
      })),
    }
  }

  async function saveOpportunityCommentSettings(caller, input = {}) {
    const context = await session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const { scope, grant } = await opportunityCommentAuthorization(context, opportunityId)
    if (!input.settings || typeof input.settings !== 'object'
      || typeof input.settings.commentsEnabled !== 'boolean'
      || typeof input.settings.reviewsEnabled !== 'boolean'
      || typeof input.settings.callsEnabled !== 'boolean'
      || !['AUTO', 'REVIEW'].includes(input.settings.moderationMode)) {
      throw new AdminError('VALIDATION_FAILED', '评论设置无效')
    }
    const version = nonNegativeVersion(input.expectedVersion)
    return repository.saveOpportunityCommentSettings({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      expectedVersion: version,
      settings: {
        commentsEnabled: input.settings.commentsEnabled,
        reviewsEnabled: input.settings.reviewsEnabled,
        callsEnabled: input.settings.callsEnabled,
        moderationMode: input.settings.moderationMode,
      },
      authorization: mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      audit: nextVersion => audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.opportunity_comments.settings.update',
        resourceType: 'OPPORTUNITY_COMMENT_SETTINGS',
        resourceId: opportunityId,
        metadata: { expectedVersion: version, nextVersion },
      }),
    })
  }

  async function moderateOpportunityComment(caller, input = {}) {
    const context = await session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const { scope, grant } = await opportunityCommentAuthorization(context, opportunityId)
    const commentId = requiredId(input.commentId, '评论')
    const action = ['PUBLISH', 'HIDE'].includes(input.action) ? input.action : null
    if (!action) throw new AdminError('VALIDATION_FAILED', '审核操作无效')
    const reason = text(input.reason, 300, { required: true, label: '审核原因' })
    const version = expectedVersion(input.expectedVersion)
    return repository.moderateOpportunityComment({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      commentId,
      expectedVersion: version,
      action,
      reason,
      authorization: mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      audit: (resourceOpportunityId, status) => {
        if (resourceOpportunityId !== opportunityId) throw new AdminError('CONFLICT', '评论所属机会已变化')
        return audit(context, grant, {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          action: action === 'PUBLISH'
            ? 'admin.opportunity_comments.publish'
            : 'admin.opportunity_comments.hide',
          resourceType: 'OPPORTUNITY_COMMENT',
          resourceId: commentId,
          metadata: { opportunityId, status, expectedVersion: version, reasonLength: reason.length },
        })
      },
    })
  }

  async function closeOpportunityCommentReport(caller, input = {}) {
    const context = await session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const { scope, grant } = await opportunityCommentAuthorization(context, opportunityId)
    const reportId = requiredId(input.reportId, '举报')
    const decision = ['RESOLVED', 'DISMISSED'].includes(input.decision) ? input.decision : null
    if (!decision) throw new AdminError('VALIDATION_FAILED', '举报处理结果无效')
    const reason = text(input.reason, 300, { required: true, label: '处理原因' })
    const version = expectedVersion(input.expectedVersion)
    return repository.closeOpportunityCommentReport({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      opportunityId,
      reportId,
      expectedVersion: version,
      decision,
      reason,
      authorization: mutationAuthorization(grant, CAPABILITIES.MESSAGES_MANAGE),
      audit: (resourceOpportunityId, commentId, status) => {
        if (resourceOpportunityId !== opportunityId) throw new AdminError('CONFLICT', '举报所属机会已变化')
        return audit(context, grant, {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          action: 'admin.opportunity_comment_reports.close',
          resourceType: 'OPPORTUNITY_COMMENT_REPORT',
          resourceId: reportId,
          metadata: { opportunityId, commentId, status, expectedVersion: version, reasonLength: reason.length },
        })
      },
    })
  }

  async function listGrowthLevels(caller) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.GROWTH_READ)
    return { items: await repository.listGrowthLevelsV2(context.caller.appId) }
  }

  async function listGrowthBenefits(caller) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.GROWTH_READ)
    return { items: await repository.listGrowthBenefits(context.caller.appId) }
  }

  async function saveGrowthBenefit(caller, input = {}) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.GROWTH_CONFIGURE, { scopeType: 'PLATFORM', scopeId: null })
    const draft = normalizeGrowthBenefit(input.draft)
    const benefitId = input.benefitId ? requiredId(input.benefitId, '权益') : null
    const version = benefitId ? expectedVersion(input.expectedVersion) : 0
    return repository.saveGrowthBenefit({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      benefitId,
      expectedVersion: version,
      draft,
      authorization: mutationAuthorization(grant, CAPABILITIES.GROWTH_CONFIGURE),
      audit: resourceId => audit(context, grant, {
        scopeType: 'PLATFORM', action: benefitId ? 'admin.growth.benefit.update' : 'admin.growth.benefit.create',
        resourceType: 'GROWTH_BENEFIT', resourceId,
        metadata: { status: draft.status, sortOrder: draft.sortOrder },
      }),
    })
  }

  async function saveGrowthLevel(caller, input) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.GROWTH_CONFIGURE, { scopeType: 'PLATFORM', scopeId: null })
    const draft = normalizeLevel(input.draft)
    const version = input.levelId ? expectedVersion(input.expectedVersion) : 0
    return repository.saveGrowthLevelV2({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      levelId: input.levelId ? requiredId(input.levelId, '等级') : null,
      expectedVersion: version,
      draft,
      authorization: mutationAuthorization(grant, CAPABILITIES.GROWTH_CONFIGURE),
      audit: levelId => audit(context, grant, {
        scopeType: 'PLATFORM', action: input.levelId ? 'admin.growth.level.update' : 'admin.growth.level.create',
        resourceType: 'GROWTH_LEVEL', resourceId: levelId,
        metadata: { status: draft.status, minimumExperience: draft.minimumExperience },
      }),
    })
  }

  async function listGrowthRules(caller) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.GROWTH_READ)
    return { items: await repository.listGrowthRules(context.caller.appId) }
  }

  async function saveGrowthRule(caller, input) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.GROWTH_CONFIGURE, { scopeType: 'PLATFORM', scopeId: null })
    const draft = normalizeRule(input.draft)
    const ruleId = requiredId(input.ruleId, '规则')
    const version = expectedVersion(input.expectedVersion)
    return repository.saveGrowthRule({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ruleId,
      expectedVersion: version,
      draft,
      authorization: mutationAuthorization(grant, CAPABILITIES.GROWTH_CONFIGURE),
      audit: ruleId => audit(context, grant, {
        scopeType: 'PLATFORM', action: 'admin.growth.rule.update',
        resourceType: 'GROWTH_RULE', resourceId: ruleId,
        metadata: { metric: draft.metric, deltaValue: draft.deltaValue, status: draft.status },
      }),
    })
  }

  async function listGrowthEntries(caller, input = {}) {
    const context = await session(caller)
    firstGrant(context.bindings, CAPABILITIES.GROWTH_READ)
    const page = pageResult(await repository.listGrowthEntries(
        context.caller.appId,
        visibilityForCapability(context.bindings, CAPABILITIES.GROWTH_READ),
        normalizeGrowthEntryFilters(input.filters),
        limit(input.limit),
        decodeCursor(input.cursor, ['createdAt', 'id']),
      ))
    return page
  }

  async function adjustGrowth(caller, input) {
    const context = await session(caller)
    const userId = requiredId(input.userId, '用户')
    const { scope } = await userAuthorization(context, userId, CAPABILITIES.GROWTH_ADJUST)
    const grant = authorize(context.bindings, CAPABILITIES.GROWTH_ADJUST, scope)
    const growthMetric = metric(input.metric)
    const deltaValue = delta(input.deltaValue)
    const reason = text(input.reason, 300, { required: true, label: '调整原因' })
    const idempotencyKey = stableKey(input.idempotencyKey, '请求', 128)
    return repository.adjustGrowth({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      userId,
      metric: growthMetric,
      deltaValue,
      reason,
      idempotencyKey,
      authorizedScope: scope,
      authorization: mutationAuthorization(grant, CAPABILITIES.GROWTH_ADJUST),
      audit: entryId => audit(context, grant, {
        scopeType: scope.scopeType, scopeId: scope.scopeId,
        action: 'admin.growth.adjust', resourceType: 'GROWTH_ENTRY', resourceId: entryId,
        metadata: { userId, metric: growthMetric, deltaValue, reasonLength: reason.length },
      }),
    })
  }

  async function listBadges(caller) {
    const context = await session(caller)
    authorize(context.bindings, CAPABILITIES.BADGES_MANAGE, { scopeType: 'PLATFORM', scopeId: null })
    return { items: await repository.listBadges(context.caller.appId) }
  }

  async function saveBadge(caller, input = {}) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.BADGES_MANAGE, { scopeType: 'PLATFORM', scopeId: null })
    const badgeId = input.badgeId ? requiredId(input.badgeId, '勋章') : null
    const draft = normalizeBadge(input.draft)
    const version = badgeId ? expectedVersion(input.expectedVersion) : 0
    return repository.saveBadge({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      badgeId,
      expectedVersion: version,
      draft,
      authorization: mutationAuthorization(grant, CAPABILITIES.BADGES_MANAGE),
      audit: resourceId => audit(context, grant, {
        scopeType: 'PLATFORM',
        action: badgeId ? 'admin.badge.update' : 'admin.badge.create',
        resourceType: 'BADGE',
        resourceId,
        metadata: { status: draft.status, sortOrder: draft.sortOrder },
      }),
    })
  }

  async function listBadgeAwards(caller, input = {}) {
    const context = await session(caller)
    authorize(context.bindings, CAPABILITIES.BADGES_MANAGE, { scopeType: 'PLATFORM', scopeId: null })
    const status = input.status === 'ACTIVE' || input.status === 'REVOKED' ? input.status : ''
    const query = text(input.query, 100)
    return { items: await repository.listBadgeAwards(context.caller.appId, { status, query }) }
  }

  async function grantBadge(caller, input = {}) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.BADGES_MANAGE, { scopeType: 'PLATFORM', scopeId: null })
    const userId = requiredId(input.userId, '用户')
    const badgeId = requiredId(input.badgeId, '勋章')
    const reason = text(input.reason, 300, { required: true, label: '授予原因' })
    return repository.grantBadge({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      userId,
      badgeId,
      reason,
      authorization: mutationAuthorization(grant, CAPABILITIES.BADGES_MANAGE),
      audit: resourceId => audit(context, grant, {
        scopeType: 'PLATFORM',
        action: 'admin.badge.grant',
        resourceType: 'USER_BADGE',
        resourceId,
        metadata: { userId, badgeId, reasonLength: reason.length },
      }),
    })
  }

  async function revokeBadge(caller, input = {}) {
    const context = await session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.BADGES_MANAGE, { scopeType: 'PLATFORM', scopeId: null })
    const awardId = requiredId(input.awardId, '获授记录')
    const version = expectedVersion(input.expectedVersion)
    const reason = text(input.reason, 300, { required: true, label: '撤销原因' })
    return repository.revokeBadge({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      awardId,
      expectedVersion: version,
      reason,
      authorization: mutationAuthorization(grant, CAPABILITIES.BADGES_MANAGE),
      audit: resourceId => audit(context, grant, {
        scopeType: 'PLATFORM',
        action: 'admin.badge.revoke',
        resourceType: 'USER_BADGE',
        resourceId,
        metadata: { reasonLength: reason.length, expectedVersion: version },
      }),
    })
  }

  async function listOrders(caller, input = {}) {
    const context = await session(caller)
    const filters = normalizeOrderFilters(input.filters)
    let grant
    let scope
    if (filters.eventId) {
      const authorization = await eventAuthorization(context, filters.eventId, CAPABILITIES.ORDERS_READ)
      grant = authorization.grant
      scope = authorization.scope
    }
    else {
      grant = firstGrant(context.bindings, CAPABILITIES.ORDERS_READ)
      scope = { scopeType: grant.scopeType, scopeId: grant.scopeId }
    }
    const visibility = visibilityForCapability(context.bindings, CAPABILITIES.ORDERS_READ)
    const [pageValue, summary] = await Promise.all([
      repository.listOrders(
        context.caller.appId,
        visibility,
        filters,
        limit(input.limit),
        decodeCursor(input.cursor, ['createdAt', 'id']),
      ),
      repository.summarizeOrders(context.caller.appId, visibility, filters),
    ])
    const page = pageResult(pageValue)
    await repository.recordAudit(audit(context, grant, {
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      action: 'admin.orders.view',
      resourceType: 'ORDER_LIST',
      metadata: { count: page.items.length, filters },
    }))
    return {
      ...page,
      summary,
      items: page.items.map((item) => {
        const { branchId, contentRefundEligible, ...safe } = item
        const orderScope = item.orderType === 'EVENT'
          ? { scopeType: 'EVENT', scopeId: item.resourceId, branchId: branchId || null }
          : { scopeType: 'PLATFORM', scopeId: null, branchId: null }
        let canRefund = false
        try {
          authorize(context.bindings, CAPABILITIES.REFUNDS_SUBMIT, orderScope)
          canRefund = true
        }
        catch {}
        const availableRefundActions = []
        if (canRefund
          && ['PAID', 'PARTIALLY_REFUNDED'].includes(item.status)
          && (item.orderType !== 'CONTENT' || contentRefundEligible)
          && Number(item.refundedAmountCents) < Number(item.amountCents)) {
          availableRefundActions.push('SUBMIT_REFUND')
        }
        if (canRefund
          && item.status === 'REFUND_PENDING'
          && item.refundId
          && ['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(item.refundStatus)) {
          availableRefundActions.push('RETRY_REFUND')
        }
        return { ...safe, availableRefundActions }
      }),
    }
  }

  async function submitRefund(caller, input) {
    const context = await session(caller)
    const orderId = requiredId(input.orderId, '订单')
    const scope = await repository.getOrderScope(context.caller.appId, orderId)
    if (!scope) throw new AdminError('NOT_FOUND', '订单不存在')
    const grant = authorize(context.bindings, CAPABILITIES.REFUNDS_SUBMIT, scope)
    const reason = text(input.reason, 300, { required: true, label: '退款原因' })
    const idempotencyKey = stableKey(input.idempotencyKey, '请求', 128)
    const refund = await repository.submitRefund({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      orderId,
      reason,
      idempotencyKey,
      authorization: mutationAuthorization(grant, CAPABILITIES.REFUNDS_SUBMIT),
      authorizedScope: scope,
      audit: (refundId, amountCents) => audit(context, grant, {
        scopeType: scope.scopeType, scopeId: scope.scopeId,
        action: 'admin.refunds.submit', resourceType: 'REFUND', resourceId: refundId,
        metadata: { orderId, amountCents, reasonLength: reason.length },
      }),
    })
    return {
      ...refund,
      providerDispatch: await dispatchRefundSafely(context.caller.appId, refund.id),
    }
  }

  async function retryRefund(caller, input) {
    const context = await session(caller)
    const refundId = requiredId(input.refundId, '退款')
    const scope = await repository.getRefundScope(context.caller.appId, refundId)
    if (!scope) throw new AdminError('NOT_FOUND', '退款记录不存在')
    const grant = authorize(context.bindings, CAPABILITIES.REFUNDS_SUBMIT, scope)
    if (!['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(scope.refundStatus)) {
      throw new AdminError('INVALID_STATE', '当前退款状态不需要重试')
    }
    await repository.authorizeRefundRetry({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      refundId,
      authorization: mutationAuthorization(grant, CAPABILITIES.REFUNDS_SUBMIT),
      authorizedScope: scope,
      audit: audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.refunds.retry',
        resourceType: 'REFUND',
        resourceId: refundId,
        metadata: { providerDispatchStatus: 'REQUESTED' },
      }),
    })
    const providerDispatch = await dispatchRefundSafely(context.caller.appId, refundId)
    return {
      id: refundId,
      providerDispatch,
    }
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

function normalizeIdempotencyKey(value) {
  const key = stableKey(value, '请求', 128)
  if (key.length < 12) throw new AdminError('VALIDATION_FAILED', '请求标识无效')
  return key
}

function normalizeMatchingSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '撮合设置无效')
  }
  const talentMinScore = Number(value.talentMinScore)
  const projectMinScore = Number(value.projectMinScore)
  const maximumCandidates = Number(value.maximumCandidates)
  if (!Number.isInteger(talentMinScore) || talentMinScore < 0 || talentMinScore > 100
    || !Number.isInteger(projectMinScore) || projectMinScore < 0 || projectMinScore > 100
    || !Number.isInteger(maximumCandidates) || maximumCandidates < 10 || maximumCandidates > 500
    || typeof value.externalProviderEnabled !== 'boolean') {
    throw new AdminError('VALIDATION_FAILED', '撮合设置无效')
  }
  return {
    talentMinScore,
    projectMinScore,
    maximumCandidates,
    externalProviderEnabled: value.externalProviderEnabled,
  }
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

function normalizeUserFilters(value) {
  const filters = normalizeFilters(value)
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '注册开始时间不能晚于结束时间')
  }
  const experienceMin = nonNegativeIntegerFilter(filters.experienceMin, '最低经验值')
  const experienceMax = nonNegativeIntegerFilter(filters.experienceMax, '最高经验值')
  if (experienceMin !== null && experienceMax !== null && experienceMin > experienceMax) {
    throw new AdminError('VALIDATION_FAILED', '最低经验值不能大于最高经验值')
  }
  return {
    query: text(filters.query, 80),
    status: ['ACTIVE', 'BLOCKED', 'CLOSED'].includes(filters.status) ? filters.status : '',
    kind: ['PLAYER', 'GUEST'].includes(filters.kind) ? filters.kind : '',
    branchId: filters.branchId ? requiredId(filters.branchId, '城市分会') : '',
    levelId: filters.levelId ? requiredId(filters.levelId, '成长等级') : '',
    controlType: ['ALLOWLIST', 'BLOCKLIST'].includes(filters.controlType) ? filters.controlType : '',
    phoneBound: ['BOUND', 'UNBOUND'].includes(filters.phoneBound) ? filters.phoneBound : '',
    profileComplete: ['COMPLETE', 'INCOMPLETE'].includes(filters.profileComplete) ? filters.profileComplete : '',
    joinedWithinDays: [7, 30, 90].includes(Number(filters.joinedWithinDays))
      ? Number(filters.joinedWithinDays)
      : 0,
    experienceMin,
    experienceMax,
    createdFrom,
    createdTo,
  }
}

function nonNegativeIntegerFilter(value, label) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 1_000_000_000) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return number
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

function normalizeRosterFilters(value) {
  const filters = normalizeFilters(value)
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '报名开始时间不能晚于结束时间')
  }
  return {
    query: text(filters.query, 80),
    status: enumFilter(filters.status, ROSTER_STATUSES, '报名状态'),
    createdFrom,
    createdTo,
  }
}

function normalizeOrderFilters(value) {
  const filters = normalizeFilters(value)
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '订单开始时间不能晚于结束时间')
  }
  return {
    query: text(filters.query, 80),
    eventId: filters.eventId ? requiredId(filters.eventId, '活动') : '',
    orderType: enumFilter(filters.orderType, ['MEMBERSHIP', 'EVENT', 'CONTENT'], '订单类型'),
    status: enumFilter(filters.status, ORDER_STATUSES, '订单状态'),
    refundStatus: enumFilter(filters.refundStatus, REFUND_STATUSES, '退款状态'),
    createdFrom,
    createdTo,
  }
}

function normalizeOpportunityFilters(value) {
  const filters = normalizeFilters(value)
  const updatedFrom = dateTimeFilter(filters.updatedFrom, '开始时间')
  const updatedTo = dateTimeFilter(filters.updatedTo, '结束时间')
  const deadlineFrom = dateTimeFilter(filters.deadlineFrom, '截止开始时间')
  const deadlineTo = dateTimeFilter(filters.deadlineTo, '截止结束时间')
  if (updatedFrom && updatedTo && updatedFrom > updatedTo) {
    throw new AdminError('VALIDATION_FAILED', '机会开始时间不能晚于结束时间')
  }
  if (deadlineFrom && deadlineTo && deadlineFrom > deadlineTo) {
    throw new AdminError('VALIDATION_FAILED', '机会截止开始时间不能晚于结束时间')
  }
  return {
    query: text(filters.query, 80),
    ownerQuery: text(filters.ownerQuery, 80),
    cityQuery: text(filters.cityQuery, 80),
    status: enumFilter(filters.status, ['DRAFT', 'PUBLISHED', 'ENDED', 'UNPUBLISHED', 'ARCHIVED'], '机会状态'),
    updatedFrom,
    updatedTo,
    deadlineFrom,
    deadlineTo,
  }
}

function normalizeRosterAllFilters(value) {
  const filters = normalizeRosterFilters(value)
  const source = normalizeFilters(value)
  return {
    ...filters,
    eventId: source.eventId ? requiredId(source.eventId, '活动') : '',
    branchId: source.branchId ? requiredId(source.branchId, '城市分会') : '',
  }
}

function normalizeOpportunityDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '机会内容无效')
  }
  const scopeType = value.scopeType === 'BRANCH' ? 'BRANCH' : 'PLATFORM'
  const roleKeys = Array.isArray(value.roleKeys) ? [...new Set(value.roleKeys)] : []
  const allowedRoles = new Set(['connector', 'business_builder', 'capital_operator', 'strategist', 'visual_designer', 'delivery_lead'])
  if (roleKeys.length > 6 || roleKeys.some(item => !allowedRoles.has(item))) {
    throw new AdminError('VALIDATION_FAILED', '合作角色无效')
  }
  const tagIds = Array.isArray(value.tagIds) ? [...new Set(value.tagIds.map(item => requiredId(item, '标签')))] : []
  if (tagIds.length > 20) throw new AdminError('VALIDATION_FAILED', '标签数量过多')
  return {
    ownerUserId: requiredId(value.ownerUserId, '发布人'),
    scopeType,
    branchId: scopeType === 'BRANCH' ? requiredId(value.branchId, '城市分会') : null,
    title: text(value.title, 120, { required: true, label: '机会标题' }),
    valueSummary: text(value.valueSummary, 300, { required: true, label: '机会价值' }),
    targetSummary: text(value.targetSummary, 300),
    description: text(value.description, 5_000),
    cityTagId: value.cityTagId ? requiredId(value.cityTagId, '城市') : null,
    roleKeys,
    tagIds,
    deadlineAt: value.deadlineAt ? dateTimeFilter(value.deadlineAt, '截止时间') : null,
  }
}

function normalizeGrowthBenefit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '权益内容无效')
  }
  const sortOrder = Number(value.sortOrder)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    throw new AdminError('VALIDATION_FAILED', '权益排序无效')
  }
  return {
    name: text(value.name, 120, { required: true, label: '权益名称' }),
    description: text(value.description, 600),
    sortOrder,
    status: enumFilter(value.status, ['DRAFT', 'ACTIVE', 'INACTIVE'], '权益状态') || 'DRAFT',
  }
}

function normalizeGrowthEntryFilters(value) {
  const filters = normalizeFilters(value)
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '成长流水开始时间不能晚于结束时间')
  }
  return {
    userId: filters.userId ? requiredId(filters.userId, '用户') : '',
    metric: filters.metric ? metric(filters.metric) : '',
    sourceEventType: filters.sourceEventType ? stableKey(filters.sourceEventType, '来源事件', 80) : '',
    createdFrom,
    createdTo,
  }
}

function enumFilter(value, allowed, label) {
  if (value === null || value === undefined || value === '') return ''
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!allowed.includes(normalized)) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return normalized
}

function dateTimeFilter(value, label) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 40) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

function normalizeExportFilters(exportType, value, scope) {
  const filters = normalizeFilters(value)
  const normalized = {}
  if (exportType === 'USERS') {
    Object.assign(normalized, normalizeUserFilters(filters))
  }
  else if (exportType === 'EVENT_ROSTER') {
    Object.assign(normalized, normalizeRosterFilters(filters), { eventId: scope.scopeId })
  }
  else if (exportType === 'EVENT_ROSTER_ALL') {
    Object.assign(normalized, normalizeRosterAllFilters(filters))
  }
  else if (exportType === 'EVENT_ORDERS') {
    Object.assign(normalized, normalizeOrderFilters({ ...filters, eventId: scope.scopeId }))
  }
  else if (exportType === 'ORDERS') {
    Object.assign(normalized, normalizeOrderFilters(filters))
  }
  else if (exportType === 'GROWTH_ENTRIES') {
    Object.assign(normalized, normalizeGrowthEntryFilters(filters))
  }
  else if (exportType === 'OPPORTUNITIES') {
    Object.assign(normalized, normalizeOpportunityFilters(filters))
  }
  if (scope.scopeType === 'BRANCH') normalized.branchId = scope.scopeId
  return normalized
}

function normalizeEditableFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '可编辑字段无效')
  }
  const allowed = new Set(['nickname', 'headline', 'introduction', 'visibility'])
  const keys = Object.keys(value)
  if (!keys.length || keys.some(key => !allowed.has(key))) {
    throw new AdminError('VALIDATION_FAILED', '包含未授权的资料字段')
  }
  const fields = {}
  if ('nickname' in value) fields.nickname = text(value.nickname, 64, { required: true, label: '昵称' })
  if ('headline' in value) fields.headline = text(value.headline, 160, { label: '简介标题' })
  if ('introduction' in value) fields.introduction = text(value.introduction, 600, { label: '个人介绍' })
  if ('visibility' in value) {
    if (!value.visibility || typeof value.visibility !== 'object' || Array.isArray(value.visibility)) {
      throw new AdminError('VALIDATION_FAILED', '隐私设置无效')
    }
    fields.visibility = value.visibility
  }
  return fields
}

function normalizeEventDraft(value) {
  if (!value || typeof value !== 'object') throw new AdminError('VALIDATION_FAILED', '活动内容无效')
  const startsAt = new Date(value.startsAt)
  const endsAt = new Date(value.endsAt)
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    throw new AdminError('VALIDATION_FAILED', '活动时间无效')
  }
  const eventMode = ['OFFLINE', 'ONLINE', 'HYBRID'].includes(value.eventMode) ? value.eventMode : 'OFFLINE'
  const accessType = ['FREE', 'MEMBER_INCLUDED', 'PAID'].includes(value.accessType) ? value.accessType : 'FREE'
  const registrationPolicy = ['AUTO', 'APPROVAL'].includes(value.registrationPolicy) ? value.registrationPolicy : 'AUTO'
  const albumSubmissionPolicy = value.albumSubmissionPolicy === 'AUTO' ? 'AUTO' : 'REVIEW'
  const priceCents = Number(value.priceCents || 0)
  const waitlistEnabled = value.waitlistEnabled === true
  if (accessType === 'PAID' && (!Number.isInteger(priceCents) || priceCents < 1 || registrationPolicy !== 'AUTO' || waitlistEnabled)) {
    throw new AdminError('VALIDATION_FAILED', '付费活动配置无效')
  }
  if (accessType !== 'PAID' && priceCents !== 0) throw new AdminError('VALIDATION_FAILED', '免费活动金额必须为零')
  const venueName = text(value.venueName, 160)
  const onlineUrl = text(value.onlineUrl, 1024)
  const latitude = coordinate(value.latitude, -90, 90, '纬度')
  const longitude = coordinate(value.longitude, -180, 180, '经度')
  if ((latitude === null) !== (longitude === null)) {
    throw new AdminError('VALIDATION_FAILED', '活动地点坐标不完整')
  }
  if ((eventMode === 'OFFLINE' || eventMode === 'HYBRID') && !venueName) throw new AdminError('VALIDATION_FAILED', '请填写活动地点')
  if ((eventMode === 'ONLINE' || eventMode === 'HYBRID') && !onlineUrl.startsWith('https://')) throw new AdminError('VALIDATION_FAILED', '线上地址必须使用 HTTPS')
  const capacity = value.capacity === null || value.capacity === undefined || value.capacity === '' ? null : Number(value.capacity)
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) throw new AdminError('VALIDATION_FAILED', '活动名额无效')
  const registrationDeadline = dateOrNull(value.registrationDeadline)
  const cancellationDeadline = dateOrNull(value.cancellationDeadline)
  if (registrationDeadline && registrationDeadline > startsAt) throw new AdminError('VALIDATION_FAILED', '报名截止时间不能晚于活动开始时间')
  if (cancellationDeadline && cancellationDeadline > startsAt) throw new AdminError('VALIDATION_FAILED', '取消截止时间不能晚于活动开始时间')
  const coverAssetId = text(value.coverAssetId, 36)
  if (coverAssetId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(coverAssetId)) {
    throw new AdminError('VALIDATION_FAILED', '活动封面无效')
  }
  const contentMedia = Array.isArray(value.contentMedia) ? value.contentMedia : []
  if (contentMedia.length > 12) {
    throw new AdminError('VALIDATION_FAILED', '活动介绍图片最多 12 张')
  }
  const contentMediaIds = new Set()
  const normalizedContentMedia = contentMedia.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AdminError('VALIDATION_FAILED', '活动介绍图片无效')
    }
    const assetId = text(item.assetId, 36)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)
      || contentMediaIds.has(assetId)) {
      throw new AdminError('VALIDATION_FAILED', '活动介绍图片无效')
    }
    contentMediaIds.add(assetId)
    return { assetId, caption: text(item.caption, 120) }
  })
  return {
    scopeType: value.scopeType === 'BRANCH' ? 'BRANCH' : 'PLATFORM',
    branchId: value.scopeType === 'BRANCH' ? requiredId(value.branchId, '城市分会') : null,
    title: text(value.title, 120, { required: true, label: '活动名称' }),
    summary: text(value.summary, 300, { required: true, label: '活动摘要' }),
    description: text(value.description, 20_000, { required: true, label: '活动介绍' }),
    contentMedia: normalizedContentMedia,
    notices: text(value.notices, 5_000),
    coverAssetId: coverAssetId || null,
    eventTypeKey: stableKey(value.eventTypeKey || 'general', '活动类型', 64),
    eventMode,
    accessType,
    registrationPolicy,
    albumEnabled: value.albumEnabled !== false,
    albumSubmissionPolicy,
    startsAt,
    endsAt,
    registrationDeadline,
    cancellationDeadline,
    venueName,
    address: text(value.address, 300),
    cityName: text(value.cityName, 80),
    latitude,
    longitude,
    onlineUrl: eventMode === 'OFFLINE' ? null : onlineUrl,
    capacity,
    waitlistEnabled,
    priceCents,
    registrationSchema: Array.isArray(value.registrationSchema) ? value.registrationSchema : [],
  }
}

function cloneEventTitle(value) {
  const suffix = '（副本）'
  return `${String(value || '').trim().slice(0, 120 - suffix.length)}${suffix}`
}

function dateOrNull(value) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new AdminError('VALIDATION_FAILED', '日期格式无效')
  return date
}

function coordinate(value, minimum, maximum, label) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return number
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

function normalizeLevel(value) {
  if (!value || typeof value !== 'object') throw new AdminError('VALIDATION_FAILED', '等级内容无效')
  const minimumExperience = Number(value.minimumExperience)
  if (!Number.isInteger(minimumExperience) || minimumExperience < 0) throw new AdminError('VALIDATION_FAILED', '等级门槛无效')
  const status = ['DRAFT', 'ACTIVE', 'INACTIVE'].includes(value.status) ? value.status : 'DRAFT'
  const sortOrder = Number(value.sortOrder ?? minimumExperience)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) throw new AdminError('VALIDATION_FAILED', '等级排序无效')
  const benefitIds = Array.isArray(value.benefitIds)
    ? [...new Set(value.benefitIds.map(item => requiredId(item, '权益')))]
    : []
  if (benefitIds.length > 50) throw new AdminError('VALIDATION_FAILED', '权益数量过多')
  return {
    levelKey: stableKey(value.levelKey, '等级', 48),
    name: text(value.name, 80, { required: true, label: '等级名称' }),
    minimumExperience,
    displayBadge: text(value.displayBadge, 80),
    sortOrder,
    benefitIds,
    status,
  }
}

function normalizeBadge(value) {
  if (!value || typeof value !== 'object') throw new AdminError('VALIDATION_FAILED', '勋章内容无效')
  const imageUrl = text(value.imageUrl, 1024)
  if (imageUrl && !/^https:\/\//.test(imageUrl)) {
    throw new AdminError('VALIDATION_FAILED', '勋章图片地址无效')
  }
  const iconName = text(value.iconName, 64)
  if (iconName && !/^[a-z][a-z0-9-]{0,63}$/.test(iconName)) {
    throw new AdminError('VALIDATION_FAILED', '勋章图标无效')
  }
  const sortOrder = Number(value.sortOrder || 0)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    throw new AdminError('VALIDATION_FAILED', '勋章排序无效')
  }
  return {
    key: stableKey(value.key, '勋章', 80),
    name: text(value.name, 100, { required: true, label: '勋章名称' }),
    description: text(value.description, 500),
    iconName,
    imageUrl,
    placeholderShape: ['CIRCLE', 'DIAMOND', 'HEXAGON'].includes(value.placeholderShape)
      ? value.placeholderShape
      : 'CIRCLE',
    sortOrder,
    status: ['DRAFT', 'ACTIVE', 'INACTIVE'].includes(value.status) ? value.status : 'DRAFT',
  }
}

function normalizeRule(value) {
  if (!value || typeof value !== 'object') throw new AdminError('VALIDATION_FAILED', '规则内容无效')
  const deltaValue = delta(value.deltaValue)
  if (deltaValue < 1) throw new AdminError('VALIDATION_FAILED', '奖励数值无效')
  const dailyLimitValue = value.dailyLimitValue === null || value.dailyLimitValue === undefined || value.dailyLimitValue === ''
    ? null
    : Number(value.dailyLimitValue)
  if (dailyLimitValue !== null && (!Number.isInteger(dailyLimitValue) || dailyLimitValue < 0)) {
    throw new AdminError('VALIDATION_FAILED', '每日上限无效')
  }
  return {
    ruleKey: stableKey(value.ruleKey, '规则', 80),
    name: text(value.name, 100, { required: true, label: '规则名称' }),
    metric: metric(value.metric),
    deltaValue,
    dailyLimitValue,
    sourceEventType: stableKey(value.sourceEventType, '来源事件', 80),
    status: ['DRAFT', 'ACTIVE', 'INACTIVE'].includes(value.status) ? value.status : 'DRAFT',
  }
}

function nonNegativeVersion(value) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 0) throw new AdminError('VALIDATION_FAILED', '记录版本无效')
  return version
}

module.exports = { PLATFORM_SCOPE_ID, createAdminService }
