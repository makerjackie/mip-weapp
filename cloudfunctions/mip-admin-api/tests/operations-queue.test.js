'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { deriveQueueItems, normalizeQueueInput } = require('../domain/operations-queue')

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
})
