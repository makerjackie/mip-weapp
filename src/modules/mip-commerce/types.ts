import type { Brand, OrderId, UserId } from '../mip'

export type MembershipPlanId = Brand<string, 'MembershipPlanId'>
export type EntitlementId = Brand<string, 'EntitlementId'>
export type RefundId = Brand<string, 'RefundId'>

export type CatalogStage = 'TEST' | 'LIVE'
export type MembershipPlanStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE'
export type OrderType = 'MEMBERSHIP' | 'EVENT'
export type OrderStatus
  = | 'CREATED'
    | 'PAYMENT_CREATED'
    | 'PAID'
    | 'FAILED'
    | 'CLOSED'
    | 'REFUND_PENDING'
    | 'PARTIALLY_REFUNDED'
    | 'REFUNDED'

export interface MembershipPlan {
  id: MembershipPlanId
  planKey: string
  catalogStage: CatalogStage
  name: string
  description?: string
  durationDays: number
  priceCents: number
  currency: 'CNY'
  benefits: string[]
  status: MembershipPlanStatus
  version: number
}

export interface CheckoutIntent {
  planId: MembershipPlanId
  idempotencyKey: string
  invitationToken?: string
}

export interface MembershipInvitation {
  token: string
  expiresAt: string
}

export interface MembershipCheckoutFact {
  orderType: 'MEMBERSHIP'
  planId: MembershipPlanId
  amountCents: number
  currency: 'CNY'
  durationDays: number
  productSnapshot: {
    planKey: string
    name: string
    durationDays: number
    priceCents: number
    currency: 'CNY'
    catalogStage: CatalogStage
    version: number
  }
}

export interface CommerceOrder {
  id: OrderId
  userId: UserId
  orderType: OrderType
  resourceId?: string
  membershipPlanId?: MembershipPlanId
  amountCents: number
  refundedAmountCents: number
  currency: 'CNY'
  status: OrderStatus
  paidAt?: string
  version: number
  createdAt?: string
  updatedAt?: string
}

export interface MembershipEntitlement {
  id: EntitlementId
  userId: UserId
  orderId: OrderId
  planId: MembershipPlanId
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'REFUNDED'
  startsAt: string
  endsAt: string
  version: number
}

export interface RefundIntent {
  orderId: OrderId
  idempotencyKey: string
  reason?: string
}

export type ClientPaymentOutcome
  = | { kind: 'CANCELLED' }
    | { kind: 'PENDING', order: CommerceOrder }
    | { kind: 'CONFIRMED', order: CommerceOrder }

export interface WechatPaymentParameters {
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'MD5' | 'HMAC-SHA256' | 'RSA'
  paySign: string
}

export interface CommerceGateway {
  listPlans: () => Promise<MembershipPlan[]>
  createMembershipInvitation: () => Promise<MembershipInvitation>
  createCheckout: (intent: CheckoutIntent) => Promise<CommerceOrder>
  createPayment: (orderId: OrderId) => Promise<WechatPaymentParameters>
  getOrder: (orderId: OrderId) => Promise<CommerceOrder>
  reconcileOrder: (orderId: OrderId) => Promise<CommerceOrder>
  listOrders: () => Promise<CommerceOrder[]>
  requestRefund: (intent: RefundIntent) => Promise<{ refundId: RefundId, status: string }>
  submitRefund: (refundId: RefundId) => Promise<{ status: string }>
}

export interface PaymentAdapter {
  request: (parameters: WechatPaymentParameters) => Promise<'ACCEPTED' | 'CANCELLED'>
}
