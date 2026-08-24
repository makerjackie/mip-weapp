import type {
  CatalogStage,
  ClientPaymentOutcome,
  CommerceOrder,
  MembershipCheckoutFact,
  MembershipEntitlement,
  MembershipPlan,
  OrderStatus,
  RefundIntent,
} from './types'

const orderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  CREATED: ['PAYMENT_CREATED', 'FAILED', 'CLOSED'],
  PAYMENT_CREATED: ['PAID', 'FAILED', 'CLOSED'],
  PAID: ['REFUND_PENDING'],
  FAILED: [],
  CLOSED: [],
  REFUND_PENDING: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUND_PENDING', 'REFUNDED'],
  REFUNDED: [],
}

export function deriveMembershipCheckout(
  plan: MembershipPlan,
  expectedStage: CatalogStage,
): MembershipCheckoutFact {
  if (plan.catalogStage !== expectedStage || plan.status !== 'ACTIVE') {
    throw new Error('MEMBERSHIP_PLAN_NOT_AVAILABLE')
  }
  if (!Number.isInteger(plan.durationDays) || plan.durationDays < 1) {
    throw new Error('MEMBERSHIP_PLAN_INVALID_DURATION')
  }
  if (!Number.isInteger(plan.priceCents) || plan.priceCents < 1 || plan.currency !== 'CNY') {
    throw new Error('MEMBERSHIP_PLAN_INVALID_PRICE')
  }
  return {
    orderType: 'MEMBERSHIP',
    planId: plan.id,
    amountCents: plan.priceCents,
    currency: plan.currency,
    durationDays: plan.durationDays,
    productSnapshot: {
      planKey: plan.planKey,
      name: plan.name,
      durationDays: plan.durationDays,
      priceCents: plan.priceCents,
      currency: plan.currency,
      catalogStage: plan.catalogStage,
      benefits: [...plan.benefits],
      version: plan.version,
    },
  }
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus) {
  if (from === to) {
    return
  }
  if (!orderTransitions[from].includes(to)) {
    throw new Error(`ORDER_TRANSITION_NOT_ALLOWED:${from}:${to}`)
  }
}

export function buildEntitlementWindow(
  paidAt: Date,
  durationDays: number,
  existing: readonly MembershipEntitlement[],
) {
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new Error('ENTITLEMENT_DURATION_INVALID')
  }
  const latestActiveEnd = existing
    .filter(item => item.status === 'ACTIVE')
    .map(item => Date.parse(item.endsAt))
    .filter(Number.isFinite)
    .reduce((latest, value) => Math.max(latest, value), paidAt.getTime())
  const startsAt = new Date(Math.max(paidAt.getTime(), latestActiveEnd))
  const endsAt = new Date(startsAt.getTime() + durationDays * 86_400_000)
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

export function validateRefundIntent(order: CommerceOrder, intent: RefundIntent) {
  if (order.id !== intent.orderId || !['PAID', 'PARTIALLY_REFUNDED'].includes(order.status)) {
    throw new Error('REFUND_NOT_AVAILABLE')
  }
  const amountCents = order.amountCents - order.refundedAmountCents
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    throw new Error('REFUND_AMOUNT_INVALID')
  }
  const idempotencyKey = intent.idempotencyKey.trim()
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw new Error('REFUND_IDEMPOTENCY_KEY_INVALID')
  }
  return {
    orderId: order.id,
    amountCents,
    idempotencyKey,
    reason: intent.reason?.trim().slice(0, 300) || undefined,
  }
}

export function interpretClientPayment(
  requestResult: 'ACCEPTED' | 'CANCELLED',
  order: CommerceOrder,
): ClientPaymentOutcome {
  if (requestResult === 'CANCELLED') {
    return { kind: 'CANCELLED' }
  }
  return order.status === 'PAID'
    ? { kind: 'CONFIRMED', order }
    : { kind: 'PENDING', order }
}
