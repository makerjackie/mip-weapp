'use strict'

const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { describe, it } = require('node:test')
const {
  assertInternalRequest,
  canonical,
  signedPayload,
} = require('../lib/internal-auth')

const secret = '0123456789abcdef0123456789abcdef'
const now = 1_777_000_000_000

function sign(event) {
  return createHmac('sha256', secret).update(canonical(signedPayload(event))).digest('hex')
}

describe('mip payment ledger internal authentication', () => {
  it('accepts only signed business fields for an allowed app', () => {
    const event = {
      action: 'getPayableOrder',
      appId: 'app-1',
      signedAt: now,
      nonce: 'nonce-1',
      orderId: 'order-1',
      identityKey: 'identity-1',
      paymentMode: 'test',
      injectedTransportField: 'ignored',
    }
    event.signature = sign(event)
    assert.equal(assertInternalRequest(event, {
      allowedAppIds: new Set(['app-1']),
      secrets: [secret],
      now: () => now,
    }), 'app-1')
  })

  it('rejects any changed signed field', () => {
    const event = {
      action: 'applyPaymentCallback',
      appId: 'app-1',
      signedAt: now,
      nonce: 'nonce-1',
      orderId: 'order-1',
      identityKey: 'identity-1',
      merchantOrderNo: 'MIP1',
      providerTransactionId: 'provider-1',
      amountCents: 79900,
      currency: 'CNY',
    }
    event.signature = sign(event)
    event.amountCents = 1
    assert.throws(() => assertInternalRequest(event, {
      allowedAppIds: new Set(['app-1']),
      secrets: [secret],
      now: () => now,
    }), /FORBIDDEN/)
  })

  it('signs provider refund recovery without a buyer identity', () => {
    const event = {
      action: 'getRefundRequestForProvider',
      appId: 'app-1',
      signedAt: now,
      nonce: 'nonce-1',
      refundId: 'refund-1',
    }
    event.signature = sign(event)
    assert.equal(assertInternalRequest(event, {
      allowedAppIds: new Set(['app-1']),
      secrets: [secret],
      now: () => now,
    }), 'app-1')
  })
})
