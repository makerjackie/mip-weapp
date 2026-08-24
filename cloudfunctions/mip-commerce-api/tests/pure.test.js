'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertOrderTransition,
  deriveMembershipCheckout,
  refundableAmount,
} = require('../domain/pure')

describe('mip commerce pure rules', () => {
  it('derives checkout facts only from an active server plan', () => {
    const result = deriveMembershipCheckout({
      id: 'plan-1',
      plan_key: 'annual',
      catalog_stage: 'TEST',
      name: '年度玩家',
      duration_days: 365,
      price_cents: 79900,
      currency: 'CNY',
      benefits_json: '["玩家身份","会员活动权益"]',
      status: 'ACTIVE',
      version: 2,
    }, 'TEST')
    assert.equal(result.amountCents, 79900)
    assert.equal(result.productSnapshot.version, 2)
    assert.deepEqual(result.productSnapshot.benefits, ['玩家身份', '会员活动权益'])
    assert.throws(() => deriveMembershipCheckout({
      catalog_stage: 'TEST',
      status: 'ACTIVE',
      duration_days: 365,
      price_cents: 1,
      currency: 'CNY',
    }, 'LIVE'), /MEMBERSHIP_PLAN_NOT_AVAILABLE/)
  })

  it('allows only ledger order transitions', () => {
    assert.doesNotThrow(() => assertOrderTransition('PAYMENT_CREATED', 'PAID'))
    assert.throws(() => assertOrderTransition('CREATED', 'REFUNDED'), /ORDER_TRANSITION_NOT_ALLOWED/)
  })

  it('computes the remaining refund amount without client pricing', () => {
    assert.equal(refundableAmount({ status: 'PAID', amount_cents: 79900 }, 10000), 69900)
    assert.throws(
      () => refundableAmount({ status: 'PAID', amount_cents: 79900 }, 79900),
      /REFUND_AMOUNT_INVALID/,
    )
  })
})
