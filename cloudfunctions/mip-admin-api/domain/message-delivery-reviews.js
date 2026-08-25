'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { deliveryEvidenceRevision, normalizedDeliveryEvidence } = require('./delivery-evidence')
const { reconcileMessageCampaignDispatch } = require('./message-campaigns')
const { pageRows } = require('./pagination')

const CLAIM_LEASE_MS = 15 * 60 * 1000
const LIST_SCAN_BATCH_SIZE = 50
const REVIEW_OPERATIONS = Object.freeze({
  claim: 'admin.messageDeliveryReviews.claim',
  reconcile: 'admin.messageDeliveryReviews.reconcile',
  resolve: 'admin.messageDeliveryReviews.resolve',
})
const CLAIMABLE_CLASSIFICATIONS = new Set([
  'PROCESSING_STALLED',
  'MANUAL_REVIEW',
  'TERMINAL_FAILURE',
])
const AUTO_CONVERGED_CLASSIFICATIONS = new Set(['SUCCEEDED', 'RETRYABLE_FAILURE'])

function createMessageDeliveryReviewRepository(database, options = {}) {
  const createId = options.createId || randomUUID
  const now = options.now || (() => new Date())
  const lockMutation = options.lockMutationAuthorization
  const assertScope = options.assertMutationScope
  if (typeof lockMutation !== 'function' || typeof assertScope !== 'function') {
    throw new TypeError('Message delivery review mutation authorization is invalid')
  }

  async function listMessageDeliveryReviews(input) {
    const currentTime = input.now || now()
    const visible = []
    let cursor = input.cursor
    while (visible.length <= input.limit) {
      const candidateRows = await listCandidates(database, {
        ...input,
        cursor,
        scanLimit: LIST_SCAN_BATCH_SIZE,
      })
      if (!candidateRows.length) break
      const ordered = await hydrateCandidates(database, input.appId, candidateRows)
      visible.push(...ordered
        .map(source => ({ source, item: reviewDto(source, input.actorUserId, currentTime) }))
        .filter(({ source, item }) => (
          matchesWorkflowFilter(item.workflow.status, input.workflowStatus)
          && (source.review || CLAIMABLE_CLASSIFICATIONS.has(item.classification))
        ))
        .map(({ item }) => item))
      if (candidateRows.length < LIST_SCAN_BATCH_SIZE) break
      const last = candidateRows[candidateRows.length - 1]
      cursor = { occurredAt: last.occurred_at, id: last.incident_id }
    }
    return pageRows(visible, input.limit, item => ({
      occurredAt: item.sourceState.occurredAt,
      id: incidentId(item.resourceRef),
    }))
  }

  async function getMessageDeliveryReview(input) {
    const source = await readSource(database, input.appId, input.resourceRef)
    return source ? reviewDto(source, input.actorUserId, input.now || now()) : null
  }

  async function claimMessageDeliveryReview(input) {
    const currentTime = input.now || now()
    return database.transaction(async (tx) => {
      const source = await lockSource(tx, input.appId, input.resourceRef)
      if (!source) throw codeError('NOT_FOUND')
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, { scopeType: 'PLATFORM', scopeId: null })
      const requestHash = reviewRequestHash('claim', input)
      const idempotency = await claimOperation(tx, {
        ...input,
        createId,
        operation: REVIEW_OPERATIONS.claim,
        requestHash,
      })
      if (idempotency.replay) return idempotency.replay

      const currentEvidence = evidenceRevision(source)
      if (currentEvidence !== input.evidenceRevision) throw codeError('EVIDENCE_CHANGED')
      const classification = classifySource(source, currentTime)
      const review = source.review
      const reviewVersion = Number(review?.version || 0)
      if (reviewVersion !== input.reviewVersion) throw codeError('CONFLICT')
      const workflow = effectiveWorkflow(review, currentEvidence, input.actorUserId, currentTime, {
        reopenResolved: CLAIMABLE_CLASSIFICATIONS.has(classification),
      })
      const reviewConvergence = isReviewAutoConvergence(source, classification)
      if ((!CLAIMABLE_CLASSIFICATIONS.has(classification) && !reviewConvergence)
        || workflow.status === 'RESOLVED') {
        throw codeError('NOT_ACTIONABLE')
      }
      if (workflow.status === 'CLAIMED' && !workflow.claimedByMe) {
        throw codeError('CLAIMED_BY_OTHER')
      }

      const claimExpiresAt = new Date(currentTime.getTime() + CLAIM_LEASE_MS)
      let reviewId
      if (!review) {
        reviewId = createId()
        await tx.query(
          `INSERT INTO mip_message_delivery_reviews (
            id, app_id, source_type, source_id, scope_type, scope_id, evidence_hash,
            workflow_status, claimed_by_user_id, claimed_at, claim_expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CLAIMED', ?, ?, ?)`,
          [reviewId, input.appId, input.resourceRef.type, input.resourceRef.id,
            source.scope.scopeType, source.scope.scopeId, currentEvidence,
            input.actorUserId, currentTime, claimExpiresAt],
        )
      }
      else {
        reviewId = review.id
        const updated = await tx.query(
          `UPDATE mip_message_delivery_reviews
           SET scope_type = ?, scope_id = ?, evidence_hash = ?, workflow_status = 'CLAIMED',
             claimed_by_user_id = ?, claimed_at = ?, claim_expires_at = ?,
             resolution_code = NULL, resolution_note = NULL, evidence_reference = NULL,
             resolved_by_user_id = NULL, resolved_at = NULL, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?`,
          [source.scope.scopeType, source.scope.scopeId, currentEvidence,
            input.actorUserId, currentTime, claimExpiresAt,
            input.appId, review.id, input.reviewVersion],
        )
        assertAffected(updated, 'CONFLICT')
      }
      source.review = await loadReview(tx, input.appId, input.resourceRef, true)
      const response = reviewDto(source, input.actorUserId, currentTime)
      await writeReviewAudit(tx, input.audit(reviewId, 'admin.message_delivery_reviews.claim', {
        sourceType: input.resourceRef.type,
        sourceStatus: source.sourceState.status,
        classification,
        evidenceRevision: currentEvidence,
      }, source.scope))
      await completeOperation(tx, {
        ...input,
        operation: REVIEW_OPERATIONS.claim,
        requestHash,
        response,
      })
      return response
    })
  }

  async function prepareDeliveryTaskReconcile(input) {
    const currentTime = input.now || now()
    const requestHash = reviewRequestHash('reconcile', input)
    return database.transaction(async (tx) => {
      const source = await lockSource(tx, input.appId, input.resourceRef)
      if (!source) throw codeError('NOT_FOUND')
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, { scopeType: 'PLATFORM', scopeId: null })
      const stored = await readOperation(tx, {
        ...input,
        operation: REVIEW_OPERATIONS.reconcile,
        requestHash,
      }, true)
      if (stored.replay) return { replay: stored.replay }
      const review = assertClaimedReview(
        source.review,
        input,
        currentTime,
        { compareCurrentEvidence: false },
      )
      return {
        replay: null,
        workerInput: {
          appId: input.appId,
          actorUserId: input.actorUserId,
          taskId: input.resourceRef.id,
          expectedEvidenceRevision: input.evidenceRevision,
          idempotencyKey: input.idempotencyKey,
        },
        reviewId: review.id,
      }
    })
  }

  async function reconcileCampaignDeliveryReview(input) {
    const currentTime = input.now || now()
    return database.transaction(async (tx) => {
      let source = await lockSource(tx, input.appId, input.resourceRef)
      if (!source) throw codeError('NOT_FOUND')
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, { scopeType: 'PLATFORM', scopeId: null })
      const requestHash = reviewRequestHash('reconcile', input)
      const idempotency = await claimOperation(tx, {
        ...input,
        createId,
        operation: REVIEW_OPERATIONS.reconcile,
        requestHash,
      })
      if (idempotency.replay) return idempotency.replay
      const review = assertClaimedReview(source.review, input, currentTime, {
        currentEvidence: evidenceRevision(source),
      })
      const classification = classifySource(source, currentTime)
      let result
      if (AUTO_CONVERGED_CLASSIFICATIONS.has(classification)) {
        result = {
          effect: classification === 'SUCCEEDED' ? 'CONFIRMED' : 'RETRYABLE_UNCHANGED',
        }
      }
      else if (['PROCESSING_STALLED', 'MANUAL_REVIEW'].includes(classification)) {
        result = await reconcileMessageCampaignDispatch(
          tx,
          input.appId,
          source.rawDispatch,
          currentTime,
        )
        source = await lockSource(tx, input.appId, input.resourceRef)
      }
      else {
        throw codeError('NOT_ACTIONABLE')
      }
      await applyReconcileWorkflow(tx, {
        appId: input.appId,
        actorUserId: input.actorUserId,
        currentTime,
        review,
        source,
      })
      source.review = await loadReview(tx, input.appId, input.resourceRef, true)
      const response = {
        ...reviewDto(source, input.actorUserId, currentTime),
        reconcileEffect: result.effect,
        schedulerReconcileRequired: result.effect === 'RETRY_ARMED',
      }
      await writeReviewAudit(tx, input.audit(review.id, 'admin.message_delivery_reviews.reconcile', {
        sourceType: input.resourceRef.type,
        sourceStatus: source.sourceState.status,
        classification: classifySource(source, currentTime),
        effect: result.effect,
        evidenceRevision: evidenceRevision(source),
      }, source.scope))
      await completeOperation(tx, {
        ...input,
        operation: REVIEW_OPERATIONS.reconcile,
        requestHash,
        response,
      })
      return response
    })
  }

  async function completeDeliveryTaskReconcile(input) {
    const currentTime = input.now || now()
    return database.transaction(async (tx) => {
      let source = await lockSource(tx, input.appId, input.resourceRef)
      if (!source) throw codeError('NOT_FOUND')
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, { scopeType: 'PLATFORM', scopeId: null })
      const requestHash = reviewRequestHash('reconcile', input)
      const idempotency = await claimOperation(tx, {
        ...input,
        createId,
        operation: REVIEW_OPERATIONS.reconcile,
        requestHash,
      })
      if (idempotency.replay) return idempotency.replay
      const review = assertClaimedReview(
        source.review,
        input,
        currentTime,
        { compareCurrentEvidence: false },
      )
      if (input.workerResult.taskId !== input.resourceRef.id
        || input.workerResult.beforeEvidenceRevision !== input.evidenceRevision
        || input.workerResult.afterEvidenceRevision !== evidenceRevision(source)) {
        throw codeError('EVIDENCE_CHANGED')
      }
      await applyReconcileWorkflow(tx, {
        appId: input.appId,
        actorUserId: input.actorUserId,
        currentTime,
        review,
        source,
      })
      source.review = await loadReview(tx, input.appId, input.resourceRef, true)
      const response = {
        ...reviewDto(source, input.actorUserId, currentTime),
        reconcileEffect: input.workerResult.effect,
        schedulerReconcileRequired: false,
      }
      await writeReviewAudit(tx, input.audit(review.id, 'admin.message_delivery_reviews.reconcile', {
        sourceType: input.resourceRef.type,
        sourceStatus: source.sourceState.status,
        classification: classifySource(source, currentTime),
        effect: input.workerResult.effect,
        evidenceRevision: evidenceRevision(source),
      }, source.scope))
      await completeOperation(tx, {
        ...input,
        operation: REVIEW_OPERATIONS.reconcile,
        requestHash,
        response,
      })
      return response
    })
  }

  async function resolveMessageDeliveryReview(input) {
    const currentTime = input.now || now()
    return database.transaction(async (tx) => {
      const source = await lockSource(tx, input.appId, input.resourceRef)
      if (!source) throw codeError('NOT_FOUND')
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, { scopeType: 'PLATFORM', scopeId: null })
      const requestHash = reviewRequestHash('resolve', input)
      const idempotency = await claimOperation(tx, {
        ...input,
        createId,
        operation: REVIEW_OPERATIONS.resolve,
        requestHash,
      })
      if (idempotency.replay) return idempotency.replay
      const review = assertClaimedReview(source.review, input, currentTime, {
        currentEvidence: evidenceRevision(source),
      })
      const classification = classifySource(source, currentTime)
      if (input.resolutionCode === 'TERMINAL_ACCEPTED' && classification !== 'TERMINAL_FAILURE') {
        throw codeError('NOT_ACTIONABLE')
      }
      if (input.resolutionCode === 'UNKNOWN_NO_REPLAY' && classification !== 'MANUAL_REVIEW') {
        throw codeError('NOT_ACTIONABLE')
      }
      const updated = await tx.query(
        `UPDATE mip_message_delivery_reviews
         SET workflow_status = 'RESOLVED', claim_expires_at = NULL,
           resolution_code = ?, resolution_note = ?, evidence_reference = ?,
           resolved_by_user_id = ?, resolved_at = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND workflow_status = 'CLAIMED'
           AND claimed_by_user_id = ? AND evidence_hash = ?`,
        [input.resolutionCode, input.note, input.evidenceReference,
          input.actorUserId, currentTime, input.appId, review.id, input.reviewVersion,
          input.actorUserId, input.evidenceRevision],
      )
      assertAffected(updated, 'CONFLICT')
      source.review = await loadReview(tx, input.appId, input.resourceRef, true)
      const response = reviewDto(source, input.actorUserId, currentTime)
      await writeReviewAudit(tx, input.audit(review.id, 'admin.message_delivery_reviews.resolve', {
        sourceType: input.resourceRef.type,
        sourceStatus: source.sourceState.status,
        classification,
        resolutionCode: input.resolutionCode,
        evidenceRevision: input.evidenceRevision,
      }, source.scope))
      await completeOperation(tx, {
        ...input,
        operation: REVIEW_OPERATIONS.resolve,
        requestHash,
        response,
      })
      return response
    })
  }

  return {
    claimMessageDeliveryReview,
    completeDeliveryTaskReconcile,
    getMessageDeliveryReview,
    listMessageDeliveryReviews,
    prepareDeliveryTaskReconcile,
    reconcileCampaignDeliveryReview,
    resolveMessageDeliveryReview,
  }
}

async function listCandidates(database, input) {
  const campaignEnabled = !input.sourceType || input.sourceType === 'CAMPAIGN_DISPATCH'
  const deliveryEnabled = !input.sourceType || input.sourceType === 'DELIVERY_TASK'
  const incidentEnabled = input.workflowStatus !== 'RESOLVED'
  const params = [
    input.appId,
    input.now,
    campaignEnabled && incidentEnabled ? 1 : 0,
    input.appId,
    campaignEnabled ? 1 : 0,
    input.workflowStatus,
    input.appId,
    input.now,
    deliveryEnabled && incidentEnabled ? 1 : 0,
    input.appId,
    deliveryEnabled ? 1 : 0,
    input.workflowStatus,
  ]
  const cursorSql = input.cursor
    ? 'WHERE (occurred_at < ? OR (occurred_at = ? AND incident_id < ?))'
    : ''
  if (input.cursor) params.push(input.cursor.occurredAt, input.cursor.occurredAt, input.cursor.id)
  return database.query(
    `SELECT source_type, source_id, occurred_at, incident_id
     FROM (
       SELECT 'CAMPAIGN_DISPATCH' AS source_type, dispatch.id AS source_id,
        dispatch.updated_at AS occurred_at,
        CONCAT('CAMPAIGN_DISPATCH:', dispatch.id) AS incident_id
       FROM mip_message_campaign_dispatches dispatch
       INNER JOIN mip_message_campaigns campaign
         ON campaign.app_id = dispatch.app_id AND campaign.id = dispatch.campaign_id
       LEFT JOIN mip_message_delivery_reviews review
         ON review.app_id = dispatch.app_id
        AND review.source_type = 'CAMPAIGN_DISPATCH' AND review.source_id = dispatch.id
       WHERE dispatch.app_id = ?
         AND (
           (dispatch.status = 'PROCESSING' AND dispatch.lease_expires_at <= ?)
           OR (dispatch.status = 'FAILED'
             AND dispatch.retry_disposition IN ('MANUAL_REVIEW', 'TERMINAL'))
         )
         AND (
           review.id IS NULL OR review.workflow_status <> 'RESOLVED'
           OR dispatch.updated_at > review.updated_at
           OR campaign.updated_at > review.updated_at
           OR EXISTS (
             SELECT 1 FROM mip_operations_messages changed_message
             WHERE changed_message.app_id = dispatch.app_id
               AND changed_message.publication_id = dispatch.campaign_id
               AND changed_message.created_at > review.updated_at
           )
           OR EXISTS (
             SELECT 1
             FROM mip_operations_messages changed_message
             INNER JOIN mip_outbox_events changed_outbox
               ON changed_outbox.app_id = changed_message.app_id
              AND changed_outbox.aggregate_type = 'OPERATIONS_MESSAGE'
              AND changed_outbox.aggregate_id = changed_message.id
              AND changed_outbox.event_type = 'operations.notification_published'
             WHERE changed_message.app_id = dispatch.app_id
               AND changed_message.publication_id = dispatch.campaign_id
               AND changed_outbox.created_at > review.updated_at
           )
         )
         AND ? = 1
       UNION
       SELECT review.source_type, review.source_id, dispatch.updated_at AS occurred_at,
        CONCAT(review.source_type, ':', review.source_id) AS incident_id
       FROM mip_message_delivery_reviews review
       INNER JOIN mip_message_campaign_dispatches dispatch
         ON dispatch.app_id = review.app_id AND dispatch.id = review.source_id
       WHERE review.app_id = ? AND review.source_type = 'CAMPAIGN_DISPATCH'
         AND ? = 1
         AND CASE ?
           WHEN 'RESOLVED' THEN review.workflow_status = 'RESOLVED'
           WHEN 'ALL' THEN 1
           ELSE review.workflow_status <> 'RESOLVED'
         END
       UNION
       SELECT 'DELIVERY_TASK' AS source_type, task.id AS source_id,
        task.outcome_updated_at AS occurred_at,
        CONCAT('DELIVERY_TASK:', task.id) AS incident_id
       FROM mip_delivery_tasks task
       LEFT JOIN mip_message_delivery_reviews review
         ON review.app_id = task.app_id
        AND review.source_type = 'DELIVERY_TASK' AND review.source_id = task.id
       WHERE task.app_id = ?
         AND (
           (task.status = 'PROCESSING' AND task.lease_expires_at <= ?)
           OR (task.status = 'FAILED'
             AND task.retry_disposition IN ('MANUAL_REVIEW', 'TERMINAL'))
           OR (task.status = 'CANCELLED'
             AND (task.last_outcome = 'UNKNOWN' OR task.retry_disposition = 'MANUAL_REVIEW'))
         )
         AND (
           review.id IS NULL OR review.workflow_status <> 'RESOLVED'
           OR task.outcome_updated_at > review.updated_at
         )
         AND ? = 1
       UNION
       SELECT review.source_type, review.source_id, task.outcome_updated_at AS occurred_at,
        CONCAT(review.source_type, ':', review.source_id) AS incident_id
       FROM mip_message_delivery_reviews review
       INNER JOIN mip_delivery_tasks task
         ON task.app_id = review.app_id AND task.id = review.source_id
       WHERE review.app_id = ? AND review.source_type = 'DELIVERY_TASK'
         AND ? = 1
         AND CASE ?
           WHEN 'RESOLVED' THEN review.workflow_status = 'RESOLVED'
           WHEN 'ALL' THEN 1
           ELSE review.workflow_status <> 'RESOLVED'
         END
     ) incident
     ${cursorSql}
     ORDER BY occurred_at DESC, incident_id DESC LIMIT ?`,
    [...params, input.scanLimit],
  )
}

async function hydrateCandidates(database, appId, candidateRows) {
  const campaignIds = candidateRows
    .filter(row => row.source_type === 'CAMPAIGN_DISPATCH')
    .map(row => row.source_id)
  const deliveryIds = candidateRows
    .filter(row => row.source_type === 'DELIVERY_TASK')
    .map(row => row.source_id)
  const [campaignRows, deliveryRows] = await Promise.all([
    campaignIds.length ? readCampaignRows(database, appId, campaignIds) : [],
    deliveryIds.length ? readDeliveryRows(database, appId, deliveryIds) : [],
  ])
  const sources = new Map([...campaignRows, ...deliveryRows].map((row) => {
    const source = sourceFromRow(row)
    return [incidentId(source.resourceRef), source]
  }))
  return candidateRows
    .map(row => sources.get(incidentId({ type: row.source_type, id: row.source_id })))
    .filter(Boolean)
}

function matchesWorkflowFilter(status, filter) {
  if (filter === 'ALL') return true
  return filter === 'RESOLVED' ? status === 'RESOLVED' : status !== 'RESOLVED'
}

async function readCampaignRows(database, appId, ids) {
  return database.query(
    `${campaignSourceSelect()}
     WHERE dispatch.app_id = ? AND dispatch.id IN (${placeholders(ids)})`,
    [appId, ...ids],
  )
}

async function readDeliveryRows(database, appId, ids) {
  return database.query(
    `${deliverySourceSelect()}
     WHERE task.app_id = ? AND task.id IN (${placeholders(ids)})`,
    [appId, ...ids],
  )
}

async function readSource(database, appId, resourceRef) {
  const rows = resourceRef.type === 'CAMPAIGN_DISPATCH'
    ? await readCampaignRows(database, appId, [resourceRef.id])
    : await readDeliveryRows(database, appId, [resourceRef.id])
  return rows[0] ? sourceFromRow(rows[0]) : null
}

async function lockSource(tx, appId, resourceRef) {
  if (resourceRef.type === 'CAMPAIGN_DISPATCH') {
    const dispatch = await tx.one(
      `SELECT id, campaign_id, scheduled_by_user_id, status, scheduled_for,
        available_at, attempts, lease_token, lease_expires_at, last_error_code,
        last_outcome, retry_disposition, version, updated_at
       FROM mip_message_campaign_dispatches WHERE app_id = ? AND id = ? FOR UPDATE`,
      [appId, resourceRef.id],
    )
    if (!dispatch) return null
    const campaign = await tx.one(
      `SELECT id, scope_type, branch_id, name, status, recipient_count,
        publish_idempotency_key, publish_request_hash, active_dispatch_id,
        published_at, version
       FROM mip_message_campaigns WHERE app_id = ? AND id = ? FOR UPDATE`,
      [appId, dispatch.campaign_id],
    )
    if (!campaign) throw codeError('CONFLICT')
    const facts = await campaignFacts(tx, appId, dispatch.campaign_id)
    const review = await loadReview(tx, appId, resourceRef, true)
    return campaignSource(dispatch, campaign, facts, review)
  }

  const task = await tx.one(
    `SELECT id, channel, status, attempts, available_at, lease_expires_at,
      delivered_at, last_error_code, last_outcome, retry_disposition,
      outcome_updated_at, updated_at, inbox_message_id
     FROM mip_delivery_tasks WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, resourceRef.id],
  )
  if (!task) return null
  const grant = await tx.one(
    `SELECT id, reservation_expires_at FROM mip_notification_grants
     WHERE app_id = ? AND status = 'RESERVED' AND reservation_task_id = ? FOR UPDATE`,
    [appId, resourceRef.id],
  )
  const message = await tx.one(
    `SELECT target_type, target_id FROM mip_inbox_messages
     WHERE app_id = ? AND id = ?`,
    [appId, task.inbox_message_id],
  )
  if (!message) throw codeError('CONFLICT')
  const review = await loadReview(tx, appId, resourceRef, true)
  return deliverySource(task, grant, message, review)
}

async function campaignFacts(adapter, appId, campaignId) {
  const row = await adapter.one(
    `SELECT COUNT(DISTINCT message.id) AS submitted_count,
      COUNT(DISTINCT CASE WHEN outbox.id IS NOT NULL THEN message.id END) AS outbox_covered_count,
      COUNT(outbox.id) AS outbox_count
     FROM mip_operations_messages message
     LEFT JOIN mip_outbox_events outbox
       ON outbox.app_id = message.app_id
      AND outbox.aggregate_type = 'OPERATIONS_MESSAGE'
      AND outbox.aggregate_id = message.id
      AND outbox.event_type = 'operations.notification_published'
     WHERE message.app_id = ? AND message.publication_id = ?`,
    [appId, campaignId],
  )
  return {
    submittedCount: Number(row?.submitted_count || 0),
    outboxCoveredCount: Number(row?.outbox_covered_count || 0),
    outboxCount: Number(row?.outbox_count || 0),
  }
}

async function loadReview(adapter, appId, resourceRef, lock = false) {
  return adapter.one(
    `SELECT id, evidence_hash, workflow_status, claimed_by_user_id, claimed_at,
      claim_expires_at, resolution_code, resolution_note, evidence_reference,
      resolved_by_user_id, resolved_at, version, created_at, updated_at
     FROM mip_message_delivery_reviews
     WHERE app_id = ? AND source_type = ? AND source_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [appId, resourceRef.type, resourceRef.id],
  )
}

function campaignSourceSelect() {
  return `SELECT 'CAMPAIGN_DISPATCH' AS source_type, dispatch.id AS source_id,
    dispatch.campaign_id, dispatch.status AS source_status,
    dispatch.scheduled_for AS source_scheduled_for,
    dispatch.available_at AS source_available_at,
    dispatch.attempts AS source_attempts,
    dispatch.lease_expires_at AS source_lease_expires_at,
    dispatch.last_error_code AS source_last_error_code,
    dispatch.last_outcome AS source_last_outcome,
    dispatch.retry_disposition AS source_retry_disposition,
    dispatch.version AS source_version, dispatch.updated_at AS source_occurred_at,
    campaign.scope_type, campaign.branch_id, campaign.name AS campaign_name,
    campaign.status AS campaign_status, campaign.recipient_count,
    campaign.publish_idempotency_key, campaign.publish_request_hash,
    campaign.active_dispatch_id, campaign.published_at,
    campaign.version AS campaign_version,
    (SELECT COUNT(DISTINCT message.id)
      FROM mip_operations_messages message
      WHERE message.app_id = campaign.app_id AND message.publication_id = campaign.id
    ) AS submitted_count,
    (SELECT COUNT(DISTINCT message.id)
      FROM mip_operations_messages message
      INNER JOIN mip_outbox_events outbox
        ON outbox.app_id = message.app_id
       AND outbox.aggregate_type = 'OPERATIONS_MESSAGE'
       AND outbox.aggregate_id = message.id
       AND outbox.event_type = 'operations.notification_published'
      WHERE message.app_id = campaign.app_id AND message.publication_id = campaign.id
    ) AS outbox_covered_count,
    (SELECT COUNT(*)
      FROM mip_operations_messages message
      INNER JOIN mip_outbox_events outbox
        ON outbox.app_id = message.app_id
       AND outbox.aggregate_type = 'OPERATIONS_MESSAGE'
       AND outbox.aggregate_id = message.id
       AND outbox.event_type = 'operations.notification_published'
      WHERE message.app_id = campaign.app_id AND message.publication_id = campaign.id
    ) AS outbox_count,
    ${reviewSelect()}
   FROM mip_message_campaign_dispatches dispatch
   INNER JOIN mip_message_campaigns campaign
     ON campaign.app_id = dispatch.app_id AND campaign.id = dispatch.campaign_id
   LEFT JOIN mip_message_delivery_reviews review
     ON review.app_id = dispatch.app_id
    AND review.source_type = 'CAMPAIGN_DISPATCH' AND review.source_id = dispatch.id`
}

function deliverySourceSelect() {
  return `SELECT 'DELIVERY_TASK' AS source_type, task.id AS source_id,
    task.channel, task.status AS source_status, task.attempts AS source_attempts,
    task.available_at AS source_available_at,
    task.lease_expires_at AS source_lease_expires_at,
    task.delivered_at AS source_delivered_at,
    task.last_error_code AS source_last_error_code,
    task.last_outcome AS source_last_outcome,
    task.retry_disposition AS source_retry_disposition,
    task.outcome_updated_at AS source_outcome_updated_at,
    task.outcome_updated_at AS source_occurred_at,
    message.target_type, message.target_id,
    (SELECT COUNT(*) FROM mip_notification_grants grant_count
      WHERE grant_count.app_id = task.app_id AND grant_count.status = 'RESERVED'
        AND grant_count.reservation_task_id = task.id) AS reserved_grant_count,
    (SELECT MAX(grant_expiry.reservation_expires_at)
      FROM mip_notification_grants grant_expiry
      WHERE grant_expiry.app_id = task.app_id AND grant_expiry.status = 'RESERVED'
        AND grant_expiry.reservation_task_id = task.id) AS reserved_grant_expires_at,
    ${reviewSelect()}
   FROM mip_delivery_tasks task
   INNER JOIN mip_inbox_messages message
     ON message.app_id = task.app_id AND message.id = task.inbox_message_id
   LEFT JOIN mip_message_delivery_reviews review
     ON review.app_id = task.app_id
    AND review.source_type = 'DELIVERY_TASK' AND review.source_id = task.id`
}

function reviewSelect() {
  return `review.id AS review_id, review.evidence_hash AS review_evidence_hash,
    review.workflow_status AS review_workflow_status,
    review.claimed_by_user_id AS review_claimed_by_user_id,
    review.claimed_at AS review_claimed_at,
    review.claim_expires_at AS review_claim_expires_at,
    review.resolution_code AS review_resolution_code,
    review.resolution_note AS review_resolution_note,
    review.evidence_reference AS review_evidence_reference,
    review.resolved_at AS review_resolved_at,
    review.version AS review_version,
    review.created_at AS review_created_at, review.updated_at AS review_updated_at`
}

function sourceFromRow(row) {
  if (row.source_type === 'CAMPAIGN_DISPATCH') {
    return campaignSource({
      id: row.source_id,
      campaign_id: row.campaign_id,
      status: row.source_status,
      scheduled_for: row.source_scheduled_for,
      available_at: row.source_available_at,
      attempts: row.source_attempts,
      lease_expires_at: row.source_lease_expires_at,
      last_error_code: row.source_last_error_code,
      last_outcome: row.source_last_outcome,
      retry_disposition: row.source_retry_disposition,
      version: row.source_version,
      updated_at: row.source_occurred_at,
    }, {
      id: row.campaign_id,
      scope_type: row.scope_type,
      branch_id: row.branch_id,
      name: row.campaign_name,
      status: row.campaign_status,
      recipient_count: row.recipient_count,
      publish_idempotency_key: row.publish_idempotency_key,
      publish_request_hash: row.publish_request_hash,
      active_dispatch_id: row.active_dispatch_id,
      published_at: row.published_at,
      version: row.campaign_version,
    }, {
      submittedCount: Number(row.submitted_count || 0),
      outboxCoveredCount: Number(row.outbox_covered_count || 0),
      outboxCount: Number(row.outbox_count || 0),
    }, reviewFromRow(row))
  }
  return deliverySource({
    id: row.source_id,
    channel: row.channel,
    status: row.source_status,
    attempts: row.source_attempts,
    available_at: row.source_available_at,
    lease_expires_at: row.source_lease_expires_at,
    delivered_at: row.source_delivered_at,
    last_error_code: row.source_last_error_code,
    last_outcome: row.source_last_outcome,
    retry_disposition: row.source_retry_disposition,
    outcome_updated_at: row.source_outcome_updated_at,
    updated_at: row.source_occurred_at,
  }, Number(row.reserved_grant_count || 0) > 0 ? {
    reservation_expires_at: row.reserved_grant_expires_at,
  } : null, {
    target_type: row.target_type,
    target_id: row.target_id,
  }, reviewFromRow(row))
}

function campaignSource(dispatch, campaign, facts, review) {
  return {
    resourceRef: { type: 'CAMPAIGN_DISPATCH', id: String(dispatch.id) },
    scope: {
      scopeType: campaign.scope_type === 'BRANCH' ? 'BRANCH' : 'PLATFORM',
      scopeId: campaign.scope_type === 'BRANCH' ? campaign.branch_id : null,
    },
    sourceState: {
      status: dispatch.status,
      attempts: Number(dispatch.attempts || 0),
      availableAt: iso(dispatch.available_at),
      leaseExpiresAt: iso(dispatch.lease_expires_at),
      deliveredAt: null,
      lastErrorCode: dispatch.last_error_code || null,
      lastOutcome: dispatch.last_outcome,
      retryDisposition: dispatch.retry_disposition,
      occurredAt: iso(dispatch.updated_at),
    },
    evidence: {
      campaignRef: { type: 'MESSAGE_CAMPAIGN', id: String(campaign.id) },
      campaignName: String(campaign.name || ''),
      campaignStatus: campaign.status,
      recipientCount: Number(campaign.recipient_count || 0),
      submittedCount: facts.submittedCount,
      outboxCoveredCount: facts.outboxCoveredCount,
      outboxCount: facts.outboxCount,
      activeDispatchMatches: campaign.active_dispatch_id === dispatch.id,
    },
    rawDispatch: dispatch,
    rawCampaign: campaign,
    rawFacts: facts,
    review,
  }
}

function deliverySource(task, grant, message, review) {
  const normalized = normalizedDeliveryEvidence({
    source_id: task.id,
    source_status: task.status,
    source_attempts: task.attempts,
    source_available_at: task.available_at,
    source_lease_expires_at: task.lease_expires_at,
    source_delivered_at: task.delivered_at,
    source_last_error_code: task.last_error_code,
    source_last_outcome: task.last_outcome,
    source_retry_disposition: task.retry_disposition,
    source_outcome_updated_at: task.outcome_updated_at,
    reserved_grant_count: grant ? 1 : 0,
    reserved_grant_expires_at: grant?.reservation_expires_at || null,
  })
  return {
    resourceRef: { type: 'DELIVERY_TASK', id: String(task.id) },
    scope: { scopeType: 'PLATFORM', scopeId: null },
    sourceState: {
      status: normalized.status,
      attempts: normalized.attempts,
      availableAt: iso(normalized.availableAt),
      leaseExpiresAt: iso(normalized.leaseExpiresAt),
      deliveredAt: iso(normalized.deliveredAt),
      lastErrorCode: normalized.lastErrorCode,
      lastOutcome: normalized.lastOutcome,
      retryDisposition: normalized.retryDisposition,
      occurredAt: iso(normalized.outcomeUpdatedAt || task.updated_at),
    },
    evidence: {
      channel: task.channel,
      reservedGrantCount: normalized.reservedGrantCount,
      targetRef: safeTargetRef(message.target_type, message.target_id),
    },
    normalizedDeliveryEvidence: normalized,
    review,
  }
}

function reviewFromRow(row) {
  if (!row.review_id) return null
  return {
    id: row.review_id,
    evidence_hash: row.review_evidence_hash,
    workflow_status: row.review_workflow_status,
    claimed_by_user_id: row.review_claimed_by_user_id,
    claimed_at: row.review_claimed_at,
    claim_expires_at: row.review_claim_expires_at,
    resolution_code: row.review_resolution_code,
    resolution_note: row.review_resolution_note,
    evidence_reference: row.review_evidence_reference,
    resolved_at: row.review_resolved_at,
    version: row.review_version,
    created_at: row.review_created_at,
    updated_at: row.review_updated_at,
  }
}

function reviewDto(source, actorUserId, currentTime) {
  const evidence = evidenceRevision(source)
  const classification = classifySource(source, currentTime)
  const workflow = effectiveWorkflow(source.review, evidence, actorUserId, currentTime, {
    reopenResolved: CLAIMABLE_CLASSIFICATIONS.has(classification),
  })
  const reviewConvergence = isReviewAutoConvergence(source, classification)
  return {
    resourceRef: source.resourceRef,
    classification,
    evidenceRevision: evidence,
    sourceState: source.sourceState,
    evidence: source.evidence,
    workflow,
    actions: {
      canClaim: workflow.status === 'OPEN'
        && (CLAIMABLE_CLASSIFICATIONS.has(classification) || reviewConvergence),
      canReconcile: workflow.status === 'CLAIMED' && workflow.claimedByMe
        && (['PROCESSING_STALLED', 'MANUAL_REVIEW'].includes(classification)
          || AUTO_CONVERGED_CLASSIFICATIONS.has(classification)),
      canResolve: workflow.status === 'CLAIMED' && workflow.claimedByMe
        && ['MANUAL_REVIEW', 'TERMINAL_FAILURE'].includes(classification),
    },
  }
}

function isReviewAutoConvergence(source, classification) {
  return Boolean(
    source.review
    && source.review.workflow_status !== 'RESOLVED'
    && AUTO_CONVERGED_CLASSIFICATIONS.has(classification),
  )
}

function effectiveWorkflow(review, currentEvidence, actorUserId, currentTime, options = {}) {
  const version = Number(review?.version || 0)
  const evidenceChanged = review && review.evidence_hash !== currentEvidence
  if (!review || review.workflow_status === 'OPEN'
    || (evidenceChanged
      && (review.workflow_status !== 'RESOLVED' || options.reopenResolved === true))) {
    return {
      status: 'OPEN',
      reviewId: review?.id || null,
      version,
      claim: null,
      resolution: null,
      claimedByMe: false,
    }
  }
  if (review.workflow_status === 'CLAIMED') {
    const expiresAt = new Date(review.claim_expires_at).getTime()
    if (!Number.isFinite(expiresAt) || expiresAt <= currentTime.getTime()) {
      return {
        status: 'OPEN',
        reviewId: review.id,
        version,
        claim: null,
        resolution: null,
        claimedByMe: false,
      }
    }
    return {
      status: 'CLAIMED',
      reviewId: review.id,
      version,
      claim: {
        claimedByMe: review.claimed_by_user_id === actorUserId,
        claimedAt: iso(review.claimed_at),
        expiresAt: iso(review.claim_expires_at),
      },
      resolution: null,
      claimedByMe: review.claimed_by_user_id === actorUserId,
    }
  }
  return {
    status: 'RESOLVED',
    reviewId: review.id,
    version,
    claim: null,
    resolution: {
      code: review.resolution_code,
      note: review.resolution_note || null,
      evidenceReference: review.evidence_reference || null,
      resolvedAt: iso(review.resolved_at),
    },
    claimedByMe: false,
  }
}

function classifySource(source, currentTime) {
  const state = source.sourceState
  if (['COMPLETED', 'DELIVERED'].includes(state.status)) return 'SUCCEEDED'
  if (state.status === 'PROCESSING') {
    const lease = new Date(state.leaseExpiresAt).getTime()
    return Number.isFinite(lease) && lease > currentTime.getTime()
      ? 'PROCESSING_ACTIVE'
      : 'PROCESSING_STALLED'
  }
  if (state.lastOutcome === 'UNKNOWN' || state.retryDisposition === 'MANUAL_REVIEW') {
    return 'MANUAL_REVIEW'
  }
  if (state.status === 'FAILED' && state.retryDisposition === 'RETRIABLE') {
    return 'RETRYABLE_FAILURE'
  }
  if (['FAILED', 'CANCELLED'].includes(state.status)) return 'TERMINAL_FAILURE'
  return 'PENDING'
}

function evidenceRevision(source) {
  if (source.resourceRef.type === 'DELIVERY_TASK') {
    return deliveryEvidenceRevision(source.normalizedDeliveryEvidence)
  }
  return createHash('sha256').update(JSON.stringify([
    source.resourceRef.id,
    source.rawDispatch.campaign_id,
    source.sourceState.status,
    source.sourceState.attempts,
    source.sourceState.availableAt,
    source.sourceState.leaseExpiresAt,
    source.sourceState.lastErrorCode,
    source.sourceState.lastOutcome,
    source.sourceState.retryDisposition,
    Number(source.rawDispatch.version || 0),
    source.sourceState.occurredAt,
    source.rawCampaign.status,
    Number(source.rawCampaign.recipient_count || 0),
    source.rawCampaign.active_dispatch_id || null,
    source.rawCampaign.publish_idempotency_key || null,
    source.rawCampaign.publish_request_hash || null,
    iso(source.rawCampaign.published_at),
    Number(source.rawCampaign.version || 0),
    source.rawFacts.submittedCount,
    source.rawFacts.outboxCoveredCount,
    source.rawFacts.outboxCount,
  ])).digest('hex')
}

function assertClaimedReview(review, input, currentTime, options = {}) {
  if (!review) throw codeError('CLAIM_EXPIRED')
  if (Number(review.version) !== input.reviewVersion) throw codeError('CONFLICT')
  if (review.evidence_hash !== input.evidenceRevision) throw codeError('EVIDENCE_CHANGED')
  if (review.workflow_status !== 'CLAIMED') throw codeError('CLAIM_EXPIRED')
  if (review.claimed_by_user_id !== input.actorUserId) throw codeError('CLAIMED_BY_OTHER')
  const expiresAt = new Date(review.claim_expires_at).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= currentTime.getTime()) {
    throw codeError('CLAIM_EXPIRED')
  }
  if (options.currentEvidence !== undefined
    && options.currentEvidence !== input.evidenceRevision) throw codeError('EVIDENCE_CHANGED')
  return review
}

async function applyReconcileWorkflow(tx, input) {
  const evidence = evidenceRevision(input.source)
  const classification = classifySource(input.source, input.currentTime)
  const converged = AUTO_CONVERGED_CLASSIFICATIONS.has(classification)
  const updated = converged
    ? await tx.query(
        `UPDATE mip_message_delivery_reviews
         SET evidence_hash = ?, workflow_status = 'RESOLVED', claim_expires_at = NULL,
           resolution_code = 'AUTO_CONVERGED', resolution_note = NULL,
           evidence_reference = NULL, resolved_by_user_id = ?, resolved_at = ?,
           version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND workflow_status = 'CLAIMED'
           AND claimed_by_user_id = ?`,
        [evidence, input.actorUserId, input.currentTime, input.appId, input.review.id,
          Number(input.review.version), input.actorUserId],
      )
    : await tx.query(
        `UPDATE mip_message_delivery_reviews
         SET evidence_hash = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND workflow_status = 'CLAIMED'
           AND claimed_by_user_id = ?`,
        [evidence, input.appId, input.review.id, Number(input.review.version), input.actorUserId],
      )
  assertAffected(updated, 'CONFLICT')
}

async function claimOperation(tx, input) {
  try {
    await tx.query(
      `INSERT INTO mip_idempotency_keys (
        id, app_id, actor_user_id, operation, idempotency_key,
        request_hash, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [input.createId(), input.appId, input.actorUserId, input.operation,
        input.idempotencyKey, input.requestHash],
    )
    return { replay: null }
  }
  catch (error) {
    if (!duplicateError(error)) throw error
  }
  return readOperation(tx, input, true)
}

async function readOperation(adapter, input, lock = false) {
  const stored = await adapter.one(
    `SELECT request_hash, status, response_json
     FROM mip_idempotency_keys
     WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
     ${lock ? 'FOR UPDATE' : ''}`,
    [input.appId, input.actorUserId, input.operation, input.idempotencyKey],
  )
  if (!stored) return { replay: null }
  if (stored.request_hash !== input.requestHash) throw codeError('IDEMPOTENCY_CONFLICT')
  if (stored.status !== 'COMPLETED') throw codeError('REQUEST_IN_PROGRESS', true)
  const replay = parseStoredResponse(stored.response_json, input.resourceRef)
  if (!replay) throw codeError('IDEMPOTENCY_CONFLICT')
  return { replay }
}

async function completeOperation(tx, input) {
  const completed = await tx.query(
    `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
     WHERE app_id = ? AND actor_user_id = ? AND operation = ?
       AND idempotency_key = ? AND request_hash = ? AND status = 'RUNNING'`,
    [JSON.stringify(input.response), input.appId, input.actorUserId, input.operation,
      input.idempotencyKey, input.requestHash],
  )
  assertAffected(completed, 'CONFLICT')
}

function parseStoredResponse(value, resourceRef) {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) }
    catch { return null }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.resourceRef?.type !== resourceRef.type
    || parsed.resourceRef?.id !== resourceRef.id
    || !/^[0-9a-f]{64}$/.test(parsed.evidenceRevision || '')) {
    return null
  }
  return parsed
}

function reviewRequestHash(operation, input) {
  const values = [
    operation,
    input.resourceRef.type,
    input.resourceRef.id,
    input.evidenceRevision,
    input.reviewVersion,
  ]
  if (operation === 'resolve') {
    values.push(input.resolutionCode, input.note || null, input.evidenceReference || null)
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}

async function writeReviewAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'ADMIN', ?, ?, ?, 'MESSAGE_DELIVERY_REVIEW', ?, ?, ?)`,
    [audit.appId, audit.actorUserId, audit.scopeType, audit.scopeId || null,
      audit.action, audit.resourceId, audit.effectiveRole || null,
      JSON.stringify(audit.metadata || {})],
  )
}

function safeTargetRef(type, id) {
  const normalizedType = typeof type === 'string' ? type.trim().toUpperCase() : ''
  const normalizedId = typeof id === 'string' ? id.trim() : ''
  if (!['EVENT', 'ORDER', 'OPPORTUNITY', 'USER', 'GROWTH'].includes(normalizedType)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedId)) {
    return null
  }
  return { type: normalizedType, id: normalizedId }
}

function incidentId(resourceRef) {
  return `${resourceRef.type}:${resourceRef.id}`
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function assertAffected(result, code) {
  if (Number(result?.affectedRows) !== 1) throw codeError(code)
}

function duplicateError(error) {
  return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062
}

function codeError(code, retryable = false) {
  const error = new Error(code)
  error.code = code
  error.retryable = retryable
  return error
}

module.exports = {
  AUTO_CONVERGED_CLASSIFICATIONS,
  CLAIM_LEASE_MS,
  LIST_SCAN_BATCH_SIZE,
  REVIEW_OPERATIONS,
  campaignSource,
  classifySource,
  createMessageDeliveryReviewRepository,
  deliverySource,
  deliveryEvidenceRevision: evidenceRevision,
  effectiveWorkflow,
  matchesWorkflowFilter,
  reviewDto,
  reviewRequestHash,
}
