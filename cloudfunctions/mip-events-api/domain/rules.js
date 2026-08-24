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
  if (!activeRegistrationStatuses.has(status) || status === 'ATTENDED') {
    throw new DomainError('CONFLICT', '当前报名状态不能取消')
  }
}

function assertCheckInAllowed({ event, registration, credential, now = new Date() }) {
  if (!registration || !['REGISTERED', 'ATTENDED'].includes(registration.status)) {
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

function validateFeedback({ body, rating }) {
  const normalizedBody = typeof body === 'string' ? body.trim() : ''
  if (!normalizedBody || normalizedBody.length > 2000) {
    throw new DomainError('VALIDATION_FAILED', '反馈内容需为 1–2000 个字')
  }
  const normalizedRating = rating === null || rating === undefined || rating === '' ? null : Number(rating)
  if (normalizedRating !== null
    && (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5)) {
    throw new DomainError('VALIDATION_FAILED', '评分需为 1–5 分')
  }
  return { body: normalizedBody, rating: normalizedRating }
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
  assertCanCancel,
  assertCheckInAllowed,
  capacityStatuses,
  decideRegistration,
  grantsCapability,
  validateFeedback,
}
