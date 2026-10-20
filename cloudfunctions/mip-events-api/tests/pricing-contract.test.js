'use strict'
const assert = require('node:assert/strict')
const { it } = require('node:test')
const { projectEventPricing } = require('../domain/pricing-contract')
const event = { id: 'event', accessType: 'PAID', priceCents: 1990, memberFree: true, registrationPriceCents: 0 }
const legacy = { id: 'event', accessType: 'PAID', priceCents: 1990 }
it('keeps strict released DTOs compatible for detail, feed and my activities', () => {
  for (const version of [undefined, null, '1', 2]) {
    assert.deepEqual(projectEventPricing('mip.events.detail', event, version), legacy)
    assert.deepEqual(projectEventPricing('mip.events.list', { items: [event], nextCursor: 'next' }, version), { items: [legacy], nextCursor: 'next' })
    assert.deepEqual(projectEventPricing('mip.events.mine', { items: [{ event, orderId: 'old' }] }, version), { items: [{ event: legacy, orderId: 'old' }] })
  }
  assert.equal(event.registrationPriceCents, 0)
})
it('provides new fields only to opted-in readers without altering mutation outcomes', () => {
  assert.equal(projectEventPricing('mip.events.detail', event, 1), event)
  const outcome = { kind: 'PAYMENT_REQUIRED', amountCents: 9900 }
  assert.equal(projectEventPricing('mip.events.register', outcome, 1), outcome)
  assert.equal(projectEventPricing('mip.events.register', outcome), outcome)
})
