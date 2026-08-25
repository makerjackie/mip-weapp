'use strict'

const { CAPABILITIES, authorize } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const {
  normalizeReviewClaimInput,
  normalizeReviewGetInput,
  normalizeReviewListInput,
  normalizeReviewReconcileInput,
  normalizeReviewResolveInput,
} = require('./message-delivery-review-validation')
const { AdminError } = require('./validation')

function createAdminMessageDeliveryReviews({
  access,
  repository,
  reconcileNotificationDelivery,
  now = () => new Date(),
}) {
  async function reviewContext(caller) {
    const context = await access.session(caller)
    const grant = authorize(
      context.bindings,
      CAPABILITIES.MESSAGES_DELIVERY_REVIEW,
      { scopeType: 'PLATFORM', scopeId: null },
    )
    return { context, grant }
  }

  async function listMessageDeliveryReviews(caller, input = {}) {
    const { context, grant } = await reviewContext(caller)
    const request = normalizeReviewListInput(input)
    const page = await repository.listMessageDeliveryReviews({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      sourceType: request.sourceType,
      workflowStatus: request.workflowStatus,
      cursor: decodeCursor(request.cursor, ['occurredAt', 'id']),
      limit: request.limit,
      now: now(),
    })
    await repository.recordAudit(access.audit(context, grant, {
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.message_delivery_reviews.list',
      resourceType: 'MESSAGE_DELIVERY_REVIEW_LIST',
      metadata: {
        count: page.items.length,
        sourceType: request.sourceType,
        workflowStatus: request.workflowStatus,
      },
    }))
    return page
  }

  async function getMessageDeliveryReview(caller, input = {}) {
    const { context, grant } = await reviewContext(caller)
    const request = normalizeReviewGetInput(input)
    const item = await repository.getMessageDeliveryReview({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      resourceRef: request.resourceRef,
      now: now(),
    })
    if (!item) throw new AdminError('NOT_FOUND', '投递复核记录不存在')
    await repository.recordAudit(access.audit(context, grant, {
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.message_delivery_reviews.get',
      resourceType: 'MESSAGE_DELIVERY_REVIEW',
      resourceId: item.workflow.reviewId,
      metadata: {
        sourceType: item.resourceRef.type,
        sourceStatus: item.sourceState.status,
        classification: item.classification,
        evidenceRevision: item.evidenceRevision,
      },
    }))
    return item
  }

  async function claimMessageDeliveryReview(caller, input = {}) {
    const { context, grant } = await reviewContext(caller)
    const request = normalizeReviewClaimInput(input)
    return repository.claimMessageDeliveryReview(mutationInput(
      context,
      grant,
      request,
      'admin.message_delivery_reviews.claim',
    ))
  }

  async function reconcileMessageDeliveryReview(caller, input = {}) {
    const { context, grant } = await reviewContext(caller)
    const request = normalizeReviewReconcileInput(input)
    const mutation = mutationInput(
      context,
      grant,
      request,
      'admin.message_delivery_reviews.reconcile',
    )
    if (request.resourceRef.type === 'CAMPAIGN_DISPATCH') {
      return repository.reconcileCampaignDeliveryReview(mutation)
    }
    const preparation = await repository.prepareDeliveryTaskReconcile(mutation)
    if (preparation.replay) return preparation.replay
    let workerResult
    try {
      workerResult = await reconcileNotificationDelivery(preparation.workerInput)
    }
    catch (error) {
      const code = publicErrorCode(error)
      throw new AdminError(
        code,
        reconcileErrorMessage(code),
        error?.retryable !== false,
      )
    }
    return repository.completeDeliveryTaskReconcile({ ...mutation, workerResult })
  }

  async function resolveMessageDeliveryReview(caller, input = {}) {
    const { context, grant } = await reviewContext(caller)
    const request = normalizeReviewResolveInput(input)
    return repository.resolveMessageDeliveryReview(mutationInput(
      context,
      grant,
      request,
      'admin.message_delivery_reviews.resolve',
    ))
  }

  function mutationInput(context, grant, request, action) {
    return {
      ...request,
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      now: now(),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MESSAGES_DELIVERY_REVIEW),
      audit: (resourceId, auditAction, metadata, scope) => access.audit(context, grant, {
        scopeType: scope?.scopeType || 'PLATFORM',
        scopeId: scope?.scopeId || null,
        action: auditAction || action,
        resourceType: 'MESSAGE_DELIVERY_REVIEW',
        resourceId,
        metadata,
      }),
    }
  }

  return {
    claimMessageDeliveryReview,
    getMessageDeliveryReview,
    listMessageDeliveryReviews,
    reconcileMessageDeliveryReview,
    resolveMessageDeliveryReview,
  }
}

function publicErrorCode(error) {
  const code = error?.code || error?.message
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(code)
    ? code
    : 'DELIVERY_RECONCILE_UNAVAILABLE'
}

function reconcileErrorMessage(code) {
  const messages = {
    DELIVERY_RECONCILE_CONFIG_REQUIRED: '通知投递复核服务尚未配置',
    DELIVERY_RECONCILE_RESPONSE_INVALID: '通知投递复核结果无法验证',
    EVIDENCE_CHANGED: '投递证据已变化，请刷新后重试',
    IDEMPOTENCY_CONFLICT: '重复请求的内容不一致',
    NOT_ACTIONABLE: '当前投递状态不需要人工处理',
    REQUEST_IN_PROGRESS: '相同投递复核正在处理',
  }
  return messages[code] || '通知投递复核暂时无法确认，请使用同一请求重试'
}

module.exports = { createAdminMessageDeliveryReviews, publicErrorCode, reconcileErrorMessage }
