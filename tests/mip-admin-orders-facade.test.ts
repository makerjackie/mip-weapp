import type { MipOrdersAdmin } from '../src/modules/mip-admin/orders-admin'
import type { AdminOrderListInput, MipAdminGateway } from '../src/modules/mip-admin/types'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { MipAdminError } from '../src/modules/mip-admin/types'

const emptyOrderPage = {
  items: [],
  nextCursor: null,
  summary: {
    currency: 'CNY' as const,
    orderCount: 0,
    paidOrderCount: 0,
    eventGrossAmountCents: 0,
    membershipGrossAmountCents: 0,
    grossAmountCents: 0,
    refundedAmountCents: 0,
    netAmountCents: 0,
  },
}

const orderDetail = {
  order: {
    id: '10000000-0000-4000-8000-000000000001',
    nickname: '用户',
    orderType: 'MEMBERSHIP' as const,
    resourceId: '10000000-0000-4000-8000-000000000002',
    resourceType: 'MEMBERSHIP_PLAN' as const,
    resourceTitle: '年度会员',
    resourceBranchName: '',
    merchantOrderNoMasked: 'MIP1…0001',
    providerTransactionIdMasked: null,
    amountCents: 79900,
    refundedAmountCents: 0,
    currency: 'CNY',
    status: 'PAID' as const,
    refundStatus: null,
    refundId: null,
    availableRefundActions: [],
    paidAt: '2030-08-20T00:00:00.000Z',
    createdAt: '2030-08-19T00:00:00.000Z',
    updatedAt: '2030-08-20T00:00:00.000Z',
    closedAt: null,
    version: 2,
  },
  buyer: {
    nickname: '用户',
    kind: 'PLAYER' as const,
    accountStatus: 'ACTIVE' as const,
    branchName: '广州分会',
    cityName: '广州',
  },
  product: {
    resourceType: 'MEMBERSHIP_PLAN' as const,
    title: '年度会员',
    branchName: '',
    snapshot: {
      catalogStage: 'LIVE' as const,
      version: 2,
      durationDays: 365,
      unlockDays: null,
      benefits: ['玩家身份'],
      refundPolicy: null,
      refundWindowHours: null,
      eventStartsAt: null,
      eventEndsAt: null,
      cityName: '',
      venueName: '',
    },
  },
  payment: { attempts: [], callbacks: [] },
  refunds: [],
  entitlementTimeline: [],
  statusTimeline: [{
    status: 'PAID' as const,
    occurredAt: '2030-08-20T00:00:00.000Z',
    evidence: 'PAYMENT_CONFIRMED' as const,
  }],
}

function createHarness() {
  const spies = {
    getSession: vi.fn<MipAdminGateway['getSession']>(async () => ({
      enabled: true,
      capabilities: [],
      roles: [],
    })),
    listOrders: vi.fn<MipAdminGateway['listOrders']>(async () => emptyOrderPage),
    getOrder: vi.fn<MipAdminGateway['getOrder']>(async () => orderDetail),
    submitRefund: vi.fn<MipAdminGateway['submitRefund']>(async () => ({
      providerDispatch: { status: 'PROVIDER_CREATED' },
    })),
    retryRefund: vi.fn<MipAdminGateway['retryRefund']>(async () => ({
      providerDispatch: { status: 'SUCCEEDED' },
    })),
  }
  const gateway = spies as unknown as MipAdminGateway
  return { module: createMipAdminModule(gateway), spies }
}

const listInput: AdminOrderListInput = {
  filters: {
    query: 'MIP-ORDER',
    eventId: 'event-a',
    orderType: 'EVENT',
    status: 'REFUND_PENDING',
    refundStatus: 'PROCESSING',
    createdFrom: '2026-08-01T00:00:00.000Z',
    createdTo: '2026-08-31T23:59:59.999Z',
  },
  cursor: 'cursor-a',
  limit: 25,
}

const submitInput = {
  orderId: 'order-a',
  reason: '重复支付',
  idempotencyKey: 'refund-order-a',
}

interface MutationCase {
  name: string
  execute: (orders: MipOrdersAdmin) => Promise<unknown>
  spy: 'submitRefund' | 'retryRefund'
}

function mutationCases(): MutationCase[] {
  return [
    {
      name: 'submitRefund',
      execute: orders => orders.submitRefund(submitInput),
      spy: 'submitRefund',
    },
    {
      name: 'retryRefund',
      execute: orders => orders.retryRefund('refund-a'),
      spy: 'retryRefund',
    },
  ]
}

describe('MIP admin orders facade', () => {
  it('uses every filter, cursor, and limit in the list cache key', async () => {
    const { module, spies } = createHarness()

    await module.orders.list(listInput)
    await module.orders.list(listInput)
    await module.orders.list({ ...listInput, cursor: 'cursor-b' })
    await module.orders.list({ ...listInput, limit: 50 })
    await module.orders.list({
      ...listInput,
      filters: { ...listInput.filters, refundStatus: 'FAILED' },
    })

    expect(spies.listOrders).toHaveBeenCalledTimes(4)
    expect(spies.listOrders.mock.calls[0]?.[0]).toBe(listInput)
    expect(spies.listOrders.mock.calls.map(call => call[0])).toEqual([
      listInput,
      { ...listInput, cursor: 'cursor-b' },
      { ...listInput, limit: 50 },
      { ...listInput, filters: { ...listInput.filters, refundStatus: 'FAILED' } },
    ])
  })

  it('keeps the legacy listOrders alias on the same cache', async () => {
    const { module, spies } = createHarness()

    await module.listOrders(listInput)
    await module.orders.list(listInput)

    expect(spies.listOrders).toHaveBeenCalledTimes(1)
    expect(spies.listOrders.mock.calls[0]?.[0]).toBe(listInput)
  })

  it('caches order detail by order id and exposes the legacy neutral alias', async () => {
    const { module, spies } = createHarness()

    await module.orders.get('order-a')
    await module.getOrder('order-a')
    await module.orders.get('order-b')
    await module.orders.get('order-a', true)

    expect(spies.getOrder.mock.calls).toEqual([
      ['order-a'],
      ['order-b'],
      ['order-a'],
    ])
  })

  it('passes refund inputs to the neutral gateway unchanged', async () => {
    const { module, spies } = createHarness()

    await module.orders.submitRefund(submitInput)
    await module.orders.retryRefund('refund-a')

    expect(spies.submitRefund.mock.calls[0]?.[0]).toBe(submitInput)
    expect(spies.retryRefund.mock.calls[0]).toEqual(['refund-a'])
  })

  for (const mutation of mutationCases()) {
    it(`invalidates only order reads after ${mutation.name} succeeds`, async () => {
      const { module, spies } = createHarness()
      await module.orders.list(listInput)
      await module.orders.list(listInput)
      await module.orders.get('order-a')
      await module.orders.get('order-a')
      await module.getSession()
      await module.getSession()

      await mutation.execute(module.orders)
      await module.orders.list(listInput)
      await module.orders.get('order-a')
      await module.getSession()

      expect(spies.listOrders).toHaveBeenCalledTimes(2)
      expect(spies.getOrder).toHaveBeenCalledTimes(2)
      expect(spies[mutation.spy]).toHaveBeenCalledTimes(1)
      expect(spies.getSession).toHaveBeenCalledTimes(1)
    })
  }

  it.each([
    ['submitRefund', new MipAdminError('CONFLICT', '订单状态已变化')],
    ['retryRefund', new MipAdminError('FORBIDDEN', '当前账号不能执行退款')],
    ['retryRefund', new MipAdminError('PAYMENT_PROVIDER_ERROR', '支付服务暂时不可用', true)],
  ] as const)('preserves cached reads and the original %s failure', async (name, failure) => {
    const { module, spies } = createHarness()
    spies[name].mockRejectedValueOnce(failure)
    await module.orders.list(listInput)

    const work = name === 'submitRefund'
      ? module.orders.submitRefund(submitInput)
      : module.orders.retryRefund('refund-a')
    await expect(work).rejects.toBe(failure)
    await module.orders.list(listInput)

    expect(spies.listOrders).toHaveBeenCalledTimes(1)
  })

  it('keeps the orders page behind the typed facade and exports outside generic mutation', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const source = fs.readFileSync(path.join(root, 'src/packages/admin/orders/index.ts'), 'utf8')

    expect(source).toContain('mipAdminModule.orders.list(')
    expect(source).toContain('mipAdminModule.orders.get(')
    expect(source).toContain('mipAdminModule.orders.submitRefund(')
    expect(source).toContain('mipAdminModule.orders.retryRefund(')
    expect(source).toContain('mipAdminModule.exportAndOpen(')
    expect(source).not.toContain('mipAdminModule.gateway')
    expect(source).not.toContain('mipAdminModule.mutate')
    expect(source.match(/mipAdminModule\.orders\.submitRefund\(/g)).toHaveLength(1)
    expect(source.match(/mipAdminModule\.orders\.retryRefund\(/g)).toHaveLength(1)
  })
})
