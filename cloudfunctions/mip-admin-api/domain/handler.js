'use strict'

const { actions } = require('./application')
const { AdminError } = require('./validation')

const ADMIN_REQUEST_CONTRACT_VERSION = 1
const adminRequestKeys = new Set(['contractVersion', 'action', 'input', 'idempotencyKey'])

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function invalidAdminRequest() {
  return new AdminError('VALIDATION_FAILED', '运营请求格式无效')
}

function isLegacyOpportunityCommentModeration(event) {
  return ['PUBLISH', 'HIDE'].includes(event.action)
    && ['opportunityId', 'commentId', 'expectedVersion', 'reason'].every(key => hasOwn(event, key))
}

function normalizeAdminRequest(event = {}) {
  if (event && typeof event === 'object' && hasOwn(event, 'contractVersion')) {
    if (!isPlainObject(event)) throw invalidAdminRequest()
    if (event.contractVersion !== ADMIN_REQUEST_CONTRACT_VERSION) {
      throw new AdminError('CONTRACT_VERSION_UNSUPPORTED', '管理请求协议版本不受支持')
    }
    if (Reflect.ownKeys(event).some(key => typeof key !== 'string' || !adminRequestKeys.has(key))) {
      throw invalidAdminRequest()
    }
    if (typeof event.action !== 'string' || !event.action) throw invalidAdminRequest()
    if (!isPlainObject(event.input)) throw invalidAdminRequest()
    if (hasOwn(event, 'idempotencyKey') && hasOwn(event.input, 'idempotencyKey')) {
      throw invalidAdminRequest()
    }
    if (hasOwn(event, 'idempotencyKey') && typeof event.idempotencyKey !== 'string') {
      throw invalidAdminRequest()
    }

    const input = { ...event.input }
    if (hasOwn(event, 'idempotencyKey')) input.idempotencyKey = event.idempotencyKey
    return { action: event.action, input }
  }

  const legacyEvent = event && typeof event === 'object' && !Array.isArray(event) ? event : {}
  if (isLegacyOpportunityCommentModeration(legacyEvent)) {
    return {
      action: 'mip.admin.opportunityComments.moderate',
      input: { ...legacyEvent },
    }
  }
  const action = typeof legacyEvent.action === 'string' ? legacyEvent.action : ''
  const input = { ...legacyEvent }
  delete input.action
  return { action, input }
}

function createHandler(options = {}) {
  const { application, getContext, issuePrincipal, resolveCaller, service } = options
  const modern = application !== undefined || issuePrincipal !== undefined
  const legacy = service !== undefined || resolveCaller !== undefined
  const modernValid = application
    && typeof application.execute === 'function'
    && typeof application.probe === 'function'
    && typeof issuePrincipal === 'function'
  const legacyValid = service
    && typeof resolveCaller === 'function'
  if (typeof getContext !== 'function'
    || modern === legacy
    || (modern && !modernValid)
    || (legacy && !legacyValid)) {
    throw new Error('HANDLER_CONFIG_INVALID')
  }

  return async function handler(event = {}) {
    try {
      const request = normalizeAdminRequest(event)
      const { action, input } = request
      const dispatch = actions[action]
      if (!dispatch) throw new AdminError('NOT_FOUND', '运营操作不存在')
      if (action === 'health') {
        const data = modern ? await application.probe() : await dispatch(service, null, input)
        return { ok: true, data }
      }
      const principal = await (modern ? issuePrincipal : resolveCaller)(getContext())
      const data = modern
        ? await application.execute(principal, action, input)
        : await dispatch(service, principal, input)
      return { ok: true, data }
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
    CONTRACT_VERSION_UNSUPPORTED: '管理请求协议版本不受支持',
    VALIDATION_FAILED: '提交内容无效',
    CONFLICT: '记录状态已变化，请刷新后重试',
    INVALID_STATE: '当前状态不支持此操作',
    MATCHING_DISPATCH_CONFIG_REQUIRED: '机会撮合重算服务尚未配置',
    MATCHING_DISPATCH_UNAVAILABLE: '机会撮合重算服务暂时不可用',
    CONTENT_SAFETY_REQUIRED: '内容安全检查未通过，暂不能发布',
    CONTENT_REFUND_NOT_AVAILABLE: '内容已访问或已超过可退款时间',
    DEMO_ORDER: '演示订单不支持退款',
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
    MESSAGE_CAMPAIGN_IMMUTABLE: '收件人快照生成后，活动内容和范围不能修改',
    MESSAGE_RECIPIENT_INVALID: '收件人信息已失效，请重新选择',
    MESSAGE_RECIPIENT_LIMIT_EXCEEDED: '收件人数超过单次发布上限',
    MESSAGE_RECIPIENTS_EMPTY: '当前范围内没有可接收消息的用户',
    MESSAGE_RECIPIENT_SNAPSHOT_INVALID: '收件人快照无效，请联系管理员处理',
    MESSAGE_SCHEDULE_ACTIVE: '请先取消当前定时计划后再立即发布',
    MESSAGE_SCHEDULE_BUSY: '定时计划正在执行，请稍后刷新',
    MESSAGE_SCHEDULE_MANUAL_REVIEW_REQUIRED: '定时计划结果待人工核对，暂不能修改或取消',
    MESSAGE_SCHEDULE_IDEMPOTENCY_CONFLICT: '重复请求的定时计划内容不一致',
    MESSAGE_SCHEDULE_REQUEST_IN_PROGRESS: '相同定时计划请求正在处理',
    CLAIMED_BY_OTHER: '该投递异常已由其他运营人员认领',
    CLAIM_EXPIRED: '认领已过期，请刷新后重新认领',
    DELIVERY_RECONCILE_CONFIG_REQUIRED: '通知投递复核服务尚未配置',
    DELIVERY_RECONCILE_RESPONSE_INVALID: '通知投递复核结果无法验证',
    DELIVERY_RECONCILE_UNAVAILABLE: '通知投递复核暂时不可用',
    EVIDENCE_CHANGED: '投递证据已变化，请刷新后重试',
    IDEMPOTENCY_CONFLICT: '重复请求的内容不一致',
    NOT_ACTIONABLE: '当前投递状态不需要人工处理',
    REQUEST_IN_PROGRESS: '相同投递复核正在处理',
    EVENT_ALBUM_MEDIA_INVALID: '照片素材状态无效，请刷新后重试',
    EVENT_ARCHIVE_BLOCKED: '活动已有报名、订单或其他业务记录，需保留历史',
    OPPORTUNITY_ARCHIVE_BLOCKED: '机会已有关联业务记录，无法归档',
    BADGE_IN_USE: '勋章仍在佩戴中，请用户先取消佩戴',
    BADGE_EQUIPPED: '勋章仍在佩戴中，暂时不能撤销',
    BADGE_KEY_CONFLICT: '勋章标识已存在',
    KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE: '当前信息源不能自动抓取，请检查配置',
    KNOWLEDGE_SOURCE_RESPONSE_INVALID: '信息源返回了无效内容',
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

module.exports = { actions, createHandler, errorResponse, normalizeAdminRequest }
