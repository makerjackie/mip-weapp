'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { applyPaymentCallback, applyRefundCallback, getPayableOrder } = require('../domain/ledger')

const paidAt = new Date('2026-08-24T04:05:00.000Z')

function eventOrder(overrides = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    app_id: 'app-1',
    user_id: '20000000-0000-4000-8000-000000000001',
    order_type: 'EVENT',
    resource_id: '30000000-0000-4000-8000-000000000001',
    merchant_order_no: 'MIPEVENT100',
    amount_cents: 9900,
    currency: 'CNY',
    status: 'PAYMENT_CREATED',
    version: 2,
    provider_transaction_id: null,
    ...overrides,
  }
}

function fulfillment(overrides = {}) {
  return {
    hold_id: '40000000-0000-4000-8000-000000000001',
    event_id: '30000000-0000-4000-8000-000000000001',
    user_id: '20000000-0000-4000-8000-000000000001',
    hold_status: 'ACTIVE',
    hold_expires_at: '2026-08-24T04:15:00.000Z',
    registration_id: '50000000-0000-4000-8000-000000000001',
    registration_status: 'PAYMENT_PENDING',
    registration_version: 1,
    ...overrides,
  }
}

function fakeDatabase(order, relation) {
  const calls = []
  let callbackHash
  return {
    calls,
    async transaction(work) {
      return work({
        async one(sql, params) {
          const normalized = String(sql).replace(/\s+/g, ' ').trim()
          calls.push({ kind: 'one', sql: normalized, params })
          if (normalized.includes('FROM mip_payment_callbacks')) {
            return {
              resource_hash: callbackHash,
              verification_status: 'VERIFIED',
              processing_status: 'RECEIVED',
            }
          }
          return normalized.includes('FROM mip_event_seat_holds') ? relation : order
        },
        async query(sql, params) {
          const normalized = String(sql).replace(/\s+/g, ' ').trim()
          calls.push({ kind: 'query', sql: normalized, params })
          if (normalized.includes('INSERT INTO mip_payment_callbacks')) callbackHash = params[3]
          return { affectedRows: 1 }
        },
      })
    },
  }
}

function paymentInput(order) {
  return {
    appId: order.app_id,
    orderId: order.id,
    identityKey: 'identity-1',
    merchantOrderNo: order.merchant_order_no,
    providerTransactionId: 'provider-transaction-1',
    amountCents: order.amount_cents,
    currency: order.currency,
  }
}

function idFactory() {
  let sequence = 0
  return () => `60000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
}

describe('canonical MIP event payment ledger', () => {
  it('refuses to issue payment parameters after the server seat hold expires', async () => {
    const order = eventOrder({
      hold_status: 'ACTIVE',
      hold_expires_at: '2026-08-24T04:04:59.000Z',
    })
    await assert.rejects(
      getPayableOrder({ one: async () => order }, paymentInput(order), { now: () => paidAt }),
      /EVENT_SEAT_HOLD_EXPIRED/,
    )
  })

  it('confirms the registration and consumes the seat hold in the canonical order transaction', async () => {
    const order = eventOrder()
    const db = fakeDatabase(order, fulfillment())
    const result = await applyPaymentCallback(db, paymentInput(order), {
      createId: idFactory(),
      now: () => paidAt,
    })
    assert.deepEqual(result, {
      status: 'PAID',
      registrationId: '50000000-0000-4000-8000-000000000001',
      idempotent: false,
    })
    assert.ok(db.calls.some(call => call.sql.includes("mip_orders SET status = 'PAID'")))
    assert.ok(db.calls.some(call => call.sql.includes("mip_event_seat_holds SET status = 'CONSUMED'")))
    assert.ok(db.calls.some(call => call.sql.includes("mip_event_registrations SET status = 'REGISTERED'")))
    assert.equal(db.calls.some(call => call.sql.includes('mip_event_orders')), false)
  })

  it('creates a full refund intent instead of granting an expired seat', async () => {
    const order = eventOrder()
    const db = fakeDatabase(order, fulfillment({
      hold_expires_at: '2026-08-24T04:04:59.000Z',
    }))
    const result = await applyPaymentCallback(db, paymentInput(order), {
      createId: idFactory(),
      now: () => paidAt,
    })
    assert.equal(result.status, 'REFUND_PENDING')
    assert.ok(result.refundId)
    assert.ok(db.calls.some(call => call.sql.includes("mip_orders SET status = 'REFUND_PENDING'")))
    assert.ok(db.calls.some(call => call.sql.includes('INSERT INTO mip_refunds')))
    assert.equal(db.calls.some(call => call.sql.includes("mip_event_registrations SET status = 'REGISTERED'")), false)
  })

  it('rejects a provider amount that differs from the server-owned order amount', async () => {
    const order = eventOrder()
    const db = fakeDatabase(order, fulfillment())
    await assert.rejects(
      applyPaymentCallback(db, { ...paymentInput(order), amountCents: 1 }, {
        createId: idFactory(),
        now: () => paidAt,
      }),
      /AMOUNT_MISMATCH/,
    )
  })

  it('finalizes event cancellation only after the full refund callback succeeds', async () => {
    const order = eventOrder({ status: 'REFUND_PENDING', provider_transaction_id: 'provider-transaction-1' })
    const refund = {
      id: '70000000-0000-4000-8000-000000000001',
      order_id: order.id,
      merchant_refund_no: 'MIPR70000000000040008000000000000001',
      provider_refund_id: null,
      amount_cents: order.amount_cents,
      status: 'PROCESSING',
      version: 2,
    }
    const calls = []
    let callbackHash
    const tx = {
      async one(sql, params) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim()
        calls.push({ kind: 'one', sql: normalized, params })
        if (normalized.includes('FROM mip_payment_callbacks')) {
          return {
            resource_hash: callbackHash,
            verification_status: 'VERIFIED',
            processing_status: 'RECEIVED',
          }
        }
        if (normalized.includes('COALESCE(SUM(amount_cents)')) return { total: order.amount_cents }
        if (normalized.includes('FROM mip_refunds')) return refund
        if (normalized.includes('JOIN mip_event_registrations')) {
          return {
            id: '50000000-0000-4000-8000-000000000001',
            event_id: order.resource_id,
            version: 3,
          }
        }
        return order
      },
      async query(sql, params) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim()
        calls.push({ kind: 'query', sql: normalized, params })
        if (normalized.includes('INSERT INTO mip_payment_callbacks')) callbackHash = params[3]
        return { affectedRows: 1 }
      },
    }
    const result = await applyRefundCallback({ transaction: work => work(tx) }, {
      appId: order.app_id,
      merchantOrderNo: order.merchant_order_no,
      merchantRefundNo: refund.merchant_refund_no,
      providerRefundId: 'provider-refund-1',
      amountCents: refund.amount_cents,
    }, { createId: idFactory(), now: () => paidAt })
    assert.deepEqual(result, { status: 'SUCCEEDED', orderStatus: 'REFUNDED', idempotent: false })
    assert.ok(calls.some(call => call.sql.includes("mip_event_registrations SET status = 'CANCELLED'")))
    assert.ok(calls.some(call => call.params?.includes('event.registration_cancelled')))
  })
})
