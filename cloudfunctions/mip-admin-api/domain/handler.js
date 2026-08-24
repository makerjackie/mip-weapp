'use strict'

const { AdminError } = require('./validation')

const actions = Object.freeze({
  health: service => service.health(),
  'mip.admin.session': (service, caller, event) => service.getSession(caller, event),
  'mip.admin.dashboard': (service, caller, event) => service.getDashboard(caller, event),
  'mip.admin.branches.list': (service, caller, event) => service.listBranches(caller, event),
  'mip.admin.branches.create': (service, caller, event) => service.createBranch(caller, event),
  'mip.admin.branches.update': (service, caller, event) => service.updateBranch(caller, event),
  'mip.admin.branches.changeStatus': (service, caller, event) => service.changeBranchStatus(caller, event),
  'mip.admin.announcements.scopes': (service, caller, event) => service.listAnnouncementScopes(caller, event),
  'mip.admin.announcements.list': (service, caller, event) => service.listAnnouncements(caller, event),
  'mip.admin.announcements.get': (service, caller, event) => service.getAnnouncement(caller, event),
  'mip.admin.announcements.save': (service, caller, event) => service.saveAnnouncement(caller, event),
  'mip.admin.announcements.publish': (service, caller, event) => service.publishAnnouncement(caller, event),
  'mip.admin.announcements.withdraw': (service, caller, event) => service.withdrawAnnouncement(caller, event),
  'mip.admin.announcements.pin': (service, caller, event) => service.setAnnouncementPinned(caller, event),
  'mip.admin.users.list': (service, caller, event) => service.listUsers(caller, event),
  'mip.admin.users.get': (service, caller, event) => service.getUser(caller, event),
  'mip.admin.users.update': (service, caller, event) => service.updateUser(caller, event),
  'mip.admin.users.setControl': (service, caller, event) => service.setUserControl(caller, event),
  'mip.admin.exports.create': (service, caller, event) => service.createExport(caller, event),
  'mip.admin.exports.prepare': (service, caller, event) => service.prepareExport(caller, event),
  'mip.admin.exports.status': (service, caller, event) => service.getExportStatus(caller, event),
  'mip.admin.exports.reserve': (service, caller, event) => service.reserveExportDownload(caller, event),
  'mip.admin.exports.complete': (service, caller, event) => service.completeExportDownload(caller, event),
  'mip.admin.events.list': (service, caller, event) => service.listEvents(caller, event),
  'mip.admin.events.policy.get': (service, caller, event) => service.getEventPolicy(caller, event),
  'mip.admin.events.policy.save': (service, caller, event) => service.saveEventPolicy(caller, event),
  'mip.admin.events.get': (service, caller, event) => service.getEvent(caller, event),
  'mip.admin.events.save': (service, caller, event) => service.saveEvent(caller, event),
  'mip.admin.events.clone': (service, caller, event) => service.cloneEvent(caller, event),
  'mip.admin.events.changeStatus': (service, caller, event) => service.changeEventStatus(caller, event),
  'mip.admin.events.archive': (service, caller, event) => service.archiveEvent(caller, event),
  'mip.admin.events.album.list': (service, caller, event) => service.listEventAlbumPhotos(caller, event),
  'mip.admin.events.album.review': (service, caller, event) => service.reviewEventAlbumPhoto(caller, event),
  'mip.admin.communications.publishEventReminder': (service, caller, event) => service.publishEventReminder(caller, event),
  'mip.admin.communityReports.list': (service, caller, event) => service.listCommunityReports(caller, event),
  'mip.admin.communityReports.claim': (service, caller, event) => service.claimCommunityReport(caller, event),
  'mip.admin.communityReports.close': (service, caller, event) => service.closeCommunityReport(caller, event),
  'mip.admin.events.roster': (service, caller, event) => service.listRoster(caller, event),
  'mip.admin.events.rosterAll': (service, caller, event) => service.listRosterAll(caller, event),
  'mip.admin.events.registrations.review': (service, caller, event) => service.reviewRegistration(caller, event),
  'mip.admin.events.checkIn': (service, caller, event) => service.checkIn(caller, event),
  'mip.admin.events.undoCheckIn': (service, caller, event) => service.undoCheckIn(caller, event),
  'mip.admin.roles.list': (service, caller, event) => service.listRoles(caller, event),
  'mip.admin.roles.candidates': (service, caller, event) => service.searchRoleCandidates(caller, event),
  'mip.admin.roles.set': (service, caller, event) => service.setRole(caller, event),
  'mip.admin.opportunities.list': (service, caller, event) => service.listOpportunities(caller, event),
  'mip.admin.opportunities.get': (service, caller, event) => service.getOpportunity(caller, event),
  'mip.admin.opportunities.options': (service, caller, event) => service.getOpportunityEditorOptions(caller, event),
  'mip.admin.opportunities.save': (service, caller, event) => service.saveOpportunity(caller, event),
  'mip.admin.opportunities.publish': (service, caller, event) => service.publishOpportunity(caller, event),
  'mip.admin.opportunities.unpublish': (service, caller, event) => service.unpublishOpportunity(caller, event),
  'mip.admin.opportunities.archive': (service, caller, event) => service.archiveOpportunity(caller, event),
  'mip.admin.growth.levels': (service, caller, event) => service.listGrowthLevels(caller, event),
  'mip.admin.growth.benefits': (service, caller, event) => service.listGrowthBenefits(caller, event),
  'mip.admin.growth.saveBenefit': (service, caller, event) => service.saveGrowthBenefit(caller, event),
  'mip.admin.growth.saveLevel': (service, caller, event) => service.saveGrowthLevel(caller, event),
  'mip.admin.growth.rules': (service, caller, event) => service.listGrowthRules(caller, event),
  'mip.admin.growth.saveRule': (service, caller, event) => service.saveGrowthRule(caller, event),
  'mip.admin.growth.entries': (service, caller, event) => service.listGrowthEntries(caller, event),
  'mip.admin.growth.adjust': (service, caller, event) => service.adjustGrowth(caller, event),
  'mip.admin.badges.list': (service, caller, event) => service.listBadges(caller, event),
  'mip.admin.badges.save': (service, caller, event) => service.saveBadge(caller, event),
  'mip.admin.badges.awards': (service, caller, event) => service.listBadgeAwards(caller, event),
  'mip.admin.badges.grant': (service, caller, event) => service.grantBadge(caller, event),
  'mip.admin.badges.revoke': (service, caller, event) => service.revokeBadge(caller, event),
  'mip.admin.orders.list': (service, caller, event) => service.listOrders(caller, event),
  'mip.admin.refunds.submit': (service, caller, event) => service.submitRefund(caller, event),
  'mip.admin.refunds.retry': (service, caller, event) => service.retryRefund(caller, event),
  'mip.admin.exceptions.list': (service, caller, event) => service.listOperationalExceptions(caller, event),
  'mip.admin.audit.list': (service, caller, event) => service.listAudit(caller, event),
})

function createHandler({ service, getContext, resolveCaller }) {
  return async function handler(event = {}) {
    try {
      const action = typeof event.action === 'string' ? event.action : ''
      const dispatch = actions[action]
      if (!dispatch) throw new AdminError('NOT_FOUND', '运营操作不存在')
      if (action === 'health') return { ok: true, data: await dispatch(service, null, event) }
      const caller = resolveCaller(getContext())
      return { ok: true, data: await dispatch(service, caller, event) }
    }
    catch (error) {
      return errorResponse(error)
    }
  }
}

function errorResponse(error) {
  const code = error?.code || error?.message
  const known = {
    AUTH_REQUIRED: '请登录后继续',
    AGREEMENT_REQUIRED: '请先接受当前用户协议和隐私政策',
    FORBIDDEN: '当前账号没有运营权限',
    NOT_FOUND: '记录不存在',
    PHONE_REQUIRED: '请先绑定手机号',
    PROFILE_REQUIRED: '请先完成身份资料',
    VALIDATION_FAILED: '提交内容无效',
    CONFLICT: '记录状态已变化，请刷新后重试',
    INVALID_STATE: '当前状态不支持此操作',
    CONTENT_SAFETY_REQUIRED: '内容安全检查未通过，暂不能发布',
    INSUFFICIENT_BALANCE: '调整后余额不能小于零',
    PHONE_ENCRYPTION_NOT_CONFIGURED: '手机号服务尚未配置',
    PHONE_CIPHERTEXT_INVALID: '手机号数据无法读取',
    IDENTITY_CONFIG_REQUIRED: '身份服务尚未配置',
    EXPORT_NOT_FOUND: '导出任务不存在',
    EXPORT_EXPIRED: '导出任务已过期',
    EXPORT_BUSY: '导出任务正在处理',
    EXPORT_NOT_READY: '导出文件尚未就绪',
    EXPORT_CONSUMED: '导出文件已下载',
    EXPORT_FAILED: '导出任务处理失败',
    EXPORT_TOO_LARGE: '导出记录过多，请缩小筛选范围',
    EXPORT_INTEGRITY_FAILED: '导出文件校验失败',
    EXPORT_STORAGE_UNAVAILABLE: '导出存储尚未配置',
    EXPORT_SERVICE_UNAVAILABLE: '导出服务暂时不可用',
    GROWTH_BASE_LEVEL_REQUIRED: '必须保留一个门槛为 0 的启用基础等级',
    GROWTH_LEVEL_THRESHOLD_CONFLICT: '等级经验门槛已存在',
    GROWTH_LEVEL_KEY_CONFLICT: '等级标识已存在',
    GROWTH_RULE_ACTIVE_CONFLICT: '同一来源事件和成长类型只能启用一条规则',
    GROWTH_RULE_KEY_CONFLICT: '规则标识已存在',
    GROWTH_RULE_IMMUTABLE: '奖励行为和成长类型不能修改',
    GROWTH_RULE_NOT_CONFIGURABLE: '该奖励规则不在可配置范围内',
    BRANCH_KEY_CONFLICT: '分会标识已存在',
    BRANCH_DEACTIVATION_BLOCKED: '分会仍有关联的有效记录，无法停用',
    COMMUNICATIONS_EVENT_NOT_PUBLISHED: '活动发布后才能发送提醒',
    COMMUNICATIONS_RECIPIENT_LIMIT_EXCEEDED: '已确认参与者数量超过单次发送上限',
    COMMUNICATIONS_EVENT_FACT_INVALID: '活动提醒信息不完整',
    COMMUNICATIONS_IDEMPOTENCY_CONFLICT: '重复请求的内容不一致',
    COMMUNICATIONS_IDEMPOTENCY_INVALID: '重复请求记录无效',
    COMMUNICATIONS_REQUEST_IN_PROGRESS: '相同提醒正在处理中',
    EVENT_ALBUM_MEDIA_INVALID: '照片素材状态无效，请刷新后重试',
    EVENT_ARCHIVE_BLOCKED: '活动已有报名、订单或其他业务记录，需保留历史',
    OPPORTUNITY_ARCHIVE_BLOCKED: '机会已有关联业务记录，无法归档',
    BADGE_IN_USE: '勋章仍在佩戴中，请用户先取消佩戴',
    BADGE_EQUIPPED: '勋章仍在佩戴中，暂时不能撤销',
    BADGE_KEY_CONFLICT: '勋章标识已存在',
  }
  if (known[code] || error instanceof AdminError) {
    const responseError = {
      code: known[code] ? code : error.code,
      message: error instanceof AdminError ? error.message : known[code],
      retryable: error?.retryable === true || code === 'CONFLICT',
    }
    const blockerDetails = branchBlockerDetails(code, error?.details)
      || opportunityArchiveBlockerDetails(code, error?.details)
      || eventArchiveBlockerDetails(code, error?.details)
    if (blockerDetails) responseError.details = blockerDetails
    return {
      ok: false,
      error: responseError,
    }
  }
  console.error('[mip-admin-api] request failed', error?.code || error?.name || 'UNKNOWN')
  return {
    ok: false,
    error: { code: 'SERVICE_UNAVAILABLE', message: '运营服务暂时不可用', retryable: true },
  }
}

function eventArchiveBlockerDetails(code, details) {
  if (code !== 'EVENT_ARCHIVE_BLOCKED' || !details || typeof details !== 'object') return null
  const blockers = {}
  for (const key of ['registrations', 'orders', 'checkins', 'albumPhotos']) {
    const value = Number(details[key])
    if (!Number.isInteger(value) || value < 0) return null
    blockers[key] = value
  }
  return { blockers }
}

function branchBlockerDetails(code, details) {
  if (code !== 'BRANCH_DEACTIVATION_BLOCKED' || !details?.blockers) return null
  const keys = ['activeMemberships', 'activeBranchAdmins', 'publishedEvents', 'publishedOpportunities']
  const blockers = {}
  for (const key of keys) {
    const value = Number(details.blockers[key])
    if (!Number.isInteger(value) || value < 0) return null
    blockers[key] = value
  }
  return { blockers }
}

function opportunityArchiveBlockerDetails(code, details) {
  if (code !== 'OPPORTUNITY_ARCHIVE_BLOCKED' || !Array.isArray(details?.blockers)) return null
  const allowed = new Set([
    'REFERRAL_INTENTS',
    'PROFILE_INTERESTS',
    'ORDERS',
    'ANNOUNCEMENTS',
    'OUTBOX_EVENTS',
  ])
  const blockers = [...new Set(details.blockers.filter(item => allowed.has(item)))]
  return blockers.length ? { blockers } : null
}

module.exports = { actions, createHandler, errorResponse }
