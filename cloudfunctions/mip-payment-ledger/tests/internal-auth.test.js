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
const legalActions = [
  'getPayableOrder',
  'markPaymentCreated',
  'applyPaymentCallback',
  'getRefundRequest',
  'getRefundRequestForProvider',
  'listPendingRefunds',
  'markRefundCreated',
  'markRefundFailed',
  'markRefundManualReview',
  'applyRefundCallback',
  'grantOwnerTestMembership',
  'revokeOwnerTestMembership',
]

function sign(event) {
  return createHmac('sha256', secret).update(canonical(signedPayload(event))).digest('hex')
}

describe('mip payment ledger internal authentication', () => {
  it('fails closed for prototype and unknown signed action names', () => {
    for (const action of ['constructor', 'toString', '__proto__', 'unknownAction']) {
      assert.throws(() => signedPayload({ action }), /FORBIDDEN/)
    }
    const inheritedAction = Object.create({ action: 'getPayableOrder' })
    assert.throws(() => signedPayload(inheritedAction), /FORBIDDEN/)
  })

  it('keeps every supported business action in the signed-field registry', () => {
    for (const action of legalActions) {
      assert.deepEqual(signedPayload({ action }), { action })
    }
  })

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

  it('signs the provider CHANGE manual-review transition', () => {
    const event = {
      action: 'markRefundManualReview',
      appId: 'app-1',
      signedAt: now,
      nonce: 'nonce-1',
      refundId: 'refund-1',
      merchantRefundNo: 'MIPR1',
      reasonCode: 'CHANGE',
    }
    event.signature = sign(event)
    assert.equal(assertInternalRequest(event, {
      allowedAppIds: new Set(['app-1']),
      secrets: [secret],
      now: () => now,
    }), 'app-1')
  })

  it('signs every field that selects an Owner TEST membership operation', () => {
    const event = {
      action: 'grantOwnerTestMembership',
      appId: 'app-1',
      signedAt: now,
      nonce: 'nonce-1',
      planKey: 'five_year_test',
    }
    event.signature = sign(event)
    event.planKey = 'another_test_plan'
    assert.throws(() => assertInternalRequest(event, {
      allowedAppIds: new Set(['app-1']),
      secrets: [secret],
      now: () => now,
    }), /FORBIDDEN/)
  })
})
