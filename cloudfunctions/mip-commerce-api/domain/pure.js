'use strict'

const orderTransitions = Object.freeze({
  CREATED: ['PAYMENT_CREATED', 'FAILED', 'CLOSED'],
  PAYMENT_CREATED: ['PAID', 'FAILED', 'CLOSED'],
  PAID: ['REFUND_PENDING'],
  FAILED: [],
  CLOSED: [],
  REFUND_PENDING: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUND_PENDING', 'REFUNDED'],
  REFUNDED: [],
})

function deriveMembershipCheckout(plan, catalogStage) {
  if (!plan || plan.catalog_stage !== catalogStage || plan.status !== 'ACTIVE') {
    throw new Error('MEMBERSHIP_PLAN_NOT_AVAILABLE')
  }
  const durationDays = Number(plan.duration_days)
  const amountCents = Number(plan.price_cents)
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new Error('MEMBERSHIP_PLAN_INVALID_DURATION')
  }
  if (!Number.isInteger(amountCents) || amountCents < 1 || plan.currency !== 'CNY') {
    throw new Error('MEMBERSHIP_PLAN_INVALID_PRICE')
  }
  return {
    amountCents,
    currency: 'CNY',
    durationDays,
    productSnapshot: {
      planKey: plan.plan_key,
      name: plan.name,
      durationDays,
      priceCents: amountCents,
      currency: 'CNY',
      catalogStage: plan.catalog_stage,
      version: Number(plan.version),
    },
  }
}

function assertOrderTransition(from, to) {
  if (from !== to && !orderTransitions[from]?.includes(to)) {
    throw new Error(`ORDER_TRANSITION_NOT_ALLOWED:${from}:${to}`)
  }
}

function refundableAmount(order, reservedRefundCents) {
  if (!['PAID', 'PARTIALLY_REFUNDED'].includes(order.status)) {
    throw new Error('REFUND_NOT_AVAILABLE')
  }
  const amount = Number(order.amount_cents) - Number(reservedRefundCents)
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error('REFUND_AMOUNT_INVALID')
  }
  return amount
}

module.exports = { assertOrderTransition, deriveMembershipCheckout, refundableAmount }
