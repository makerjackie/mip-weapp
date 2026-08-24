'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  applyPaymentCallback,
  assertPaymentMatches,
  getPayableOrder,
  getRefundRequestForProvider,
  listPendingRefunds,
  markRefundFailed,
  markRefundManualReview,
  rebuildMembershipEntitlements,
  membershipAttribution,
} = require('../domain/ledger')

const paidAt = new Date('2026-08-24T00:00:00.000Z')
const order = {
  id: '10000000-0000-4000-8000-000000000001',
  app_id: 'app-1',
  user_id: '20000000-0000-4000-8000-000000000001',
  order_type: 'MEMBERSHIP',
  membership_plan_id: '30000000-0000-4000-8000-000000000001',
  merchant_order_no: 'MIP100',
  amount_cents: 79900,
  currency: 'CNY',
  status: 'PAYMENT_CREATED',
  version: 2,
  product_snapshot_json: JSON.stringify({ durationDays: 30, name: '月度玩家' }),
  catalog_stage: 'TEST',
  plan_status: 'ACTIVE',
}

describe('mip payment ledger', () => {
  it('fails on merchant number, amount, or currency mismatch', () => {
    const input = {
      merchantOrderNo: order.merchant_order_no,
      amountCents: order.amount_cents,
      currency: order.currency,
    }
    assert.doesNotThrow(() => assertPaymentMatches(order, input))
    assert.throws(() => assertPaymentMatches(order, { ...input, amountCents: 1 }), /AMOUNT_MISMATCH/)
  })

  it('serves a payable order only from the matching catalog stage', async () => {
    const db = { one: async () => order }
    const result = await getPayableOrder(db, {
      appId: 'app-1',
      orderId: order.id,
      identityKey: 'identity-1',
      paymentMode: 'test',
    })
    assert.equal(result.amountCents, 79900)
    await assert.rejects(() => getPayableOrder(db, {
      appId: 'app-1',
      orderId: order.id,
      identityKey: 'identity-1',
      paymentMode: 'live',
    }), /PAYMENT_MODE_MISMATCH/)
  })

  it('serves provider refund facts without trusting a caller identity or amount', async () => {
    const sqlCalls = []
    const db = {
      async one(sql, params) {
        sqlCalls.push({ sql, params })
        return {
          id: '20000000-0000-4000-8000-000000000001',
          order_id: order.id,
          user_id: order.user_id,
          merchant_order_no: order.merchant_order_no,
          merchant_refund_no: 'MIPR123',
          amount_cents: 19900,
          order_amount_cents: order.amount_cents,
          currency: 'CNY',
          status: 'PENDING',
          order_status: 'REFUND_PENDING',
        }
      },
    }
    const result = await getRefundRequestForProvider(db, {
      appId: 'app-1', refundId: '20000000-0000-4000-8000-000000000001', amountCents: 1,
    })
    assert.equal(result.amountCents, 19900)
    assert.doesNotMatch(sqlCalls[0].sql, /mip_user_identities/)
    assert.deepEqual(sqlCalls[0].params, ['app-1', result.id])
  })

  it('lists only active refund facts for controlled recovery', async () => {
    const calls = []
    const result = await listPendingRefunds({
      async query(sql, params) {
        calls.push({ sql, params })
        return [{ id: 'refund-a' }, { id: 'refund-b' }]
      },
    }, { appId: 'app-1', limit: 2 })
    assert.deepEqual(result, { refundIds: ['refund-a', 'refund-b'] })
    assert.match(calls[0].sql, /'PENDING', 'PROVIDER_CREATED', 'PROCESSING'/)
    assert.match(calls[0].sql, /MANUAL_REVIEW_CHANGE/)
    assert.deepEqual(calls[0].params, ['app-1', 2])
  })

  it('keeps provider CHANGE reserved as a non-retriable manual review fact', async () => {
    const calls = []
    const refund = {
      id: '20000000-0000-4000-8000-000000000001',
      merchant_refund_no: 'MIPR123',
      status: 'PROVIDER_CREATED',
      version: 3,
    }
    const db = {
      transaction: work => work({
        async one(sql, params) {
          calls.push({ sql, params })
          return refund
        },
        async query(sql, params) {
          calls.push({ sql, params })
          return { affectedRows: 1 }
        },
      }),
    }
    const result = await markRefundManualReview(db, {
      appId: 'app-1',
      refundId: refund.id,
      merchantRefundNo: refund.merchant_refund_no,
      reasonCode: 'CHANGE',
    })
    assert.deepEqual(result, { status: 'PROCESSING', manualReview: true, idempotent: false })
    assert.ok(calls.some(call => String(call.sql).includes("SET status = 'PROCESSING', last_error_code = ?")
      && call.params[0] === 'MANUAL_REVIEW_CHANGE'))
    assert.equal(calls.some(call => String(call.sql).includes('UPDATE mip_orders')), false)
    await assert.rejects(() => markRefundManualReview(db, {
      appId: 'app-1',
      refundId: refund.id,
      merchantRefundNo: refund.merchant_refund_no,
      reasonCode: 'REFUNDCLOSE',
    }), /REFUND_MANUAL_REVIEW_REASON_INVALID/)
  })

  it('allows only authoritative REFUNDCLOSE to release a refund reservation', async () => {
    let called = false
    await assert.rejects(() => markRefundFailed({
      transaction: async () => { called = true },
    }, {
      appId: 'app-1',
      refundId: '20000000-0000-4000-8000-000000000001',
      merchantRefundNo: 'MIPR123',
      reasonCode: 'CHANGE',
    }), /REFUND_FAILURE_REASON_INVALID/)
    assert.equal(called, false)
  })

  it('persists PAID before entitlement and outbox facts in one transaction', async () => {
    const statements = []
    let callbackHash
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_payment_callbacks')) {
          return {
            resource_hash: callbackHash,
            verification_status: 'VERIFIED',
            processing_status: 'RECEIVED',
          }
        }
        if (sql.includes('FROM mip_orders')) {
          return order
        }
        return null
      },
      async query(sql, params) {
        statements.push(sql)
        if (sql.includes('INSERT INTO mip_payment_callbacks')) {
          callbackHash = params[3]
        }
        if (sql.includes("FROM mip_orders\n     WHERE") && sql.includes("status = 'PAID'")) {
          return [{
            id: order.id,
            membership_plan_id: order.membership_plan_id,
            paid_at: paidAt,
            product_snapshot_json: order.product_snapshot_json,
          }]
        }
        if (sql.includes('FROM mip_membership_entitlements')) {
          return []
        }
        return { affectedRows: 1 }
      },
    }
    const db = { transaction: work => work(tx) }
    const ids = idFactory()
    const result = await applyPaymentCallback(db, {
      appId: 'app-1',
      orderId: order.id,
      identityKey: 'identity-1',
      merchantOrderNo: order.merchant_order_no,
      providerTransactionId: 'provider-transaction-1',
      amountCents: order.amount_cents,
      currency: order.currency,
    }, { createId: ids, now: () => paidAt })
    assert.deepEqual(result, { status: 'PAID', idempotent: false })
    const orderUpdate = statements.findIndex(sql => sql.includes("SET status = 'PAID'"))
    const entitlementWrite = statements.findIndex(sql => sql.includes('INSERT INTO mip_membership_entitlements'))
    const outboxWrite = statements.findIndex(sql => sql.includes('INSERT INTO mip_outbox_events'))
    const callbackProcessed = statements.findIndex(sql => sql.includes("processing_status = 'PROCESSED'"))
    assert.ok(orderUpdate >= 0
      && entitlementWrite > orderUpdate
      && outboxWrite > entitlementWrite
      && callbackProcessed > outboxWrite)
  })

  it('rejects a duplicate provider callback whose immutable facts changed', async () => {
    const paidOrder = {
      ...order,
      status: 'PAID',
      provider_transaction_id: 'provider-transaction-1',
    }
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_payment_callbacks')) {
          return {
            resource_hash: '0'.repeat(64),
            verification_status: 'VERIFIED',
            processing_status: 'PROCESSED',
          }
        }
        return paidOrder
      },
      async query() {
        return { affectedRows: 1 }
      },
    }
    await assert.rejects(() => applyPaymentCallback({ transaction: work => work(tx) }, {
      appId: 'app-1',
      orderId: paidOrder.id,
      identityKey: 'identity-1',
      merchantOrderNo: paidOrder.merchant_order_no,
      providerTransactionId: paidOrder.provider_transaction_id,
      amountCents: paidOrder.amount_cents,
      currency: paidOrder.currency,
    }), /CALLBACK_RESOURCE_MISMATCH/)
  })

  it('rebuilds remaining membership windows after refund without overlap', async () => {
    const writes = []
    const tx = {
      async query(sql, params) {
        if (sql.includes("FROM mip_orders\n     WHERE")) {
          return [
            {
              id: 'order-1',
              membership_plan_id: 'plan-1',
              paid_at: new Date('2026-08-01T00:00:00.000Z'),
              product_snapshot_json: JSON.stringify({ durationDays: 30 }),
            },
            {
              id: 'order-2',
              membership_plan_id: 'plan-1',
              paid_at: new Date('2026-08-15T00:00:00.000Z'),
              product_snapshot_json: JSON.stringify({ durationDays: 30 }),
            },
          ]
        }
        if (sql.includes('FROM mip_membership_entitlements')) {
          return []
        }
        if (sql.includes('INSERT INTO mip_membership_entitlements')) {
          writes.push(params)
        }
        return { affectedRows: 1 }
      },
    }
    await rebuildMembershipEntitlements(tx, 'app-1', order.user_id, {
      createId: idFactory(),
      now: () => paidAt,
    })
    assert.equal(writes.length, 2)
    assert.equal(new Date(writes[0][6]).toISOString(), '2026-08-01T00:00:00.000Z')
    assert.equal(new Date(writes[0][7]).toISOString(), '2026-08-31T00:00:00.000Z')
    assert.equal(new Date(writes[1][6]).toISOString(), '2026-08-31T00:00:00.000Z')
    assert.equal(new Date(writes[1][7]).toISOString(), '2026-09-30T00:00:00.000Z')
  })

  it('locks the server-captured invitation on entitlement fulfillment', async () => {
    const inviterUserId = '50000000-0000-4000-8000-000000000001'
    const tokenHash = 'a'.repeat(64)
    assert.deepEqual(membershipAttribution({
      attribution: { sourceType: 'USER', invitedByUserId: inviterUserId, sourceTokenHash: tokenHash },
    }, order.user_id), {
      sourceType: 'USER',
      invitedByUserId: inviterUserId,
      sourceTokenHash: tokenHash,
    })
    assert.deepEqual(membershipAttribution({}, order.user_id), {
      sourceType: 'PLATFORM',
      invitedByUserId: null,
      sourceTokenHash: null,
    })
    assert.throws(() => membershipAttribution({
      attribution: { sourceType: 'USER', invitedByUserId: order.user_id, sourceTokenHash: tokenHash },
    }, order.user_id), /ENTITLEMENT_SOURCE_INVALID/)
  })
})

function idFactory() {
  let sequence = 0
  return () => `40000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
}
