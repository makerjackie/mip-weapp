import type { Brand, OrderId, UserId } from '../mip'

export type MembershipPlanId = Brand<string, 'MembershipPlanId'>
export type EntitlementId = Brand<string, 'EntitlementId'>
export type RefundId = Brand<string, 'RefundId'>

export type CatalogStage = 'TEST' | 'LIVE'
export type PaymentMode = 'disabled' | 'test' | 'live'
export type MembershipPlanStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE'
export type OrderType = 'MEMBERSHIP' | 'EVENT' | 'CONTENT'
export type OrderStatus
  = | 'CREATED'
    | 'PAYMENT_CREATED'
    | 'PAID'
    | 'FAILED'
    | 'CLOSED'
    | 'REFUND_PENDING'
    | 'PARTIALLY_REFUNDED'
    | 'REFUNDED'
export type OrderServiceStatus = 'PENDING_USE' | 'COMPLETED' | 'REFUNDED' | 'UNAVAILABLE'

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
}

export interface MembershipInvitationAttribution {
  sourceType: 'PLATFORM' | 'USER'
  displayName: string
  avatarUrl?: string
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
  serviceStatus: OrderServiceStatus
  paidAt?: string
  event?: {
    title: string
    coverUrl?: string
    startsAt?: string
    endsAt?: string
    cityName?: string
    venueName?: string
    address?: string
  }
  priceItems?: Array<{
    label: string
    amountCents: number
  }>
  version: number
  createdAt?: string
  updatedAt?: string
}

export interface MembershipBenefitItem {
  key: string
  label: string
  status: 'ACTIVE'
}

export type MembershipEntitlementSourceType = 'ORDER' | 'ADMIN_ADJUSTMENT'
export type MembershipEntitlementHistoryStatus
  = | 'PENDING'
    | 'ACTIVE'
    | 'SCHEDULED'
    | 'EXPIRED'
    | 'REVOKED'
    | 'REFUNDED'

interface MembershipEntitlementHistoryBase {
  entitlementId: EntitlementId
  sourceType: MembershipEntitlementSourceType
  sourceLabel: string
  status: MembershipEntitlementHistoryStatus
  startsAt: string
  endsAt: string
}

export type MembershipEntitlementHistoryItem
  = | (MembershipEntitlementHistoryBase & {
    sourceType: 'ORDER'
    orderId: OrderId
    plan: {
      id: MembershipPlanId
      name: string
      description?: string
    }
    price: { amountCents: number, currency: 'CNY' }
    invitationAttribution: MembershipInvitationAttribution
  })
  | (MembershipEntitlementHistoryBase & {
    sourceType: 'ADMIN_ADJUSTMENT'
    orderId?: never
    plan?: never
    price?: never
    invitationAttribution?: never
  })

interface ActiveMembershipBenefitsBase {
  kind: 'PLAYER'
  status: 'ACTIVE'
  entitlementId: EntitlementId
  sourceType: MembershipEntitlementSourceType
  sourceLabel: string
  startsAt: string
  endsAt: string
  membershipEndsAt: string
  benefits: MembershipBenefitItem[]
  history: MembershipEntitlementHistoryItem[]
  version: number
}

interface PendingMembershipBenefitsBase {
  kind: 'PENDING'
  status: 'PENDING'
  entitlementId: EntitlementId
  sourceType: MembershipEntitlementSourceType
  sourceLabel: string
  startsAt: string
  endsAt: string
  benefits: []
  version: number
}

export type MembershipBenefitsSnapshot
  = | {
    kind: 'GUEST'
    status: 'NONE'
    benefits: []
    history: MembershipEntitlementHistoryItem[]
  }
  // MIW-27 第二轮：首笔付费会员等待管理后台审核时，commerce 只给出待审核事实；
  // 身份投影仍按嘉宾处理，玩家侧权益在审核通过前不开放。
  | (PendingMembershipBenefitsBase & {
    plan: {
      id: MembershipPlanId
      name: string
      description?: string
    }
  })
  | (ActiveMembershipBenefitsBase & {
    sourceType: 'ORDER'
    plan: {
      id: MembershipPlanId
      name: string
      description?: string
    }
    invitationAttribution: MembershipInvitationAttribution
  })
  | (ActiveMembershipBenefitsBase & {
    sourceType: 'ADMIN_ADJUSTMENT'
    plan?: never
    invitationAttribution?: never
  })

export interface RefundIntent {
  orderId: OrderId
  idempotencyKey: string
  reason?: string
}

// MIW-126：PENDING 的 order 可为 null——收银台之后的 reconcile 与兜底回读都失败时，
// 客户端拿不到任何订单快照事实；此时只报告「结果未确认」，由调用方用自己已知的
// orderId 引导用户去结果页/订单页继续核对。绝不把收银台成功当成已支付。
export type ClientPaymentOutcome
  = | { kind: 'CANCELLED' }
    | { kind: 'PENDING', order: CommerceOrder | null }
    | { kind: 'CONFIRMED', order: CommerceOrder }

export interface WechatPaymentParameters {
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'MD5' | 'HMAC-SHA256' | 'RSA'
  paySign: string
}

export interface CommerceOrderFilter {
  serviceStatus?: Exclude<OrderServiceStatus, 'UNAVAILABLE'>
  cursor?: string
  limit?: number
}

export interface CommerceOrderPage {
  items: CommerceOrder[]
  nextCursor?: string
}

// MIW-119：支付能力由服务端声明（describePaymentCapabilities），入口页提前预取，
// 支付时刻零环境往返；快照只影响提前展示，支付动作仍由服务端最终裁决。
export interface PaymentCapabilities {
  mode: PaymentMode
  catalogStage: CatalogStage
  available: boolean
}

export interface CommerceGateway {
  describePaymentCapabilities: () => Promise<PaymentCapabilities>
  listPlans: () => Promise<MembershipPlan[]>
  getMembershipBenefits: () => Promise<MembershipBenefitsSnapshot>
  createCheckout: (intent: CheckoutIntent) => Promise<CommerceOrder>
  createPayment: (orderId: OrderId) => Promise<WechatPaymentParameters>
  getOrder: (orderId: OrderId) => Promise<CommerceOrder>
  reconcileOrder: (orderId: OrderId) => Promise<CommerceOrder>
  listOrders: () => Promise<CommerceOrder[]>
  listOrderPage: (filter?: CommerceOrderFilter) => Promise<CommerceOrderPage>
  requestRefund: (intent: RefundIntent) => Promise<{ refundId: RefundId, status: string }>
  submitRefund: (refundId: RefundId) => Promise<{ status: string }>
}

export interface PaymentAdapter {
  request: (parameters: WechatPaymentParameters) => Promise<'ACCEPTED' | 'CANCELLED'>
}
