import type {
  ExternalDeliveryDecision,
  InboxMessageIntent,
  NotificationChannel,
  NotificationGrant,
} from './types'

const routeByTargetType: Readonly<Record<string, (id: string) => string>> = {
  EVENT: id => `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(id)}`,
  OPPORTUNITY: id => `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(id)}`,
  MATCHING: id => `/packages/member/mip-opportunity-matching/index?requestId=${encodeURIComponent(id)}`,
  ORDER: id => `/packages/member/order-detail/index?orderId=${encodeURIComponent(id)}`,
  PROFILE: profileRef => `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}`,
  GROWTH: () => '/packages/member/mip-growth/index',
  GAME: () => '/packages/member/mip-game/index',
  KNOWLEDGE: id => `/packages/member/mip-knowledge/detail/index?contentId=${encodeURIComponent(id)}`,
}

const trustedRoutePrefixes = [
  '/packages/member/mip-events/detail/index?eventId=',
  '/packages/member/mip-opportunities/detail/index?id=',
  '/packages/member/mip-opportunity-matching/index?requestId=',
  '/packages/member/order-detail/index?orderId=',
  '/packages/member/mip-knowledge/detail/index?contentId=',
] as const

const publicProfileRoutePrefix = '/packages/member/mip-public-profile/index?profileRef='
const profileRefPattern = /^p1\.[\w-]{16}\.[\w-]{48}\.[\w-]{22}$/

export function isTrustedInboxRoute(route: string) {
  return route === '/packages/member/mip-growth/index'
    || route === '/packages/member/mip-game/index'
    || (route.startsWith(publicProfileRoutePrefix) && profileRefPattern.test(route.slice(publicProfileRoutePrefix.length)))
    || trustedRoutePrefixes.some(prefix => route.startsWith(prefix) && route.length > prefix.length)
}

export function buildInboxTarget(type: string, id: string) {
  const normalizedType = type.trim().toUpperCase()
  const normalizedId = id.trim()
  const buildRoute = routeByTargetType[normalizedType]
  const validId = normalizedType === 'PROFILE'
    ? profileRefPattern.test(normalizedId)
    : Boolean(normalizedId && normalizedId.length <= 80)
  if (!buildRoute || !validId) {
    throw new Error('INBOX_TARGET_INVALID')
  }
  return { type: normalizedType, id: normalizedId, route: buildRoute(normalizedId) }
}

export function normalizeInboxIntent(intent: InboxMessageIntent) {
  const title = intent.title.trim()
  const body = intent.body.trim()
  const dedupeKey = intent.dedupeKey.trim()
  if (!title || title.length > 100 || !body || body.length > 500 || !dedupeKey || dedupeKey.length > 160) {
    throw new Error('INBOX_MESSAGE_INVALID')
  }
  if (Boolean(intent.targetType) !== Boolean(intent.targetId)) {
    throw new Error('INBOX_TARGET_INVALID')
  }
  const target = intent.targetType && intent.targetId
    ? buildInboxTarget(intent.targetType, intent.targetId)
    : undefined
  return { ...intent, title, body, dedupeKey, target }
}

export function decideExternalDelivery(options: {
  channel: NotificationChannel
  enabled: boolean
  templateKey?: string
  grants: readonly NotificationGrant[]
  now?: Date
}): ExternalDeliveryDecision {
  if (!options.enabled) {
    return { channel: options.channel, deliver: false, reason: 'CHANNEL_DISABLED' }
  }
  const templateKey = options.templateKey?.trim()
  if (!templateKey) {
    return { channel: options.channel, deliver: false, reason: 'TEMPLATE_MISSING' }
  }
  const now = (options.now ?? new Date()).getTime()
  const available = options.grants.some(grant => (
    grant.channel === options.channel
    && grant.templateKey === templateKey
    && grant.status === 'AVAILABLE'
    && (!grant.expiresAt || Date.parse(grant.expiresAt) > now)
  ))
  return available
    ? { channel: options.channel, deliver: true, reason: 'READY' }
    : { channel: options.channel, deliver: false, reason: 'GRANT_UNAVAILABLE' }
}
