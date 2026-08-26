import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parseAdminOrderDetail,
  parseAdminOrderPage,
  parseAdminRosterPage,
} from '../src/modules/mip-admin/order-roster'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const uuid = {
  order: '10000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-000000000002',
  plan: '10000000-0000-4000-8000-000000000003',
  registration: '10000000-0000-4000-8000-000000000004',
  refund: '10000000-0000-4000-8000-000000000005',
}

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid.order,
    nickname: '用户',
    orderType: 'MEMBERSHIP',
    resourceId: uuid.plan,
    resourceType: 'MEMBERSHIP_PLAN',
    resourceTitle: '年度会员',
    resourceBranchName: '',
    merchantOrderNoMasked: 'MIP1…0001',
    providerTransactionIdMasked: null,
    amountCents: 79900,
    refundedAmountCents: 0,
    currency: 'CNY',
    status: 'PAID',
    refundStatus: null,
    refundId: null,
    availableRefundActions: ['SUBMIT_REFUND'],
    paidAt: '2026-08-20T02:00:00.000Z',
    createdAt: '2026-08-20T01:00:00.000Z',
    version: 2,
    ...overrides,
  }
}

function roster(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid.registration,
    nickname: '用户',
    cityName: '广州',
    status: 'REGISTERED',
    answers: { role: '嘉宾' },
    answerItems: [{ key: 'role', label: '参与身份', value: '嘉宾' }],
    phoneBound: true,
    phoneNumber: null,
    submittedAt: '2026-08-20T01:00:00.000Z',
    registeredAt: '2026-08-20T01:01:00.000Z',
    checkedInAt: null,
    version: 1,
    ...overrides,
  }
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    currency: 'CNY',
    orderCount: 1,
    paidOrderCount: 1,
    eventGrossAmountCents: 0,
    membershipGrossAmountCents: 79900,
    grossAmountCents: 79900,
    refundedAmountCents: 0,
    netAmountCents: 79900,
    ...overrides,
  }
}

function orderDetail(overrides: Record<string, unknown> = {}) {
  return {
    order: {
      ...order(),
      updatedAt: '2026-08-20T02:00:01.000Z',
      closedAt: null,
    },
    buyer: {
      nickname: '用户',
      kind: 'PLAYER',
      accountStatus: 'ACTIVE',
      branchName: '广州分会',
      cityName: '广州',
    },
    product: {
      resourceType: 'MEMBERSHIP_PLAN',
      title: '年度会员',
      branchName: '',
      snapshot: {
        catalogStage: 'LIVE',
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
    payment: {
      attempts: [{
        provider: 'WECHAT_PAY',
        status: 'SUCCEEDED',
        providerPaymentIdMasked: 'WX-P…0001',
        requiresAttention: false,
        createdAt: '2026-08-20T01:00:01.000Z',
        updatedAt: '2026-08-20T02:00:00.000Z',
      }],
      callbacks: [{
        callbackType: 'PAYMENT',
        verificationStatus: 'VERIFIED',
        processingStatus: 'PROCESSED',
        requiresAttention: false,
        processedAt: '2026-08-20T02:00:01.000Z',
        createdAt: '2026-08-20T02:00:00.000Z',
        updatedAt: '2026-08-20T02:00:01.000Z',
      }],
    },
    refunds: [{
      id: uuid.refund,
      requestedBy: 'OPERATOR',
      merchantRefundNoMasked: 'MIPR…0001',
      providerRefundIdMasked: null,
      amountCents: 12000,
      currency: 'CNY',
      reason: '用户申请',
      status: 'PENDING',
      requiresAttention: false,
      refundedAt: null,
      createdAt: '2026-08-21T01:00:00.000Z',
      updatedAt: '2026-08-21T01:00:00.000Z',
      callback: null,
      statusTimeline: [{
        status: 'PENDING',
        occurredAt: '2026-08-21T01:00:00.000Z',
        evidence: 'REFUND_CREATED',
      }],
    }],
    entitlementTimeline: [],
    statusTimeline: [
      { status: 'CREATED', occurredAt: '2026-08-20T01:00:00.000Z', evidence: 'ORDER_CREATED' },
      { status: 'PAID', occurredAt: '2026-08-20T02:00:00.000Z', evidence: 'PAYMENT_CONFIRMED' },
    ],
    ...overrides,
  }
}

describe('H2 admin order and roster response boundary', () => {
  it('accepts complete safe DTOs and rejects raw payment or roster identity fields', () => {
    const parsedOrder = parseAdminOrderPage({
      items: [order({
        entitlementStartsAt: '2026-08-20T02:00:00.000Z',
        entitlementEndsAt: '2027-08-20T02:00:00.000Z',
        entitlementStatus: 'ACTIVE',
      })],
      nextCursor: null,
      summary: summary(),
    }).items[0]
    expect(parsedOrder.resourceTitle).toBe('年度会员')
    expect(parsedOrder.entitlementStatus).toBe('ACTIVE')
    expect(() => parseAdminOrderPage({
      items: [order({ merchantOrderNo: 'MIP-RAW-ORDER' })],
      nextCursor: null,
      summary: summary(),
    })).toThrow(/无效的订单列表/)
    expect(() => parseAdminOrderPage({
      items: [order({ userId: uuid.user })],
      nextCursor: null,
      summary: summary(),
    })).toThrow(/无效的订单列表/)
    expect(() => parseAdminOrderPage({
      items: [order()],
      nextCursor: null,
      summary: summary({ netAmountCents: 1 }),
    })).toThrow(/无效的财务汇总/)

    expect(parseAdminRosterPage({ items: [roster()], nextCursor: null }).items[0].answerItems[0]).toEqual({
      key: 'role',
      label: '参与身份',
      value: '嘉宾',
    })
    expect(() => parseAdminRosterPage({
      items: [roster({ phoneCiphertext: 'secret', userId: uuid.user })],
      nextCursor: null,
    })).toThrow(/无效的参与者名单/)
  })

  it('accepts the neutral order detail and fails closed on private or raw provider fields', () => {
    const detail = parseAdminOrderDetail(orderDetail())

    expect(detail.order.amountCents).toBe(79900)
    expect(detail.payment.attempts[0]?.status).toBe('SUCCEEDED')
    expect(detail.refunds[0]?.requestedBy).toBe('OPERATOR')
    expect(detail.entitlementTimeline).toEqual([])
    expect(() => parseAdminOrderDetail(orderDetail({
      buyer: { ...orderDetail().buyer as object, userId: uuid.user },
    }))).toThrow(/无效的订单详情/)
    expect(() => parseAdminOrderDetail(orderDetail({
      payment: {
        ...orderDetail().payment as object,
        callbacks: [{
          ...(orderDetail().payment as { callbacks: Array<Record<string, unknown>> }).callbacks[0],
          callbackKey: 'raw-provider-callback-key',
        }],
      },
    }))).toThrow(/无效的订单详情/)
    expect(() => parseAdminOrderDetail(orderDetail({
      payment: {
        ...orderDetail().payment as object,
        attempts: [{
          ...(orderDetail().payment as { attempts: Array<Record<string, unknown>> }).attempts[0],
          providerPaymentIdMasked: 'WX1',
        }],
      },
    }))).toThrow(/无效的订单详情/)
    expect(() => parseAdminOrderDetail(orderDetail({
      statusTimeline: [{
        status: 'PENDING',
        occurredAt: '2026-08-20T01:00:00.000Z',
        evidence: 'REFUND_CREATED',
      }],
    }))).toThrow(/无效的订单详情/)
    expect(() => parseAdminOrderDetail(orderDetail({
      payment: {
        ...orderDetail().payment as object,
        callbacks: [{
          ...(orderDetail().payment as { callbacks: Array<Record<string, unknown>> }).callbacks[0],
          callbackType: 'REFUND',
        }],
      },
    }))).toThrow(/无效的订单详情/)
  })

  it('wires all requested filters and renders server-derived actions and full roster facts', () => {
    const page = read('src/packages/admin/orders/index.ts')
    const orderWxml = read('src/packages/admin/orders/index.wxml')
    const rosterWxml = read('src/packages/admin/event-registrations/index.wxml')
    const service = read('cloudfunctions/mip-admin-api/domain/orders.js')
    const repository = read('cloudfunctions/mip-admin-api/domain/repositories/orders.js')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')

    for (const filter of ['query', 'orderType', 'status', 'refundStatus', 'createdFrom', 'createdTo']) {
      expect(page).toContain(`${filter}:`)
    }
    expect(orderWxml).toContain('item.resourceTitle')
    expect(orderWxml).toContain('item.refundedText')
    expect(orderWxml).toContain('item.createdText')
    expect(orderWxml).toContain('item.paidText')
    expect(orderWxml).toContain('item.canSubmitRefund')
    expect(orderWxml).toContain('item.canRetryRefund')
    expect(orderWxml).toContain('mip-admin-responsive-panel')
    expect(orderWxml).toContain('关联权益时间线')
    expect(page).toContain('mipAdminModule.orders.get(')
    expect(service).toContain('availableRefundActions.push(\'SUBMIT_REFUND\')')
    expect(service).toContain('availableRefundActions.push(\'RETRY_REFUND\')')
    expect(repository).toContain('LEFT JOIN mip_membership_plans')
    expect(repository).toContain('refundStatus === \'NONE\'')
    expect(gateway).toContain('parseAdminOrderPage')
    expect(gateway).toContain('call(\'mip.admin.orders.get\'')
    expect(gateway).toContain('parseAdminRosterPage')
    expect(rosterWxml).toContain('item.answerItems')
    expect(rosterWxml).toContain('item.submittedText')
    expect(rosterWxml).toContain('item.registeredText')
    expect(rosterWxml).toContain('item.checkedInText')
  })
})
