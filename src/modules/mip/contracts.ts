export type Brand<Value, Name extends string> = Value & { readonly __brand: Name }

export type UserId = Brand<string, 'UserId'>
export type BranchId = Brand<string, 'BranchId'>
export type EventId = Brand<string, 'EventId'>
export type OpportunityId = Brand<string, 'OpportunityId'>
export type OrderId = Brand<string, 'OrderId'>
export type CooperationCardId = Brand<string, 'CooperationCardId'>
export type SuperCaseId = Brand<string, 'SuperCaseId'>

export const cooperationRoleKeys = [
  'connector',
  'business_builder',
  'capital_operator',
  'strategist',
  'visual_designer',
  'delivery_lead',
] as const

export type CooperationRoleKey = (typeof cooperationRoleKeys)[number]
export type UserKind = 'PLAYER' | 'GUEST'
export type ScopeType = 'PLATFORM' | 'BRANCH' | 'EVENT'

export const adminRoleKeys = [
  'PLATFORM_OWNER',
  'PLATFORM_OPERATIONS',
  'PLATFORM_FINANCE',
  'BRANCH_ADMIN',
  'EVENT_OWNER',
  'EVENT_MANAGER',
  'EVENT_STAFF',
] as const

export type AdminRoleKey = (typeof adminRoleKeys)[number]

export const mipErrorCodes = [
  'AUTH_REQUIRED',
  'AGREEMENT_REQUIRED',
  'PHONE_REQUIRED',
  'PROFILE_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_FAILED',
  'PAYMENT_UNAVAILABLE',
  'PAYMENT_PENDING',
  'CONTENT_REJECTED',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
] as const

export type MipErrorCode = (typeof mipErrorCodes)[number]

export interface MipErrorShape {
  code: MipErrorCode
  message: string
  retryable: boolean
  traceId?: string
  details?: Record<string, unknown>
}

export interface PageRequest {
  cursor?: string
  limit?: number
}

export interface PageResult<Item> {
  items: Item[]
  nextCursor?: string
}

export interface EntitlementProjection {
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'REFUNDED'
  startsAt: string
  endsAt: string
}

export interface UserSummary {
  id: UserId
  kind: UserKind
  nickname: string
  avatarUrl?: string
  primaryBranchId?: BranchId
}

export interface CityBranchSummary {
  id: BranchId
  name: string
  cityName: string
  status: 'ACTIVE' | 'INACTIVE'
}

export interface CallerCapabilities {
  scopeType: ScopeType
  scopeId?: string
  roles: AdminRoleKey[]
  capabilities: string[]
}

export interface CallerContext {
  appId: string
  userId: UserId
  primaryBranchId?: BranchId
  grants: CallerCapabilities[]
}

export const mipDomainEvents = [
  'identity.user_registered',
  'identity.profile_completed',
  'membership.order_created',
  'membership.payment_confirmed',
  'membership.entitlement_activated',
  'membership.entitlement_revoked',
  'event.published',
  'event.registration_confirmed',
  'event.registration_cancelled',
  'event.checked_in',
  'event.heart_changed',
  'event.feedback_submitted',
  'opportunity.published',
  'opportunity.referral_changed',
  'profile.interest_changed',
  'growth.entry_recorded',
  'message.inbox_created',
] as const

export type MipDomainEvent = (typeof mipDomainEvents)[number]

export function resolveUserKind(
  entitlement: EntitlementProjection | null | undefined,
  at = new Date(),
): UserKind {
  if (!entitlement || entitlement.status !== 'ACTIVE') {
    return 'GUEST'
  }
  const timestamp = at.getTime()
  const startsAt = Date.parse(entitlement.startsAt)
  const endsAt = Date.parse(entitlement.endsAt)
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
    return 'GUEST'
  }
  return startsAt <= timestamp && timestamp < endsAt ? 'PLAYER' : 'GUEST'
}

export function isCooperationRoleKey(value: string): value is CooperationRoleKey {
  return cooperationRoleKeys.includes(value as CooperationRoleKey)
}
