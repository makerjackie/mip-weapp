'use strict'

const routes = {
  EVENT: id => `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(id)}`,
  OPPORTUNITY: id => `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(id)}`,
  ORDER: id => `/packages/member/order-detail/index?orderId=${encodeURIComponent(id)}`,
  PROFILE: profileRef => `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}`,
  GROWTH: () => '/packages/member/mip-growth/index',
}

function buildTarget(type, id) {
  if (type === undefined && id === undefined) return null
  const normalizedType = text(type).toUpperCase()
  const normalizedId = text(id)
  const validId = normalizedType === 'PROFILE' ? isProfileRef(normalizedId) : isUuid(normalizedId)
  if (!routes[normalizedType] || !validId) {
    throw new Error('INBOX_TARGET_INVALID')
  }
  return {
    type: normalizedType,
    id: normalizedId,
    route: routes[normalizedType](normalizedId),
  }
}

function isProfileRef(value) {
  return /^p1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{48}\.[A-Za-z0-9_-]{22}$/.test(value)
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { buildTarget }
