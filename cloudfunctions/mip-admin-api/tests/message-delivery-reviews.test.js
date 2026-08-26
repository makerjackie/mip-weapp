'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { describe, it } = require('node:test')
const { CAPABILITIES } = require('../domain/capabilities')
const {
  deliveryEvidenceRevision,
  normalizedDeliveryEvidence,
} = require('../domain/delivery-evidence')
const { createAdminMessageDeliveryReviews } = require('../domain/message-delivery-review-service')
const {
  campaignSource,
  createMessageDeliveryReviewRepository,
  deliverySource,
  deliveryEvidenceRevision: reviewEvidenceRevision,
  effectiveWorkflow,
  LIST_SCAN_BATCH_SIZE,
  matchesWorkflowFilter,
  reviewDto,
} = require('../domain/message-delivery-reviews')
const {
  normalizeReviewListInput,
  normalizeReviewResolveInput,
} = require('../domain/message-delivery-review-validation')
const { encodeCursor } = require('../domain/pagination')
const { createNotificationReconcileClient } = require('../lib/notification-reconcile-client')
const workerEvidence = require('../../mip-notification-worker/domain/delivery-evidence')
const { verifyInternalEvent } = require('../../mip-notification-worker/lib/internal-auth')

const APP_ID = 'wx-message-delivery-review'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_ID = '10000000-0000-4000-8000-000000000002'
const CURRENT_TIME = new Date('2030-08-25T10:00:00.000Z')
const SECRET = 'notification-review-secret-at-least-32-bytes'

describe('message delivery review contract', () => {
  it('keeps the detail DTO limited to safe operational evidence', () => {
    const source = deliverySource({
      id: idFor(900),
      channel: 'WECHAT_SUBSCRIPTION',
      status: 'CANCELLED',
      attempts: 1,
      available_at: null,
      lease_expires_at: null,
      delivered_at: null,
      last_error_code: 'DELIVERY_OUTCOME_UNKNOWN',
      last_outcome: 'UNKNOWN',
      retry_disposition: 'MANUAL_REVIEW',
      outcome_updated_at: CURRENT_TIME,
      updated_at: CURRENT_TIME,
    }, null, {
      target_type: 'USER',
      target_id: idFor(901),
    }, null)
    const dto = reviewDto(source, ACTOR_ID, CURRENT_TIME)
    const serialized = JSON.stringify(dto).toLowerCase()
    for (const forbidden of ['openid', 'phone', 'ciphertext', 'provider', 'payload']) {
      assert.equal(serialized.includes(forbidden), false)
    }
    assert.deepEqual(Object.keys(dto), [
      'resourceRef',
      'classification',
      'evidenceRevision',
      'sourceState',
      'evidence',
      'workflow',
      'actions',
    ])
    assert.deepEqual(dto.evidence, {
      channel: 'WECHAT_SUBSCRIPTION',
      reservedGrantCount: 0,
      targetRef: { type: 'USER', id: idFor(901) },
    })
  })

  it('defaults lists to active workflow, validates explicit history, and requires an unknown note', () => {
    assert.deepEqual(normalizeReviewListInput({}), {
      sourceType: null,
      workflowStatus: 'ACTIVE',
      cursor: null,
      limit: 20,
    })
    assert.equal(normalizeReviewListInput({ workflowStatus: 'RESOLVED' }).workflowStatus, 'RESOLVED')
    assert.throws(
      () => normalizeReviewListInput({ workflowStatus: 'CLOSED' }),
      error => error.code === 'VALIDATION_FAILED',
    )
    assert.throws(() => normalizeReviewResolveInput({
      resourceRef: { type: 'DELIVERY_TASK', id: idFor(1) },
      evidenceRevision: 'a'.repeat(64),
      reviewVersion: 1,
      resolutionCode: 'UNKNOWN_NO_REPLAY',
      note: '',
      idempotencyKey: 'review-resolve-0001',
    }), error => error.code === 'VALIDATION_FAILED')
  })

  it('requires the dedicated platform capability and decodes the stable cursor before repository access', async () => {
    const calls = []
    const audits = []
    const access = accessFixture('PLATFORM_OPERATIONS', audits)
    const service = createAdminMessageDeliveryReviews({
      access,
      now: () => CURRENT_TIME,
      repository: {
        async listMessageDeliveryReviews(input) {
          calls.push(input)
          return { items: [], nextCursor: null }
        },
        async recordAudit(audit) { audits.push(audit) },
      },
    })
    const cursor = encodeCursor({ occurredAt: CURRENT_TIME.toISOString(), id: `DELIVERY_TASK:${idFor(1)}` })
    await service.listMessageDeliveryReviews({ appId: APP_ID }, {
      workflowStatus: 'RESOLVED',
      cursor,
      limit: 5,
    })
    assert.deepEqual(calls[0].cursor, {
      v: 1,
      occurredAt: CURRENT_TIME.toISOString(),
      id: `DELIVERY_TASK:${idFor(1)}`,
    })
    assert.equal(calls[0].workflowStatus, 'RESOLVED')
    assert.equal(audits.at(-1).metadata.workflowStatus, 'RESOLVED')

    const finance = createAdminMessageDeliveryReviews({
      access: accessFixture('PLATFORM_FINANCE', []),
      repository: { async listMessageDeliveryReviews() { throw new Error('must not read') } },
    })
    await assert.rejects(
      finance.listMessageDeliveryReviews({ appId: APP_ID }, {}),
      error => error.code === 'FORBIDDEN',
    )
    assert.equal(CAPABILITIES.MESSAGES_DELIVERY_REVIEW, 'messages.delivery.review')
  })

  it('uses four fixed candidate branches with bound source, workflow, and cursor controls', async () => {
    const repositorySource = readFileSync(require.resolve('../domain/message-delivery-reviews'), 'utf8')
    assert.doesNotMatch(repositorySource, /\$\{selections\.join\(/)

    for (const [sourceType, workflowStatus, controls, cursor = null] of [
      [null, 'ACTIVE', [1, 1, 1, 1]],
      [null, 'RESOLVED', [0, 1, 0, 1]],
      [null, 'ALL', [1, 1, 1, 1]],
      ['CAMPAIGN_DISPATCH', 'ACTIVE', [1, 1, 0, 0]],
      ['CAMPAIGN_DISPATCH', 'RESOLVED', [0, 1, 0, 0]],
      ['CAMPAIGN_DISPATCH', 'ALL', [1, 1, 0, 0]],
      ['DELIVERY_TASK', 'ACTIVE', [0, 0, 1, 1]],
      ['DELIVERY_TASK', 'RESOLVED', [0, 0, 0, 1], {
        occurredAt: CURRENT_TIME,
        id: `DELIVERY_TASK:${idFor(1)}`,
      }],
      ['DELIVERY_TASK', 'ALL', [0, 0, 1, 1]],
    ]) {
      let candidateCall
      const repository = createMessageDeliveryReviewRepository({
        async query(sql, params) {
          candidateCall = { sql, params }
          return []
        },
      }, {
        lockMutationAuthorization() {},
        assertMutationScope() {},
        now: () => CURRENT_TIME,
      })

      await repository.listMessageDeliveryReviews({
        appId: APP_ID,
        actorUserId: ACTOR_ID,
        sourceType,
        workflowStatus,
        cursor,
        limit: 20,
        now: CURRENT_TIME,
      })

      assert.equal(candidateCall.sql.match(/\bUNION\b/g).length, 3)
      assert.match(candidateCall.sql, /SELECT 'CAMPAIGN_DISPATCH' AS source_type/)
      assert.match(candidateCall.sql, /SELECT review\.source_type, review\.source_id, dispatch\.updated_at/)
      assert.match(candidateCall.sql, /SELECT 'DELIVERY_TASK' AS source_type/)
      assert.match(candidateCall.sql, /SELECT review\.source_type, review\.source_id, task\.outcome_updated_at/)
      assert.deepEqual([0, 3, 6, 9].map(index => candidateCall.params[index]), Array(4).fill(APP_ID))
      assert.deepEqual([candidateCall.params[1], candidateCall.params[7]], [CURRENT_TIME, CURRENT_TIME])
      assert.deepEqual([2, 4, 8, 10].map(index => candidateCall.params[index]), controls)
      assert.deepEqual([candidateCall.params[5], candidateCall.params[11]], [
        workflowStatus,
        workflowStatus,
      ])
      if (cursor) {
        assert.match(candidateCall.sql, /WHERE \(occurred_at < \? OR \(occurred_at = \? AND incident_id < \?\)\)/)
        assert.deepEqual(candidateCall.params.slice(-4), [
          cursor.occurredAt,
          cursor.occurredAt,
          cursor.id,
          LIST_SCAN_BATCH_SIZE,
        ])
      }
      else {
        assert.doesNotMatch(candidateCall.sql, /WHERE \(occurred_at < \?/)
        assert.equal(candidateCall.params.at(-1), LIST_SCAN_BATCH_SIZE)
      }
    }
  })

  it('uses queue-prefixed incident ids for a shared cursor without widening each scan batch', async () => {
    let candidateCall
    const repository = createMessageDeliveryReviewRepository({
      async query(sql, params) {
        candidateCall = { sql, params }
        return []
      },
    }, {
      lockMutationAuthorization() {},
      assertMutationScope() {},
      now: () => CURRENT_TIME,
    })

    const cursor = {
      occurredAt: CURRENT_TIME,
      id: `DELIVERY_REVIEW:CAMPAIGN_DISPATCH:${idFor(20)}`,
    }
    await repository.listMessageDeliveryReviews({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      workflowStatus: 'ACTIVE',
      cursor,
      queueCursor: true,
      limit: 20,
      now: CURRENT_TIME,
    })

    assert.match(candidateCall.sql, /CONCAT\('DELIVERY_REVIEW:CAMPAIGN_DISPATCH:', dispatch\.id\) AS incident_id/)
    assert.match(candidateCall.sql, /WHERE \(occurred_at < \? OR \(occurred_at = \? AND incident_id < \?\)\)/)
    assert.deepEqual(candidateCall.params.slice(-4), [
      cursor.occurredAt,
      cursor.occurredAt,
      cursor.id,
      LIST_SCAN_BATCH_SIZE,
    ])
  })

  it('uses bulk evidence reads, excludes unchanged resolved history, and reopens changed evidence', async () => {
    const candidates = Array.from({ length: 52 }, (_, index) => ({
      source_type: 'DELIVERY_TASK',
      source_id: idFor(index + 1),
      occurred_at: new Date(CURRENT_TIME.getTime() - index * 1_000),
      incident_id: `DELIVERY_TASK:${idFor(index + 1)}`,
    }))
    const rows = new Map(candidates.map((candidate, index) => {
      const row = deliveryRow(candidate, index < 50)
      if (index === 10) row.review_evidence_hash = 'f'.repeat(64)
      return [candidate.source_id, row]
    }))
    const candidateCalls = []
    const database = {
      async query(sql, params) {
        if (sql.includes('FROM (')) {
          candidateCalls.push(params)
          return candidateCalls.length === 1 ? candidates.slice(0, 50) : candidates.slice(50)
        }
        if (sql.includes('FROM mip_delivery_tasks task')) {
          return params.slice(1).map(id => rows.get(id))
        }
        throw new Error(`Unexpected SQL: ${sql.slice(0, 60)}`)
      },
    }
    const repository = createMessageDeliveryReviewRepository(database, {
      lockMutationAuthorization() {},
      assertMutationScope() {},
      now: () => CURRENT_TIME,
    })
    const page = await repository.listMessageDeliveryReviews({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      sourceType: 'DELIVERY_TASK',
      workflowStatus: 'ACTIVE',
      cursor: null,
      limit: 1,
      now: CURRENT_TIME,
    })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].resourceRef.id, idFor(11))
    assert.equal(page.items[0].workflow.status, 'OPEN')
    assert.equal(typeof page.nextCursor, 'string')
    assert.equal(candidateCalls.length, 2)
    assert.deepEqual(candidateCalls[1].slice(-4, -1), [
      candidates[49].occurred_at,
      candidates[49].occurred_at,
      candidates[49].incident_id,
    ])

    assert.equal(matchesWorkflowFilter('RESOLVED', 'ACTIVE'), false)
    assert.equal(matchesWorkflowFilter('RESOLVED', 'RESOLVED'), true)
    assert.equal(matchesWorkflowFilter('OPEN', 'ALL'), true)
  })

  it('keeps converged delivery facts in explicit resolved history through review-driven candidates', async () => {
    const candidate = {
      source_type: 'DELIVERY_TASK',
      source_id: idFor(70),
      occurred_at: CURRENT_TIME,
      incident_id: `DELIVERY_TASK:${idFor(70)}`,
    }
    const row = deliveryRow(candidate, true)
    Object.assign(row, {
      source_status: 'DELIVERED',
      source_delivered_at: CURRENT_TIME,
      source_last_error_code: null,
      source_last_outcome: 'SUCCEEDED',
      source_retry_disposition: 'TERMINAL',
      review_resolution_code: 'AUTO_CONVERGED',
      review_resolution_note: null,
    })
    row.review_evidence_hash = deliveryEvidenceRevision(normalizedDeliveryEvidence(row))
    const candidateSql = []
    const repository = createMessageDeliveryReviewRepository({
      async query(sql) {
        if (sql.includes('FROM (')) {
          candidateSql.push(sql)
          return [candidate]
        }
        if (sql.includes('FROM mip_delivery_tasks task')) return [row]
        throw new Error(`Unexpected SQL: ${sql.slice(0, 60)}`)
      },
    }, {
      lockMutationAuthorization() {},
      assertMutationScope() {},
      now: () => CURRENT_TIME,
    })
    const page = await repository.listMessageDeliveryReviews({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      sourceType: 'DELIVERY_TASK',
      workflowStatus: 'RESOLVED',
      cursor: null,
      limit: 20,
      now: CURRENT_TIME,
    })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].classification, 'SUCCEEDED')
    assert.equal(page.items[0].workflow.status, 'RESOLVED')
    assert.match(candidateSql[0], /FROM mip_message_delivery_reviews review/)
    assert.match(candidateSql[0], /review\.workflow_status = 'RESOLVED'/)
    assert.doesNotMatch(candidateSql[0], /task\.status IN \('PROCESSING', 'FAILED'\)/)
  })

  it('keeps a resolved review closed when its source later reaches a benign success state', async () => {
    const candidate = {
      source_type: 'DELIVERY_TASK',
      source_id: idFor(72),
      occurred_at: CURRENT_TIME,
      incident_id: `DELIVERY_TASK:${idFor(72)}`,
    }
    const row = deliveryRow(candidate, true)
    Object.assign(row, {
      source_status: 'DELIVERED',
      source_delivered_at: CURRENT_TIME,
      source_last_error_code: null,
      source_last_outcome: 'SUCCEEDED',
      source_retry_disposition: 'TERMINAL',
      review_evidence_hash: '0'.repeat(64),
    })
    let candidateQuery = ''
    const repository = createMessageDeliveryReviewRepository({
      async query(sql) {
        if (sql.includes('FROM (')) {
          candidateQuery = sql
          return [candidate]
        }
        if (sql.includes('FROM mip_delivery_tasks task')) return [row]
        throw new Error(`Unexpected SQL: ${sql.slice(0, 60)}`)
      },
    }, {
      lockMutationAuthorization() {},
      assertMutationScope() {},
      now: () => CURRENT_TIME,
    })
    const page = await repository.listMessageDeliveryReviews({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      sourceType: 'DELIVERY_TASK',
      workflowStatus: 'RESOLVED',
      cursor: null,
      limit: 20,
      now: CURRENT_TIME,
    })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].classification, 'SUCCEEDED')
    assert.equal(page.items[0].workflow.status, 'RESOLVED')
    assert.equal(page.items[0].actions.canClaim, false)
    assert.match(candidateQuery, /review\.workflow_status = 'RESOLVED'/)
  })

  it('reopens a resolved review only when changed evidence is currently actionable', async () => {
    const candidate = {
      source_type: 'DELIVERY_TASK',
      source_id: idFor(73),
      occurred_at: CURRENT_TIME,
      incident_id: `DELIVERY_TASK:${idFor(73)}`,
    }
    const row = deliveryRow(candidate, true)
    row.review_evidence_hash = '0'.repeat(64)
    row.review_updated_at = new Date(CURRENT_TIME.getTime() - 1_000)
    let candidateQuery = ''
    const repository = createMessageDeliveryReviewRepository({
      async query(sql) {
        if (sql.includes('FROM (')) {
          candidateQuery = sql
          return [candidate]
        }
        if (sql.includes('FROM mip_delivery_tasks task')) return [row]
        throw new Error(`Unexpected SQL: ${sql.slice(0, 60)}`)
      },
    }, {
      lockMutationAuthorization() {},
      assertMutationScope() {},
      now: () => CURRENT_TIME,
    })
    const page = await repository.listMessageDeliveryReviews({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      sourceType: 'DELIVERY_TASK',
      workflowStatus: 'ACTIVE',
      cursor: null,
      limit: 20,
      now: CURRENT_TIME,
    })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].classification, 'MANUAL_REVIEW')
    assert.equal(page.items[0].workflow.status, 'OPEN')
    assert.equal(page.items[0].actions.canClaim, true)
    assert.match(candidateQuery, /task\.outcome_updated_at > review\.updated_at/)
    assert.match(candidateQuery, /review\.workflow_status <> 'RESOLVED'/)
    assert.match(candidateQuery, /task\.lease_expires_at <= \?/)
  })

  it('reopens changed reviews that already converged and keeps fresh retryable work out of review', async () => {
    const { dispatch, campaign, facts } = completedCampaignFacts()
    const staleReview = claimedReview('0'.repeat(64))
    const campaignRecord = campaignSource(dispatch, campaign, facts, staleReview)
    const staleCampaign = reviewDto(campaignRecord, ACTOR_ID, CURRENT_TIME)
    assert.equal(staleCampaign.classification, 'SUCCEEDED')
    assert.equal(staleCampaign.workflow.status, 'OPEN')
    assert.equal(staleCampaign.actions.canClaim, true)
    campaignRecord.review = claimedReview(staleCampaign.evidenceRevision)
    assert.equal(reviewDto(campaignRecord, ACTOR_ID, CURRENT_TIME).actions.canReconcile, true)

    const task = completedDeliveryTask()
    const deliveryRecord = deliverySource(task, null, { target_type: 'EVENT', target_id: idFor(800) }, staleReview)
    const staleDelivery = reviewDto(deliveryRecord, ACTOR_ID, CURRENT_TIME)
    assert.equal(staleDelivery.classification, 'SUCCEEDED')
    assert.equal(staleDelivery.workflow.status, 'OPEN')
    assert.equal(staleDelivery.actions.canClaim, true)
    deliveryRecord.review = claimedReview(staleDelivery.evidenceRevision)
    assert.equal(reviewDto(deliveryRecord, ACTOR_ID, CURRENT_TIME).actions.canReconcile, true)

    const candidate = {
      source_type: 'DELIVERY_TASK',
      source_id: idFor(71),
      occurred_at: CURRENT_TIME,
      incident_id: `DELIVERY_TASK:${idFor(71)}`,
    }
    const retryable = deliveryRow(candidate, false)
    Object.assign(retryable, {
      source_status: 'FAILED',
      source_last_error_code: 'WECHAT_BUSY',
      source_last_outcome: 'KNOWN_FAILED',
      source_retry_disposition: 'RETRIABLE',
    })
    let retryableCandidateQuery = ''
    const repository = createMessageDeliveryReviewRepository({
      async query(sql) {
        if (sql.includes('FROM (')) {
          retryableCandidateQuery = sql
          return [candidate]
        }
        if (sql.includes('FROM mip_delivery_tasks task')) return [retryable]
        throw new Error(`Unexpected SQL: ${sql.slice(0, 60)}`)
      },
    }, {
      lockMutationAuthorization() {},
      assertMutationScope() {},
      now: () => CURRENT_TIME,
    })
    const page = await repository.listMessageDeliveryReviews({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      sourceType: 'DELIVERY_TASK',
      workflowStatus: 'ACTIVE',
      cursor: null,
      limit: 20,
      now: CURRENT_TIME,
    })
    assert.deepEqual(page, { items: [], nextCursor: null })
    assert.match(retryableCandidateQuery, /task\.retry_disposition IN \('MANUAL_REVIEW', 'TERMINAL'\)/)
    assert.doesNotMatch(retryableCandidateQuery, /task\.status IN \('PROCESSING', 'FAILED'\)/)
  })

  it('reclaims expired success and retryable reviews before auto-converging without business writes', async () => {
    for (const scenario of [
      { ...completedCampaignFacts(), expectedEffect: 'CONFIRMED', key: 'success' },
      { ...retryableCampaignFacts(), expectedEffect: 'RETRYABLE_UNCHANGED', key: 'retryable' },
    ]) {
      const outcome = await autoConvergeCampaignScenario(scenario)
      assert.equal(outcome.claimed.workflow.status, 'CLAIMED')
      assert.equal(outcome.claimed.actions.canReconcile, true)
      assert.equal(outcome.result.workflow.status, 'RESOLVED')
      assert.equal(outcome.result.workflow.resolution.code, 'AUTO_CONVERGED')
      assert.equal(outcome.result.reconcileEffect, scenario.expectedEffect)
      assert.equal(outcome.result.schedulerReconcileRequired, false)
      assert.equal(outcome.businessMutationCount, 0)
    }
  })

  it('treats evidence changes and expired claims as open without mutating business facts', () => {
    const activeClaim = {
      id: idFor(100),
      evidence_hash: 'a'.repeat(64),
      workflow_status: 'CLAIMED',
      claimed_by_user_id: ACTOR_ID,
      claimed_at: new Date(CURRENT_TIME.getTime() - 1_000),
      claim_expires_at: new Date(CURRENT_TIME.getTime() + 60_000),
      version: 3,
    }
    assert.equal(effectiveWorkflow(activeClaim, 'a'.repeat(64), ACTOR_ID, CURRENT_TIME).claimedByMe, true)
    assert.equal(effectiveWorkflow(activeClaim, 'b'.repeat(64), ACTOR_ID, CURRENT_TIME).status, 'OPEN')
    assert.equal(effectiveWorkflow({
      ...activeClaim,
      claimed_by_user_id: OTHER_ID,
      claim_expires_at: new Date(CURRENT_TIME.getTime() - 1),
    }, 'a'.repeat(64), ACTOR_ID, CURRENT_TIME).status, 'OPEN')
  })

  it('signs the complete worker reconcile body and rejects tampering', async () => {
    let signed
    const client = createNotificationReconcileClient({
      cloud: {
        async callFunction(input) {
          signed = input.data
          const verified = verifyInternalEvent(input.data, {
            secret: SECRET,
            now: CURRENT_TIME.getTime(),
            allowedAppIds: new Set([APP_ID]),
          })
          assert.equal(verified.actorUserId, ACTOR_ID)
          return { result: { ok: true, data: workerResult(idFor(1)) } }
        },
      },
      functionName: 'mip-notification-worker',
      secret: SECRET,
      now: () => CURRENT_TIME.getTime(),
    })
    const result = await client.reconcile({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      taskId: idFor(1),
      expectedEvidenceRevision: 'a'.repeat(64),
      idempotencyKey: 'review-reconcile-0001',
    })
    assert.equal(result.effect, 'UNCHANGED')
    assert.throws(() => verifyInternalEvent({ ...signed, taskId: idFor(2) }, {
      secret: SECRET,
      now: CURRENT_TIME.getTime(),
      allowedAppIds: new Set([APP_ID]),
    }), /FORBIDDEN/)
  })

  it('keeps admin and worker delivery evidence revisions identical', () => {
    const task = {
      id: idFor(1),
      status: 'PROCESSING',
      attempts: 3,
      available_at: new Date('2030-08-25T09:55:00.000Z'),
      lease_expires_at: new Date('2030-08-25T09:59:00.000Z'),
      delivered_at: null,
      last_error_code: 'DELIVERY_OUTCOME_UNKNOWN',
      last_outcome: 'UNKNOWN',
      retry_disposition: 'MANUAL_REVIEW',
      outcome_updated_at: new Date('2030-08-25T09:59:30.000Z'),
    }
    const grant = { reservation_expires_at: new Date('2030-08-25T10:01:00.000Z') }
    const adminRow = {
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
      reserved_grant_count: 1,
      reserved_grant_expires_at: grant.reservation_expires_at,
    }
    assert.equal(
      deliveryEvidenceRevision(normalizedDeliveryEvidence(adminRow)),
      workerEvidence.deliveryEvidenceRevision(workerEvidence.normalizedDeliveryEvidence(task, grant)),
    )
  })

  it('keeps the worker call between durable preflight and completion and preserves retry codes', async () => {
    const order = []
    const item = reviewItem()
    const service = createAdminMessageDeliveryReviews({
      access: accessFixture('PLATFORM_OPERATIONS', []),
      repository: {
        async prepareDeliveryTaskReconcile(input) {
          order.push('prepare')
          return {
            replay: null,
            workerInput: {
              appId: input.appId,
              actorUserId: input.actorUserId,
              taskId: input.resourceRef.id,
              expectedEvidenceRevision: input.evidenceRevision,
              idempotencyKey: input.idempotencyKey,
            },
          }
        },
        async completeDeliveryTaskReconcile(input) {
          order.push('complete')
          assert.equal(input.workerResult.effect, 'UNCHANGED')
          return item
        },
      },
      async reconcileNotificationDelivery(input) {
        order.push('worker')
        return workerResult(input.taskId)
      },
      now: () => CURRENT_TIME,
    })
    const result = await service.reconcileMessageDeliveryReview({ appId: APP_ID }, mutationInput())
    assert.equal(result.resourceRef.id, idFor(1))
    assert.deepEqual(order, ['prepare', 'worker', 'complete'])

    const unavailable = createAdminMessageDeliveryReviews({
      access: accessFixture('PLATFORM_OPERATIONS', []),
      repository: {
        async prepareDeliveryTaskReconcile() { return { replay: null, workerInput: {} } },
      },
      async reconcileNotificationDelivery() {
        const error = new Error('REQUEST_IN_PROGRESS')
        error.code = 'REQUEST_IN_PROGRESS'
        error.retryable = true
        throw error
      },
    })
    await assert.rejects(
      unavailable.reconcileMessageDeliveryReview({ appId: APP_ID }, mutationInput()),
      error => error.code === 'REQUEST_IN_PROGRESS' && error.retryable === true,
    )
  })
})

function accessFixture(roleKey, audits) {
  const grant = { roleKey, scopeType: 'PLATFORM', scopeId: null }
  return {
    async session() {
      return {
        caller: { appId: APP_ID, userId: ACTOR_ID },
        bindings: [grant],
      }
    },
    mutationAuthorization(_grant, capability) { return { capability } },
    audit(_context, _grant, input) {
      return { appId: APP_ID, actorUserId: ACTOR_ID, effectiveRole: roleKey, ...input }
    },
    recordAudit(value) { audits.push(value) },
  }
}

function idFor(value) {
  return `90000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

function deliveryRow(candidate, resolved) {
  const row = {
    source_type: 'DELIVERY_TASK',
    source_id: candidate.source_id,
    channel: 'WECHAT_SUBSCRIPTION',
    source_status: 'CANCELLED',
    source_attempts: 1,
    source_available_at: candidate.occurred_at,
    source_lease_expires_at: null,
    source_delivered_at: null,
    source_last_error_code: 'DELIVERY_OUTCOME_UNKNOWN',
    source_last_outcome: 'UNKNOWN',
    source_retry_disposition: 'MANUAL_REVIEW',
    source_outcome_updated_at: candidate.occurred_at,
    source_occurred_at: candidate.occurred_at,
    target_type: 'EVENT',
    target_id: idFor(800),
    reserved_grant_count: 0,
    reserved_grant_expires_at: null,
    review_id: resolved ? idFor(500 + Number(candidate.source_id.slice(-3))) : null,
    review_evidence_hash: null,
    review_workflow_status: resolved ? 'RESOLVED' : null,
    review_claimed_by_user_id: resolved ? ACTOR_ID : null,
    review_claimed_at: resolved ? candidate.occurred_at : null,
    review_claim_expires_at: null,
    review_resolution_code: resolved ? 'UNKNOWN_NO_REPLAY' : null,
    review_resolution_note: resolved ? '已核对供应商记录' : null,
    review_evidence_reference: null,
    review_resolved_at: resolved ? candidate.occurred_at : null,
    review_version: resolved ? 2 : null,
    review_created_at: candidate.occurred_at,
    review_updated_at: candidate.occurred_at,
  }
  if (resolved) {
    row.review_evidence_hash = deliveryEvidenceRevision(normalizedDeliveryEvidence(row))
  }
  return row
}

function mutationInput() {
  return {
    resourceRef: { type: 'DELIVERY_TASK', id: idFor(1) },
    evidenceRevision: 'a'.repeat(64),
    reviewVersion: 1,
    idempotencyKey: 'review-reconcile-0001',
  }
}

function workerResult(taskId) {
  return {
    taskId,
    effect: 'UNCHANGED',
    beforeEvidenceRevision: 'a'.repeat(64),
    afterEvidenceRevision: 'a'.repeat(64),
    source: { status: 'CANCELLED' },
  }
}

function claimedReview(evidenceHash) {
  return {
    id: idFor(600),
    evidence_hash: evidenceHash,
    workflow_status: 'CLAIMED',
    claimed_by_user_id: ACTOR_ID,
    claimed_at: new Date(CURRENT_TIME.getTime() - 1_000),
    claim_expires_at: new Date(CURRENT_TIME.getTime() + 60_000),
    resolution_code: null,
    resolution_note: null,
    evidence_reference: null,
    resolved_at: null,
    version: 2,
  }
}

async function autoConvergeCampaignScenario(scenario) {
  const { dispatch, campaign, facts } = scenario
  const source = campaignSource(dispatch, campaign, facts, null)
  const currentEvidence = reviewEvidenceRevision(source)
  let review = {
    ...claimedReview(currentEvidence),
    claim_expires_at: new Date(CURRENT_TIME.getTime() - 1),
  }
  let businessMutationCount = 0
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_message_campaign_dispatches')) return dispatch
      if (sql.includes('FROM mip_message_campaigns')) return campaign
      if (sql.includes('FROM mip_operations_messages')) {
        return {
          submitted_count: facts.submittedCount,
          outbox_covered_count: facts.outboxCoveredCount,
          outbox_count: facts.outboxCount,
        }
      }
      if (sql.includes('FROM mip_message_delivery_reviews')) return review
      throw new Error(`Unexpected SQL: ${sql.slice(0, 60)}`)
    },
    async query(sql) {
      if (sql.includes('INSERT INTO mip_idempotency_keys')) return { affectedRows: 1 }
      if (sql.includes('SET scope_type = ?, scope_id = ?, evidence_hash = ?')) {
        review = {
          ...review,
          evidence_hash: currentEvidence,
          workflow_status: 'CLAIMED',
          claimed_by_user_id: ACTOR_ID,
          claimed_at: CURRENT_TIME,
          claim_expires_at: new Date(CURRENT_TIME.getTime() + 15 * 60 * 1_000),
          resolution_code: null,
          resolution_note: null,
          evidence_reference: null,
          resolved_at: null,
          version: review.version + 1,
        }
        return { affectedRows: 1 }
      }
      if (sql.includes("resolution_code = 'AUTO_CONVERGED'")) {
        review = {
          ...review,
          evidence_hash: currentEvidence,
          workflow_status: 'RESOLVED',
          claim_expires_at: null,
          resolution_code: 'AUTO_CONVERGED',
          resolution_note: null,
          evidence_reference: null,
          resolved_at: CURRENT_TIME,
          version: review.version + 1,
        }
        return { affectedRows: 1 }
      }
      if (/UPDATE mip_message_(campaigns|campaign_dispatches)/.test(sql)) businessMutationCount += 1
      if (sql.includes('INSERT INTO mip_audit_logs') || sql.includes('UPDATE mip_idempotency_keys')) {
        return { affectedRows: 1 }
      }
      throw new Error(`Unexpected SQL: ${sql.slice(0, 60)}`)
    },
  }
  const repository = createMessageDeliveryReviewRepository({
    async transaction(work) { return work(tx) },
  }, {
    createId: () => idFor(990),
    async lockMutationAuthorization() { return { scopeType: 'PLATFORM', scopeId: null } },
    assertMutationScope() {},
    now: () => CURRENT_TIME,
  })
  const mutationBase = {
    appId: APP_ID,
    actorUserId: ACTOR_ID,
    resourceRef: { type: 'CAMPAIGN_DISPATCH', id: dispatch.id },
    evidenceRevision: currentEvidence,
    authorization: { capability: 'messages.delivery.review' },
    audit: resourceId => ({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'PLATFORM',
      scopeId: null,
      resourceId,
    }),
  }
  const claimed = await repository.claimMessageDeliveryReview({
    ...mutationBase,
    reviewVersion: review.version,
    idempotencyKey: `review-converged-${scenario.key}-claim-001`,
  })
  const result = await repository.reconcileCampaignDeliveryReview({
    ...mutationBase,
    reviewVersion: claimed.workflow.version,
    idempotencyKey: `review-converged-${scenario.key}-001`,
  })
  return { claimed, result, businessMutationCount }
}

function completedCampaignFacts() {
  const dispatch = {
    id: idFor(720),
    campaign_id: idFor(721),
    scheduled_by_user_id: ACTOR_ID,
    status: 'COMPLETED',
    scheduled_for: new Date(CURRENT_TIME.getTime() - 60_000),
    available_at: new Date(CURRENT_TIME.getTime() - 60_000),
    attempts: 1,
    lease_token: null,
    lease_expires_at: null,
    last_error_code: null,
    last_outcome: 'SUCCEEDED',
    retry_disposition: 'TERMINAL',
    version: 4,
    updated_at: CURRENT_TIME,
  }
  return {
    dispatch,
    campaign: {
      id: dispatch.campaign_id,
      scope_type: 'PLATFORM',
      branch_id: null,
      name: '交付复核测试活动',
      status: 'PUBLISHED',
      recipient_count: 1,
      publish_idempotency_key: 'campaign-publish-001',
      publish_request_hash: 'a'.repeat(64),
      active_dispatch_id: dispatch.id,
      published_at: CURRENT_TIME,
      version: 5,
    },
    facts: {
      submittedCount: 1,
      outboxCoveredCount: 1,
      outboxCount: 1,
    },
  }
}

function retryableCampaignFacts() {
  const completed = completedCampaignFacts()
  return {
    dispatch: {
      ...completed.dispatch,
      status: 'FAILED',
      attempts: 2,
      last_error_code: 'MESSAGE_SCHEDULE_LEASE_EXPIRED',
      last_outcome: 'NOT_ATTEMPTED',
      retry_disposition: 'RETRIABLE',
    },
    campaign: {
      ...completed.campaign,
      status: 'READY',
      recipient_count: 1,
      publish_idempotency_key: null,
      publish_request_hash: null,
      published_at: null,
    },
    facts: { submittedCount: 0, outboxCoveredCount: 0, outboxCount: 0 },
  }
}

function completedDeliveryTask() {
  return {
    id: idFor(730),
    channel: 'WECHAT_SUBSCRIPTION',
    status: 'DELIVERED',
    attempts: 1,
    available_at: new Date(CURRENT_TIME.getTime() - 60_000),
    lease_expires_at: null,
    delivered_at: CURRENT_TIME,
    last_error_code: null,
    last_outcome: 'SUCCEEDED',
    retry_disposition: 'TERMINAL',
    outcome_updated_at: CURRENT_TIME,
    updated_at: CURRENT_TIME,
  }
}

function reviewItem() {
  return {
    resourceRef: { type: 'DELIVERY_TASK', id: idFor(1) },
    evidenceRevision: 'a'.repeat(64),
  }
}
