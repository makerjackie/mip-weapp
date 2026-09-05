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
    hold_order_id: '10000000-0000-4000-8000-000000000001',
    event_id: '30000000-0000-4000-8000-000000000001',
    user_id: '20000000-0000-4000-8000-000000000001',
    hold_status: 'ACTIVE',
    hold_expires_at: '2026-08-24T04:15:00.000Z',
    registration_id: '50000000-0000-4000-8000-000000000001',
    registration_order_id: '10000000-0000-4000-8000-000000000001',
    registration_event_id: '30000000-0000-4000-8000-000000000001',
    registration_user_id: '20000000-0000-4000-8000-000000000001',
    registration_status: 'PAYMENT_PENDING',
    registration_version: 1,
    ...overrides,
  }
}

function fakeDatabase(order, relation, affectedRows = () => 1) {
  const calls = []
  let callbackHash
  return {
    calls,
    async one(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'one', sql: normalized, params })
      return paymentRouteRow(order)
    },
    async transaction(work) {
      return work({
        async one(sql, params) {
          const normalized = String(sql).replace(/\s+/g, ' ').trim()
          calls.push({ kind: 'one', sql: normalized, params })
          if (normalized.includes('FROM mip_user_identities')) return paymentIdentity(order)
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
          return { affectedRows: affectedRows(normalized) }
        },
      })
    },
  }
}

function refundDatabase(order, refund, tx, calls) {
  return {
    async one(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'one', sql: normalized, params })
      return {
        ...refund,
        refund_id: refund.id,
        app_id: order.app_id,
        user_id: order.user_id,
        order_type: order.order_type,
        merchant_order_no: order.merchant_order_no,
        merchant_refund_no: refund.merchant_refund_no,
        provider_refund_id: refund.provider_refund_id,
        refund_amount_cents: refund.amount_cents,
        refund_status: refund.status,
        order_amount_cents: order.amount_cents,
        currency: order.currency,
        order_status: order.status,
      }
    },
    transaction: work => work(tx),
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

function paymentRouteRow(order) {
  const identity = paymentIdentity(order)
  return {
    ...order,
    order_id: order.id,
    identity_id: identity.id,
    identity_key: identity.identity_key,
    closed_identity_key: identity.closed_identity_key,
  }
}

function paymentIdentity(order, overrides = {}) {
  return {
    id: '70000000-0000-4000-8000-000000000001',
    app_id: order.app_id,
    user_id: order.user_id,
    provider: 'WECHAT_MINIPROGRAM',
    identity_key: 'identity-1',
    closed_identity_key: null,
    ...overrides,
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
    const identityLock = db.calls.findIndex(call => call.sql.includes('FROM mip_user_identities'))
    const orderLock = db.calls.findIndex(call => call.sql.startsWith('SELECT * FROM mip_orders'))
    assert.ok(identityLock >= 0 && orderLock > identityLock)
    assert.equal(db.calls.some(call => call.sql.includes('FROM mip_users')), false)
  })

  it('fails closed for dirty event registration, hold, or relation facts', async () => {
    const dirtyFacts = [
      [fulfillment({ registration_status: 'REGISTERED' }), /EVENT_FULFILLMENT_INVALID/],
      [fulfillment({ hold_status: 'CONSUMED' }), /EVENT_FULFILLMENT_INVALID/],
      [fulfillment({ registration_user_id: 'different-user' }), /EVENT_ORDER_INVALID/],
    ]
    for (const [relation, expected] of dirtyFacts) {
      const db = fakeDatabase(eventOrder(), relation)
      await assert.rejects(
        applyPaymentCallback(db, paymentInput(eventOrder()), {
          createId: idFactory(),
          now: () => paidAt,
        }),
        expected,
      )
      assert.equal(db.calls.some(call => call.sql.includes('event.registration_confirmed')), false)
    }
  })

  it('rolls back confirmation when the locked hold or registration conditional write loses a race', async () => {
    for (const lostWrite of ['mip_event_seat_holds SET status', 'mip_event_registrations SET status']) {
      const order = eventOrder()
      const db = fakeDatabase(order, fulfillment(), sql => sql.includes(lostWrite) ? 0 : 1)
      await assert.rejects(
        applyPaymentCallback(db, paymentInput(order), {
          createId: idFactory(),
          now: () => paidAt,
        }),
        lostWrite.includes('seat_holds')
          ? /EVENT_SEAT_HOLD_STATUS_CONFLICT/
          : /EVENT_REGISTRATION_STATUS_CONFLICT/,
      )
      assert.equal(db.calls.some(call => call.sql.includes('event.registration_confirmed')), false)
    }
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
    const eventLockIndex = db.calls.findIndex(call => call.sql.includes('FROM mip_events'))
    const fulfillmentIndex = db.calls.findIndex(call => call.sql.includes('FROM mip_event_seat_holds'))
    assert.ok(eventLockIndex >= 0 && eventLockIndex < fulfillmentIndex)
    assert.match(db.calls[eventLockIndex].sql, /FOR UPDATE/)
    assert.deepEqual(db.calls[eventLockIndex].params, [order.app_id, order.resource_id])
    assert.ok(result.refundId)
    assert.ok(db.calls.some(call => call.sql.includes("mip_orders SET status = 'REFUND_PENDING'")))
    assert.ok(db.calls.some(call => call.sql.includes('INSERT INTO mip_refunds')))
    assert.equal(db.calls.some(call => call.sql.includes("mip_event_registrations SET status = 'REGISTERED'")), false)
  })

  it('records a late payment on a replaced cancelled order for refund without touching the new registration', async () => {
    const order = eventOrder({ status: 'CLOSED' })
    const db = fakeDatabase(order, fulfillment({
      registration_id: null,
      registration_order_id: null,
      hold_status: 'CANCELLED',
    }))
    const result = await applyPaymentCallback(db, paymentInput(order), {
      createId: idFactory(), now: () => paidAt,
    })
    assert.equal(result.status, 'REFUND_PENDING')
    const refund = db.calls.find(call => call.sql.includes('INSERT INTO mip_refunds'))
    assert.ok(refund.sql.includes("'PENDING', NULL"))
    assert.equal(refund.params[2], order.id)
    assert.equal(refund.params[6], order.amount_cents)
    assert.equal(db.calls.some(call => call.sql.includes('UPDATE mip_event_registrations')), false)
    assert.ok(db.calls.some(call => call.sql.includes("processing_status = 'PROCESSED'")))
  })

  it('does not reconcile a detached order when its hold belongs to a different user', async () => {
    const order = eventOrder({ status: 'CLOSED' })
    const db = fakeDatabase(order, fulfillment({
      registration_id: null, user_id: 'another-user', hold_status: 'CANCELLED',
    }))
    await assert.rejects(applyPaymentCallback(db, paymentInput(order), {
      createId: idFactory(), now: () => paidAt,
    }), /EVENT_ORDER_INVALID/)
    assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO mip_refunds')), false)
  })

  it('creates no refund or outbox when the locked late-payment registration write loses a race', async () => {
    const order = eventOrder()
    const db = fakeDatabase(order, fulfillment({
      hold_expires_at: '2026-08-24T04:04:59.000Z',
    }), sql => sql.includes("SET status = 'CANCELLATION_PENDING'") ? 0 : 1)
    await assert.rejects(
      applyPaymentCallback(db, paymentInput(order), {
        createId: idFactory(),
        now: () => paidAt,
      }),
      /EVENT_REGISTRATION_STATUS_CONFLICT/,
    )
    assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO mip_refunds')), false)
    assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO mip_outbox_events')), false)
  })

  it('returns an idempotent late-payment result before touching fulfillment facts', async () => {
    const order = eventOrder({
      status: 'REFUND_PENDING',
      provider_transaction_id: 'provider-transaction-1',
    })
    const db = fakeDatabase(order, fulfillment())
    const result = await applyPaymentCallback(db, paymentInput(order), {
      createId: idFactory(),
      now: () => paidAt,
    })
    assert.deepEqual(result, { status: 'REFUND_PENDING', idempotent: true })
    assert.equal(db.calls.some(call => call.sql.includes('FROM mip_event_seat_holds')), false)
    assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO mip_refunds')), false)
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
      app_id: order.app_id,
      order_id: order.id,
      merchant_refund_no: 'MIPR70000000000040008000000000000001',
      provider_refund_id: null,
      amount_cents: order.amount_cents,
      status: 'PROCESSING',
      last_error_code: 'MANUAL_REVIEW_CHANGE',
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
        if (normalized.includes('FROM mip_event_registrations')) {
          return {
            id: '50000000-0000-4000-8000-000000000001',
            event_id: order.resource_id,
            user_id: order.user_id,
            status: 'CANCELLATION_PENDING',
            version: 3,
          }
        }
        if (normalized.includes('FROM mip_event_checkins')) return null
        return order
      },
      async query(sql, params) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim()
        calls.push({ kind: 'query', sql: normalized, params })
        if (normalized.includes('INSERT INTO mip_payment_callbacks')) callbackHash = params[3]
        return { affectedRows: 1 }
      },
    }
    const result = await applyRefundCallback(refundDatabase(order, refund, tx, calls), {
      appId: order.app_id,
      merchantOrderNo: order.merchant_order_no,
      merchantRefundNo: refund.merchant_refund_no,
      providerRefundId: 'provider-refund-1',
      amountCents: refund.amount_cents,
    }, { createId: idFactory(), now: () => paidAt })
    assert.deepEqual(result, { status: 'SUCCEEDED', orderStatus: 'REFUNDED', idempotent: false })
    assert.ok(calls.some(call => call.sql.includes('last_error_code = NULL')))
    assert.ok(calls.some(call => call.sql.includes("mip_event_registrations SET status = 'CANCELLED'")))
    assert.ok(calls.some(call => call.params?.includes('event.registration_cancelled')))
  })

  it('settles a replaced order refund without cancelling or inspecting checkin on the new registration', async () => {
    const order = eventOrder({ status: 'REFUND_PENDING', provider_transaction_id: 'provider-transaction-1' })
    const refund = {
      id: '70000000-0000-4000-8000-000000000001',
      app_id: order.app_id,
      order_id: order.id,
      merchant_refund_no: 'MIPR70000000000040008000000000000001',
      provider_refund_id: null,
      amount_cents: order.amount_cents,
      status: 'PROCESSING',
      last_error_code: null,
      idempotency_key: `event-late-payment:${order.id}`,
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
        if (normalized.includes('FROM mip_event_registrations')) return null
        if (normalized.includes('FROM mip_event_seat_holds')) return { id: 'old-hold' }
        if (normalized.includes('FROM mip_event_checkins')) return null
        return order
      },
      async query(sql, params) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim()
        calls.push({ kind: 'query', sql: normalized, params })
        if (normalized.includes('INSERT INTO mip_payment_callbacks')) callbackHash = params[3]
        return { affectedRows: 1 }
      },
    }
    const result = await applyRefundCallback(refundDatabase(order, refund, tx, calls), {
      appId: order.app_id,
      merchantOrderNo: order.merchant_order_no,
      merchantRefundNo: refund.merchant_refund_no,
      providerRefundId: 'provider-refund-1',
      amountCents: refund.amount_cents,
    }, { createId: idFactory(), now: () => paidAt })
    assert.deepEqual(result, { status: 'SUCCEEDED', orderStatus: 'REFUNDED', idempotent: false })
    assert.ok(calls.some(call => call.sql.includes('last_error_code = NULL')))
    assert.equal(calls.some(call => call.sql.includes('UPDATE mip_event_registrations')), false)
    assert.equal(calls.some(call => call.sql.includes('FROM mip_event_checkins')), false)
    assert.equal(calls.some(call => call.params?.includes('event.registration_cancelled')), false)
  })

  it('accepts a late authoritative success for a legacy FAILED CHANGE without a competing refund', async () => {
    const order = eventOrder({ status: 'PAID', provider_transaction_id: 'provider-transaction-1', version: 7 })
    const refund = {
      id: '70000000-0000-4000-8000-000000000001',
      app_id: order.app_id,
      order_id: order.id,
      merchant_refund_no: 'MIPR70000000000040008000000000000001',
      provider_refund_id: 'provider-refund-legacy',
      amount_cents: order.amount_cents,
      status: 'FAILED',
      last_error_code: 'CHANGE',
      version: 4,
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
        if (normalized.includes('FROM mip_event_registrations')) {
          return {
            id: '50000000-0000-4000-8000-000000000001',
            event_id: order.resource_id,
            user_id: order.user_id,
            status: 'CANCELLATION_PENDING',
            version: 3,
          }
        }
        if (normalized.includes('FROM mip_event_checkins')) return null
        return order
      },
      async query(sql, params) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim()
        calls.push({ kind: 'query', sql: normalized, params })
        if (normalized.includes('INSERT INTO mip_payment_callbacks')) callbackHash = params[3]
        if (normalized.includes('SELECT id, status, amount_cents FROM mip_refunds')) return []
        return { affectedRows: 1 }
      },
    }
    const result = await applyRefundCallback(refundDatabase(order, refund, tx, calls), {
      appId: order.app_id,
      merchantOrderNo: order.merchant_order_no,
      merchantRefundNo: refund.merchant_refund_no,
      providerRefundId: refund.provider_refund_id,
      amountCents: refund.amount_cents,
    }, { createId: idFactory(), now: () => paidAt })
    assert.deepEqual(result, { status: 'SUCCEEDED', orderStatus: 'REFUNDED', idempotent: false })
    assert.ok(calls.some(call => call.sql.includes("status IN ('REFUND_PENDING', 'PAID', 'PARTIALLY_REFUNDED')")))
  })

  it('records a failed callback for manual reconciliation and emits no false event outbox', async () => {
    const order = eventOrder({ status: 'REFUND_PENDING', provider_transaction_id: 'provider-transaction-1' })
    const refund = {
      id: '70000000-0000-4000-8000-000000000001',
      app_id: order.app_id,
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
        if (normalized.includes('FROM mip_refunds')) return refund
        if (normalized.includes('FROM mip_event_registrations')) {
          return {
            id: '50000000-0000-4000-8000-000000000001',
            event_id: order.resource_id,
            user_id: order.user_id,
            status: 'REGISTERED',
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
    await assert.rejects(
      applyRefundCallback(refundDatabase(order, refund, tx, calls), {
        appId: order.app_id,
        merchantOrderNo: order.merchant_order_no,
        merchantRefundNo: refund.merchant_refund_no,
        providerRefundId: 'provider-refund-reconcile',
        amountCents: refund.amount_cents,
      }, { createId: idFactory(), now: () => paidAt }),
      /EVENT_REFUND_RECONCILIATION_REQUIRED/,
    )
    assert.ok(calls.some(call => call.sql.includes("processing_status = 'FAILED'")
      && call.params?.includes('EVENT_REFUND_RECONCILIATION_REQUIRED')))
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_outbox_events')), false)
  })
})
