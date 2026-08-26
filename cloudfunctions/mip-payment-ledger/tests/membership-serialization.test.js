'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  applyPaymentCallback,
  applyRefundCallback,
  markRefundFailed,
  rebuildMembershipEntitlements,
} = require('../domain/ledger')
const { lockMembershipChain } = require('../domain/membership-locks')

const appId = 'app-1'
const userId = '20000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-24T00:00:00.000Z')

describe('membership ledger serialization and dual-source projection', () => {
  it('serializes two orders through identity, chain, then current order locks', async () => {
    const mutex = createMutex()
    const events = []
    const firstLocked = deferred()
    const first = membershipOrder('10000000-0000-4000-8000-000000000001')
    const second = membershipOrder('10000000-0000-4000-8000-000000000002')
    const firstWork = applyPaymentCallback(
      concurrentPaymentDatabase('A', first, mutex, events, firstLocked),
      paymentInput(first, 'provider-a'),
      { createId: idFactory(), now: () => now },
    )
    await firstLocked.promise
    const secondWork = applyPaymentCallback(
      concurrentPaymentDatabase('B', second, mutex, events),
      paymentInput(second, 'provider-b'),
      { createId: idFactory(), now: () => now },
    )
    await Promise.all([firstWork, secondWork])
    assert.ok(events.indexOf('A:identity') < events.indexOf('A:chain'))
    assert.ok(events.indexOf('A:chain') < events.indexOf('A:order'))
    assert.ok(events.indexOf('A:release') < events.indexOf('B:identity'))
    assert.ok(events.indexOf('B:identity') < events.indexOf('B:chain'))
    assert.ok(events.indexOf('B:chain') < events.indexOf('B:order'))
    assert.ok(events.indexOf('A:sources') < events.indexOf('A:release'))
    assert.ok(events.indexOf('B:sources') < events.indexOf('B:release'))
  })

  it('keeps a REFUND_PENDING order in the chain while another payment is fulfilled', async () => {
    const first = membershipOrder('10000000-0000-4000-8000-000000000001', {
      status: 'REFUND_PENDING',
      paid_at: new Date('2026-08-01T00:00:00.000Z'),
    })
    const second = membershipOrder('10000000-0000-4000-8000-000000000002', {
      paid_at: new Date('2026-08-15T00:00:00.000Z'),
    })
    const firstEntitlement = orderEntitlement(first, {
      starts_at: new Date('2026-08-01T00:00:00.000Z'),
      ends_at: new Date('2026-08-31T00:00:00.000Z'),
    })
    const harness = rebuildHarness({
      orders: [first, second],
      entitlements: [firstEntitlement],
    })
    const result = await runRebuild(harness)
    assert.equal(result.changed, true)
    assert.match(harness.sourceSql, /status IN \('PAID', 'REFUND_PENDING'\)/)
    assert.match(harness.sourceSql, /succeeded_refund\.status = 'SUCCEEDED'/)
    assert.equal(harness.calls.some(call => call.sql.includes("revocation_reason = 'ORDER_REFUNDED'")
      && call.params.includes(firstEntitlement.id)), false)
    const secondInsert = harness.calls.find(call => call.sql.includes('INSERT INTO mip_membership_entitlements'))
    assert.equal(new Date(secondInsert.params[6]).toISOString(), '2026-08-31T00:00:00.000Z')
    assert.equal(new Date(secondInsert.params[7]).toISOString(), '2026-09-30T00:00:00.000Z')
  })

  it('places a complete ORDER duration after one and multiple manual blockers', async () => {
    const order = membershipOrder('10000000-0000-4000-8000-000000000001', {
      paid_at: new Date('2026-08-01T00:00:00.000Z'),
      product_snapshot_json: JSON.stringify({ durationDays: 10 }),
    })
    for (const [manual, expectedStart, expectedEnd] of [
      [[manualEntitlement('a', '2026-08-05', '2026-08-10')], '2026-08-10', '2026-08-20'],
      [[
        manualEntitlement('a', '2026-08-05', '2026-08-10'),
        manualEntitlement('b', '2026-08-15', '2026-08-20'),
      ], '2026-08-20', '2026-08-30'],
    ]) {
      const harness = rebuildHarness({ orders: [order], entitlements: manual })
      await runRebuild(harness)
      const insert = harness.calls.find(call => call.sql.includes('INSERT INTO mip_membership_entitlements'))
      assert.equal(new Date(insert.params[6]).toISOString(), `${expectedStart}T00:00:00.000Z`)
      assert.equal(new Date(insert.params[7]).toISOString(), `${expectedEnd}T00:00:00.000Z`)
      for (const blocker of manual) {
        assert.equal(harness.calls.some(call => call.sql.startsWith('UPDATE mip_membership_entitlements')
          && call.params.includes(blocker.id)), false)
      }
    }
  })

  it('treats touching half-open windows as non-overlapping and never rewrites manual facts', async () => {
    const order = membershipOrder('10000000-0000-4000-8000-000000000001', {
      paid_at: new Date('2026-08-01T00:00:00.000Z'),
      product_snapshot_json: JSON.stringify({ durationDays: 10 }),
    })
    const manual = manualEntitlement('touching', '2026-08-11', '2026-08-20')
    const harness = rebuildHarness({ orders: [order], entitlements: [manual] })
    await runRebuild(harness)
    const insert = harness.calls.find(call => call.sql.includes('INSERT INTO mip_membership_entitlements'))
    assert.equal(new Date(insert.params[6]).toISOString(), '2026-08-01T00:00:00.000Z')
    assert.equal(new Date(insert.params[7]).toISOString(), '2026-08-11T00:00:00.000Z')
    assert.equal(harness.calls.some(call => call.sql.startsWith('UPDATE mip_membership_entitlements')), false)
  })

  it('leaves a manual-only projection and chain version unchanged', async () => {
    const manual = manualEntitlement('only', '2026-08-01', '2026-09-01')
    const harness = rebuildHarness({ orders: [], entitlements: [manual] })
    const result = await runRebuild(harness)
    assert.deepEqual(result, { changed: false, chainVersion: 1, membershipActive: true })
    assert.equal(harness.calls.some(call => mutation(call.sql)), false)
  })

  it('returns an idempotent payment without a chain bump when a waiter holds an old route', async () => {
    const paid = membershipOrder('10000000-0000-4000-8000-000000000001', {
      status: 'PAID',
      provider_transaction_id: 'provider-duplicate',
    })
    const routed = {
      ...paid,
      status: 'PAYMENT_CREATED',
      provider_transaction_id: null,
    }
    const calls = []
    let callbackHash
    const tx = {
      async one(sql) {
        const normalized = normalize(sql)
        calls.push({ kind: 'one', sql: normalized })
        if (normalized.includes('FROM mip_user_identities')) return paymentIdentity(paid)
        if (normalized.includes('FROM mip_membership_chains')) return chainRow()
        if (normalized.includes('FROM mip_payment_callbacks')) {
          return {
            resource_hash: callbackHash,
            verification_status: 'VERIFIED',
            processing_status: 'PROCESSED',
          }
        }
        return paid
      },
      async query(sql, params) {
        const normalized = normalize(sql)
        calls.push({ kind: 'query', sql: normalized, params })
        if (normalized.includes('INSERT INTO mip_payment_callbacks')) callbackHash = params[3]
        return { affectedRows: 1 }
      },
    }
    const result = await applyPaymentCallback({
      one: async () => paymentRouteRow(routed),
      transaction: work => work(tx),
    }, paymentInput(paid, paid.provider_transaction_id), { now: () => now })
    assert.deepEqual(result, { status: 'PAID', idempotent: true })
    assert.equal(calls.some(call => call.sql.includes('UPDATE mip_membership_chains')), false)
    assert.equal(calls.some(call => call.sql.includes('FROM mip_membership_entitlements')), false)
  })

  it('returns an idempotent refund after the first callback settles while the waiter holds an old route', async () => {
    const routedOrder = membershipOrder('10000000-0000-4000-8000-000000000001', {
      status: 'REFUND_PENDING',
    })
    const routedRefund = refundRow(routedOrder, {
      status: 'PROCESSING',
      provider_refund_id: null,
    })
    const settledOrder = { ...routedOrder, status: 'REFUNDED' }
    const settledRefund = {
      ...routedRefund,
      status: 'SUCCEEDED',
      provider_refund_id: 'provider-refund-duplicate',
    }
    const calls = []
    let callbackHash
    const result = await applyRefundCallback({
      one: async () => refundRouteRow(routedOrder, routedRefund),
      transaction: work => work({
        async one(sql) {
          const normalized = normalize(sql)
          calls.push({ kind: 'one', sql: normalized })
          if (normalized.includes('FROM mip_membership_chains')) return chainRow()
          if (normalized.startsWith('SELECT * FROM mip_orders')) return settledOrder
          if (normalized.startsWith('SELECT * FROM mip_refunds')) return settledRefund
          if (normalized.includes('FROM mip_payment_callbacks')) {
            return {
              resource_hash: callbackHash,
              verification_status: 'VERIFIED',
              processing_status: 'PROCESSED',
            }
          }
          throw new Error(`Unexpected one query: ${normalized}`)
        },
        async query(sql, params) {
          const normalized = normalize(sql)
          calls.push({ kind: 'query', sql: normalized, params })
          if (normalized.includes('INSERT INTO mip_payment_callbacks')) callbackHash = params[3]
          return { affectedRows: 1 }
        },
      }),
    }, {
      appId,
      refundId: routedRefund.id,
      merchantOrderNo: routedOrder.merchant_order_no,
      merchantRefundNo: routedRefund.merchant_refund_no,
      providerRefundId: settledRefund.provider_refund_id,
      amountCents: routedRefund.amount_cents,
    }, { now: () => now })
    assert.deepEqual(result, { status: 'SUCCEEDED', idempotent: true })
    assert.equal(calls.some(call => call.sql.includes('UPDATE mip_membership_chains')), false)
    assert.equal(calls.some(call => call.sql.includes('FROM mip_membership_entitlements')), false)
  })

  it('repairs an old early-revoked entitlement on an idempotent REFUNDCLOSE fact', async () => {
    const order = membershipOrder('10000000-0000-4000-8000-000000000001', {
      status: 'PAID',
      paid_at: new Date('2026-08-01T00:00:00.000Z'),
    })
    const refund = refundRow(order, { status: 'FAILED', last_error_code: 'REFUNDCLOSE' })
    const revoked = orderEntitlement(order, {
      status: 'REFUNDED',
      starts_at: new Date('2026-08-01T00:00:00.000Z'),
      ends_at: new Date('2026-08-31T00:00:00.000Z'),
      revoked_at: new Date('2026-08-10T00:00:00.000Z'),
      revocation_reason: 'ORDER_REFUNDED',
    })
    const database = failedRefundDatabase(order, refund, [order], [revoked], 0)
    const result = await markRefundFailed(database, refundFailureInput(refund), {
      createId: idFactory(),
      now: () => now,
    })
    assert.deepEqual(result, { status: 'FAILED', idempotent: true })
    const repair = database.calls.find(call => call.sql.startsWith('UPDATE mip_membership_entitlements')
      && call.sql.includes('revoked_at = NULL'))
    assert.ok(repair)
    assert.ok(database.calls.some(call => call.sql.includes('UPDATE mip_membership_chains')))
  })

  it('restores the order on REFUNDCLOSE before rebuilding its ORDER entitlement', async () => {
    const order = membershipOrder('10000000-0000-4000-8000-000000000001', {
      status: 'REFUND_PENDING',
      paid_at: new Date('2026-08-01T00:00:00.000Z'),
    })
    const refund = refundRow(order, { status: 'PROCESSING' })
    const revoked = orderEntitlement(order, {
      status: 'REFUNDED',
      starts_at: new Date('2026-08-01T00:00:00.000Z'),
      ends_at: new Date('2026-08-31T00:00:00.000Z'),
      revoked_at: new Date('2026-08-10T00:00:00.000Z'),
      revocation_reason: 'ORDER_REFUNDED',
    })
    const database = failedRefundDatabase(order, refund, [order], [revoked], 0)
    const result = await markRefundFailed(database, refundFailureInput(refund), {
      createId: idFactory(),
      now: () => now,
    })
    assert.deepEqual(result, { status: 'FAILED', idempotent: false })
    const statements = database.calls.map(call => call.sql)
    const chain = statements.findIndex(sql => sql.includes('FROM mip_membership_chains'))
    const orderLock = statements.findIndex(sql => sql.startsWith('SELECT * FROM mip_orders'))
    const refundLock = statements.findIndex(sql => sql.startsWith('SELECT * FROM mip_refunds'))
    const sourceOrders = statements.findIndex(sql => sql.includes('FROM mip_orders order_row'))
    const entitlements = statements.findIndex(sql => sql.includes('FROM mip_membership_entitlements'))
    assert.ok(chain >= 0 && orderLock > chain && refundLock > orderLock
      && sourceOrders > refundLock && entitlements > sourceOrders)
    assert.ok(statements.some(sql => sql.startsWith('UPDATE mip_orders SET status = ?')))
  })

  it('applies a membership refund as chain, order, refund, callback, sources, then entitlements', async () => {
    const order = membershipOrder('10000000-0000-4000-8000-000000000001', {
      status: 'REFUND_PENDING',
      paid_at: new Date('2026-08-01T00:00:00.000Z'),
    })
    const refund = refundRow(order, { status: 'PROCESSING', provider_refund_id: null })
    const orderFact = orderEntitlement(order, {
      starts_at: new Date('2026-08-01T00:00:00.000Z'),
      ends_at: new Date('2026-08-31T00:00:00.000Z'),
    })
    const manual = manualEntitlement('refund-safe', '2026-09-01', '2026-10-01')
    const calls = []
    let callbackHash = null
    const tx = {
      async one(sql, params) {
        const normalized = normalize(sql)
        calls.push({ kind: 'one', sql: normalized, params })
        if (normalized.includes('FROM mip_membership_chains')) return chainRow()
        if (normalized.startsWith('SELECT * FROM mip_orders')) return order
        if (normalized.startsWith('SELECT * FROM mip_refunds')) return refund
        if (normalized.includes('FROM mip_payment_callbacks')) {
          return {
            resource_hash: callbackHash,
            verification_status: 'VERIFIED',
            processing_status: 'RECEIVED',
          }
        }
        if (normalized.includes('COALESCE(SUM(amount_cents)')) return { total: order.amount_cents }
        throw new Error(`Unexpected one query: ${normalized}`)
      },
      async query(sql, params) {
        const normalized = normalize(sql)
        calls.push({ kind: 'query', sql: normalized, params })
        if (normalized.includes('INSERT INTO mip_payment_callbacks')) callbackHash = params[3]
        if (normalized.includes('FROM mip_orders order_row')) return []
        if (normalized.includes('FROM mip_membership_entitlements')) return [orderFact, manual]
        return { affectedRows: 1 }
      },
    }
    const result = await applyRefundCallback({
      one: async () => refundRouteRow(order, refund),
      transaction: work => work(tx),
    }, {
      appId,
      refundId: refund.id,
      merchantOrderNo: order.merchant_order_no,
      merchantRefundNo: refund.merchant_refund_no,
      providerRefundId: 'provider-refund-success',
      amountCents: refund.amount_cents,
    }, { createId: idFactory(), now: () => now })
    assert.deepEqual(result, { status: 'SUCCEEDED', orderStatus: 'REFUNDED', idempotent: false })
    const statements = calls.map(call => call.sql)
    const chain = statements.findIndex(sql => sql.includes('FROM mip_membership_chains'))
    const orderLock = statements.findIndex(sql => sql.startsWith('SELECT * FROM mip_orders'))
    const refundLock = statements.findIndex(sql => sql.startsWith('SELECT * FROM mip_refunds'))
    const callback = statements.findIndex(sql => sql.includes('FROM mip_payment_callbacks'))
    const sourceOrders = statements.findIndex(sql => sql.includes('FROM mip_orders order_row'))
    const entitlements = statements.findIndex(sql => sql.includes('FROM mip_membership_entitlements'))
    assert.ok(chain >= 0 && orderLock > chain && refundLock > orderLock && callback > refundLock
      && sourceOrders > callback && entitlements > sourceOrders)
    assert.equal(calls.some(call => call.sql.startsWith('UPDATE mip_membership_entitlements')
      && call.params.includes(manual.id)), false)
  })

  it('fails closed when any immutable locked payment route fact differs from the pre-read route', async () => {
    const routed = membershipOrder('10000000-0000-4000-8000-000000000001')
    for (const changed of [
      { ...routed, user_id: '20000000-0000-4000-8000-000000000099' },
      { ...routed, order_type: 'CONTENT' },
      { ...routed, merchant_order_no: 'MIP-CHANGED' },
      { ...routed, amount_cents: routed.amount_cents + 1 },
      { ...routed, currency: 'USD' },
    ]) {
      let callbackWritten = false
      await assert.rejects(() => applyPaymentCallback({
        one: async () => paymentRouteRow(routed),
        transaction: work => work({
          async one(sql) {
            const normalized = normalize(sql)
            if (normalized.includes('FROM mip_user_identities')) return paymentIdentity(routed)
            if (normalized.includes('FROM mip_membership_chains')) return chainRow()
            return changed
          },
          async query(sql) {
            if (String(sql).includes('mip_payment_callbacks')) callbackWritten = true
            return { affectedRows: 1 }
          },
        }),
      }, paymentInput(routed, 'provider-stale')), /PAYMENT_ROUTE_CHANGED/)
      assert.equal(callbackWritten, false)
    }
  })

  it('fails closed on an identity rebind or closure before chain and order locks', async () => {
    const routed = membershipOrder('10000000-0000-4000-8000-000000000001')
    const originalIdentity = paymentIdentity(routed)
    for (const changedIdentity of [
      { ...originalIdentity, user_id: '20000000-0000-4000-8000-000000000099' },
      { ...originalIdentity, identity_key: 'identity-rebound' },
      { ...originalIdentity, closed_identity_key: originalIdentity.identity_key },
    ]) {
      let laterLockReached = false
      await assert.rejects(() => applyPaymentCallback({
        one: async () => paymentRouteRow(routed),
        transaction: work => work({
          async one(sql) {
            if (normalize(sql).includes('FROM mip_user_identities')) return changedIdentity
            laterLockReached = true
            return null
          },
        }),
      }, paymentInput(routed, 'provider-stale')), /PAYMENT_IDENTITY_CHANGED/)
      assert.equal(laterLockReached, false)
    }
  })

  it('fails closed when any immutable locked refund route fact differs from the pre-read route', async () => {
    const routedOrder = membershipOrder('10000000-0000-4000-8000-000000000001', {
      status: 'REFUND_PENDING',
    })
    const routedRefund = refundRow(routedOrder, { provider_refund_id: null })
    for (const [lockedOrder, lockedRefund] of [
      [{ ...routedOrder, user_id: '20000000-0000-4000-8000-000000000099' }, routedRefund],
      [{ ...routedOrder, order_type: 'CONTENT' }, routedRefund],
      [{ ...routedOrder, merchant_order_no: 'MIP-CHANGED' }, routedRefund],
      [{ ...routedOrder, amount_cents: routedOrder.amount_cents + 1 }, routedRefund],
      [{ ...routedOrder, currency: 'USD' }, routedRefund],
      [routedOrder, { ...routedRefund, merchant_refund_no: 'MIPR-CHANGED' }],
      [routedOrder, { ...routedRefund, amount_cents: routedRefund.amount_cents - 1 }],
    ]) {
      let callbackWritten = false
      await assert.rejects(() => applyRefundCallback({
        one: async () => refundRouteRow(routedOrder, routedRefund),
        transaction: work => work({
          async one(sql) {
            const normalized = normalize(sql)
            if (normalized.includes('FROM mip_membership_chains')) return chainRow()
            if (normalized.startsWith('SELECT * FROM mip_orders')) return lockedOrder
            if (normalized.startsWith('SELECT * FROM mip_refunds')) return lockedRefund
            throw new Error(`Unexpected one query: ${normalized}`)
          },
          async query(sql) {
            if (String(sql).includes('mip_payment_callbacks')) callbackWritten = true
            return { affectedRows: 1 }
          },
        }),
      }, {
        appId,
        refundId: routedRefund.id,
        merchantOrderNo: routedOrder.merchant_order_no,
        merchantRefundNo: routedRefund.merchant_refund_no,
        providerRefundId: 'provider-refund-success',
        amountCents: routedRefund.amount_cents,
      }), /REFUND_ROUTE_CHANGED/)
      assert.equal(callbackWritten, false)
    }
  })
})

function rebuildHarness(options) {
  const calls = []
  return {
    calls,
    sourceSql: '',
    tx: {
      async one(sql) {
        const normalized = normalize(sql)
        calls.push({ kind: 'one', sql: normalized, params: [] })
        if (normalized.includes('FROM mip_membership_chains')) return chainRow()
        throw new Error(`Unexpected one query: ${normalized}`)
      },
      async query(sql, params) {
        const normalized = normalize(sql)
        calls.push({ kind: 'query', sql: normalized, params })
        if (normalized.includes('FROM mip_orders order_row')) {
          this.owner.sourceSql = normalized
          return options.orders
        }
        if (normalized.includes('FROM mip_membership_entitlements')) return options.entitlements
        return { affectedRows: 1 }
      },
      owner: null,
    },
  }
}

async function runRebuild(harness) {
  harness.tx.owner = harness
  const chain = await lockMembershipChain(harness.tx, {
    appId, userId, orderType: 'MEMBERSHIP',
  })
  return rebuildMembershipEntitlements(harness.tx, appId, userId, {
    chain,
    createId: idFactory(),
    now: () => now,
  })
}

function failedRefundDatabase(order, refund, sourceOrders, entitlements, reservedTotal) {
  const calls = []
  return {
    calls,
    async one(sql, params) {
      calls.push({ kind: 'one', sql: normalize(sql), params })
      return refundRouteRow(order, refund)
    },
    async transaction(work) {
      return work({
        async one(sql, params) {
          const normalized = normalize(sql)
          calls.push({ kind: 'one', sql: normalized, params })
          if (normalized.includes('FROM mip_membership_chains')) return chainRow()
          if (normalized.startsWith('SELECT * FROM mip_orders')) return order
          if (normalized.startsWith('SELECT * FROM mip_refunds')) return refund
          if (normalized.includes('COALESCE(SUM(amount_cents)')) return { total: reservedTotal }
          throw new Error(`Unexpected one query: ${normalized}`)
        },
        async query(sql, params) {
          const normalized = normalize(sql)
          calls.push({ kind: 'query', sql: normalized, params })
          if (normalized.includes('FROM mip_orders order_row')) return sourceOrders
          if (normalized.includes('FROM mip_membership_entitlements')) return entitlements
          return { affectedRows: 1 }
        },
      })
    },
  }
}

function concurrentPaymentDatabase(label, order, mutex, events, lockedSignal) {
  return {
    one: async () => paymentRouteRow(order),
    async transaction(work) {
      let release = null
      let callbackHash = null
      try {
        return await work({
          async one(sql) {
            const normalized = normalize(sql)
            if (normalized.includes('FROM mip_user_identities')) {
              release = await mutex.acquire()
              events.push(`${label}:identity`)
              lockedSignal?.resolve()
              return paymentIdentity(order)
            }
            if (normalized.includes('FROM mip_membership_chains')) {
              events.push(`${label}:chain`)
              return chainRow()
            }
            if (normalized.includes('FROM mip_payment_callbacks')) {
              return {
                resource_hash: callbackHash,
                verification_status: 'VERIFIED',
                processing_status: 'RECEIVED',
              }
            }
            events.push(`${label}:order`)
            return order
          },
          async query(sql, params) {
            const normalized = normalize(sql)
            if (normalized.includes('INSERT INTO mip_payment_callbacks')) callbackHash = params[3]
            if (normalized.includes('FROM mip_orders order_row')) {
              events.push(`${label}:sources`)
              return [order]
            }
            if (normalized.includes('FROM mip_membership_entitlements')) return []
            return { affectedRows: 1 }
          },
        })
      }
      finally {
        if (release) {
          events.push(`${label}:release`)
          release()
        }
      }
    },
  }
}

function createMutex() {
  let current = Promise.resolve()
  return {
    async acquire() {
      let release
      const previous = current
      current = new Promise(resolve => { release = resolve })
      await previous
      return release
    },
  }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function membershipOrder(id, overrides = {}) {
  return {
    id,
    app_id: appId,
    user_id: userId,
    order_type: 'MEMBERSHIP',
    membership_plan_id: '30000000-0000-4000-8000-000000000001',
    merchant_order_no: `MIP${id.replace(/-/g, '').slice(0, 20)}`,
    amount_cents: 79900,
    currency: 'CNY',
    status: 'PAYMENT_CREATED',
    version: 2,
    paid_at: now,
    created_at: now,
    provider_transaction_id: null,
    product_snapshot_json: JSON.stringify({ durationDays: 30, name: '月度玩家' }),
    ...overrides,
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

function orderEntitlement(order, overrides = {}) {
  return {
    id: `40000000-0000-4000-8000-${order.id.replace(/-/g, '').slice(-12)}`,
    order_id: order.id,
    plan_id: order.membership_plan_id,
    source_type: 'ORDER',
    source_adjustment_id: null,
    status: 'ACTIVE',
    starts_at: order.paid_at,
    ends_at: new Date(new Date(order.paid_at).getTime() + 30 * 86_400_000),
    revoked_at: null,
    revocation_reason: null,
    version: 1,
    ...overrides,
  }
}

function manualEntitlement(suffix, startsAt, endsAt) {
  return {
    id: `manual-${suffix}`,
    order_id: null,
    plan_id: null,
    source_type: 'ADMIN_ADJUSTMENT',
    source_adjustment_id: `adjustment-${suffix}`,
    status: 'ACTIVE',
    starts_at: new Date(`${startsAt}T00:00:00.000Z`),
    ends_at: new Date(`${endsAt}T00:00:00.000Z`),
    revoked_at: null,
    revocation_reason: null,
    version: 1,
  }
}

function refundRow(order, overrides = {}) {
  return {
    id: '50000000-0000-4000-8000-000000000001',
    app_id: appId,
    order_id: order.id,
    merchant_refund_no: 'MIPR50000000000040008000000000000001',
    provider_refund_id: 'provider-refund-1',
    amount_cents: order.amount_cents,
    status: 'PROCESSING',
    version: 2,
    ...overrides,
  }
}

function refundRouteRow(order, refund) {
  return {
    ...refund,
    refund_id: refund.id,
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
}

function paymentInput(order, providerTransactionId) {
  return {
    appId,
    orderId: order.id,
    identityKey: 'identity-1',
    merchantOrderNo: order.merchant_order_no,
    providerTransactionId,
    amountCents: order.amount_cents,
    currency: order.currency,
  }
}

function refundFailureInput(refund) {
  return {
    appId,
    refundId: refund.id,
    merchantRefundNo: refund.merchant_refund_no,
    reasonCode: 'REFUNDCLOSE',
  }
}

function chainRow() {
  return { app_id: appId, user_id: userId, version: 1 }
}

function mutation(sql) {
  return /^(INSERT|UPDATE|DELETE) /.test(sql)
}

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim()
}

function idFactory() {
  let sequence = 0
  return () => `60000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
}
