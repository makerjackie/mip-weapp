'use strict'

const { CAPABILITIES, authorize } = require('./capabilities')
const { availableExceptionTypes } = require('./operational-exception-access')
const { decodeCursor, pageRows } = require('./pagination')
const { AdminError, limit } = require('./validation')

const STATES = Object.freeze(['PENDING', 'PROCESSING', 'MANUAL_REVIEW'])
const REVIEW_STATES = new Set(['PROCESSING_ACTIVE', 'PROCESSING_STALLED'])
const PENDING_REVIEW_STATES = new Set(['PENDING', 'RETRYABLE_FAILURE'])

function createAdminOperationsQueue({ access, repository, now = () => new Date() }) {
  async function listOperationsQueue(caller, input = {}) {
    const context = await access.session(caller)
    const exceptionTypes = availableExceptionTypes(context.bindings)
    const canReadExceptions = exceptionTypes.length > 0
      && hasCapability(context.bindings, CAPABILITIES.OPERATIONS_EXCEPTIONS_READ)
    const canReadDeliveryReviews = hasCapability(context.bindings, CAPABILITIES.MESSAGES_DELIVERY_REVIEW)
    if (!canReadExceptions && !canReadDeliveryReviews) {
      throw new AdminError('FORBIDDEN', '当前账号没有查看运营待办的权限')
    }
    const request = normalizeQueueInput(input)
    const currentTime = now()
    const sourceLimit = request.limit + 1
    const [exceptions, reviews] = await Promise.all([
      canReadExceptions && request.state !== 'PENDING'
        ? repository.listOperationalExceptions(context.caller.appId, {
            types: exceptionTypes,
            statuses: statusesForState(request.state),
            cursor: request.cursor,
            internal: true,
            limit: sourceLimit,
          })
        : [],
      canReadDeliveryReviews
        ? repository.listMessageDeliveryReviews({
            appId: context.caller.appId,
            actorUserId: context.caller.userId,
            workflowStatus: 'ACTIVE',
            cursor: request.cursor,
            queueCursor: true,
            queueState: request.state,
            limit: sourceLimit,
            now: currentTime,
          })
        : { items: [] },
    ])
    let items = deriveQueueItems(exceptions, reviews.items || [])
    if (request.state) items = items.filter(item => item.state === request.state)
    if (request.cursor) {
      items = items.filter(item => item.occurredAt < request.cursor.occurredAt
        || (item.occurredAt === request.cursor.occurredAt && item.id < request.cursor.id))
    }
    const page = pageRows(items, request.limit, item => ({ occurredAt: item.occurredAt, id: item.id }))
    const auditGrant = canReadExceptions
      ? authorize(context.bindings, CAPABILITIES.OPERATIONS_EXCEPTIONS_READ, { scopeType: 'PLATFORM', scopeId: null })
      : authorize(context.bindings, CAPABILITIES.MESSAGES_DELIVERY_REVIEW, { scopeType: 'PLATFORM', scopeId: null })
    await repository.recordAudit(access.audit(context, auditGrant, {
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.operations.queue.list',
      resourceType: 'OPERATIONS_QUEUE',
      metadata: { count: page.items.length, state: request.state, limit: request.limit },
    }))
    return page
  }

  return { listOperationsQueue }
}

function normalizeQueueInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['state', 'cursor', 'limit'].includes(key))) {
    throw new AdminError('VALIDATION_FAILED', '运营待办请求格式无效')
  }
  const state = input.state === undefined || input.state === '' || input.state === null
    ? null
    : STATES.includes(input.state) ? input.state : null
  if (input.state !== undefined && input.state !== '' && input.state !== null && !state) {
    throw new AdminError('VALIDATION_FAILED', '运营待办状态无效')
  }
  return {
    state,
    cursor: decodeCursor(input.cursor, ['occurredAt', 'id']),
    limit: limit(input.limit || 50, 100),
  }
}

function statusesForState(state) {
  if (state === 'PROCESSING') return ['STALLED']
  if (state === 'MANUAL_REVIEW') return ['FAILED', 'REJECTED', 'EXPIRED', 'CLEANUP_PENDING']
  return ['FAILED', 'STALLED', 'REJECTED', 'EXPIRED', 'CLEANUP_PENDING']
}

function deriveQueueItems(exceptions, reviews) {
  const items = exceptions.map(item => ({
    id: item.id,
    state: item.status === 'STALLED' ? 'PROCESSING' : 'MANUAL_REVIEW',
    source: 'EXCEPTION',
    sourceType: item.source,
    title: item.title,
    summary: item.summary,
    occurredAt: item.occurredAt,
    reasonCode: item.reasonCode,
    target: item.target,
    reviewRef: null,
  }))
  for (const item of reviews) {
    if (item.workflow?.status === 'RESOLVED') continue
    const state = REVIEW_STATES.has(item.classification)
      ? 'PROCESSING'
      : PENDING_REVIEW_STATES.has(item.classification) ? 'PENDING' : 'MANUAL_REVIEW'
    items.push({
      id: `DELIVERY_REVIEW:${item.resourceRef.type}:${item.resourceRef.id}`,
      state,
      source: 'DELIVERY_REVIEW',
      sourceType: item.resourceRef.type,
      title: item.resourceRef.type === 'CAMPAIGN_DISPATCH' ? '消息活动待复核' : '通知投递待复核',
      summary: state === 'MANUAL_REVIEW'
        ? '投递结果需要人工核对，当前不自动重放。'
        : '消息投递状态尚未完成，需要继续处理。',
      occurredAt: item.sourceState.occurredAt,
      reasonCode: item.sourceState.lastErrorCode,
      target: targetFor(item.evidence?.targetRef),
      reviewRef: item.resourceRef,
    })
  }
  return items.sort((left, right) => (
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || right.id.localeCompare(left.id)
  ))
}

function targetFor(value) {
  if (!value || typeof value.id !== 'string') return null
  const routes = {
    EVENT: `/packages/admin/event-console/index?eventId=${value.id}`,
    ORDER: '/packages/admin/orders/index',
    OPPORTUNITY: '/packages/admin/opportunities/index',
    USER: '/packages/admin/profiles/index',
    GROWTH: '/packages/admin/growth-entries/index',
  }
  return routes[value.type] ? { type: value.type, id: value.id, route: routes[value.type] } : null
}

function hasCapability(bindings, capability) {
  try {
    authorize(bindings, capability, { scopeType: 'PLATFORM', scopeId: null })
    return true
  }
  catch {
    return false
  }
}

module.exports = {
  STATES,
  createAdminOperationsQueue,
  deriveQueueItems,
  normalizeQueueInput,
}
