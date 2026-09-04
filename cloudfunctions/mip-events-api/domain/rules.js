'use strict'

class DomainError extends Error {
  constructor(code, message, retryable = false) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.retryable = retryable
  }
}

const activeRegistrationStatuses = new Set([
  'PENDING_REVIEW',
  'WAITLISTED',
  'PAYMENT_PENDING',
  'REGISTERED',
  'CANCELLATION_PENDING',
  'ATTENDED',
])

const capacityStatuses = new Set(['REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED'])
const cancellableRegistrationStatuses = new Set([
  'PENDING_REVIEW',
  'WAITLISTED',
  'PAYMENT_PENDING',
  'REGISTERED',
])

function asDate(value, code = 'DATA_INTEGRITY') {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new DomainError(code, '活动时间无效')
  }
  return date
}

function assertRegistrationWindow(event, now = new Date()) {
  if (!event || event.status !== 'PUBLISHED') {
    throw new DomainError('NOT_FOUND', '活动不存在或已下架')
  }
  const timestamp = asDate(now).getTime()
  const startsAt = asDate(event.starts_at).getTime()
  const opensAt = event.registration_opens_at ? asDate(event.registration_opens_at).getTime() : null
  const deadline = event.registration_deadline ? asDate(event.registration_deadline).getTime() : startsAt
  if ((opensAt !== null && timestamp < opensAt) || timestamp >= deadline) {
    throw new DomainError('CONFLICT', '当前不在报名时间内')
  }
}

function decideRegistration({ event, userKind, capacityCount, activeHoldCount, now = new Date() }) {
  assertRegistrationWindow(event, now)
  if (event.access_type === 'MEMBER_INCLUDED' && userKind !== 'PLAYER') {
    throw new DomainError('FORBIDDEN', '本活动仅限玩家报名')
  }
  const capacity = event.capacity === null || event.capacity === undefined
    ? null
    : Number(event.capacity)
  const full = capacity !== null && capacityCount + activeHoldCount >= capacity
  if (event.access_type === 'PAID') {
    if (full) {
      throw new DomainError('CONFLICT', '活动名额已满')
    }
    return 'PAYMENT_PENDING'
  }
  if (full) {
    if (Number(event.waitlist_enabled) === 1) {
      return 'WAITLISTED'
    }
    throw new DomainError('CONFLICT', '活动名额已满')
  }
  return event.registration_policy === 'APPROVAL' ? 'PENDING_REVIEW' : 'REGISTERED'
}

function assertCanCancel(status) {
  if (!cancellableRegistrationStatuses.has(status)) {
    throw new DomainError('CONFLICT', '当前报名状态不能取消')
  }
}

function assertCheckInAllowed({ event, registration, credential, now = new Date() }) {
  if (!registration || ['CANCELLED', 'REJECTED'].includes(registration.status)) {
    throw new DomainError('REGISTRATION_REQUIRED', '请先完成活动报名')
  }
  if (registration.status === 'PAYMENT_PENDING') {
    throw new DomainError('REGISTRATION_PENDING', '报名支付尚未确认')
  }
  if (!['REGISTERED', 'ATTENDED'].includes(registration.status)) {
    throw new DomainError('FORBIDDEN', '当前没有可签到的报名资格')
  }
  if (!credential || credential.status !== 'ACTIVE') {
    throw new DomainError('VALIDATION_FAILED', '活动码无效')
  }
  const timestamp = asDate(now).getTime()
  if (timestamp < asDate(credential.valid_from).getTime()
    || timestamp > asDate(credential.valid_until).getTime()) {
    throw new DomainError('CONFLICT', '当前不在签到时间内')
  }
  if (credential.event_id !== registration.event_id || credential.event_id !== event.id) {
    throw new DomainError('VALIDATION_FAILED', '活动码与报名活动不一致')
  }
}

const cooperationRoleKeys = new Set([
  'connector',
  'business_builder',
  'capital_operator',
  'strategist',
  'visual_designer',
  'delivery_lead',
])
const feedbackAnswerKeys = new Set([
  'recommendation',
  'roleKeys',
  'joinIntent',
  'explorationMethods',
  'rosterConsent',
])
const feedbackRecommendations = new Set(['RECOMMEND', 'NOT_RECOMMEND'])
const feedbackJoinIntents = new Set(['JOIN_NOW', 'LEARN_MORE', 'NOT_INTERESTED'])
const feedbackExplorationMethods = new Set(['ATTEND_EVENT', 'COMMUNITY_CHAT'])
const feedbackRosterConsents = new Set(['MATCH_OPPORTUNITIES', 'PRIVATE'])

function validateFeedbackAnswers(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)
    || Object.keys(answers).length !== feedbackAnswerKeys.size
    || Object.keys(answers).some(key => !feedbackAnswerKeys.has(key))) {
    throw new DomainError('VALIDATION_FAILED', '活动反馈选项无效')
  }
  if (!feedbackRecommendations.has(answers.recommendation)) {
    throw new DomainError('VALIDATION_FAILED', '推荐选择无效')
  }
  if (!Array.isArray(answers.roleKeys)
    || answers.roleKeys.length < 1
    || answers.roleKeys.length > cooperationRoleKeys.size
    || new Set(answers.roleKeys).size !== answers.roleKeys.length
    || answers.roleKeys.some(roleKey => !cooperationRoleKeys.has(roleKey))) {
    throw new DomainError('VALIDATION_FAILED', '合作角色需选择 1–6 项且不能重复')
  }
  if (!feedbackJoinIntents.has(answers.joinIntent)) {
    throw new DomainError('VALIDATION_FAILED', '参与意向无效')
  }
  if (!Array.isArray(answers.explorationMethods)
    || answers.explorationMethods.length > feedbackExplorationMethods.size
    || new Set(answers.explorationMethods).size !== answers.explorationMethods.length
    || answers.explorationMethods.some(method => !feedbackExplorationMethods.has(method))) {
    throw new DomainError('VALIDATION_FAILED', '探索方式无效或存在重复项')
  }
  if (!feedbackRosterConsents.has(answers.rosterConsent)) {
    throw new DomainError('VALIDATION_FAILED', '名单使用范围无效')
  }
  return {
    recommendation: answers.recommendation,
    roleKeys: [...answers.roleKeys],
    joinIntent: answers.joinIntent,
    explorationMethods: [...answers.explorationMethods],
    rosterConsent: answers.rosterConsent,
  }
}

function parseFeedbackAnswers(value) {
  if (value === null || value === undefined) return null
  try {
    return validateFeedbackAnswers(typeof value === 'string' ? JSON.parse(value) : value)
  }
  catch {
    throw new DomainError('DATA_INTEGRITY', '活动反馈答案无效')
  }
}

function validateFeedback({ body, rating, answers }) {
  if (body !== undefined && typeof body !== 'string') {
    throw new DomainError('VALIDATION_FAILED', '反馈内容无效')
  }
  const normalizedBody = typeof body === 'string' ? body.trim() : ''
  if (normalizedBody.length > 300) {
    throw new DomainError('VALIDATION_FAILED', '反馈内容最多 300 个字')
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new DomainError('VALIDATION_FAILED', '评分需为 1–5 分')
  }
  return { body: normalizedBody, rating, answers: validateFeedbackAnswers(answers) }
}

const roleCapabilities = Object.freeze({
  PLATFORM_OWNER: ['events.manage', 'events.checkin', 'events.feedback.read', 'events.audit.read'],
  PLATFORM_OPERATIONS: ['events.manage', 'events.checkin', 'events.feedback.read'],
  PLATFORM_FINANCE: [],
  BRANCH_ADMIN: ['events.manage', 'events.checkin', 'events.feedback.read'],
  EVENT_OWNER: ['events.manage', 'events.checkin', 'events.feedback.read'],
  EVENT_MANAGER: ['events.manage', 'events.checkin', 'events.feedback.read'],
  EVENT_STAFF: ['events.checkin'],
})

const policyCapabilityByEventCapability = Object.freeze({
  'events.manage': 'events.write',
  'events.checkin': 'events.checkin.manage',
  'events.feedback.read': 'events.feedback.read',
  'events.audit.read': 'audit.read',
})

function configuredCapabilityAllows(binding, capability) {
  if (binding.role_key === 'PLATFORM_OWNER') return true
  const value = binding.policy_capabilities_json
  if (value === null || value === undefined) return true
  try {
    const capabilities = typeof value === 'string' ? JSON.parse(value) : value
    const policyCapability = policyCapabilityByEventCapability[capability]
    return typeof policyCapability === 'string'
      && Array.isArray(capabilities)
      && new Set(capabilities).size === capabilities.length
      && capabilities.every(item => typeof item === 'string')
      && capabilities.includes(policyCapability)
  }
  catch {
    return false
  }
}

function grantsCapability(bindings, capability, event) {
  return bindings.some((binding) => {
    if (!roleCapabilities[binding.role_key]?.includes(capability)) {
      return false
    }
    if (!configuredCapabilityAllows(binding, capability)) return false
    if (binding.scope_type === 'PLATFORM') {
      return true
    }
    if (binding.scope_type === 'BRANCH') {
      return Boolean(event.branch_id) && binding.scope_id === event.branch_id
    }
    return binding.scope_type === 'EVENT' && binding.scope_id === event.id
  })
}

module.exports = {
  DomainError,
  activeRegistrationStatuses,
  cancellableRegistrationStatuses,
  assertCanCancel,
  assertCheckInAllowed,
  capacityStatuses,
  decideRegistration,
  grantsCapability,
  parseFeedbackAnswers,
  validateFeedback,
  validateFeedbackAnswers,
}
