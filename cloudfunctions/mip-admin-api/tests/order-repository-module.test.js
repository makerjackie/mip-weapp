'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminOrderRepository } = require('../domain/repositories/orders')

const APP_ID = 'wx-orders'
const EVENT_ID = 'event-a'
const BRANCH_ID = 'branch-a'

function databaseHarness({ one, query } = {}) {
  const calls = []
  let transactionActive = false
  let transactions = 0
  const tx = {
    async one(sql, params) {
      calls.push({ method: 'one', sql, params, transactionActive })
      return one ? one(sql, params) : null
    },
    async query(sql, params) {
      calls.push({ method: 'query', sql, params, transactionActive })
      return query ? query(sql, params) : { affectedRows: 1 }
    },
  }
  return {
    calls,
    get transactions() { return transactions },
    async one(sql, params) {
      calls.push({ method: 'one', sql, params, transactionActive })
      return one ? one(sql, params) : null
    },
    async query(sql, params) {
      calls.push({ method: 'query', sql, params, transactionActive })
      return query ? query(sql, params) : []
    },
    async transaction(work) {
      transactions += 1
      assert.equal(transactionActive, false)
      transactionActive = true
      try { return await work(tx) }
      finally { transactionActive = false }
    },
  }
}

function repository(database, overrides = {}) {
  let sequence = 0
  return createAdminOrderRepository(database, {
    assertMutationScope() {},
    async lockMutationAuthorization() {
      return {
        capability: 'refunds.submit',
        effectiveGrant: { roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null },
      }
    },
    createId() {
      sequence += 1
      return `generated-${sequence}`
    },
    now: () => new Date('2030-08-26T12:00:00.000Z'),
    randomBytes: () => Buffer.from('abcde'),
    ...overrides,
  })
}

function audit(resourceId = 'refund-a', amountCents = 12_000) {
  return {
    appId: APP_ID,
    actorUserId: 'admin-a',
    scopeType: 'EVENT',
    scopeId: EVENT_ID,
    action: 'admin.refunds.submit',
    resourceType: 'REFUND',
    resourceId,
    effectiveRole: 'PLATFORM_FINANCE',
    metadata: { amountCents },
  }
}

describe('admin order persistence adapter', () => {
  it('keeps the persistence interface limited to order reads and refund transactions', () => {
    const adapter = repository(databaseHarness())
    assert.deepEqual(Object.keys(adapter).sort(), [
      'authorizeRefundRetry',
      'getOrderDetail',
      'getOrderScope',
      'getRefundScope',
      'listOrderSummary',
      'listOrders',
      'submitRefund',
      'summarizeOrders',
    ])
  })

  it('maps an app- and scope-controlled order detail without leaking raw payment or buyer identifiers', async () => {
    const at = value => new Date(value)
    const database = databaseHarness({
      one(sql) {
        if (!sql.includes('INNER JOIN mip_users buyer')) assert.fail(`unexpected one query: ${sql}`)
        return {
          id: 'order-a', nickname: '用户', order_type: 'EVENT', resource_id: EVENT_ID,
          membership_plan_id: null, event_title: '城市活动', branch_id: BRANCH_ID,
          event_branch_name: '深圳分会', knowledge_title: null,
          merchant_order_no: 'MIP-ORDER-0001', provider_transaction_id: 'WX-TRANSACTION-0001',
          amount_cents: 20_000, currency: 'CNY', status: 'PARTIALLY_REFUNDED',
          paid_at: at('2030-08-20T00:00:00.000Z'), closed_at: null,
          product_snapshot_json: JSON.stringify({
            title: '下单时城市活动', eventVersion: 7,
            catalogStage: 'LIVE', cityName: '深圳', venueName: '会场',
            startsAt: '2030-08-28T10:00:00.000Z', endsAt: '2030-08-28T12:00:00.000Z',
            benefits: ['活动席位'], merchantSecret: 'do-not-return',
          }),
          version: 3, created_at: at('2030-08-19T00:00:00.000Z'),
          updated_at: at('2030-08-22T00:00:00.000Z'), buyer_status: 'ACTIVE',
          buyer_branch_name: '深圳分会', buyer_city_name: '深圳', buyer_is_player: 1,
          membership_entitlement_id: null, knowledge_entitlement_id: null,
          refunded_amount: 5_000, refund_status: 'SUCCEEDED', refund_id: 'refund-a',
        }
      },
      query(sql) {
        if (sql.includes('FROM mip_payment_attempts')) {
          return [{
            provider: 'WECHAT_PAY', provider_payment_id: 'WX1', status: 'SUCCEEDED',
            last_error_code: null, created_at: at('2030-08-19T00:01:00.000Z'),
            updated_at: at('2030-08-20T00:00:00.000Z'), prepay_id: 'private-prepay-id',
          }]
        }
        if (sql.includes("callback.callback_type = 'PAYMENT'")) {
          return [{
            callback_type: 'PAYMENT', verification_status: 'VERIFIED',
            processing_status: 'PROCESSED', processed_at: at('2030-08-20T00:00:01.000Z'),
            last_error_code: null, created_at: at('2030-08-20T00:00:00.000Z'),
            updated_at: at('2030-08-20T00:00:01.000Z'), callback_key: 'private-key',
          }]
        }
        if (sql.includes('FROM mip_refunds refund')) {
          return [{
            id: 'refund-a', requested_by_user_id: 'operator-a', buyer_user_id: 'buyer-a',
            merchant_refund_no: 'MIP-REFUND-0001', provider_refund_id: 'WX-REFUND-0001',
            amount_cents: 5_000, currency: 'CNY', reason: '用户申请', status: 'SUCCEEDED',
            refunded_at: at('2030-08-22T00:00:00.000Z'), last_error_code: null,
            created_at: at('2030-08-21T00:00:00.000Z'), updated_at: at('2030-08-22T00:00:00.000Z'),
            callback_type: 'REFUND', verification_status: 'VERIFIED',
            processing_status: 'PROCESSED', processed_at: at('2030-08-22T00:00:01.000Z'),
            callback_last_error_code: null, callback_created_at: at('2030-08-22T00:00:00.000Z'),
            callback_updated_at: at('2030-08-22T00:00:01.000Z'),
          }]
        }
        assert.fail(`unexpected query: ${sql}`)
      },
    })
    const adapter = repository(database)
    const visibility = { platform: false, branchIds: [BRANCH_ID], eventIds: [] }

    const detail = await adapter.getOrderDetail(APP_ID, visibility, 'order-a')

    assert.deepEqual(detail.scope, {
      scopeType: 'EVENT', scopeId: EVENT_ID, branchId: BRANCH_ID,
    })
    assert.deepEqual(detail.buyer, {
      nickname: '用户', kind: 'PLAYER', accountStatus: 'ACTIVE',
      branchName: '深圳分会', cityName: '深圳',
    })
    assert.equal(detail.order.amountCents, 20_000)
    assert.equal(detail.order.refundedAmountCents, 5_000)
    assert.equal(detail.productSnapshot.cityName, '深圳')
    assert.equal(detail.productSnapshot.title, '下单时城市活动')
    assert.equal(detail.productSnapshot.version, 7)
    assert.deepEqual(detail.entitlementTimeline, [])
    assert.deepEqual(detail.statusTimeline.map(item => item.status), [
      'CREATED', 'PAID',
    ])
    assert.equal(detail.paymentAttempts[0].providerPaymentIdMasked, '…')
    assert.equal(detail.paymentCallbacks[0].processingStatus, 'PROCESSED')
    assert.equal(detail.refunds[0].requestedBy, 'OPERATOR')
    assert.deepEqual(detail.refunds[0].statusTimeline.map(item => item.status), ['PENDING', 'SUCCEEDED'])
    assert.doesNotMatch(JSON.stringify(detail), /do-not-return|private-prepay-id|private-key|operator-a|buyer-a|WX1/)

    assert.deepEqual(database.calls[0].params, [APP_ID, 'order-a', BRANCH_ID])
    assert.equal(database.calls.every(call => call.params[0] === APP_ID), true)
    const detailSql = database.calls[0].sql
    assert.match(detailSql, /o\.app_id = \? AND o\.id = \? AND/)
    assert.match(detailSql, /e\.branch_id IN \(\?\)/)
    const paymentCallbackSql = database.calls.find(
      call => call.sql.includes("callback.callback_type = 'PAYMENT'"),
    ).sql
    assert.match(paymentCallbackSql, /callback\.callback_key = order_row\.provider_transaction_id/)
  })

  it('derives order and refund scopes only from app-scoped server facts', async () => {
    const database = databaseHarness({
      one(sql) {
        if (sql.includes('FROM mip_refunds r')) {
          return {
            id: 'refund-a', refund_status: 'PROCESSING', order_type: 'MEMBERSHIP',
            resource_id: null, branch_id: null,
          }
        }
        return {
          id: 'order-a', order_type: 'EVENT', resource_id: EVENT_ID, branch_id: BRANCH_ID,
        }
      },
    })
    const adapter = repository(database)

    assert.deepEqual(await adapter.getOrderScope(APP_ID, 'order-a'), {
      scopeType: 'EVENT', scopeId: EVENT_ID, branchId: BRANCH_ID,
    })
    assert.deepEqual(await adapter.getRefundScope(APP_ID, 'refund-a'), {
      scopeType: 'PLATFORM', scopeId: null, branchId: null, refundStatus: 'PROCESSING',
    })
    assert.equal(database.calls.length, 2)
    assert.deepEqual(database.calls.map(call => call.params), [
      [APP_ID, 'order-a'],
      [APP_ID, 'refund-a'],
    ])
  })

  it('keeps list, financial summary and dashboard summary on the same visibility seam', async () => {
    const database = databaseHarness({
      query() {
        return [{
          id: 'order-a', user_id: 'user-a', nickname: '用户', order_type: 'EVENT',
          resource_id: EVENT_ID, membership_plan_id: null, event_title: '城市活动',
          branch_id: BRANCH_ID, event_branch_name: '深圳分会', merchant_order_no: 'MIP-ORDER-0001',
          provider_transaction_id: 'WX-TRANSACTION-0001', amount_cents: 20_000,
          refunded_amount: 5_000, currency: 'CNY', status: 'PARTIALLY_REFUNDED',
          refund_status: 'SUCCEEDED', refund_id: 'refund-a',
          paid_at: new Date('2030-08-20T00:00:00.000Z'),
          created_at: new Date('2030-08-19T00:00:00.000Z'), version: 3,
        }]
      },
      one(sql) {
        if (sql.includes('AS order_count')) {
          return {
            order_count: 1, paid_order_count: 1, event_gross_amount: 20_000,
            membership_gross_amount: 0, gross_amount: 20_000, refunded_amount: 5_000,
          }
        }
        return { paid_orders: 1, pending_refunds: 2 }
      },
    })
    const adapter = repository(database)
    const visibility = { platform: false, branchIds: [BRANCH_ID], eventIds: [] }
    const filters = { query: '城市', orderType: 'EVENT', refundStatus: 'SUCCEEDED' }

    const page = await adapter.listOrders(APP_ID, visibility, filters, 20)
    const summary = await adapter.summarizeOrders(APP_ID, visibility, filters)
    const dashboardSummary = await adapter.listOrderSummary(APP_ID, visibility)

    assert.equal(page.items[0].resourceTitle, '城市活动')
    assert.equal(page.items[0].merchantOrderNoMasked, 'MIP-…0001')
    assert.equal(page.items[0].providerTransactionIdMasked, 'WX-T…0001')
    assert.deepEqual(summary, {
      currency: 'CNY', orderCount: 1, paidOrderCount: 1,
      eventGrossAmountCents: 20_000, membershipGrossAmountCents: 0,
      grossAmountCents: 20_000, refundedAmountCents: 5_000, netAmountCents: 15_000,
    })
    assert.deepEqual(dashboardSummary, { paidOrders: 1, pendingRefunds: 2 })
    const sql = database.calls.map(call => call.sql).join('\n')
    assert.match(sql, /e\.branch_id IN \(\?\)/)
    assert.match(sql, /ORDER BY rf\.created_at DESC, rf\.id DESC LIMIT 1\) = \?/)
    const listSql = database.calls.find(call => call.sql.includes('SELECT o.id, o.user_id')).sql
    assert.match(listSql, /entitlement\.order_id = o\.id\s+AND entitlement\.source_type = 'ORDER'/)
    assert.equal(database.calls.every(call => call.params[0] === APP_ID), true)
  })

  it('commits event refund, registration, audit and outbox facts in one transaction', async () => {
    const database = databaseHarness({
      one(sql) {
        if (sql.includes('SELECT order_type, resource_id FROM mip_orders')) {
          return { order_type: 'EVENT', resource_id: EVENT_ID }
        }
        if (sql.includes('SELECT id, branch_id FROM mip_events')) {
          return { id: EVENT_ID, branch_id: BRANCH_ID }
        }
        if (sql.includes('SELECT id, user_id, order_type')) {
          return {
            id: 'order-a', user_id: 'user-a', order_type: 'EVENT', resource_id: EVENT_ID,
            amount_cents: 12_000, status: 'PAID', version: 4,
            paid_at: new Date('2030-08-20T00:00:00.000Z'), product_snapshot_json: '{}',
          }
        }
        if (sql.includes('FROM mip_event_registrations')) {
          return { id: 'registration-a', user_id: 'user-a', status: 'REGISTERED', version: 2 }
        }
        if (sql.includes('FROM mip_event_checkins')) return null
        if (sql.includes('idempotency_key')) return null
        if (sql.includes('COALESCE(SUM(amount_cents)')) return { refunded: 0 }
        assert.fail(`unexpected one query: ${sql}`)
      },
    })
    let checkedScope
    const adapter = repository(database, {
      assertMutationScope(_authorization, scope) { checkedScope = scope },
    })

    const result = await adapter.submitRefund({
      appId: APP_ID,
      actorUserId: 'admin-a',
      orderId: 'order-a',
      reason: '运营退款',
      idempotencyKey: 'refund-request-a',
      authorizedScope: { scopeType: 'EVENT', scopeId: EVENT_ID, branchId: BRANCH_ID },
      audit: (refundId, amountCents) => audit(refundId, amountCents),
    })

    assert.deepEqual(result, {
      id: 'generated-1', orderId: 'order-a', amountCents: 12_000,
      status: 'PENDING', idempotent: false,
    })
    assert.deepEqual(checkedScope, { scopeType: 'EVENT', scopeId: EVENT_ID, branchId: BRANCH_ID })
    assert.equal(database.transactions, 1)
    assert.equal(database.calls.every(call => call.transactionActive), true)
    const sql = database.calls.map(call => call.sql).join('\n')
    assert.match(sql, /mip_event_checkins/)
    assert.match(sql, /INSERT INTO mip_refunds/)
    assert.match(sql, /UPDATE mip_orders SET status = 'REFUND_PENDING'/)
    assert.match(sql, /UPDATE mip_event_registrations SET/)
    assert.match(sql, /INSERT INTO mip_audit_logs/)
    assert.equal(database.calls.filter(call => call.sql.includes('INSERT INTO mip_outbox_events')).length, 2)
  })

  it('rejects a reused refund key when the business reason changes', async () => {
    const database = databaseHarness({
      one(sql) {
        if (sql.includes('SELECT order_type, resource_id FROM mip_orders')) {
          return { order_type: 'MEMBERSHIP', resource_id: 'plan-a' }
        }
        if (sql.includes('SELECT id, user_id, order_type')) {
          return {
            id: 'order-a', user_id: 'user-a', order_type: 'MEMBERSHIP', resource_id: 'plan-a',
            amount_cents: 6_000, status: 'PAID', version: 1, product_snapshot_json: '{}',
          }
        }
        if (sql.includes('FROM mip_refunds') && sql.includes('idempotency_key')) {
          return { id: 'refund-a', amount_cents: 6_000, status: 'PENDING', version: 1, reason: '原退款原因' }
        }
        assert.fail(`unexpected one query: ${sql}`)
      },
    })
    const adapter = repository(database)

    await assert.rejects(() => adapter.submitRefund({
      appId: APP_ID,
      actorUserId: 'admin-a',
      orderId: 'order-a',
      reason: '新的退款原因',
      idempotencyKey: 'refund-request-reused',
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null, branchId: null },
      audit: () => audit('refund-a', 6_000),
    }), /IDEMPOTENCY_CONFLICT/)
    assert.equal(database.calls.filter(call => call.method === 'query').length, 0)
  })

  it('locks retry scope and writes its audit before returning authorization', async () => {
    const database = databaseHarness({
      one(sql) {
        if (sql.includes('FROM mip_refunds')) {
          return { id: 'refund-a', order_id: 'order-a', status: 'PENDING' }
        }
        if (sql.includes('FROM mip_orders')) {
          return { id: 'order-a', order_type: 'EVENT', resource_id: EVENT_ID }
        }
        if (sql.includes('FROM mip_events')) return { id: EVENT_ID, branch_id: BRANCH_ID }
        assert.fail(`unexpected one query: ${sql}`)
      },
    })
    const adapter = repository(database)

    const result = await adapter.authorizeRefundRetry({
      appId: APP_ID,
      actorUserId: 'admin-a',
      refundId: 'refund-a',
      authorizedScope: { scopeType: 'EVENT', scopeId: EVENT_ID, branchId: BRANCH_ID },
      audit: { ...audit('refund-a'), action: 'admin.refunds.retry' },
    })

    assert.deepEqual(result, { id: 'refund-a', status: 'PENDING' })
    assert.equal(database.transactions, 1)
    assert.equal(database.calls.every(call => call.transactionActive), true)
    assert.match(database.calls.at(-1).sql, /INSERT INTO mip_audit_logs/)
  })
})
