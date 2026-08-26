import { MipAdminError } from './types'

export type AdminUserInfluenceKind = 'INVITATION' | 'HEART' | 'VISIT'
export type AdminUserInfluenceDirection = 'ALL' | 'INCOMING' | 'OUTGOING'
export type AdminUserInfluenceFactDirection = Exclude<AdminUserInfluenceDirection, 'ALL'>
export type AdminUserInfluenceCounterpartState
  = | 'AVAILABLE'
    | 'REDACTED'
    | 'UNAVAILABLE'
    | 'NOT_RETAINED'
    | 'NOT_APPLICABLE'
export type AdminUserInfluenceUnavailableFact = 'CANCELLED_INCOMING_HEART'

export interface AdminUserInfluenceListInput {
  userId: string
  kind: AdminUserInfluenceKind
  direction?: AdminUserInfluenceDirection
  occurredFrom?: string
  occurredTo?: string
  cursor?: string
  limit?: number
}

export interface AdminUserInfluenceFact {
  reference: string
  kind: AdminUserInfluenceKind
  direction: AdminUserInfluenceFactDirection
  status: string
  occurredAt: string
  eventTitle: string | null
  counterpartNickname: string | null
  counterpartKind: 'PLAYER' | 'GUEST' | null
  counterpartState: AdminUserInfluenceCounterpartState
  sourceType: 'USER' | 'PLATFORM' | null
}

export interface AdminUserInfluencePage {
  items: AdminUserInfluenceFact[]
  nextCursor: string | null
  unavailableFacts: AdminUserInfluenceUnavailableFact[]
}

const inputKeys = new Set([
  'userId',
  'kind',
  'direction',
  'occurredFrom',
  'occurredTo',
  'cursor',
  'limit',
])
const responseKeys = ['items', 'nextCursor', 'unavailableFacts']
const itemKeys = [
  'reference',
  'kind',
  'direction',
  'status',
  'occurredAt',
  'eventTitle',
  'counterpartNickname',
  'counterpartKind',
  'counterpartState',
  'sourceType',
]
const kinds = new Set<AdminUserInfluenceKind>(['INVITATION', 'HEART', 'VISIT'])
const directions = new Set<AdminUserInfluenceDirection>(['ALL', 'INCOMING', 'OUTGOING'])
const factDirections = new Set<AdminUserInfluenceFactDirection>(['INCOMING', 'OUTGOING'])
const counterpartStates = new Set<AdminUserInfluenceCounterpartState>([
  'AVAILABLE',
  'REDACTED',
  'UNAVAILABLE',
  'NOT_RETAINED',
  'NOT_APPLICABLE',
])
const invitationStatuses = new Set([
  'PENDING_REVIEW',
  'WAITLISTED',
  'PAYMENT_PENDING',
  'REGISTERED',
  'CANCELLATION_PENDING',
  'CANCELLED',
  'REJECTED',
  'ATTENDED',
])
const referencePattern = /^if1\.[\w-]{22}$/
const userIdPattern = /^[\w-]{1,64}$/

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Reflect.ownKeys(value)
  const expected = new Set(keys)
  return actual.length === keys.length
    && actual.every(key => typeof key === 'string' && expected.has(key))
}

function invalidRequest(): never {
  throw new MipAdminError('VALIDATION_FAILED', '用户影响力查询无效')
}

function invalidResponse(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的用户影响力数据')
}

function validOptionalDate(value: unknown) {
  return value === undefined
    || (typeof value === 'string' && value.length > 0 && value.length <= 40 && Number.isFinite(Date.parse(value)))
}

function validStatus(kind: AdminUserInfluenceKind, status: string) {
  if (kind === 'INVITATION') {
    return invitationStatuses.has(status)
  }
  if (kind === 'HEART') {
    return status === 'ACTIVE' || status === 'CANCELLED'
  }
  return status === 'READ' || status === 'UNREAD'
}

function validCounterpart(value: Record<string, unknown>) {
  if (value.counterpartState === 'AVAILABLE' || value.counterpartState === 'REDACTED') {
    return typeof value.counterpartNickname === 'string'
      && (value.counterpartKind === 'PLAYER' || value.counterpartKind === 'GUEST')
  }
  if (value.counterpartNickname !== null || value.counterpartKind !== null) {
    return false
  }
  if (value.counterpartState === 'NOT_RETAINED') {
    return value.kind === 'HEART'
      && value.status === 'CANCELLED'
      && value.direction === 'OUTGOING'
  }
  if (value.counterpartState === 'NOT_APPLICABLE') {
    return value.kind === 'INVITATION'
      && value.sourceType === 'PLATFORM'
      && value.direction === 'INCOMING'
  }
  return value.counterpartState === 'UNAVAILABLE'
}

function validFact(value: unknown) {
  if (!record(value)
    || !hasExactKeys(value, itemKeys)
    || typeof value.reference !== 'string'
    || !referencePattern.test(value.reference)
    || !kinds.has(value.kind as AdminUserInfluenceKind)
    || !factDirections.has(value.direction as AdminUserInfluenceFactDirection)
    || typeof value.status !== 'string'
    || !validStatus(value.kind as AdminUserInfluenceKind, value.status)
    || typeof value.occurredAt !== 'string'
    || !Number.isFinite(Date.parse(value.occurredAt))
    || !(value.eventTitle === null
      || (typeof value.eventTitle === 'string' && value.eventTitle.length > 0 && value.eventTitle.length <= 120))
    || !(value.counterpartNickname === null
      || (typeof value.counterpartNickname === 'string' && value.counterpartNickname.length > 0 && value.counterpartNickname.length <= 64))
    || !(value.counterpartKind === null || value.counterpartKind === 'PLAYER' || value.counterpartKind === 'GUEST')
    || !counterpartStates.has(value.counterpartState as AdminUserInfluenceCounterpartState)
    || !(value.sourceType === null || value.sourceType === 'USER' || value.sourceType === 'PLATFORM')) {
    return false
  }
  if (value.kind === 'VISIT') {
    return value.eventTitle === null
      && value.sourceType === null
      && validCounterpart(value)
  }
  if (typeof value.eventTitle !== 'string') {
    return false
  }
  if (value.kind === 'HEART') {
    if (value.sourceType !== null || !validCounterpart(value)) {
      return false
    }
    return value.status === 'CANCELLED'
      ? value.direction === 'OUTGOING' && value.counterpartState === 'NOT_RETAINED'
      : value.counterpartState !== 'NOT_RETAINED'
  }
  return value.sourceType !== null
    && !(value.sourceType === 'PLATFORM' && (
      value.direction !== 'INCOMING'
      || value.counterpartState !== 'NOT_APPLICABLE'
    ))
    && validCounterpart(value)
}

export function createAdminUserInfluenceRequest(
  value: AdminUserInfluenceListInput,
): AdminUserInfluenceListInput {
  if (!record(value)
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !inputKeys.has(key))
    || typeof value.userId !== 'string'
    || !userIdPattern.test(value.userId)
    || !kinds.has(value.kind)) {
    invalidRequest()
  }
  const direction = value.direction ?? 'ALL'
  const limit = value.limit ?? 20
  if (!directions.has(direction)
    || !Number.isInteger(limit)
    || limit < 1
    || limit > 30
    || !validOptionalDate(value.occurredFrom)
    || !validOptionalDate(value.occurredTo)
    || (value.occurredFrom !== undefined
      && value.occurredTo !== undefined
      && Date.parse(value.occurredFrom) > Date.parse(value.occurredTo))
    || (value.cursor !== undefined
      && (typeof value.cursor !== 'string' || !value.cursor || value.cursor.length > 512))) {
    invalidRequest()
  }
  return {
    userId: value.userId,
    kind: value.kind,
    direction,
    ...(value.occurredFrom ? { occurredFrom: value.occurredFrom } : {}),
    ...(value.occurredTo ? { occurredTo: value.occurredTo } : {}),
    ...(value.cursor ? { cursor: value.cursor } : {}),
    limit,
  }
}

export function parseAdminUserInfluencePage(
  value: unknown,
  expected?: AdminUserInfluenceListInput,
): AdminUserInfluencePage {
  if (!record(value)
    || !hasExactKeys(value, responseKeys)
    || !Array.isArray(value.items)
    || value.items.some(item => !validFact(item))
    || !(value.nextCursor === null
      || (typeof value.nextCursor === 'string' && value.nextCursor.length > 0 && value.nextCursor.length <= 512))
    || !Array.isArray(value.unavailableFacts)
    || value.unavailableFacts.some(item => item !== 'CANCELLED_INCOMING_HEART')) {
    invalidResponse()
  }
  const page = value as unknown as AdminUserInfluencePage
  if (expected
    && (page.items.some(item => item.kind !== expected.kind
      || (expected.direction !== undefined
        && expected.direction !== 'ALL'
        && item.direction !== expected.direction))
      || (page.unavailableFacts.length > 0
        && (expected.kind !== 'HEART' || expected.direction === 'OUTGOING')))) {
    invalidResponse()
  }
  return page
}
