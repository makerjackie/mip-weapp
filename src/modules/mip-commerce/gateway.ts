import type {
  CommerceGateway,
  CommerceOrder,
  MembershipInvitation,
  MembershipPlan,
  RefundId,
  RefundIntent,
  WechatPaymentParameters,
} from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipCommerceTransport {
  invoke: (
    functionName: string,
    action: string,
    data?: Record<string, unknown>,
    retryable?: boolean,
  ) => Promise<unknown>
}

export class MipCommerceError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unwrap<T>(value: unknown): T {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new MipCommerceError('INVALID_RESPONSE', '服务返回了无效响应', true)
  }
  const envelope = value as unknown as Envelope<T>
  if (!envelope.ok) {
    throw new MipCommerceError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '服务暂时不可用',
      envelope.error?.retryable === true,
    )
  }
  return envelope.data as T
}

function paymentParameters(value: unknown): WechatPaymentParameters {
  const source = unwrap<{ payment: unknown }>(value).payment
  if (!isRecord(source)
    || typeof source.timeStamp !== 'string'
    || typeof source.nonceStr !== 'string'
    || typeof source.package !== 'string'
    || !['MD5', 'HMAC-SHA256', 'RSA'].includes(String(source.signType))
    || typeof source.paySign !== 'string') {
    throw new MipCommerceError('INVALID_PAYMENT_RESPONSE', '支付服务没有返回有效的调起参数')
  }
  return source as unknown as WechatPaymentParameters
}

export function createMipCommerceGateway(
  transport: MipCommerceTransport,
  functionNames: { commerce: string, payment: string },
): CommerceGateway {
  const commerce = <T>(action: string, data: Record<string, unknown> = {}, retryable = false) =>
    transport.invoke(functionNames.commerce, action, data, retryable).then(unwrap<T>)
  const payment = (action: string, data: Record<string, unknown> = {}) =>
    transport.invoke(functionNames.payment, action, data, false)

  return {
    listPlans() {
      return commerce<MembershipPlan[]>('listPlans', {}, true)
    },

    createMembershipInvitation() {
      return commerce<MembershipInvitation>('createMembershipInvitation')
    },

    createCheckout(intent) {
      return commerce<CommerceOrder>('createCheckout', intent as unknown as Record<string, unknown>)
    },

    createPayment(orderId) {
      return payment('createPayment', { orderId }).then(paymentParameters)
    },

    getOrder(orderId) {
      return commerce<CommerceOrder>('getOrder', { orderId }, true)
    },

    async reconcileOrder(orderId) {
      await payment('syncPayment', { orderId }).then(unwrap<{ status: string }>)
      return commerce<CommerceOrder>('getOrder', { orderId }, true)
    },

    listOrders() {
      return commerce<CommerceOrder[]>('listOrders', {}, true)
    },

    async requestRefund(intent: RefundIntent) {
      const refund = await commerce<{ id: RefundId, status: string }>(
        'requestRefund',
        intent as unknown as Record<string, unknown>,
      )
      const submitted = await payment('submitRefund', { refundId: refund.id })
        .then(unwrap<{ status: string }>)
      return { refundId: refund.id, status: submitted.status }
    },

    submitRefund(refundId) {
      return payment('submitRefund', { refundId }).then(unwrap<{ status: string }>)
    },
  }
}
