'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertOwnerTestMembershipEnvironment,
  grantOwnerTestMembership,
  revokeOwnerTestMembership,
} = require('../domain/owner-test-membership')

const appId = 'wx0000000000000001'
const ownerId = '10000000-0000-4000-8000-000000000001'
const plan = {
  id: '20000000-0000-4000-8000-000000000001',
  plan_key: 'annual_test',
  catalog_stage: 'TEST',
  name: '一年会员（测试）',
  duration_days: 365,
  price_cents: 600000,
  currency: 'CNY',
  benefits_json: JSON.stringify(['玩家身份']),
  status: 'ACTIVE',
  version: 3,
}
const environment = {
  appId,
  planKey: plan.plan_key,
  deploymentStage: 'development',
  catalogStage: 'TEST',
  paymentMode: 'disabled',
}
const now = new Date('2026-08-26T08:00:00.000Z')

describe('Owner TEST membership ledger operations', () => {
  it('fails before opening a transaction outside development/test TEST configuration', async () => {
    for (const invalid of [
      { deploymentStage: 'production' },
      { deploymentStage: 'staging' },
      { catalogStage: 'LIVE' },
      { paymentMode: 'live' },
    ]) {
      let called = false
      await assert.rejects(() => grantOwnerTestMembership({
        transaction: async () => { called = true },
      }, { ...environment, ...invalid }), /TEST_MEMBERSHIP_DISABLED/)
      assert.equal(called, false)
    }
    assert.throws(() => assertOwnerTestMembershipEnvironment({
      ...environment,
      planKey: 'LIVE/PLAN',
    }), /TEST_MEMBERSHIP_PLAN_INVALID/)
  })

  it('maps storage failures to a safe operation stage without returning database details', async () => {
    const logs = []
    const originalError = console.error
    console.error = (...values) => logs.push(values)
    try {
      await assert.rejects(() => grantOwnerTestMembership({
        transaction: work => work({
          query: async () => { throw new Error('sensitive database diagnostic') },
        }),
      }, environment), /TEST_MEMBERSHIP_CONTEXT_STORAGE_ERROR/)
    }
    finally {
      console.error = originalError
    }
    assert.deepEqual(logs, [[
      '[owner-test-membership]',
      'TEST_MEMBERSHIP_CONTEXT_STORAGE_ERROR',
      'UNKNOWN',
    ]])
  })

  it('grants through user, chain, order/refund, and entitlement locks with an ORDER source', async () => {
    const ids = idFactory([
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000004',
    ])
    const db = ownerDatabase({
      rebuildOrders: [{
        id: ids.values[0],
        membership_plan_id: plan.id,
        paid_at: now,
        product_snapshot_json: JSON.stringify({
          durationDays: plan.duration_days,
          attribution: { sourceType: 'PLATFORM' },
        }),
      }],
    })
    const result = await grantOwnerTestMembership(db, environment, {
      createId: ids,
      now: () => now,
    })
    assert.deepEqual(result, {
      operation: 'GRANT',
      status: 'ACTIVE',
      membershipActive: true,
      managed: true,
      idempotent: false,
    })
    assertLockOrder(db.calls)
    const entitlementInsert = db.calls.find(call => call.sql.includes('INSERT INTO mip_membership_entitlements'))
    assert.match(entitlementInsert.sql, /source_type,[\s\S]*source_adjustment_id/)
    assert.match(entitlementInsert.sql, /'ORDER', NULL/)
    assert.ok(db.calls.some(call => call.sql.includes('UPDATE mip_membership_chains')))
    const orderInsert = db.calls.find(call => call.sql.includes('INSERT INTO mip_orders'))
    const snapshot = JSON.parse(orderInsert.params.at(-1))
    assert.equal(snapshot.catalogStage, 'TEST')
    assert.equal(snapshot.operationSource, 'OWNER_TEST_MEMBERSHIP')
  })

  it('returns idempotently for an active operation-owned TEST entitlement without bumping the chain', async () => {
    const managedOrder = ownerTestOrder()
    const db = ownerDatabase({
      orders: [managedOrder],
      entitlements: [activeOrderEntitlement(managedOrder.id)],
    })
    const result = await grantOwnerTestMembership(db, environment, { now: () => now })
    assert.equal(result.idempotent, true)
    assert.equal(result.managed, true)
    assert.equal(db.calls.some(call => mutation(call.sql)), false)
  })

  it('does not duplicate a managed TEST order whose entitlement starts in the future', async () => {
    const managedOrder = ownerTestOrder()
    const futureEntitlement = activeOrderEntitlement(managedOrder.id, {
      starts_at: new Date('2027-01-01T00:00:00.000Z'),
      ends_at: new Date('2032-01-01T00:00:00.000Z'),
    })
    const db = ownerDatabase({
      orders: [managedOrder],
      entitlements: [futureEntitlement],
    })
    const result = await grantOwnerTestMembership(db, environment, { now: () => now })
    assert.deepEqual(result, {
      operation: 'GRANT',
      status: 'INACTIVE',
      membershipActive: false,
      managed: true,
      idempotent: true,
    })
    assert.equal(db.calls.some(call => mutation(call.sql)), false)
  })

  it('does not duplicate an operation-owned TEST order while its refund is pending', async () => {
    const managedOrder = ownerTestOrder({ status: 'REFUND_PENDING' })
    const db = ownerDatabase({
      orders: [managedOrder],
      refunds: [processingRefund(managedOrder.id)],
      entitlements: [activeOrderEntitlement(managedOrder.id)],
    })
    const result = await grantOwnerTestMembership(db, environment, { now: () => now })
    assert.deepEqual(result, {
      operation: 'GRANT',
      status: 'ACTIVE',
      membershipActive: true,
      managed: true,
      idempotent: true,
    })
    assert.equal(db.calls.some(call => mutation(call.sql)), false)
  })

  it('does not replace an active ADMIN_ADJUSTMENT entitlement', async () => {
    const db = ownerDatabase({ entitlements: [activeManualEntitlement()] })
    const result = await grantOwnerTestMembership(db, environment, { now: () => now })
    assert.deepEqual(result, {
      operation: 'GRANT',
      status: 'ACTIVE',
      membershipActive: true,
      managed: false,
      idempotent: true,
    })
    assert.equal(db.calls.some(call => mutation(call.sql)), false)
  })

  it('revokes idempotently when no operation-owned TEST membership is active', async () => {
    const db = ownerDatabase()
    const result = await revokeOwnerTestMembership(db, environment, { now: () => now })
    assert.deepEqual(result, {
      operation: 'REVOKE',
      status: 'INACTIVE',
      membershipActive: false,
      managed: false,
      idempotent: true,
    })
    assert.equal(db.calls.some(call => mutation(call.sql)), false)
  })

  it('refuses to revoke a managed marker attached to another plan or LIVE catalog fact', async () => {
    for (const conflict of [
      { membership_plan_id: '20000000-0000-4000-8000-000000000002' },
      { product_snapshot_json: JSON.stringify({
        catalogStage: 'LIVE', operationSource: 'OWNER_TEST_MEMBERSHIP',
      }) },
    ]) {
      const managedOrder = ownerTestOrder(conflict)
      const db = ownerDatabase({
        orders: [managedOrder],
        entitlements: [activeOrderEntitlement(managedOrder.id)],
      })
      await assert.rejects(
        () => revokeOwnerTestMembership(db, environment, { now: () => now }),
        /TEST_MEMBERSHIP_STATE_CONFLICT/,
      )
      assert.equal(db.calls.some(call => mutation(call.sql)), false)
    }
  })

  it('revokes with order before refund before entitlement and only rebuilds ORDER sources', async () => {
    const managedOrder = ownerTestOrder()
    const entitlement = activeOrderEntitlement(managedOrder.id)
    const ids = idFactory([
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
    ])
    const db = ownerDatabase({
      orders: [managedOrder],
      entitlements: [entitlement],
      rebuildEntitlements: [entitlement],
    })
    const result = await revokeOwnerTestMembership(db, environment, {
      createId: ids,
      now: () => now,
    })
    assert.deepEqual(result, {
      operation: 'REVOKE',
      status: 'INACTIVE',
      membershipActive: false,
      managed: true,
      idempotent: false,
    })
    assertLockOrder(db.calls)
    assert.ok(db.calls.some(call => call.sql.includes('INSERT INTO mip_refunds')))
    const entitlementUpdate = db.calls.find(call => call.sql.includes("revocation_reason = 'ORDER_REFUNDED'"))
    assert.match(entitlementUpdate.sql, /source_type = 'ORDER'/)
    assert.ok(db.calls.some(call => call.sql.includes('UPDATE mip_membership_chains')))
  })

  it('revokes an operation-owned paid TEST order whose entitlement starts in the future', async () => {
    const managedOrder = ownerTestOrder()
    const futureEntitlement = activeOrderEntitlement(managedOrder.id, {
      starts_at: new Date('2027-01-01T00:00:00.000Z'),
      ends_at: new Date('2032-01-01T00:00:00.000Z'),
    })
    const db = ownerDatabase({
      orders: [managedOrder],
      entitlements: [futureEntitlement],
      rebuildEntitlements: [futureEntitlement],
    })
    const result = await revokeOwnerTestMembership(db, environment, {
      createId: idFactory([
        '40000000-0000-4000-8000-000000000011',
        '40000000-0000-4000-8000-000000000012',
      ]),
      now: () => now,
    })
    assert.deepEqual(result, {
      operation: 'REVOKE',
      status: 'INACTIVE',
      membershipActive: false,
      managed: true,
      idempotent: false,
    })
    assert.ok(db.calls.some(call => call.sql.includes('INSERT INTO mip_refunds')))
    assert.ok(db.calls.some(call => call.sql.includes("revocation_reason = 'ORDER_REFUNDED'")))
  })

  it('does not create a second refund for an operation-owned REFUND_PENDING order', async () => {
    const managedOrder = ownerTestOrder({ status: 'REFUND_PENDING' })
    const db = ownerDatabase({
      orders: [managedOrder],
      refunds: [processingRefund(managedOrder.id)],
      entitlements: [activeOrderEntitlement(managedOrder.id)],
    })
    const result = await revokeOwnerTestMembership(db, environment, { now: () => now })
    assert.deepEqual(result, {
      operation: 'REVOKE',
      status: 'ACTIVE',
      membershipActive: true,
      managed: true,
      idempotent: true,
    })
    assert.equal(db.calls.some(call => mutation(call.sql)), false)
  })
})

function ownerDatabase(options = {}) {
  const calls = []
  const config = {
    orders: [],
    refunds: [],
    entitlements: [],
    rebuildOrders: [],
    rebuildEntitlements: options.entitlements || [],
    ...options,
  }
  const tx = {
    async one(sql, params) {
      const normalized = normalize(sql)
      calls.push({ kind: 'one', sql: normalized, params })
      if (normalized.includes('FROM mip_membership_plans')) return plan
      if (normalized.includes('FROM mip_membership_chains')) {
        return { app_id: appId, user_id: ownerId, version: 1 }
      }
      throw new Error(`Unexpected one query: ${normalized}`)
    },
    async query(sql, params) {
      const normalized = normalize(sql)
      calls.push({ kind: 'query', sql: normalized, params })
      if (normalized.includes('FROM mip_users user_row')) return [{ id: ownerId }]
      if (normalized.includes('FROM mip_orders order_row')
        && normalized.includes("status IN ('PAID', 'REFUND_PENDING')")) {
        return config.rebuildOrders
      }
      if (normalized.includes('FROM mip_orders order_row')) return config.orders
      if (normalized.includes('FROM mip_refunds refund')
        && normalized.includes('INNER JOIN mip_orders order_row')) return config.refunds
      if (normalized.includes('FROM mip_membership_entitlements')
        && normalized.includes('ORDER BY starts_at')) return config.entitlements
      if (normalized.includes('FROM mip_membership_entitlements')) return config.rebuildEntitlements
      return { affectedRows: 1 }
    },
  }
  return { calls, transaction: work => work(tx) }
}

function ownerTestOrder(overrides = {}) {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    membership_plan_id: plan.id,
    amount_cents: plan.price_cents,
    status: 'PAID',
    version: 2,
    paid_at: new Date('2026-08-20T00:00:00.000Z'),
    created_at: new Date('2026-08-20T00:00:00.000Z'),
    product_snapshot_json: JSON.stringify({
      catalogStage: 'TEST',
      operationSource: 'OWNER_TEST_MEMBERSHIP',
    }),
    ...overrides,
  }
}

function activeOrderEntitlement(orderId, overrides = {}) {
  return {
    id: '50000000-0000-4000-8000-000000000001',
    order_id: orderId,
    plan_id: plan.id,
    source_type: 'ORDER',
    source_adjustment_id: null,
    status: 'ACTIVE',
    starts_at: new Date('2026-08-20T00:00:00.000Z'),
    ends_at: new Date('2031-08-20T00:00:00.000Z'),
    revoked_at: null,
    revocation_reason: null,
    version: 1,
    ...overrides,
  }
}

function processingRefund(orderId) {
  return {
    id: '60000000-0000-4000-8000-000000000099',
    order_id: orderId,
    status: 'PROCESSING',
    created_at: new Date('2026-08-25T00:00:00.000Z'),
  }
}

function activeManualEntitlement() {
  return {
    id: '50000000-0000-4000-8000-000000000002',
    order_id: null,
    plan_id: null,
    source_type: 'ADMIN_ADJUSTMENT',
    source_adjustment_id: '60000000-0000-4000-8000-000000000001',
    status: 'ACTIVE',
    starts_at: new Date('2026-08-01T00:00:00.000Z'),
    ends_at: new Date('2026-09-01T00:00:00.000Z'),
    revoked_at: null,
    revocation_reason: null,
    version: 1,
  }
}

function assertLockOrder(calls) {
  const statements = calls.map(call => call.sql)
  const user = statements.findIndex(sql => sql.includes('FROM mip_users user_row'))
  const chain = statements.findIndex(sql => sql.includes('FROM mip_membership_chains'))
  const orders = statements.findIndex(sql => sql.includes('FROM mip_orders order_row')
    && !sql.includes("status IN ('PAID', 'REFUND_PENDING')"))
  const refunds = statements.findIndex(sql => sql.includes('FROM mip_refunds refund')
    && sql.includes('INNER JOIN mip_orders order_row'))
  const entitlements = statements.findIndex(sql => sql.includes('FROM mip_membership_entitlements')
    && sql.includes('ORDER BY starts_at'))
  assert.ok(user >= 0 && chain > user && orders > chain && refunds > orders && entitlements > refunds)
}

function mutation(sql) {
  return /^(INSERT|UPDATE|DELETE) /.test(sql)
}

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim()
}

function idFactory(values) {
  let index = 0
  const factory = () => values[index++]
  factory.values = values
  return factory
}
