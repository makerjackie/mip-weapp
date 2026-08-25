'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  deliveryEvidenceRevision,
  normalizedDeliveryEvidence,
} = require('../domain/delivery-evidence')
const { createNotificationRepository } = require('../domain/repository')
const { createNotificationService } = require('../domain/service')

const APP_ID = 'wx-delivery-review'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const TASK_ID = '20000000-0000-4000-8000-000000000001'
const CURRENT_TIME = new Date('2030-08-25T10:00:00.000Z')

describe('notification delivery reconciliation', () => {
  it('quarantines an expired processing lease without invoking a provider and replays idempotently', async () => {
    const fixture = reconcileFixture({
      task: task({
        status: 'PROCESSING',
        lease_expires_at: new Date(CURRENT_TIME.getTime() - 1_000),
        last_outcome: 'UNKNOWN',
        retry_disposition: 'MANUAL_REVIEW',
      }),
      grant: {
        id: '30000000-0000-4000-8000-000000000001',
        reservation_expires_at: new Date(CURRENT_TIME.getTime() - 1_000),
      },
    })
    const repository = createNotificationRepository(fixture.database, {
      createId: () => '40000000-0000-4000-8000-000000000001',
    })
    const input = reconcileInput(fixture.evidenceRevision())
    const first = await repository.reconcileDeliveryTask(input)
    assert.equal(first.effect, 'QUARANTINED')
    assert.equal(first.source.status, 'CANCELLED')
    assert.equal(first.source.lastOutcome, 'UNKNOWN')
    assert.equal(first.source.retryDisposition, 'MANUAL_REVIEW')
    assert.equal(first.source.lastErrorCode, 'DELIVERY_OUTCOME_UNKNOWN')
    assert.equal(fixture.state.grant, null)
    assert.equal(fixture.state.providerCalls, 0)
    assert.equal(fixture.state.audits.length, 1)
    assert.equal(fixture.state.audits[0].effect, 'QUARANTINED')
    assert.equal(fixture.state.audits[0].beforeStatus, 'PROCESSING')
    assert.equal(fixture.state.audits[0].afterStatus, 'CANCELLED')

    const readsBeforeReplay = fixture.state.taskReads
    const replay = await repository.reconcileDeliveryTask(input)
    assert.deepEqual(replay, first)
    assert.equal(fixture.state.taskReads, readsBeforeReplay)
    assert.equal(fixture.state.audits.length, 1)
  })

  it('never replays an existing unknown delivery and leaves safe retryable facts unchanged', async () => {
    for (const [sourceTask, expectedEffect] of [
      [task({ status: 'CANCELLED', last_outcome: 'UNKNOWN', retry_disposition: 'MANUAL_REVIEW' }), 'UNCHANGED'],
      [task({ status: 'FAILED', last_outcome: 'KNOWN_FAILED', retry_disposition: 'RETRIABLE' }), 'RETRYABLE_UNCHANGED'],
    ]) {
      const fixture = reconcileFixture({ task: sourceTask, grant: null })
      const repository = createNotificationRepository(fixture.database)
      const result = await repository.reconcileDeliveryTask(
        reconcileInput(fixture.evidenceRevision()),
      )
      assert.equal(result.effect, expectedEffect)
      assert.equal(fixture.state.task.status, sourceTask.status)
      assert.equal(fixture.state.taskWrites, 0)
      assert.equal(fixture.state.providerCalls, 0)
    }
  })

  it('rejects active leases and changed evidence before any delivery-state mutation', async () => {
    const active = reconcileFixture({
      task: task({
        status: 'PROCESSING',
        lease_expires_at: new Date(CURRENT_TIME.getTime() + 60_000),
        last_outcome: 'UNKNOWN',
        retry_disposition: 'MANUAL_REVIEW',
      }),
      grant: null,
    })
    await assert.rejects(
      createNotificationRepository(active.database).reconcileDeliveryTask(
        reconcileInput(active.evidenceRevision()),
      ),
      /NOT_ACTIONABLE/,
    )
    assert.equal(active.state.taskWrites, 0)

    const changed = reconcileFixture({
      task: task({ status: 'CANCELLED', last_outcome: 'UNKNOWN', retry_disposition: 'MANUAL_REVIEW' }),
      grant: null,
    })
    await assert.rejects(
      createNotificationRepository(changed.database).reconcileDeliveryTask(
        reconcileInput('f'.repeat(64)),
      ),
      /EVIDENCE_CHANGED/,
    )
    assert.equal(changed.state.taskWrites, 0)
  })

  it('validates every signed reconcile field before repository access', async () => {
    const calls = []
    const service = createNotificationService({
      repository: {
        async reconcileDeliveryTask(input) {
          calls.push(input)
          return { taskId: input.taskId }
        },
      },
      clock: () => CURRENT_TIME.getTime(),
    })
    await service.reconcileDeliveryTask({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      taskId: TASK_ID,
      expectedEvidenceRevision: 'a'.repeat(64),
      idempotencyKey: 'notification-review-0001',
    })
    assert.equal(calls[0].now.toISOString(), CURRENT_TIME.toISOString())
    assert.throws(() => service.reconcileDeliveryTask({
      appId: APP_ID,
      actorUserId: 'not-a-user',
      taskId: TASK_ID,
      expectedEvidenceRevision: 'a'.repeat(64),
      idempotencyKey: 'notification-review-0001',
    }), /VALIDATION_FAILED/)
    assert.throws(() => service.reconcileDeliveryTask({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      taskId: TASK_ID,
      expectedEvidenceRevision: 'changed',
      idempotencyKey: 'notification-review-0001',
    }), /VALIDATION_FAILED/)
  })
})

function task(overrides = {}) {
  return {
    id: TASK_ID,
    status: 'CANCELLED',
    attempts: 1,
    available_at: CURRENT_TIME,
    lease_expires_at: null,
    delivered_at: null,
    last_error_code: 'DELIVERY_OUTCOME_UNKNOWN',
    last_outcome: 'UNKNOWN',
    retry_disposition: 'MANUAL_REVIEW',
    outcome_updated_at: CURRENT_TIME,
    ...overrides,
  }
}

function reconcileInput(expectedEvidenceRevision) {
  return {
    appId: APP_ID,
    actorUserId: ACTOR_ID,
    taskId: TASK_ID,
    expectedEvidenceRevision,
    idempotencyKey: 'notification-review-0001',
    now: CURRENT_TIME,
  }
}

function reconcileFixture({ task: initialTask, grant: initialGrant }) {
  const state = {
    task: { ...initialTask },
    grant: initialGrant ? { ...initialGrant } : null,
    idempotency: null,
    taskReads: 0,
    taskWrites: 0,
    providerCalls: 0,
    audits: [],
  }
  const database = {
    async transaction(callback) {
      return callback({
        async one(sql) {
          if (sql.includes('FROM mip_idempotency_keys')) return state.idempotency
          if (sql.includes('FROM mip_delivery_tasks')) {
            state.taskReads += 1
            return { ...state.task }
          }
          if (sql.includes('FROM mip_notification_grants')) {
            return state.grant ? { ...state.grant } : null
          }
          throw new Error(`Unexpected SQL: ${sql.slice(0, 60)}`)
        },
        async query(sql, params) {
          if (sql.includes('INSERT INTO mip_idempotency_keys')) {
            if (state.idempotency) {
              const duplicate = new Error('duplicate')
              duplicate.code = 'ER_DUP_ENTRY'
              throw duplicate
            }
            state.idempotency = {
              request_hash: params.at(-1),
              status: 'RUNNING',
              response_json: null,
            }
            return { affectedRows: 1 }
          }
          if (sql.includes('UPDATE mip_notification_grants')) {
            state.grant = null
            return { affectedRows: 1 }
          }
          if (sql.includes('UPDATE mip_delivery_tasks')) {
            state.taskWrites += 1
            state.task = {
              ...state.task,
              status: 'CANCELLED',
              lease_expires_at: null,
              last_error_code: 'DELIVERY_OUTCOME_UNKNOWN',
              last_outcome: 'UNKNOWN',
              retry_disposition: 'MANUAL_REVIEW',
              outcome_updated_at: CURRENT_TIME,
            }
            return { affectedRows: 1 }
          }
          if (sql.includes('INSERT INTO mip_audit_logs')) {
            state.audits.push(JSON.parse(params.at(-1)))
            return { affectedRows: 1 }
          }
          if (sql.includes('UPDATE mip_idempotency_keys')) {
            state.idempotency.status = 'COMPLETED'
            state.idempotency.response_json = params[0]
            return { affectedRows: 1 }
          }
          throw new Error(`Unexpected SQL: ${sql.slice(0, 60)}`)
        },
      })
    },
  }
  return {
    database,
    state,
    evidenceRevision() {
      return deliveryEvidenceRevision(normalizedDeliveryEvidence(state.task, state.grant))
    },
  }
}
