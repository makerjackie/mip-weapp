import type { OrderId, UserId } from '../src/modules/mip'
import type {
  CommerceGateway,
  CommerceOrder,
  MembershipPlan,
  PaymentAdapter,
} from '../src/modules/mip-commerce'
import { describe, expect, it, vi } from 'vitest'
import {
  createMembershipPlanCache,
  createMipCommerceGateway,
  createMipCommerceModule,
  interpretClientPayment,
  MipCommerceError,
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

  it('delegates payment availability to the server and reconciles payment outcomes', async () => {
    const gateway = {
      describePaymentCapabilities: vi.fn(async () => ({
        mode: 'live' as const,
        catalogStage: 'LIVE' as const,
        available: true,
      })),
      listPlans: vi.fn(async () => [plan]),
      getMembershipBenefits: vi.fn(async () => ({
        kind: 'GUEST' as const,
        status: 'NONE' as const,
        benefits: [] as [],
        history: [],
      })),
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
      listOrderPage: vi.fn(async () => ({ items: [] })),
      requestRefund: vi.fn(async () => ({ refundId: 'refund-1' as never, status: 'PENDING' })),
      submitRefund: vi.fn(async () => ({ status: 'PROVIDER_CREATED' })),
    } satisfies CommerceGateway
    const payment: PaymentAdapter = { request: vi.fn(async () => 'ACCEPTED') }
    // MIW-119：模块本地不再短路支付——disabled 拒绝由服务端 createCheckout 给出。
    const disabledGateway = {
      ...gateway,
      describePaymentCapabilities: vi.fn(async () => ({
        mode: 'disabled' as const,
        catalogStage: 'TEST' as const,
        available: false,
      })),
      createCheckout: vi.fn(async () => {
        throw new MipCommerceError('PAYMENT_UNAVAILABLE', '当前环境未开启微信支付')
      }),
    } satisfies CommerceGateway
    const module = createMipCommerceModule(gateway, payment)
    await expect(module.ensurePaymentCapability()).resolves.toMatchObject({
      mode: 'live',
      available: true,
    })
    await expect(createMipCommerceModule(disabledGateway, payment).purchase({
      planId: plan.id,
      idempotencyKey: 'purchase-1',
    })).rejects.toMatchObject({ code: 'PAYMENT_UNAVAILABLE' })
    await expect(module.purchase({ planId: plan.id, idempotencyKey: 'purchase-1' })).resolves.toMatchObject({
      kind: 'CONFIRMED',
    })
    await expect(module.payOrder(order('CREATED').id)).resolves.toMatchObject({ kind: 'CONFIRMED' })

    gateway.reconcileOrder.mockClear()
    payment.request.mockResolvedValueOnce('CANCELLED')
    await expect(module.payOrder(order('CREATED').id)).resolves.toMatchObject({ kind: 'CANCELLED' })
    expect(gateway.reconcileOrder).not.toHaveBeenCalled()

    gateway.reconcileOrder.mockRejectedValueOnce(new Error('PAYMENT_QUERY_UNAVAILABLE'))
    await expect(module.purchase({ planId: plan.id, idempotencyKey: 'purchase-2' })).resolves.toMatchObject({
      kind: 'PENDING',
      order: { id: order('CREATED').id },
    })
    // MIW-126：purchase 兜底用 createCheckout 已持有的订单事实，不再回读 getOrder。
    expect(gateway.getOrder).not.toHaveBeenCalled()
  })

  it('keeps the payOrder launch path free of pre-payment order reads (MIW-126)', async () => {
    const gateway = {
      describePaymentCapabilities: vi.fn(async () => ({
        mode: 'live' as const,
        catalogStage: 'LIVE' as const,
        available: true,
      })),
      listPlans: vi.fn(async () => [plan]),
      getMembershipBenefits: vi.fn(async () => ({
        kind: 'GUEST' as const,
        status: 'NONE' as const,
        benefits: [] as [],
        history: [],
      })),
      createCheckout: vi.fn(async () => order('CREATED')),
      createPayment: vi.fn(async () => ({
        timeStamp: '1',
        nonceStr: 'nonce',
        package: 'prepay_id=test',
        signType: 'RSA' as const,
        paySign: 'signature',
      })),
      getOrder: vi.fn(async () => order('PAID')),
      reconcileOrder: vi.fn(async () => order('PAID')),
      listOrders: vi.fn(async () => []),
      listOrderPage: vi.fn(async () => ({ items: [] })),
      requestRefund: vi.fn(async () => ({ refundId: 'refund-1' as never, status: 'PENDING' })),
      submitRefund: vi.fn(async () => ({ status: 'PROVIDER_CREATED' })),
    } satisfies CommerceGateway
    const payment: PaymentAdapter = { request: vi.fn(async () => 'ACCEPTED') }
    const module = createMipCommerceModule(gateway, payment)
    await expect(module.payOrder(order('CREATED').id, order('CREATED'))).resolves.toMatchObject({
      kind: 'CONFIRMED',
    })
    // 拉起关键路径 = createPayment + requestPayment + reconcile；getOrder 只允许出现在兜底。
    expect(gateway.createPayment).toHaveBeenCalledTimes(1)
    expect(gateway.reconcileOrder).toHaveBeenCalledTimes(1)
    expect(gateway.getOrder).not.toHaveBeenCalled()
  })

  it('reads the order only in the post-cashier fallback when no known order exists (MIW-126)', async () => {
    const gateway = {
      describePaymentCapabilities: vi.fn(async () => ({
        mode: 'live' as const,
        catalogStage: 'LIVE' as const,
        available: true,
      })),
      listPlans: vi.fn(async () => [plan]),
      getMembershipBenefits: vi.fn(async () => ({
        kind: 'GUEST' as const,
        status: 'NONE' as const,
        benefits: [] as [],
        history: [],
      })),
      createCheckout: vi.fn(async () => order('CREATED')),
      createPayment: vi.fn(async () => ({
        timeStamp: '1',
        nonceStr: 'nonce',
        package: 'prepay_id=test',
        signType: 'RSA' as const,
        paySign: 'signature',
      })),
      getOrder: vi.fn(async () => order('PAYMENT_CREATED')),
      reconcileOrder: vi.fn(async () => {
        throw new Error('PAYMENT_QUERY_UNAVAILABLE')
      }),
      listOrders: vi.fn(async () => []),
      listOrderPage: vi.fn(async () => ({ items: [] })),
      requestRefund: vi.fn(async () => ({ refundId: 'refund-1' as never, status: 'PENDING' })),
      submitRefund: vi.fn(async () => ({ status: 'PROVIDER_CREATED' })),
    } satisfies CommerceGateway
    const payment: PaymentAdapter = { request: vi.fn(async () => 'ACCEPTED') }
    const module = createMipCommerceModule(gateway, payment)
    await expect(module.payOrder(order('CREATED').id)).resolves.toMatchObject({
      kind: 'PENDING',
      order: { id: order('CREATED').id },
    })
    expect(gateway.getOrder).toHaveBeenCalledTimes(1)

    // reconcile 与兜底回读都失败：报告 PENDING 且不带订单快照，交由结果页继续核对。
    gateway.getOrder.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await expect(module.payOrder(order('CREATED').id)).resolves.toEqual({
      kind: 'PENDING',
      order: null,
    })
  })

  it('caches the capability snapshot per module and clears stale-stage plan cache', async () => {
    let capabilityStage = 'TEST'
    const gateway = {
      describePaymentCapabilities: vi.fn(async () => ({
        mode: 'test' as const,
        catalogStage: capabilityStage as 'TEST' | 'LIVE',
        available: true,
      })),
      listPlans: vi.fn(async () => [plan]),
      getMembershipBenefits: vi.fn(async () => ({
        kind: 'GUEST' as const,
        status: 'NONE' as const,
        benefits: [] as [],
        history: [],
      })),
      createCheckout: vi.fn(async () => order('CREATED')),
      createPayment: vi.fn(async () => ({
        timeStamp: '1',
        nonceStr: 'nonce',
        package: 'prepay_id=test',
        signType: 'RSA' as const,
        paySign: 'signature',
      })),
      getOrder: vi.fn(async () => order('CREATED')),
      reconcileOrder: vi.fn(async () => order('PAID')),
      listOrders: vi.fn(async () => []),
      listOrderPage: vi.fn(async () => ({ items: [] })),
      requestRefund: vi.fn(async () => ({ refundId: 'refund-1' as never, status: 'PENDING' })),
      submitRefund: vi.fn(async () => ({ status: 'PROVIDER_CREATED' })),
    } satisfies CommerceGateway
    const payment: PaymentAdapter = { request: vi.fn(async () => 'ACCEPTED') }
    const writes: unknown[] = []
    const module = createMipCommerceModule(gateway, payment, {
      planCache: createMembershipPlanCache({
        storage: {
          read: () => undefined,
          write: value => writes.push(value),
          clear: () => {},
        },
      }),
    })
    // 预置一个 TEST 快照（列表先行返回，随后能力快照报告已切到 LIVE）。
    await module.listPlans()
    expect(module.peekPlans()).toEqual([plan])
    expect(gateway.describePaymentCapabilities).not.toHaveBeenCalled()
    capabilityStage = 'LIVE'
    await module.ensurePaymentCapability()
    // stage 切换触发旧缓存清除；下一次 peek 回源而非读旧 stage 残留。
    expect(module.peekPlans()).toBeUndefined()

    // 二次调用复用快照，不重复请求。
    await module.ensurePaymentCapability()
    expect(gateway.describePaymentCapabilities).toHaveBeenCalledTimes(1)
    expect(module.peekPaymentCapability()).toMatchObject({ catalogStage: 'LIVE' })
    expect(writes.length).toBeGreaterThan(0)
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
