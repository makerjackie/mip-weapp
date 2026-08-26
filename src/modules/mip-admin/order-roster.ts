import type {
  AdminOrder,
  AdminOrderDetail,
  AdminOrderEntitlementTimelineItem,
  AdminOrderPage,
  AdminOrderPaymentAttempt,
  AdminOrderPaymentCallback,
  AdminOrderRefund,
  AdminOrderRefundAction,
  AdminOrderStatus,
  AdminOrderStatusTimelineItem,
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
const paymentAttemptStatuses = new Set(['CREATED', 'PARAMETERS_ISSUED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CLOSED'])
const callbackProcessingStatuses = new Set(['RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED'])
const timelineStatusByEvidence = {
  ORDER_CREATED: 'CREATED',
  PAYMENT_CONFIRMED: 'PAID',
  ORDER_CLOSED: 'CLOSED',
  REFUND_CREATED: 'PENDING',
  REFUND_COMPLETED: 'SUCCEEDED',
} as const
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

function validMaskedIdentifier(value: unknown, maximum: number) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maximum
    && value.includes('…')
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

function parseOrderItem(value: unknown, label = '订单列表'): AdminOrder {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'id',
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
    || !validMaskedIdentifier(value.merchantOrderNoMasked, 64)
    || !(value.providerTransactionIdMasked === null
      || validMaskedIdentifier(value.providerTransactionIdMasked, 128))
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
    throw invalidResponse(label)
  }
  return value as unknown as AdminOrder
}

function parseStatusTimelineItem(
  value: unknown,
  family: 'ORDER' | 'REFUND',
): AdminOrderStatusTimelineItem {
  const evidence = record(value) ? String(value.evidence) : ''
  const expectedStatus = timelineStatusByEvidence[evidence as keyof typeof timelineStatusByEvidence]
  if (!record(value)
    || !hasOnlyKeys(value, ['status', 'occurredAt', 'evidence'])
    || expectedStatus !== value.status
    || (family === 'ORDER' ? !evidence.startsWith('ORDER_') && evidence !== 'PAYMENT_CONFIRMED' : !evidence.startsWith('REFUND_'))
    || !validDate(value.occurredAt)) {
    throw invalidResponse('订单详情')
  }
  return value as unknown as AdminOrderStatusTimelineItem
}

function parsePaymentAttempt(value: unknown): AdminOrderPaymentAttempt {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'provider',
      'status',
      'providerPaymentIdMasked',
      'requiresAttention',
      'createdAt',
      'updatedAt',
    ])
    || !['WECHAT_PAY', 'TEST'].includes(String(value.provider))
    || !paymentAttemptStatuses.has(String(value.status))
    || !(value.providerPaymentIdMasked === null
      || validMaskedIdentifier(value.providerPaymentIdMasked, 128))
    || typeof value.requiresAttention !== 'boolean'
    || !validDate(value.createdAt)
    || !validDate(value.updatedAt)) {
    throw invalidResponse('订单详情')
  }
  return value as unknown as AdminOrderPaymentAttempt
}

function parsePaymentCallback(
  value: unknown,
  expectedType: 'PAYMENT' | 'REFUND',
): AdminOrderPaymentCallback {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'callbackType',
      'verificationStatus',
      'processingStatus',
      'requiresAttention',
      'processedAt',
      'createdAt',
      'updatedAt',
    ])
    || value.callbackType !== expectedType
    || !['VERIFIED', 'REJECTED'].includes(String(value.verificationStatus))
    || !callbackProcessingStatuses.has(String(value.processingStatus))
    || typeof value.requiresAttention !== 'boolean'
    || !validDate(value.processedAt, true)
    || !validDate(value.createdAt)
    || !validDate(value.updatedAt)) {
    throw invalidResponse('订单详情')
  }
  return value as unknown as AdminOrderPaymentCallback
}

function parseRefund(value: unknown): AdminOrderRefund {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'id',
      'requestedBy',
      'merchantRefundNoMasked',
      'providerRefundIdMasked',
      'amountCents',
      'currency',
      'reason',
      'status',
      'requiresAttention',
      'refundedAt',
      'createdAt',
      'updatedAt',
      'callback',
      'statusTimeline',
    ])
    || typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || !['BUYER', 'OPERATOR', 'SYSTEM'].includes(String(value.requestedBy))
    || !validMaskedIdentifier(value.merchantRefundNoMasked, 64)
    || !(value.providerRefundIdMasked === null
      || validMaskedIdentifier(value.providerRefundIdMasked, 128))
    || !Number.isInteger(value.amountCents)
    || Number(value.amountCents) <= 0
    || typeof value.currency !== 'string'
    || !/^[A-Z]{3}$/.test(value.currency)
    || typeof value.reason !== 'string'
    || value.reason.length > 300
    || !refundStatuses.has(value.status as AdminRefundStatus)
    || typeof value.requiresAttention !== 'boolean'
    || !validDate(value.refundedAt, true)
    || !validDate(value.createdAt)
    || !validDate(value.updatedAt)
    || !(value.callback === null || record(value.callback))
    || !Array.isArray(value.statusTimeline)) {
    throw invalidResponse('订单详情')
  }
  return {
    ...(value as unknown as Omit<AdminOrderRefund, 'callback' | 'statusTimeline'>),
    callback: value.callback === null ? null : parsePaymentCallback(value.callback, 'REFUND'),
    statusTimeline: value.statusTimeline.map(item => parseStatusTimelineItem(item, 'REFUND')),
  }
}

function parseEntitlementTimelineItem(value: unknown): AdminOrderEntitlementTimelineItem {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'kind',
      'status',
      'startsAt',
      'endsAt',
      'firstAccessedAt',
      'revokedAt',
      'createdAt',
      'updatedAt',
    ])
    || !['MEMBERSHIP', 'CONTENT'].includes(String(value.kind))
    || !['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED'].includes(String(value.status))
    || !validDate(value.startsAt)
    || !validDate(value.endsAt, true)
    || !validDate(value.firstAccessedAt, true)
    || !validDate(value.revokedAt, true)
    || !validDate(value.createdAt)
    || !validDate(value.updatedAt)) {
    throw invalidResponse('订单详情')
  }
  return value as unknown as AdminOrderEntitlementTimelineItem
}

function nullableInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  return value === null
    || (Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum)
}

function validProductSnapshot(value: unknown) {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'catalogStage',
      'version',
      'durationDays',
      'unlockDays',
      'benefits',
      'refundPolicy',
      'refundWindowHours',
      'eventStartsAt',
      'eventEndsAt',
      'cityName',
      'venueName',
    ])
    || !(value.catalogStage === null || ['TEST', 'LIVE'].includes(String(value.catalogStage)))
    || !nullableInteger(value.version, 1)
    || !nullableInteger(value.durationDays, 1, 3660)
    || !nullableInteger(value.unlockDays, 1, 3660)
    || !Array.isArray(value.benefits)
    || value.benefits.length > 30
    || value.benefits.some(item => typeof item !== 'string' || item.length < 1 || item.length > 160)
    || !(value.refundPolicy === null || ['BEFORE_ACCESS', 'NON_REFUNDABLE'].includes(String(value.refundPolicy)))
    || !nullableInteger(value.refundWindowHours, 0, 720)
    || !validDate(value.eventStartsAt, true)
    || !validDate(value.eventEndsAt, true)
    || typeof value.cityName !== 'string'
    || value.cityName.length > 80
    || typeof value.venueName !== 'string'
    || value.venueName.length > 120) {
    return false
  }
  return true
}

export function parseAdminOrderDetail(value: unknown): AdminOrderDetail {
  if (!record(value)
    || !hasOnlyKeys(value, ['order', 'buyer', 'product', 'payment', 'refunds', 'entitlementTimeline', 'statusTimeline'])
    || !record(value.order)
    || !hasOnlyKeys(value.order, [
      'id',
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
      'updatedAt',
      'closedAt',
    ])
    || !validDate(value.order.updatedAt)
    || !validDate(value.order.closedAt, true)
    || !record(value.buyer)
    || !hasOnlyKeys(value.buyer, ['nickname', 'kind', 'accountStatus', 'branchName', 'cityName'])
    || typeof value.buyer.nickname !== 'string'
    || value.buyer.nickname.length < 1
    || value.buyer.nickname.length > 64
    || !['PLAYER', 'GUEST'].includes(String(value.buyer.kind))
    || !['ACTIVE', 'BLOCKED', 'CLOSED'].includes(String(value.buyer.accountStatus))
    || typeof value.buyer.branchName !== 'string'
    || value.buyer.branchName.length > 80
    || typeof value.buyer.cityName !== 'string'
    || value.buyer.cityName.length > 80
    || !record(value.product)
    || !hasOnlyKeys(value.product, ['resourceType', 'title', 'branchName', 'snapshot'])
    || !['MEMBERSHIP_PLAN', 'EVENT', 'KNOWLEDGE_CONTENT'].includes(String(value.product.resourceType))
    || typeof value.product.title !== 'string'
    || value.product.title.length < 1
    || value.product.title.length > 120
    || typeof value.product.branchName !== 'string'
    || value.product.branchName.length > 80
    || !validProductSnapshot(value.product.snapshot)
    || !record(value.payment)
    || !hasOnlyKeys(value.payment, ['attempts', 'callbacks'])
    || !Array.isArray(value.payment.attempts)
    || !Array.isArray(value.payment.callbacks)
    || !Array.isArray(value.refunds)
    || !Array.isArray(value.entitlementTimeline)
    || !Array.isArray(value.statusTimeline)) {
    throw invalidResponse('订单详情')
  }
  const { updatedAt, closedAt, ...baseOrder } = value.order
  return {
    order: {
      ...parseOrderItem(baseOrder, '订单详情'),
      updatedAt: updatedAt as string,
      closedAt: closedAt as string | null,
    },
    buyer: value.buyer as unknown as AdminOrderDetail['buyer'],
    product: value.product as unknown as AdminOrderDetail['product'],
    payment: {
      attempts: value.payment.attempts.map(parsePaymentAttempt),
      callbacks: value.payment.callbacks.map(item => parsePaymentCallback(item, 'PAYMENT')),
    },
    refunds: value.refunds.map(parseRefund),
    entitlementTimeline: value.entitlementTimeline.map(parseEntitlementTimelineItem),
    statusTimeline: value.statusTimeline.map(item => parseStatusTimelineItem(item, 'ORDER')),
  }
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
    items: value.items.map(item => parseOrderItem(item)),
    nextCursor: value.nextCursor === undefined ? null : value.nextCursor,
    summary: parseOrderSummary(value.summary),
  }
}
