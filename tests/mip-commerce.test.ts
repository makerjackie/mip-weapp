import type { OrderId, UserId } from '../src/modules/mip'
import type {
  CommerceGateway,
  CommerceOrder,
  MembershipEntitlement,
  MembershipPlan,
  PaymentAdapter,
} from '../src/modules/mip-commerce'
import { describe, expect, it, vi } from 'vitest'
import {
  assertOrderTransition,
  buildEntitlementWindow,
  createMipCommerceGateway,
  createMipCommerceModule,
  deriveMembershipCheckout,
  interpretClientPayment,
  validateRefundIntent,
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
    version: 1,
  }
}

describe('MIP membership commerce', () => {
  it('derives price, duration, and stage from the trusted plan', () => {
    expect(deriveMembershipCheckout(plan, 'TEST')).toMatchObject({
      amountCents: 79900,
      durationDays: 365,
      currency: 'CNY',
    })
    expect(() => deriveMembershipCheckout(plan, 'LIVE')).toThrow('MEMBERSHIP_PLAN_NOT_AVAILABLE')
  })

  it('keeps order transitions and refund amounts server constrained', () => {
    expect(() => assertOrderTransition('PAYMENT_CREATED', 'PAID')).not.toThrow()
    expect(() => assertOrderTransition('CREATED', 'REFUNDED')).toThrow('ORDER_TRANSITION_NOT_ALLOWED')
    expect(validateRefundIntent(order('PAID'), {
      orderId: 'order-1' as OrderId,
      idempotencyKey: 'refund-1',
      reason: '  取消购买  ',
    })).toMatchObject({ amountCents: 79900, reason: '取消购买' })
    expect(() => validateRefundIntent({ ...order('PAID'), refundedAmountCents: 79900 }, {
      orderId: 'order-1' as OrderId,
      idempotencyKey: 'refund-2',
    })).toThrow('REFUND_AMOUNT_INVALID')
  })

  it('extends an active entitlement without overlapping its window', () => {
    const current = [{
      id: 'entitlement-1',
      userId: 'user-1',
      orderId: 'old-order',
      planId: 'plan-1',
      status: 'ACTIVE',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-09-01T00:00:00.000Z',
      version: 1,
    }] as MembershipEntitlement[]
    expect(buildEntitlementWindow(new Date('2026-08-24T00:00:00.000Z'), 30, current)).toEqual({
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-10-01T00:00:00.000Z',
    })
  })

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
        return { ok: true, data: { kind: 'GUEST', status: 'NONE', benefits: [] } }
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
