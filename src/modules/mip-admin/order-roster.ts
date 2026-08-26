import type {
  AdminOrder,
  AdminOrderPage,
  AdminOrderRefundAction,
  AdminOrderStatus,
  AdminOrderSummary,
  AdminPage,
  AdminRefundStatus,
  AdminRosterItem,
  AdminRosterStatus,
} from './types'
import { MipAdminError } from './types'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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
const refundStatuses = new Set<AdminRefundStatus>([
  'PENDING',
  'PROVIDER_CREATED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
])
const refundActions = new Set<AdminOrderRefundAction>(['SUBMIT_REFUND', 'RETRY_REFUND'])
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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function validDate(value: unknown, nullable = false) {
  return (nullable && value === null)
    || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function invalidResponse(label: string) {
  return new MipAdminError('INVALID_RESPONSE', `运营服务返回了无效的${label}`)
}

function parsePage<T>(value: unknown, label: string, parseItem: (item: unknown) => T): AdminPage<T> {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === undefined || value.nextCursor === null || typeof value.nextCursor === 'string')) {
    throw invalidResponse(label)
  }
  return {
    items: value.items.map(parseItem),
    nextCursor: value.nextCursor === undefined ? null : value.nextCursor,
  }
}

function parseRosterItem(value: unknown): AdminRosterItem {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'id',
      'nickname',
      'cityName',
      'status',
      'answers',
      'answerItems',
      'phoneBound',
      'phoneNumber',
      'submittedAt',
      'registeredAt',
      'checkedInAt',
      'version',
      'entitlementStartsAt',
      'entitlementEndsAt',
      'entitlementStatus',
    ])
    || typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || typeof value.nickname !== 'string'
    || value.nickname.length < 1
    || value.nickname.length > 64
    || typeof value.cityName !== 'string'
    || value.cityName.length > 80
    || !rosterStatuses.has(value.status as AdminRosterStatus)
    || !record(value.answers)
    || !Array.isArray(value.answerItems)
    || typeof value.phoneBound !== 'boolean'
    || !(value.phoneNumber === null || typeof value.phoneNumber === 'string')
    || !validDate(value.submittedAt)
    || !validDate(value.registeredAt, true)
    || !validDate(value.checkedInAt, true)
    || !Number.isInteger(value.version)
    || Number(value.version) < 1
    || !(value.entitlementStartsAt === undefined || validDate(value.entitlementStartsAt, true))
    || !(value.entitlementEndsAt === undefined || validDate(value.entitlementEndsAt, true))
    || !(value.entitlementStatus === undefined || value.entitlementStatus === null
      || ['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED'].includes(String(value.entitlementStatus)))) {
    throw invalidResponse('参与者名单')
  }
  for (const item of value.answerItems) {
    if (!record(item)
      || typeof item.key !== 'string'
      || item.key.length < 1
      || item.key.length > 48
      || typeof item.label !== 'string'
      || item.label.length < 1
      || item.label.length > 60
      || typeof item.value !== 'string'
      || item.value.length > 16_384) {
      throw invalidResponse('参与者名单')
    }
  }
  return value as unknown as AdminRosterItem
}

function parseOrderItem(value: unknown): AdminOrder {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'id',
      'userId',
      'nickname',
      'orderType',
      'resourceId',
      'resourceType',
      'resourceTitle',
      'resourceBranchName',
      'merchantOrderNoMasked',
      'providerTransactionIdMasked',
      'amountCents',
      'refundedAmountCents',
      'currency',
      'status',
      'refundStatus',
      'refundId',
      'availableRefundActions',
      'paidAt',
      'createdAt',
      'version',
      'entitlementStartsAt',
      'entitlementEndsAt',
      'entitlementStatus',
    ])
    || typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || typeof value.userId !== 'string'
    || !uuidPattern.test(value.userId)
    || typeof value.nickname !== 'string'
    || value.nickname.length < 1
    || value.nickname.length > 64
    || !['MEMBERSHIP', 'EVENT', 'CONTENT'].includes(String(value.orderType))
    || !(value.resourceId === null
      || (typeof value.resourceId === 'string' && uuidPattern.test(value.resourceId)))
    || !['MEMBERSHIP_PLAN', 'EVENT', 'KNOWLEDGE_CONTENT'].includes(String(value.resourceType))
    || typeof value.resourceTitle !== 'string'
    || value.resourceTitle.length < 1
    || value.resourceTitle.length > 120
    || typeof value.resourceBranchName !== 'string'
    || value.resourceBranchName.length > 80
    || typeof value.merchantOrderNoMasked !== 'string'
    || value.merchantOrderNoMasked.length < 1
    || value.merchantOrderNoMasked.length > 64
    || !(value.providerTransactionIdMasked === null || typeof value.providerTransactionIdMasked === 'string')
    || !Number.isInteger(value.amountCents)
    || Number(value.amountCents) <= 0
    || !Number.isInteger(value.refundedAmountCents)
    || Number(value.refundedAmountCents) < 0
    || Number(value.refundedAmountCents) > Number(value.amountCents)
    || typeof value.currency !== 'string'
    || !/^[A-Z]{3}$/.test(value.currency)
    || !orderStatuses.has(value.status as AdminOrderStatus)
    || !(value.refundStatus === null || refundStatuses.has(value.refundStatus as AdminRefundStatus))
    || !(value.refundId === null
      || (typeof value.refundId === 'string' && uuidPattern.test(value.refundId)))
    || !Array.isArray(value.availableRefundActions)
    || value.availableRefundActions.some(action => !refundActions.has(action as AdminOrderRefundAction))
    || new Set(value.availableRefundActions).size !== value.availableRefundActions.length
    || !validDate(value.paidAt, true)
    || !validDate(value.createdAt)
    || !Number.isInteger(value.version)
    || Number(value.version) < 1
    || !(value.entitlementStartsAt === undefined || validDate(value.entitlementStartsAt, true))
    || !(value.entitlementEndsAt === undefined || validDate(value.entitlementEndsAt, true))
    || !(value.entitlementStatus === undefined || value.entitlementStatus === null
      || ['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED'].includes(String(value.entitlementStatus)))) {
    throw invalidResponse('订单列表')
  }
  return value as unknown as AdminOrder
}

function parseOrderSummary(value: unknown): AdminOrderSummary {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'currency',
      'orderCount',
      'paidOrderCount',
      'eventGrossAmountCents',
      'membershipGrossAmountCents',
      'grossAmountCents',
      'refundedAmountCents',
      'netAmountCents',
    ])
    || value.currency !== 'CNY') {
    throw invalidResponse('财务汇总')
  }
  for (const key of [
    'orderCount',
    'paidOrderCount',
    'eventGrossAmountCents',
    'membershipGrossAmountCents',
    'grossAmountCents',
    'refundedAmountCents',
    'netAmountCents',
  ]) {
    if (!Number.isInteger(value[key]) || Number(value[key]) < 0) {
      throw invalidResponse('财务汇总')
    }
  }
  if (Number(value.eventGrossAmountCents) + Number(value.membershipGrossAmountCents) !== Number(value.grossAmountCents)
    || Number(value.grossAmountCents) - Number(value.refundedAmountCents) !== Number(value.netAmountCents)) {
    throw invalidResponse('财务汇总')
  }
  return value as unknown as AdminOrderSummary
}

export function parseAdminRosterPage(value: unknown): AdminPage<AdminRosterItem> {
  return parsePage(value, '参与者名单', parseRosterItem)
}

export function parseAdminOrderPage(value: unknown): AdminOrderPage {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor', 'summary'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === undefined || value.nextCursor === null || typeof value.nextCursor === 'string')) {
    throw invalidResponse('订单列表')
  }
  return {
    items: value.items.map(parseOrderItem),
    nextCursor: value.nextCursor === undefined ? null : value.nextCursor,
    summary: parseOrderSummary(value.summary),
  }
}
