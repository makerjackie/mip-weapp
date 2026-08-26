'use strict'

const {
  CAPABILITIES,
  authorize,
  firstGrant,
  visibilityForCapability,
} = require('./capabilities')
const { decodeCursor } = require('./pagination')
const {
  AdminError,
  limit,
  requiredId,
  stableKey,
  text,
} = require('./validation')

const ORDER_STATUSES = [
  'CREATED', 'PAYMENT_CREATED', 'PAID', 'FAILED', 'CLOSED',
  'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED',
]
const REFUND_STATUSES = ['NONE', 'PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED']

function createAdminOrders({
  repository,
  access,
  dispatchProviderRefund = async () => ({ status: 'PENDING_RETRY' }),
}) {
  async function getOrder(caller, input) {
    const context = await access.session(caller)
    const orderId = requiredId(input.orderId, '订单')
    firstGrant(context.bindings, CAPABILITIES.ORDERS_READ)
    const visibility = visibilityForCapability(context.bindings, CAPABILITIES.ORDERS_READ)
    const detail = await repository.getOrderDetail(
      context.caller.appId,
      visibility,
      orderId,
    )
    if (!detail) throw new AdminError('NOT_FOUND', '订单不存在')
    const grant = authorize(context.bindings, CAPABILITIES.ORDERS_READ, detail.scope)
    await repository.recordAudit(access.audit(context, grant, {
      scopeType: detail.scope.scopeType,
      scopeId: detail.scope.scopeId,
      action: 'admin.orders.detail.view',
      resourceType: 'ORDER',
      resourceId: orderId,
      metadata: { orderType: detail.order.orderType },
    }))
    return projectOrderDetail(detail, context.bindings)
  }

  async function listOrders(caller, input = {}) {
    const context = await access.session(caller)
    const filters = normalizeOrderFilters(input.filters)
    let grant
    let scope
    if (filters.eventId) {
      const authorization = await access.eventAuthorization(context, filters.eventId, CAPABILITIES.ORDERS_READ)
      grant = authorization.grant
      scope = authorization.scope
    }
    else {
      grant = firstGrant(context.bindings, CAPABILITIES.ORDERS_READ)
      scope = { scopeType: grant.scopeType, scopeId: grant.scopeId }
    }
    const visibility = visibilityForCapability(context.bindings, CAPABILITIES.ORDERS_READ)
    const [pageValue, summary] = await Promise.all([
      repository.listOrders(
        context.caller.appId,
        visibility,
        filters,
        limit(input.limit),
        decodeCursor(input.cursor, ['createdAt', 'id']),
      ),
      repository.summarizeOrders(context.caller.appId, visibility, filters),
    ])
    const page = pageResult(pageValue)
    await repository.recordAudit(access.audit(context, grant, {
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      action: 'admin.orders.view',
      resourceType: 'ORDER_LIST',
      metadata: { count: page.items.length, filters },
    }))
    return {
      ...page,
      summary,
      items: page.items.map(item => projectOrder(item, context.bindings)),
    }
  }

  async function submitRefund(caller, input) {
    const context = await access.session(caller)
    const orderId = requiredId(input.orderId, '订单')
    const scope = await repository.getOrderScope(context.caller.appId, orderId)
    if (!scope) throw new AdminError('NOT_FOUND', '订单不存在')
    const grant = authorize(context.bindings, CAPABILITIES.REFUNDS_SUBMIT, scope)
    const reason = text(input.reason, 300, { required: true, label: '退款原因' })
    const idempotencyKey = stableKey(input.idempotencyKey, '请求', 128)
    const refund = await repository.submitRefund({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      orderId,
      reason,
      idempotencyKey,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.REFUNDS_SUBMIT),
      authorizedScope: scope,
      audit: (refundId, amountCents) => access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.refunds.submit',
        resourceType: 'REFUND',
        resourceId: refundId,
        metadata: { orderId, amountCents, reasonLength: reason.length },
      }),
    })
    return {
      ...refund,
      providerDispatch: await dispatchRefundSafely(
        dispatchProviderRefund,
        context.caller.appId,
        refund.id,
      ),
    }
  }

  async function retryRefund(caller, input) {
    const context = await access.session(caller)
    const refundId = requiredId(input.refundId, '退款')
    const scope = await repository.getRefundScope(context.caller.appId, refundId)
    if (!scope) throw new AdminError('NOT_FOUND', '退款记录不存在')
    const grant = authorize(context.bindings, CAPABILITIES.REFUNDS_SUBMIT, scope)
    if (!['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(scope.refundStatus)) {
      throw new AdminError('INVALID_STATE', '当前退款状态不需要重试')
    }
    await repository.authorizeRefundRetry({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      refundId,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.REFUNDS_SUBMIT),
      authorizedScope: scope,
      audit: access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: 'admin.refunds.retry',
        resourceType: 'REFUND',
        resourceId: refundId,
        metadata: { providerDispatchStatus: 'REQUESTED' },
      }),
    })
    const providerDispatch = await dispatchRefundSafely(
      dispatchProviderRefund,
      context.caller.appId,
      refundId,
    )
    return {
      id: refundId,
      providerDispatch,
    }
  }

  return {
    getOrder,
    listOrders,
    normalizeExportFilters: normalizeOrderFilters,
    retryRefund,
    submitRefund,
  }
}

function projectOrder(item, bindings) {
  const orderScope = item.orderType === 'EVENT'
    ? { scopeType: 'EVENT', scopeId: item.resourceId, branchId: item.branchId || null }
    : { scopeType: 'PLATFORM', scopeId: null, branchId: null }
  let canRefund = false
  try {
    authorize(bindings, CAPABILITIES.REFUNDS_SUBMIT, orderScope)
    canRefund = true
  }
  catch {}
  const availableRefundActions = []
  if (canRefund
    && !item.demoOrder
    && ['PAID', 'PARTIALLY_REFUNDED'].includes(item.status)
    && (item.orderType !== 'CONTENT' || item.contentRefundEligible)
    && Number(item.refundedAmountCents) < Number(item.amountCents)) {
    availableRefundActions.push('SUBMIT_REFUND')
  }
  if (canRefund
    && item.status === 'REFUND_PENDING'
    && item.refundId
    && ['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(item.refundStatus)) {
    availableRefundActions.push('RETRY_REFUND')
  }
  return {
    id: item.id,
    nickname: item.nickname,
    orderType: item.orderType,
    resourceId: item.resourceId,
    resourceType: item.resourceType,
    resourceTitle: item.resourceTitle,
    resourceBranchName: item.resourceBranchName,
    merchantOrderNoMasked: item.merchantOrderNoMasked,
    providerTransactionIdMasked: item.providerTransactionIdMasked,
    amountCents: item.amountCents,
    refundedAmountCents: item.refundedAmountCents,
    currency: item.currency,
    status: item.status,
    refundStatus: item.refundStatus,
    refundId: item.refundId,
    availableRefundActions,
    paidAt: item.paidAt,
    createdAt: item.createdAt,
    version: item.version,
    ...(item.orderType === 'MEMBERSHIP' ? {
      entitlementStartsAt: item.entitlementStartsAt,
      entitlementEndsAt: item.entitlementEndsAt,
      entitlementStatus: item.entitlementStatus,
    } : {}),
  }
}

function projectOrderDetail(detail, bindings) {
  const order = projectOrder(detail.order, bindings)
  return {
    order: {
      ...order,
      updatedAt: detail.order.updatedAt,
      closedAt: detail.order.closedAt,
    },
    buyer: {
      nickname: detail.buyer.nickname,
      kind: detail.buyer.kind,
      accountStatus: detail.buyer.accountStatus,
      branchName: detail.buyer.branchName,
      cityName: detail.buyer.cityName,
    },
    product: {
      resourceType: order.resourceType,
      title: detail.productSnapshot.title || order.resourceTitle,
      branchName: order.resourceBranchName,
      snapshot: {
        catalogStage: detail.productSnapshot.catalogStage,
        version: detail.productSnapshot.version,
        durationDays: detail.productSnapshot.durationDays,
        unlockDays: detail.productSnapshot.unlockDays,
        benefits: [...detail.productSnapshot.benefits],
        refundPolicy: detail.productSnapshot.refundPolicy,
        refundWindowHours: detail.productSnapshot.refundWindowHours,
        eventStartsAt: detail.productSnapshot.eventStartsAt,
        eventEndsAt: detail.productSnapshot.eventEndsAt,
        cityName: detail.productSnapshot.cityName,
        venueName: detail.productSnapshot.venueName,
      },
    },
    payment: {
      attempts: detail.paymentAttempts.map(projectPaymentAttempt),
      callbacks: detail.paymentCallbacks.map(projectPaymentCallback),
    },
    refunds: detail.refunds.map(projectRefund),
    entitlementTimeline: detail.entitlementTimeline.map(projectEntitlement),
    statusTimeline: detail.statusTimeline.map(projectStatusTimelineItem),
  }
}

function projectPaymentAttempt(item) {
  return {
    provider: item.provider,
    status: item.status,
    providerPaymentIdMasked: item.providerPaymentIdMasked,
    requiresAttention: item.requiresAttention === true,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function projectPaymentCallback(item) {
  return {
    callbackType: item.callbackType,
    verificationStatus: item.verificationStatus,
    processingStatus: item.processingStatus,
    requiresAttention: item.requiresAttention === true,
    processedAt: item.processedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function projectRefund(item) {
  return {
    id: item.id,
    requestedBy: item.requestedBy,
    merchantRefundNoMasked: item.merchantRefundNoMasked,
    providerRefundIdMasked: item.providerRefundIdMasked,
    amountCents: item.amountCents,
    currency: item.currency,
    reason: item.reason,
    status: item.status,
    requiresAttention: item.requiresAttention === true,
    refundedAt: item.refundedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    callback: item.callback ? projectPaymentCallback(item.callback) : null,
    statusTimeline: item.statusTimeline.map(projectStatusTimelineItem),
  }
}

function projectEntitlement(item) {
  return {
    kind: item.kind,
    status: item.status,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    firstAccessedAt: item.firstAccessedAt,
    revokedAt: item.revokedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function projectStatusTimelineItem(item) {
  return {
    status: item.status,
    occurredAt: item.occurredAt,
    evidence: item.evidence,
  }
}

async function dispatchRefundSafely(dispatchProviderRefund, appId, refundId) {
  try {
    const result = await dispatchProviderRefund({ appId, refundId })
    const status = ['PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED'].includes(result?.status)
      ? result.status
      : 'PENDING_RETRY'
    return { status }
  }
  catch {
    return { status: 'PENDING_RETRY' }
  }
}

function pageResult(value) {
  if (Array.isArray(value)) return { items: value, nextCursor: null }
  return {
    items: Array.isArray(value?.items) ? value.items : [],
    nextCursor: typeof value?.nextCursor === 'string' ? value.nextCursor : null,
  }
}

function normalizeOrderFilters(value) {
  const filters = normalizeFilters(value)
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '订单开始时间不能晚于结束时间')
  }
  return {
    query: text(filters.query, 80),
    eventId: filters.eventId ? requiredId(filters.eventId, '活动') : '',
    orderType: enumFilter(filters.orderType, ['MEMBERSHIP', 'EVENT', 'CONTENT'], '订单类型'),
    status: enumFilter(filters.status, ORDER_STATUSES, '订单状态'),
    refundStatus: enumFilter(filters.refundStatus, REFUND_STATUSES, '退款状态'),
    createdFrom,
    createdTo,
  }
}

function normalizeFilters(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

function enumFilter(value, allowed, label) {
  if (value === null || value === undefined || value === '') return ''
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!allowed.includes(normalized)) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return normalized
}

function dateTimeFilter(value, label) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 40) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

module.exports = { createAdminOrders }
