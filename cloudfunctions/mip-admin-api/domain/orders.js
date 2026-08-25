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
    listOrders,
    normalizeExportFilters: normalizeOrderFilters,
    retryRefund,
    submitRefund,
  }
}

function projectOrder(item, bindings) {
  const { branchId, contentRefundEligible, demoOrder, ...safe } = item
  const orderScope = item.orderType === 'EVENT'
    ? { scopeType: 'EVENT', scopeId: item.resourceId, branchId: branchId || null }
    : { scopeType: 'PLATFORM', scopeId: null, branchId: null }
  let canRefund = false
  try {
    authorize(bindings, CAPABILITIES.REFUNDS_SUBMIT, orderScope)
    canRefund = true
  }
  catch {}
  const availableRefundActions = []
  if (canRefund
    && !demoOrder
    && ['PAID', 'PARTIALLY_REFUNDED'].includes(item.status)
    && (item.orderType !== 'CONTENT' || contentRefundEligible)
    && Number(item.refundedAmountCents) < Number(item.amountCents)) {
    availableRefundActions.push('SUBMIT_REFUND')
  }
  if (canRefund
    && item.status === 'REFUND_PENDING'
    && item.refundId
    && ['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(item.refundStatus)) {
    availableRefundActions.push('RETRY_REFUND')
  }
  return { ...safe, availableRefundActions }
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
