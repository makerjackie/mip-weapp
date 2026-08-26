'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  createAdminOperationsQueue,
  deriveQueueItems,
  normalizeQueueInput,
} = require('../domain/operations-queue')

const id = '00000000-0000-4000-8000-000000000001'

function exception(status) {
  return {
    id: `OUTBOX:${id}`,
    source: 'OUTBOX',
    status,
    title: '业务事件处理失败',
    summary: '一项业务事件未完成后续处理。',
    occurredAt: '2030-01-01T00:00:00.000Z',
    reasonCode: null,
    target: null,
  }
}

function review(classification) {
  return {
    resourceRef: { type: 'DELIVERY_TASK', id },
    classification,
    sourceState: {
      status: 'PROCESSING',
      attempts: 1,
      lastErrorCode: null,
      occurredAt: '2030-01-02T00:00:00.000Z',
    },
    evidence: { targetRef: null },
    workflow: { status: 'OPEN' },
  }
}

describe('operations queue server contract', () => {
  it('maps existing exception and review classifications to queue states', () => {
    const items = deriveQueueItems([exception('STALLED'), exception('FAILED')], [review('MANUAL_REVIEW')])
    assert.deepEqual(items.map(item => item.state), ['MANUAL_REVIEW', 'PROCESSING', 'MANUAL_REVIEW'])
    assert.equal(items.every(item => !('phone' in item) && !('openId' in item)), true)
  })

  it('accepts only bounded cursor/state input', () => {
    assert.deepEqual(normalizeQueueInput({ state: 'PROCESSING', limit: 100 }).state, 'PROCESSING')
    assert.throws(() => normalizeQueueInput({ unknown: true }), error => error.code === 'VALIDATION_FAILED')
    assert.throws(() => normalizeQueueInput({ state: 'DONE' }), error => error.code === 'VALIDATION_FAILED')
  })

  it('scans both source collections before applying the shared page cursor', async () => {
    const calls = []
    const access = {
      async session() {
        return {
          caller: { appId: 'app-id', userId: 'user-id' },
          bindings: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
        }
      },
      audit: (_context, _grant, input) => input,
    }
    const repository = {
      async listOperationalExceptions(appId, input) {
        calls.push({ type: 'exceptions', appId, input })
        return [exception('FAILED')]
      },
      async listMessageDeliveryReviews(input) {
        calls.push({ type: 'reviews', input })
        return { items: [review('MANUAL_REVIEW')] }
      },
      async recordAudit(input) {
        calls.push({ type: 'audit', input })
      },
    }
    const queue = createAdminOperationsQueue({ access, repository })

    const page = await queue.listOperationsQueue(
      { appId: 'app-id', userId: 'user-id' },
      { limit: 1 },
    )

    assert.equal(calls.find(call => call.type === 'exceptions').input.internal, true)
    assert.equal(calls.find(call => call.type === 'exceptions').input.limit, 2)
    assert.equal(calls.find(call => call.type === 'exceptions').input.cursor, null)
    assert.equal(calls.find(call => call.type === 'reviews').input.queueCursor, true)
    assert.equal(calls.find(call => call.type === 'reviews').input.queueState, null)
    assert.equal(calls.find(call => call.type === 'reviews').input.limit, 2)
    assert.equal(page.items.length, 1)
    assert.equal(typeof page.nextCursor, 'string')

    await queue.listOperationsQueue(
      { appId: 'app-id', userId: 'user-id' },
      { state: 'PROCESSING', limit: 10 },
    )
    const processingExceptions = calls.filter(call => call.type === 'exceptions').at(-1)
    const processingReviews = calls.filter(call => call.type === 'reviews').at(-1)
    assert.deepEqual(processingExceptions.input.statuses, ['STALLED'])
    assert.equal(processingReviews.input.queueState, 'PROCESSING')
    assert.equal(processingReviews.input.limit, 11)

    await queue.listOperationsQueue(
      { appId: 'app-id', userId: 'user-id' },
      { state: 'PENDING', limit: 10 },
    )
    assert.equal(calls.filter(call => call.type === 'exceptions').length, 2)
  })
})
