'use strict'
const assert = require('node:assert/strict')
const { it } = require('node:test')
const { rosterPaymentFields } = require('../domain/roster-payment')
it('recognizes confirmed free registrations from historical facts even after the exemption changes', () => {
  for (const status of ['REGISTERED', 'ATTENDED', 'CANCELLED']) {
    assert.equal(rosterPaymentFields({ access_type: 'PAID', member_free: 0, status }).paymentStatus, 'NOT_REQUIRED')
  }
  assert.equal(rosterPaymentFields({ access_type: 'PAID', status: 'PAYMENT_PENDING' }).paymentStatus, 'UNPAID')
  assert.equal(rosterPaymentFields({ access_type: 'PAID', status: 'REGISTERED', order_id: 'original', payment_status: 'PAID' }).paymentStatus, 'PAID')
})
