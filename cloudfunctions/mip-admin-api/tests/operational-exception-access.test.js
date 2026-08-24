'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  availableExceptionTypes,
  normalizeExceptionRequest,
} = require('../domain/operational-exception-access')

const platform = roleKey => ({ roleKey, scopeType: 'PLATFORM', scopeId: null })

describe('operational exception access', () => {
  it('gives owners and operations all types, finance only commerce types, and event roles none', () => {
    assert.deepEqual(availableExceptionTypes([platform('PLATFORM_OWNER')]), [
      'OUTBOX', 'REFUND', 'PAYMENT', 'MEDIA', 'DELIVERY', 'AI',
    ])
    assert.deepEqual(availableExceptionTypes([platform('PLATFORM_OPERATIONS')]), [
      'OUTBOX', 'REFUND', 'PAYMENT', 'MEDIA', 'DELIVERY', 'AI',
    ])
    assert.deepEqual(availableExceptionTypes([platform('PLATFORM_FINANCE')]), ['REFUND', 'PAYMENT'])
    assert.deepEqual(availableExceptionTypes([
      { roleKey: 'EVENT_OWNER', scopeType: 'EVENT', scopeId: 'event-a' },
    ]), [])
  })

  it('normalizes bounded filters and rejects finance access to unrelated types', () => {
    assert.deepEqual(normalizeExceptionRequest({ type: 'payment', status: 'failed', limit: 500 }, ['REFUND', 'PAYMENT']), {
      types: ['PAYMENT'],
      statuses: ['FAILED'],
      type: 'PAYMENT',
      status: 'FAILED',
      limit: 100,
    })
    assert.throws(
      () => normalizeExceptionRequest({ type: 'MEDIA' }, ['REFUND', 'PAYMENT']),
      error => error.code === 'FORBIDDEN',
    )
    assert.throws(
      () => normalizeExceptionRequest({ status: 'UNKNOWN' }, ['REFUND', 'PAYMENT']),
      error => error.code === 'VALIDATION_FAILED',
    )
  })
})
