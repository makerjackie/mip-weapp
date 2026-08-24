import type { CallerCapabilities, EntitlementProjection, UserKind } from '../mip'
import type { CommerceOrder, MembershipPlan, OrderStatus } from '../mip-commerce'

export type OrderTone = 'neutral' | 'brand' | 'success' | 'danger'

export interface OrderStatusPresentation {
  label: string
  tone: OrderTone
  paymentPending: boolean
  refundable: boolean
  terminal: boolean
}

const orderStatusPresentation: Record<OrderStatus, OrderStatusPresentation> = {
  CREATED: {
    label: '待支付',
    tone: 'neutral',
    paymentPending: true,
    refundable: false,
    terminal: false,
  },
  PAYMENT_CREATED: {
    label: '支付确认中',
    tone: 'brand',
    paymentPending: true,
    refundable: false,
    terminal: false,
  },
  PAID: {
    label: '已支付',
    tone: 'success',
    paymentPending: false,
    refundable: true,
    terminal: false,
  },
  FAILED: {
    label: '支付失败',
    tone: 'danger',
    paymentPending: false,
    refundable: false,
    terminal: true,
  },
  CLOSED: {
    label: '已关闭',
    tone: 'neutral',
    paymentPending: false,
    refundable: false,
    terminal: true,
  },
  REFUND_PENDING: {
    label: '退款处理中',
    tone: 'brand',
    paymentPending: false,
    refundable: false,
    terminal: false,
  },
  PARTIALLY_REFUNDED: {
    label: '部分退款',
    tone: 'brand',
    paymentPending: false,
    refundable: true,
    terminal: false,
  },
  REFUNDED: {
    label: '已退款',
    tone: 'neutral',
    paymentPending: false,
    refundable: false,
    terminal: true,
  },
}

export function presentOrderStatus(status: OrderStatus): OrderStatusPresentation {
  return orderStatusPresentation[status]
}

export function classifyPaymentResult(order: CommerceOrder): 'pending' | 'success' | 'failed' {
  if (order.status === 'PAID') {
    return 'success'
  }
  if (presentOrderStatus(order.status).paymentPending) {
    return 'pending'
  }
  return 'failed'
}

export function formatCny(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    return '—'
  }
  return `¥${(amountCents / 100).toFixed(2)}`
}

export function planTitle(order: CommerceOrder, plans: readonly MembershipPlan[]) {
  if (order.orderType === 'EVENT') {
    return '活动订单'
  }
  return plans.find(plan => String(plan.id) === String(order.membershipPlanId))?.name || '会员订单'
}

export function membershipPresentation(
  kind: UserKind,
  entitlement?: EntitlementProjection,
) {
  if (kind === 'PLAYER' && entitlement?.status === 'ACTIVE') {
    return {
      label: '玩家',
      description: '会员权益使用中',
      endsAt: entitlement.endsAt,
    }
  }
  return {
    label: '嘉宾',
    description: '当前没有有效会员权益',
    endsAt: undefined,
  }
}

export function hasCapability(grants: readonly CallerCapabilities[], capability: string) {
  return grants.some(grant => grant.capabilities.includes(capability))
}

export function canManageEvents(grants: readonly CallerCapabilities[]) {
  return hasCapability(grants, 'event:manage') || hasCapability(grants, 'event:check_in')
}

export function createIntentKey(
  prefix: string,
  now = Date.now(),
  random = Math.random(),
) {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32) || 'mip'
  const entropy = Math.floor(Math.max(0, Math.min(0.999999999, random)) * 1_000_000_000)
    .toString(36)
    .padStart(6, '0')
  return `${safePrefix}-${now.toString(36)}-${entropy}`
}
