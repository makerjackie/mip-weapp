'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { signInternalEvent, verifyInternalEvent } = require('../lib/internal-auth')

const secret = '0123456789abcdef0123456789abcdef'
const now = 1_777_000_000_000

describe('refund worker internal authentication', () => {
  it('accepts a signed request only for an allowed app', () => {
    const request = {
      action: 'dispatchRefund',
      appId: 'wx1234567890abcdef',
      refundId: '20000000-0000-4000-8000-000000000001',
      nonce: 'nonce-1',
      timestamp: now,
    }
    request.signature = signInternalEvent(request, secret)
    const verified = verifyInternalEvent(request, {
      allowedAppIds: new Set([request.appId]),
      secret,
      now,
    })
    assert.equal(verified.refundId, request.refundId)
  })

  it('rejects a changed refund id and an unapproved app', () => {
    const request = {
      action: 'dispatchRefund',
      appId: 'wx1234567890abcdef',
      refundId: '20000000-0000-4000-8000-000000000001',
      nonce: 'nonce-1',
      timestamp: now,
    }
    request.signature = signInternalEvent(request, secret)
    request.refundId = '20000000-0000-4000-8000-000000000002'
    assert.throws(() => verifyInternalEvent(request, {
      allowedAppIds: new Set([request.appId]), secret, now,
    }), /FORBIDDEN/)
    request.refundId = '20000000-0000-4000-8000-000000000001'
    request.signature = signInternalEvent(request, secret)
    assert.throws(() => verifyInternalEvent(request, {
      allowedAppIds: new Set(['wx0000000000000000']), secret, now,
    }), /FORBIDDEN/)
  })
})
