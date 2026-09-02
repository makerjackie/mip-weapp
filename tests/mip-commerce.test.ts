import type { OrderId, UserId } from '../src/modules/mip'
import type {
  CommerceGateway,
  CommerceOrder,
  MembershipPlan,
  PaymentAdapter,
} from '../src/modules/mip-commerce'
import { describe, expect, it, vi } from 'vitest'
import {
  createMipCommerceGateway,
  createMipCommerceModule,
  interpretClientPayment,
} from '../src/modules/mip-commerce'

const plan: MembershipPlan = {
  id: 'plan-1' as MembershipPlan['id'],
  planKey: 'annual-player',
  catalogStage: 'TEST',
  name: '年度玩家',
  durationDays: 365,
  priceCents: 79900,
  currency: 'CNY',
  benefits: ['玩家身份'],
  status: 'ACTIVE',
  version: 3,
}

function order(status: CommerceOrder['status']): CommerceOrder {
  return {
    id: 'order-1' as OrderId,
    userId: 'user-1' as UserId,
    orderType: 'MEMBERSHIP',
    membershipPlanId: plan.id,
    amountCents: plan.priceCents,
    refundedAmountCents: 0,
    currency: 'CNY',
    status,
    serviceStatus: ['PARTIALLY_REFUNDED', 'REFUNDED'].includes(status) ? 'REFUNDED' : 'UNAVAILABLE',
    version: 1,
  }
}

describe('MIP membership commerce', () => {
  it('never treats wx.requestPayment acceptance as paid', () => {
    expect(interpretClientPayment('ACCEPTED', order('PAYMENT_CREATED')).kind).toBe('PENDING')
    expect(interpretClientPayment('ACCEPTED', order('PAID')).kind).toBe('CONFIRMED')
  })

  it('fails closed when payment is disabled and reconciles when enabled', async () => {
    const gateway = {
      listPlans: vi.fn(async () => [plan]),
      getMembershipBenefits: vi.fn(async () => ({
        kind: 'GUEST' as const,
        status: 'NONE' as const,
        benefits: [] as [],
        history: [],
      })),
      createMembershipInvitation: vi.fn(async () => ({ token: 'm1.opaque', expiresAt: '2026-09-23T00:00:00.000Z' })),
      createMembershipInvitationCode: vi.fn(async () => ({ codeUrl: 'cloud://env.test/code.png', expiresAt: '2026-09-23T00:00:00.000Z' })),
      resolveMembershipInvitationScene: vi.fn(async () => ({ token: 'm1.scene', expiresAt: '2026-09-23T00:00:00.000Z' })),
      createCheckout: vi.fn(async () => order('CREATED')),
      createPayment: vi.fn(async () => ({
        timeStamp: '1',
        nonceStr: 'nonce',
        package: 'prepay_id=test',
        signType: 'RSA' as const,
        paySign: 'signature',
      })),
      getOrder: vi.fn(async () => order('PAYMENT_CREATED')),
      reconcileOrder: vi.fn(async () => order('PAID')),
      listOrders: vi.fn(async () => []),
      requestRefund: vi.fn(async () => ({ refundId: 'refund-1' as never, status: 'PENDING' })),
      submitRefund: vi.fn(async () => ({ status: 'PROVIDER_CREATED' })),
    } satisfies CommerceGateway
    const payment: PaymentAdapter = { request: vi.fn(async () => 'ACCEPTED') }
    const disabledModule = createMipCommerceModule(gateway, payment, {
      paymentMode: 'disabled',
      catalogStage: 'TEST',
    })
    await expect(disabledModule.purchase({
      planId: plan.id,
      idempotencyKey: 'purchase-1',
    })).rejects.toThrow('PAYMENT_UNAVAILABLE')
    expect(() => disabledModule.requestRefund({
      orderId: order('PAID').id,
      idempotencyKey: 'refund-1',
    })).toThrow('PAYMENT_UNAVAILABLE')
    await expect(createMipCommerceModule(gateway, payment, {
      paymentMode: 'test',
      catalogStage: 'TEST',
    }).purchase({ planId: plan.id, idempotencyKey: 'purchase-1' })).resolves.toMatchObject({
      kind: 'CONFIRMED',
    })
    await expect(createMipCommerceModule(gateway, payment, {
      paymentMode: 'test',
      catalogStage: 'TEST',
    }).payOrder(order('CREATED').id)).resolves.toMatchObject({ kind: 'CONFIRMED' })

    gateway.reconcileOrder.mockClear()
    payment.request.mockResolvedValueOnce('CANCELLED')
    await expect(createMipCommerceModule(gateway, payment, {
      paymentMode: 'test',
      catalogStage: 'TEST',
    }).payOrder(order('CREATED').id)).resolves.toMatchObject({ kind: 'CANCELLED' })
    expect(gateway.reconcileOrder).not.toHaveBeenCalled()

    gateway.reconcileOrder.mockRejectedValueOnce(new Error('PAYMENT_QUERY_UNAVAILABLE'))
    await expect(createMipCommerceModule(gateway, payment, {
      paymentMode: 'test',
      catalogStage: 'TEST',
    }).purchase({ planId: plan.id, idempotencyKey: 'purchase-2' })).resolves.toMatchObject({
      kind: 'PENDING',
      order: { id: order('CREATED').id },
    })
  })

  it('routes commerce and payment calls through separate mip functions', async () => {
    const invoke = vi.fn(async (functionName: string, action: string) => {
      if (action === 'syncPayment') {
        return { ok: true, data: { status: 'PAID' } }
      }
      if (action === 'getOrder') {
        return { ok: true, data: order('PAID') }
      }
      if (action === 'requestRefund') {
        return { ok: true, data: { id: 'refund-1', status: 'PENDING' } }
      }
      if (action === 'getMembershipBenefits') {
        return { ok: true, data: { kind: 'GUEST', status: 'NONE', benefits: [], history: [] } }
      }
      if (action === 'submitRefund') {
        return { ok: true, data: { status: 'PROVIDER_CREATED' } }
      }
      throw new Error(`${functionName}:${action}`)
    })
    const gateway = createMipCommerceGateway({ invoke }, {
      commerce: 'mip-commerce-api',
      payment: 'mip-cloudpay',
    })

    await expect(gateway.getMembershipBenefits()).resolves.toEqual({
      kind: 'GUEST',
      status: 'NONE',
      benefits: [],
      history: [],
    })
    await expect(gateway.reconcileOrder(order('PAID').id)).resolves.toMatchObject({ status: 'PAID' })
    await expect(gateway.requestRefund({
      orderId: order('PAID').id,
      idempotencyKey: 'refund-key',
    })).resolves.toEqual({ refundId: 'refund-1', status: 'PROVIDER_CREATED' })
    expect(invoke.mock.calls.map(call => `${call[0]}:${call[1]}`)).toEqual([
      'mip-commerce-api:getMembershipBenefits',
      'mip-cloudpay:syncPayment',
      'mip-commerce-api:getOrder',
      'mip-commerce-api:requestRefund',
      'mip-cloudpay:submitRefund',
    ])
  })

  it('rejects malformed payment parameters before calling wx.requestPayment', async () => {
    const gateway = createMipCommerceGateway({
      invoke: vi.fn(async () => ({ ok: true, data: { payment: { package: 'invalid' } } })),
    }, {
      commerce: 'mip-commerce-api',
      payment: 'mip-cloudpay',
    })
    await expect(gateway.createPayment(order('CREATED').id))
      .rejects
      .toThrow('支付服务没有返回有效的调起参数')
  })
})
