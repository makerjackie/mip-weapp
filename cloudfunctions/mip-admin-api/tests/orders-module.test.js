'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminAccess } = require('../domain/access')
const { createAdminOrders } = require('../domain/orders')

const APP_ID = 'wx-app'
const EVENT_ID = 'event-a'
const BRANCH_ID = 'branch-a'
const caller = { appId: APP_ID, identityKey: 'identity-key' }

function repository(overrides = {}) {
  const audits = []
  const repo = {
    audits,
    roleBindings: [{ roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null }],
    resolveReads: 0,
    listReads: 0,
    detailReads: 0,
    summaryReads: 0,
    refundWrites: 0,
    retryWrites: 0,
    async resolveUser() {
      repo.resolveReads += 1
      return {
        id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true,
        phoneBound: true, profileComplete: true,
      }
    },
    async listRoleBindings() {
      return repo.roleBindings
    },
    async getEventScope(_appId, eventId) {
      if (eventId === 'event-missing') return null
      return {
        scopeType: 'EVENT', scopeId: eventId,
        eventScopeType: 'BRANCH', branchId: BRANCH_ID,
        status: 'PUBLISHED', version: 3,
      }
    },
    async getOrderScope(_appId, orderId) {
      if (orderId === 'order-missing') return null
      return { scopeType: 'PLATFORM', scopeId: null, branchId: null }
    },
    async getRefundScope(_appId, refundId) {
      if (refundId === 'refund-missing') return null
      return {
        scopeType: 'PLATFORM', scopeId: null, branchId: null,
        refundStatus: 'PENDING',
      }
    },
    async listOrders() {
      repo.listReads += 1
      return []
    },
    async getOrderDetail() {
      repo.detailReads += 1
      return orderDetailRow()
    },
    async summarizeOrders() {
      repo.summaryReads += 1
      return emptySummary()
    },
    async submitRefund(input) {
      repo.refundWrites += 1
      return {
        id: 'refund-server', orderId: input.orderId,
        amountCents: 12000, status: 'PENDING', idempotent: false,
      }
    },
    async authorizeRefundRetry(input) {
      repo.retryWrites += 1
      return { id: input.refundId, status: 'PENDING' }
    },
    async recordAudit(value) {
      audits.push(value)
    },
    ...overrides,
  }
  return repo
}

function orders(repo, dispatchProviderRefund = async () => ({ status: 'PROVIDER_CREATED' })) {
  return createAdminOrders({
    repository: repo,
    access: createAdminAccess({ repository: repo }),
    dispatchProviderRefund,
  })
}

function emptySummary() {
  return {
    currency: 'CNY', orderCount: 0, paidOrderCount: 0,
    eventGrossAmountCents: 0, membershipGrossAmountCents: 0,
    grossAmountCents: 0, refundedAmountCents: 0, netAmountCents: 0,
  }
}

function orderRow(overrides = {}) {
  return {
    id: 'order-a', userId: 'user-a', nickname: '用户', orderType: 'MEMBERSHIP',
    resourceId: 'plan-a', resourceType: 'MEMBERSHIP_PLAN', resourceTitle: '年度会员',
    resourceBranchName: '', merchantOrderNoMasked: 'MIP1…0001',
    providerTransactionIdMasked: 'WX1…0001', amountCents: 79900,
    refundedAmountCents: 0, currency: 'CNY', status: 'PAID',
    refundStatus: null, refundId: null, paidAt: '2030-08-20T00:00:00.000Z',
    createdAt: '2030-08-19T00:00:00.000Z', version: 2,
    branchId: null, demoOrder: false,
    ...overrides,
  }
}

function orderDetailRow(overrides = {}) {
  return {
    scope: { scopeType: 'PLATFORM', scopeId: null, branchId: null },
    order: {
      ...orderRow(),
      updatedAt: '2030-08-21T00:00:00.000Z',
      closedAt: null,
      userId: 'private-user-id',
    },
    buyer: {
      nickname: '用户', kind: 'PLAYER', accountStatus: 'ACTIVE',
      branchName: '广州分会', cityName: '广州', phoneNumber: '18819253403',
      userId: 'private-user-id',
    },
    productSnapshot: {
      title: '下单时年度会员', catalogStage: 'LIVE', version: 2, durationDays: 365, unlockDays: null,
      benefits: ['玩家身份'], refundPolicy: null, refundWindowHours: null,
      eventStartsAt: null, eventEndsAt: null, cityName: '', venueName: '',
      rawSnapshot: { merchantSecret: 'secret' },
    },
    paymentAttempts: [{
      provider: 'WECHAT_PAY', status: 'SUCCEEDED', providerPaymentIdMasked: 'WX1…0001',
      requiresAttention: false, createdAt: '2030-08-19T00:00:00.000Z',
      updatedAt: '2030-08-20T00:00:00.000Z', prepayId: 'private-prepay-id',
    }],
    paymentCallbacks: [{
      callbackType: 'PAYMENT', verificationStatus: 'VERIFIED', processingStatus: 'PROCESSED',
      requiresAttention: false, processedAt: '2030-08-20T00:00:01.000Z',
      createdAt: '2030-08-20T00:00:00.000Z', updatedAt: '2030-08-20T00:00:01.000Z',
      callbackKey: 'private-callback-key',
    }],
    refunds: [{
      id: 'refund-a', requestedBy: 'OPERATOR', merchantRefundNoMasked: 'MIPR…0001',
      providerRefundIdMasked: null, amountCents: 12000, currency: 'CNY',
      reason: '运营退款', status: 'PENDING', requiresAttention: false, refundedAt: null,
      createdAt: '2030-08-21T00:00:00.000Z', updatedAt: '2030-08-21T00:00:00.000Z',
      callback: null,
      statusTimeline: [{
        status: 'PENDING', occurredAt: '2030-08-21T00:00:00.000Z', evidence: 'REFUND_CREATED',
      }],
      requestedByUserId: 'private-operator-id',
    }],
    entitlementTimeline: [{
      kind: 'MEMBERSHIP', status: 'ACTIVE', startsAt: '2030-08-20T00:00:00.000Z',
      endsAt: '2031-08-20T00:00:00.000Z', firstAccessedAt: null, revokedAt: null,
      createdAt: '2030-08-20T00:00:00.000Z', updatedAt: '2030-08-20T00:00:00.000Z',
      entitlementId: 'private-entitlement-id',
    }],
    statusTimeline: [
      { status: 'CREATED', occurredAt: '2030-08-19T00:00:00.000Z', evidence: 'ORDER_CREATED' },
      { status: 'PAID', occurredAt: '2030-08-20T00:00:00.000Z', evidence: 'PAYMENT_CONFIRMED' },
    ],
    ...overrides,
  }
}

describe('admin orders deep module', () => {
  it('exposes only order administration and its export filter seam', () => {
    const api = createAdminOrders({ repository: {}, access: {} })
    assert.deepEqual(Object.keys(api).sort(), [
      'getOrder',
      'listOrders',
      'normalizeExportFilters',
      'retryRefund',
      'submitRefund',
    ])
  })

  it('reads one order through server visibility and projects no private identifiers', async () => {
    let captured
    const repo = repository({
      async getOrderDetail(...args) {
        repo.detailReads += 1
        captured = args
        return orderDetailRow()
      },
    })
    const service = orders(repo)

    const detail = await service.getOrder(caller, { orderId: 'order-a', userId: 'forged-user' })

    assert.deepEqual(captured, [
      APP_ID,
      { platform: true, branchIds: [], eventIds: [] },
      'order-a',
    ])
    assert.equal(detail.order.amountCents, 79900)
    assert.equal(detail.product.title, '下单时年度会员')
    assert.equal(detail.buyer.kind, 'PLAYER')
    assert.equal(detail.payment.attempts[0].status, 'SUCCEEDED')
    assert.equal(detail.refunds[0].amountCents, 12000)
    assert.equal(detail.entitlementTimeline[0].status, 'ACTIVE')
    assert.equal(repo.audits.at(-1).action, 'admin.orders.detail.view')
    assert.equal(repo.audits.at(-1).resourceId, 'order-a')
    assert.doesNotMatch(
      JSON.stringify(detail),
      /private-user-id|18819253403|private-prepay-id|private-callback-key|merchantSecret|private-operator-id|private-entitlement-id/,
    )

    repo.roleBindings = [{ roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: EVENT_ID }]
    const reads = repo.detailReads
    await assert.rejects(
      () => service.getOrder(caller, { orderId: 'order-a' }),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(repo.detailReads, reads)
  })

  it('uses scoped detail visibility and returns not found without widening inaccessible orders', async () => {
    let capturedVisibility
    const repo = repository({
      async getOrderDetail(_appId, visibility, orderId) {
        repo.detailReads += 1
        capturedVisibility = visibility
        if (orderId === 'order-hidden') return null
        return orderDetailRow({
          scope: { scopeType: 'EVENT', scopeId: EVENT_ID, branchId: BRANCH_ID },
          order: orderRow({
            orderType: 'EVENT', resourceId: EVENT_ID, resourceType: 'EVENT',
            resourceTitle: '城市活动', branchId: BRANCH_ID,
            updatedAt: '2030-08-21T00:00:00.000Z', closedAt: null,
          }),
        })
      },
    })
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }]
    const service = orders(repo)

    const detail = await service.getOrder(caller, { orderId: 'order-a' })
    assert.equal(detail.order.orderType, 'EVENT')
    assert.deepEqual(capturedVisibility, {
      platform: false, branchIds: [BRANCH_ID], eventIds: [],
    })

    await assert.rejects(
      () => service.getOrder(caller, { orderId: 'order-hidden' }),
      error => error?.code === 'NOT_FOUND',
    )
  })

  it('reloads current roles and never reads order data without orders.read', async () => {
    const repo = repository()
    const service = orders(repo)

    await service.listOrders(caller)
    assert.equal(repo.listReads, 1)
    assert.equal(repo.summaryReads, 1)

    repo.roleBindings = [{ roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: EVENT_ID }]
    await assert.rejects(() => service.listOrders(caller), error => error?.code === 'FORBIDDEN')
    assert.equal(repo.resolveReads, 2)
    assert.equal(repo.listReads, 1)
    assert.equal(repo.summaryReads, 1)
  })

  it('authorizes event filters against the server scope and resolves missing events first', async () => {
    let captured
    const repo = repository({
      async listOrders(...args) {
        repo.listReads += 1
        captured = args
        return []
      },
    })
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }]
    const service = orders(repo)

    await service.listOrders(caller, { filters: { eventId: EVENT_ID } })
    assert.equal(captured[0], APP_ID)
    assert.deepEqual(captured[1], {
      platform: false, branchIds: [BRANCH_ID], eventIds: [],
    })
    assert.equal(captured[2].eventId, EVENT_ID)
    assert.equal(repo.audits.at(-1).scopeType, 'EVENT')
    assert.equal(repo.audits.at(-1).scopeId, EVENT_ID)

    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-b' }]
    await assert.rejects(
      () => service.listOrders(caller, { filters: { eventId: EVENT_ID } }),
      error => error?.code === 'FORBIDDEN',
    )
    await assert.rejects(
      () => service.listOrders(caller, { filters: { eventId: 'event-missing' } }),
      error => error?.code === 'NOT_FOUND',
    )
    assert.equal(repo.listReads, 1)
    assert.equal(repo.summaryReads, 1)
  })

  it('projects only safe financial fields and separates read from refund capability', async () => {
    const rows = [
      orderRow(),
      orderRow({ id: 'order-demo', demoOrder: true }),
      orderRow({
        id: 'order-content', orderType: 'CONTENT', resourceId: 'content-a',
        resourceType: 'KNOWLEDGE_CONTENT', resourceTitle: '会员内容',
        contentRefundEligible: false,
      }),
      orderRow({
        id: 'order-pending', status: 'REFUND_PENDING', refundStatus: 'PROCESSING',
        refundId: 'refund-a',
      }),
    ]
    const summary = {
      ...emptySummary(), orderCount: rows.length, paidOrderCount: 3,
      grossAmountCents: 319600, netAmountCents: 319600,
    }
    const repo = repository({
      async listOrders() {
        repo.listReads += 1
        return { items: rows, nextCursor: 'next-page' }
      },
      async summarizeOrders() {
        repo.summaryReads += 1
        return summary
      },
    })
    const service = orders(repo)

    const financePage = await service.listOrders(caller)
    assert.equal(financePage.nextCursor, 'next-page')
    assert.deepEqual(financePage.summary, summary)
    assert.deepEqual(financePage.items.map(item => item.availableRefundActions), [
      ['SUBMIT_REFUND'], [], [], ['RETRY_REFUND'],
    ])
    for (const item of financePage.items) {
      assert.equal(Object.hasOwn(item, 'branchId'), false)
      assert.equal(Object.hasOwn(item, 'userId'), false)
      assert.equal(Object.hasOwn(item, 'demoOrder'), false)
      assert.equal(Object.hasOwn(item, 'contentRefundEligible'), false)
      assert.equal(item.providerTransactionIdMasked, 'WX1…0001')
      assert.equal(item.version, 2)
    }

    repo.roleBindings = [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }]
    const operationsPage = await service.listOrders(caller)
    assert.equal(operationsPage.items.every(item => item.availableRefundActions.length === 0), true)
  })

  it('uses identical validated filters for lists and exports and rejects time conflicts before reads', async () => {
    let captured
    const repo = repository({
      async listOrders(...args) {
        repo.listReads += 1
        captured = args[2]
        return []
      },
    })
    const service = orders(repo)
    const filters = {
      query: ' MIP-0001 ', eventId: EVENT_ID,
      orderType: 'event', status: 'paid', refundStatus: 'none',
      createdFrom: '2030-08-01T00:00:00.000Z',
      createdTo: '2030-08-24T23:59:59.999Z',
    }

    await service.listOrders(caller, { filters })
    assert.deepEqual(captured, {
      query: 'MIP-0001', eventId: EVENT_ID,
      orderType: 'EVENT', status: 'PAID', refundStatus: 'NONE',
      createdFrom: '2030-08-01 00:00:00.000',
      createdTo: '2030-08-24 23:59:59.999',
    })
    assert.deepEqual(service.normalizeExportFilters(filters), captured)

    const reads = repo.listReads
    await assert.rejects(() => service.listOrders(caller, { filters: {
      createdFrom: '2030-08-25T00:00:00.000Z',
      createdTo: '2030-08-24T00:00:00.000Z',
    } }), error => error?.code === 'VALIDATION_FAILED')
    assert.equal(repo.listReads, reads)
    assert.equal(repo.summaryReads, 1)
    assert.throws(() => service.normalizeExportFilters({
      createdFrom: '2030-08-25T00:00:00.000Z',
      createdTo: '2030-08-24T00:00:00.000Z',
    }), error => error?.code === 'VALIDATION_FAILED')
  })

  it('submits only the server-created refund id and amount after the repository transaction returns', async () => {
    const trace = []
    let release
    let captured
    const transactionGate = new Promise(resolve => { release = resolve })
    const repo = repository({
      async submitRefund(input) {
        repo.refundWrites += 1
        captured = input
        trace.push('transaction-started')
        await transactionGate
        trace.push('transaction-committed')
        return {
          id: 'refund-server', orderId: input.orderId,
          amountCents: 12000, status: 'PENDING', idempotent: false,
        }
      },
    })
    const dispatched = []
    const service = orders(repo, async (input) => {
      trace.push('provider-dispatched')
      dispatched.push(input)
      return { status: 'PROVIDER_CREATED' }
    })

    const pending = service.submitRefund(caller, {
      orderId: 'order-a',
      reason: '  用户申请退款  ',
      idempotencyKey: 'refund-request-0001',
      amountCents: 1,
      refundId: 'refund-client',
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(trace, ['transaction-started'])
    release()
    const result = await pending

    assert.deepEqual(trace, ['transaction-started', 'transaction-committed', 'provider-dispatched'])
    assert.deepEqual(dispatched, [{ appId: APP_ID, refundId: 'refund-server' }])
    assert.equal(result.amountCents, 12000)
    assert.equal(result.id, 'refund-server')
    assert.deepEqual(result.providerDispatch, { status: 'PROVIDER_CREATED' })
    assert.equal(Object.hasOwn(captured, 'amountCents'), false)
    assert.equal(Object.hasOwn(captured, 'refundId'), false)
    assert.equal(captured.reason, '用户申请退款')
    assert.equal(captured.authorization.capability, 'refunds.submit')
    assert.deepEqual(captured.authorizedScope, {
      scopeType: 'PLATFORM', scopeId: null, branchId: null,
    })
    assert.deepEqual(captured.audit('refund-server', 12000).metadata, {
      orderId: 'order-a', amountCents: 12000, reasonLength: 6,
    })
  })

  it('preserves demo and scope failures without dispatching or widening permissions', async () => {
    let dispatches = 0
    const demoError = Object.assign(new Error('DEMO_ORDER'), { code: 'DEMO_ORDER' })
    const repo = repository({
      async submitRefund() {
        repo.refundWrites += 1
        throw demoError
      },
    })
    const service = orders(repo, async () => {
      dispatches += 1
      return { status: 'PROVIDER_CREATED' }
    })

    await assert.rejects(() => service.submitRefund(caller, {
      orderId: 'order-demo', reason: '测试退款', idempotencyKey: 'demo-refund-request',
      demo: false,
    }), error => error === demoError)
    assert.equal(dispatches, 0)

    repo.roleBindings = [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }]
    const writes = repo.refundWrites
    await assert.rejects(() => service.submitRefund(caller, {
      orderId: 'order-a', reason: '运营退款', idempotencyKey: 'refund-request-0002',
    }), error => error?.code === 'FORBIDDEN')
    assert.equal(repo.refundWrites, writes)
    assert.equal(dispatches, 0)

    await assert.rejects(() => service.submitRefund(caller, {
      orderId: 'order-missing', reason: '运营退款', idempotencyKey: 'refund-request-0003',
    }), error => error?.code === 'NOT_FOUND')
    assert.equal(repo.refundWrites, writes)
  })

  it('retries only active server refunds after authorization commits and fails provider errors safely', async () => {
    const trace = []
    let release
    let captured
    const authorizationGate = new Promise(resolve => { release = resolve })
    const repo = repository({
      async authorizeRefundRetry(input) {
        repo.retryWrites += 1
        captured = input
        trace.push('authorization-started')
        await authorizationGate
        trace.push('authorization-committed')
        return { id: input.refundId, status: 'PENDING' }
      },
    })
    const service = orders(repo, async () => {
      trace.push('provider-dispatched')
      throw new Error('provider unavailable')
    })

    const pending = service.retryRefund(caller, { refundId: 'refund-a' })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(trace, ['authorization-started'])
    release()
    const result = await pending

    assert.deepEqual(trace, ['authorization-started', 'authorization-committed', 'provider-dispatched'])
    assert.deepEqual(result, {
      id: 'refund-a', providerDispatch: { status: 'PENDING_RETRY' },
    })
    assert.equal(captured.authorization.capability, 'refunds.submit')
    assert.equal(captured.audit.action, 'admin.refunds.retry')

    repo.getRefundScope = async () => ({
      scopeType: 'PLATFORM', scopeId: null, branchId: null, refundStatus: 'SUCCEEDED',
    })
    const writes = repo.retryWrites
    await assert.rejects(
      () => service.retryRefund(caller, { refundId: 'refund-a' }),
      error => error?.code === 'INVALID_STATE',
    )
    assert.equal(repo.retryWrites, writes)

    const conflict = Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' })
    repo.getRefundScope = async () => ({
      scopeType: 'PLATFORM', scopeId: null, branchId: null, refundStatus: 'PENDING',
    })
    repo.authorizeRefundRetry = async () => { throw conflict }
    await assert.rejects(
      () => service.retryRefund(caller, { refundId: 'refund-a' }),
      error => error === conflict,
    )
    assert.equal(trace.filter(item => item === 'provider-dispatched').length, 1)
  })
})
