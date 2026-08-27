import type {
  AdminOrderStatus,
  AdminPage,
  AdminRoleKey,
  AdminRosterStatus,
  AdminScopeType,
  AdminUser,
  AdminUserDetail,
} from './types'
import { MipAdminError } from './types'

const idPattern = /^[\w-]{1,36}$/
const cursorPattern = /^[\w-]{1,512}$/
const userStatuses = new Set(['ACTIVE', 'BLOCKED', 'CLOSED'])
const userKinds = new Set(['PLAYER', 'GUEST'])
const playerLifecycles = new Set(['CURRENT', 'FORMER', 'NEVER'])
const controls = new Set(['ALLOWLIST', 'BLOCKLIST'])
const phoneBoundFilters = new Set(['BOUND', 'UNBOUND'])
const profileCompleteFilters = new Set(['COMPLETE', 'INCOMPLETE'])
const joinedWithinDaysFilters = new Set<unknown>([0, 7, 30, 90, '0', '7', '30', '90'])
const membershipStatuses = new Set(['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED'])
const visibilityKeys = new Set([
  'nickname',
  'avatar',
  'realName',
  'gender',
  'careerIdentity',
  'identityStatus',
  'headline',
  'introduction',
  'companies',
  'organizations',
  'industry',
  'abilities',
  'primaryBranch',
  'influence',
  'cardContacts',
])
const cardContactVisibilityKeys = new Set(['phone', 'wechat', 'email', 'address'])
const roleKeys = new Set<AdminRoleKey>([
  'PLATFORM_OWNER',
  'PLATFORM_OPERATIONS',
  'PLATFORM_FINANCE',
  'BRANCH_ADMIN',
  'EVENT_OWNER',
  'EVENT_MANAGER',
  'EVENT_STAFF',
])
const scopeTypes = new Set<AdminScopeType>(['PLATFORM', 'BRANCH', 'EVENT'])
const opportunityStatuses = new Set(['DRAFT', 'PUBLISHED', 'ENDED', 'UNPUBLISHED', 'ARCHIVED'])
const superCaseStatuses = new Set(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'])
const rosterStatuses = new Set<AdminRosterStatus>([
  'PENDING_REVIEW',
  'WAITLISTED',
  'PAYMENT_PENDING',
  'REGISTERED',
  'CANCELLATION_PENDING',
  'CANCELLED',
  'REJECTED',
  'ATTENDED',
])
const orderStatuses = new Set<AdminOrderStatus>([
  'CREATED',
  'PAYMENT_CREATED',
  'PAID',
  'FAILED',
  'CLOSED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
])
const orderTypes = new Set(['MEMBERSHIP', 'EVENT', 'CONTENT'])
const listInputKeys = new Set(['filters', 'includePhone', 'cursor', 'limit'])
const filterKeys = new Set([
  'query',
  'status',
  'kind',
  'playerLifecycle',
  'branchId',
  'levelId',
  'controlType',
  'phoneBound',
  'profileComplete',
  'joinedWithinDays',
  'experienceMin',
  'experienceMax',
  'createdFrom',
  'createdTo',
])
const userKeys = [
  'id',
  'status',
  'kind',
  'nickname',
  'headline',
  'introduction',
  'primaryBranchId',
  'branchName',
  'cityName',
  'phoneBound',
  'phoneNumber',
  'controls',
  'levelId',
  'levelName',
  'experience',
  'visibility',
  'userVersion',
  'profileVersion',
  'createdAt',
  'updatedAt',
  'playerNumber',
  'firstPlayerAt',
  'latestEntitlementEndsAt',
  'totalValidMembershipSeconds',
] as const
const detailKeys = [
  ...userKeys,
  'primaryBranchOptions',
  'companies',
  'organizations',
  'membership',
  'growth',
  'counts',
  'influence',
  'tags',
  'roles',
  'relatedRecords',
] as const

function invalidRequest(): never {
  throw new MipAdminError('VALIDATION_FAILED', '用户查询条件无效')
}

function invalidResponse(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的用户数据')
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Reflect.ownKeys(value)
  const expected = new Set(keys)
  return actual.length === expected.size
    && actual.every(key => typeof key === 'string' && expected.has(key))
}

function validId(value: unknown) {
  return typeof value === 'string' && idPattern.test(value)
}

function validText(value: unknown, maximum: number, minimum = 0) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum
}

function validDate(value: unknown) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
}

function validNullableDate(value: unknown) {
  return value === null || validDate(value)
}

function validSafeInteger(value: unknown, minimum = Number.MIN_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function uniqueBy(values: unknown[], key: (value: Record<string, unknown>) => unknown) {
  const found = new Set<unknown>()
  for (const item of values) {
    if (!record(item)) {
      return false
    }
    const current = key(item)
    if (found.has(current)) {
      return false
    }
    found.add(current)
  }
  return true
}

function optionalEnum(value: unknown, allowed: Set<string>) {
  return value === undefined || value === '' || (typeof value === 'string' && allowed.has(value))
}

function optionalId(value: unknown) {
  return value === undefined || value === '' || validId(value)
}

function integerInput(value: unknown) {
  if (value === undefined || value === '') {
    return null
  }
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000_000
    ? parsed
    : Number.NaN
}

function validVisibility(value: unknown) {
  return record(value)
    && Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string' || !visibilityKeys.has(key)) {
        return false
      }
      if (key !== 'cardContacts') {
        return typeof value[key] === 'boolean'
      }
      const contacts = value[key]
      return record(contacts)
        && Reflect.ownKeys(contacts).length === cardContactVisibilityKeys.size
        && Reflect.ownKeys(contacts).every(contactKey => typeof contactKey === 'string'
          && cardContactVisibilityKeys.has(contactKey)
          && typeof contacts[contactKey] === 'boolean')
    })
}

export function createAdminUserListRequest(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const input = value ?? {}
  if (!record(input)
    || Reflect.ownKeys(input).some(key => typeof key !== 'string' || !listInputKeys.has(key))) {
    invalidRequest()
  }
  if (input.includePhone !== undefined && typeof input.includePhone !== 'boolean') {
    invalidRequest()
  }
  if (input.cursor !== undefined
    && (typeof input.cursor !== 'string' || !cursorPattern.test(input.cursor))) {
    invalidRequest()
  }
  if (input.limit !== undefined
    && (!validSafeInteger(input.limit, 1) || Number(input.limit) > 50)) {
    invalidRequest()
  }
  if (input.filters === undefined) {
    return { ...input }
  }
  if (!record(input.filters)
    || Reflect.ownKeys(input.filters).some(key => typeof key !== 'string' || !filterKeys.has(key))) {
    invalidRequest()
  }
  const filters = input.filters
  if (filters.query !== undefined
    && (typeof filters.query !== 'string' || filters.query.trim().length > 80)) {
    invalidRequest()
  }
  if (!optionalEnum(filters.status, userStatuses)
    || !optionalEnum(filters.kind, userKinds)
    || !optionalEnum(filters.playerLifecycle, playerLifecycles)
    || !optionalEnum(filters.controlType, controls)
    || !optionalEnum(filters.phoneBound, phoneBoundFilters)
    || !optionalEnum(filters.profileComplete, profileCompleteFilters)
    || !optionalId(filters.branchId)
    || !optionalId(filters.levelId)) {
    invalidRequest()
  }
  if (filters.joinedWithinDays !== undefined
    && !joinedWithinDaysFilters.has(filters.joinedWithinDays)) {
    invalidRequest()
  }
  const minimum = integerInput(filters.experienceMin)
  const maximum = integerInput(filters.experienceMax)
  if (Number.isNaN(minimum)
    || Number.isNaN(maximum)
    || (minimum !== null && maximum !== null && minimum > maximum)) {
    invalidRequest()
  }
  for (const key of ['createdFrom', 'createdTo'] as const) {
    const date = filters[key]
    if (date !== undefined && date !== '' && !validDate(date)) {
      invalidRequest()
    }
  }
  if (typeof filters.createdFrom === 'string'
    && filters.createdFrom
    && typeof filters.createdTo === 'string'
    && filters.createdTo
    && Date.parse(filters.createdFrom) > Date.parse(filters.createdTo)) {
    invalidRequest()
  }
  return { ...input, filters: { ...filters } }
}

function validUser(value: unknown, includePhone: boolean): value is AdminUser {
  const lifecycleKeys = ['playerNumber', 'firstPlayerAt', 'latestEntitlementEndsAt', 'totalValidMembershipSeconds']
  const keys = record(value) && lifecycleKeys.every(key => Object.hasOwn(value, key))
    ? [...userKeys]
    : userKeys.filter(key => !lifecycleKeys.includes(key))
  if (!record(value)
    || !exactKeys(value, keys)
    || !validId(value.id)
    || !userStatuses.has(String(value.status))
    || !userKinds.has(String(value.kind))
    || !validText(value.nickname, 64, 1)
    || !validText(value.headline, 160)
    || !validText(value.introduction, 600)
    || !(value.primaryBranchId === null || validId(value.primaryBranchId))
    || !validText(value.branchName, 80)
    || !validText(value.cityName, 80)
    || typeof value.phoneBound !== 'boolean'
    || !(value.phoneNumber === null
      || (typeof value.phoneNumber === 'string' && /^[+\d][\d\s-]{5,31}$/.test(value.phoneNumber)))
    || !Array.isArray(value.controls)
    || value.controls.some(item => typeof item !== 'string' || !controls.has(item))
    || new Set(value.controls).size !== value.controls.length
    || !(value.levelId === null || validId(value.levelId))
    || !validText(value.levelName, 80)
    || !validSafeInteger(value.experience)
    || !validVisibility(value.visibility)
    || !validSafeInteger(value.userVersion, 1)
    || !validSafeInteger(value.profileVersion, 0)
    || !validNullableDate(value.createdAt)
    || !validNullableDate(value.updatedAt)) {
    return false
  }
  if (lifecycleKeys.every(key => Object.hasOwn(value, key))) {
    if (!(value.playerNumber === null || validSafeInteger(value.playerNumber, 1))
      || !validNullableDate(value.firstPlayerAt)
      || !validNullableDate(value.latestEntitlementEndsAt)
      || !validSafeInteger(value.totalValidMembershipSeconds, 0)) {
      return false
    }
  }
  if (!value.phoneBound && value.phoneNumber !== null) {
    return false
  }
  if (!includePhone && value.phoneNumber !== null) {
    return false
  }
  return value.levelId === null
    ? value.levelName === ''
    : typeof value.levelName === 'string' && value.levelName.length > 0
}

export function parseAdminUserPage(value: unknown, includePhone = false): AdminPage<AdminUser> {
  if (!record(value)
    || !exactKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || value.items.length > 50
    || value.items.some(item => !validUser(item, includePhone))
    || !uniqueBy(value.items, item => item.id)
    || !(value.nextCursor === null
      || (typeof value.nextCursor === 'string' && cursorPattern.test(value.nextCursor)))) {
    invalidResponse()
  }
  return value as unknown as AdminPage<AdminUser>
}

function validOrganizationList(value: unknown) {
  return Array.isArray(value)
    && value.length <= 12
    && value.every(item => record(item)
      && (exactKeys(item, ['name']) || exactKeys(item, ['name', 'role']))
      && validText(item.name, 120, 1)
      && (item.role === undefined || validText(item.role, 80, 1)))
}

function validMembership(value: unknown, kind: unknown) {
  if (value === null) {
    return kind === 'GUEST'
  }
  if (!record(value)
    || !exactKeys(value, ['status', 'startsAt', 'endsAt', 'isCurrent', 'isScheduled'])
    || !membershipStatuses.has(String(value.status))
    || !validDate(value.startsAt)
    || !validDate(value.endsAt)
    || Date.parse(String(value.endsAt)) <= Date.parse(String(value.startsAt))
    || typeof value.isCurrent !== 'boolean'
    || typeof value.isScheduled !== 'boolean'
    || (value.isCurrent && value.isScheduled)
    || (value.status !== 'ACTIVE' && (value.isCurrent || value.isScheduled))) {
    return false
  }
  return value.isCurrent === (kind === 'PLAYER')
}

function validCountRecord(value: unknown, keys: readonly string[]) {
  return record(value)
    && exactKeys(value, keys)
    && keys.every(key => validSafeInteger(value[key], 0))
}

function validTags(value: unknown) {
  return Array.isArray(value)
    && value.length <= 100
    && uniqueBy(value, item => `${item.relation}:${item.id}`)
    && value.every(item => record(item)
      && exactKeys(item, ['id', 'kind', 'relation', 'label'])
      && validId(item.id)
      && validText(item.kind, 40, 1)
      && validText(item.relation, 40, 1)
      && validText(item.label, 80, 1))
}

function validRoles(value: unknown) {
  return Array.isArray(value)
    && value.length <= 100
    && value.every(item => record(item)
      && exactKeys(item, ['roleKey', 'scopeType', 'scopeId', 'grantedAt'])
      && roleKeys.has(item.roleKey as AdminRoleKey)
      && scopeTypes.has(item.scopeType as AdminScopeType)
      && (item.scopeId === null || validId(item.scopeId))
      && validNullableDate(item.grantedAt)
      && (item.scopeType === 'PLATFORM' ? item.scopeId === null : item.scopeId !== null))
}

function validBranchOptions(value: unknown) {
  return Array.isArray(value)
    && value.length <= 100
    && uniqueBy(value, item => item.id)
    && value.every(item => record(item)
      && exactKeys(item, ['id', 'name', 'cityName'])
      && validId(item.id)
      && validText(item.name, 80, 1)
      && validText(item.cityName, 80, 1))
}

function validRelatedRecords(value: unknown) {
  if (!record(value)
    || !exactKeys(value, ['superCases', 'opportunities', 'registrations', 'orders'])) {
    return false
  }
  if (!Array.isArray(value.superCases)
    || value.superCases.length > 50
    || !uniqueBy(value.superCases, item => item.id)
    || value.superCases.some(item => !record(item)
      || !exactKeys(item, ['id', 'title', 'summary', 'status', 'updatedAt'])
      || !validId(item.id)
      || !validText(item.title, 120, 1)
      || !validText(item.summary, 240)
      || !superCaseStatuses.has(String(item.status))
      || !validNullableDate(item.updatedAt))) {
    return false
  }
  if (!Array.isArray(value.opportunities)
    || value.opportunities.length > 50
    || !uniqueBy(value.opportunities, item => item.id)
    || value.opportunities.some(item => !record(item)
      || !exactKeys(item, ['id', 'title', 'status', 'updatedAt'])
      || !validId(item.id)
      || !validText(item.title, 120, 1)
      || !opportunityStatuses.has(String(item.status))
      || !validNullableDate(item.updatedAt))) {
    return false
  }
  if (!Array.isArray(value.registrations)
    || value.registrations.length > 50
    || !uniqueBy(value.registrations, item => item.id)
    || value.registrations.some(item => !record(item)
      || !exactKeys(item, ['id', 'eventId', 'title', 'status', 'createdAt'])
      || !validId(item.id)
      || !validId(item.eventId)
      || !validText(item.title, 120, 1)
      || !rosterStatuses.has(item.status as AdminRosterStatus)
      || !validNullableDate(item.createdAt))) {
    return false
  }
  return Array.isArray(value.orders)
    && value.orders.length <= 50
    && uniqueBy(value.orders, item => item.id)
    && value.orders.every(item => record(item)
      && exactKeys(item, [
        'id',
        'orderType',
        'title',
        'status',
        'amountCents',
        'currency',
        'merchantOrderNoMasked',
        'createdAt',
      ])
      && validId(item.id)
      && orderTypes.has(String(item.orderType))
      && validText(item.title, 160, 1)
      && orderStatuses.has(item.status as AdminOrderStatus)
      && validSafeInteger(item.amountCents, 0)
      && typeof item.currency === 'string'
      && /^[A-Z]{3}$/.test(item.currency)
      && validText(item.merchantOrderNoMasked, 80)
      && validNullableDate(item.createdAt))
}

export function parseAdminUserDetail(value: unknown, includePhone = false): AdminUserDetail {
  const lifecycleKeys = ['playerNumber', 'firstPlayerAt', 'latestEntitlementEndsAt', 'totalValidMembershipSeconds']
  const hasLifecycle = record(value) && lifecycleKeys.every(key => Object.hasOwn(value, key))
  const expectedDetailKeys = hasLifecycle
    ? detailKeys
    : detailKeys.filter(key => !lifecycleKeys.includes(key))
  const base = record(value)
    ? Object.fromEntries((hasLifecycle ? userKeys : userKeys.filter(key => !lifecycleKeys.includes(key)))
        .map(key => [key, value[key]]))
    : null
  if (!record(value)
    || !exactKeys(value, expectedDetailKeys)
    || !validUser(base, includePhone)
    || !validBranchOptions(value.primaryBranchOptions)
    || !validOrganizationList(value.companies)
    || !validOrganizationList(value.organizations)
    || !validMembership(value.membership, value.kind)
    || !record(value.growth)
    || !exactKeys(value.growth, ['levelName', 'experience', 'contribution', 'coin'])
    || !validText(value.growth.levelName, 80)
    || !validSafeInteger(value.growth.experience)
    || !validSafeInteger(value.growth.contribution)
    || !validSafeInteger(value.growth.coin, 0)
    || value.levelName !== value.growth.levelName
    || value.experience !== value.growth.experience
    || !validCountRecord(value.counts, [
      'registrations',
      'attended',
      'orders',
      'opportunities',
      'cooperationCards',
      'superCases',
    ])
    || !validCountRecord(value.influence, [
      'guestCount',
      'interactionCount',
      'interestCount',
      'visitorCount',
    ])
    || !validTags(value.tags)
    || !validRoles(value.roles)
    || !validRelatedRecords(value.relatedRecords)) {
    invalidResponse()
  }
  return value as unknown as AdminUserDetail
}
