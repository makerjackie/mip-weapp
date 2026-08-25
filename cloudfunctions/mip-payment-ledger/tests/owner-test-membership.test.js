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
  plan_key: 'five_year_test',
  catalog_stage: 'TEST',
  name: '五年会员（测试）',
  duration_days: 1825,
  price_cents: 19900,
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

  it('writes a TEST order, payment attempt, entitlement, outbox, and audit in one transaction', async () => {
    const calls = []
    const ids = idFactory([
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000004',
    ])
    const tx = {
      async one(sql, params) {
        calls.push({ kind: 'one', sql, params })
        if (sql.includes('FROM mip_membership_plans')) return plan
        if (sql.includes('FROM mip_membership_entitlements entitlement')) return null
        throw new Error(`Unexpected one query: ${sql}`)
      },
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params })
        if (sql.includes('FROM mip_users user_row')) return [{ id: ownerId }]
        if (sql.includes('INNER JOIN mip_membership_entitlements entitlement')) return []
        if (sql.includes("FROM mip_orders\n     WHERE") && sql.includes("status = 'PAID'")) {
          return [{
            id: ids.values[0],
            membership_plan_id: plan.id,
            paid_at: now,
            product_snapshot_json: JSON.stringify({
              durationDays: plan.duration_days,
              attribution: { sourceType: 'PLATFORM' },
            }),
          }]
        }
        if (sql.includes('SELECT id, order_id FROM mip_membership_entitlements')) return []
        if (sql.trimStart().startsWith('UPDATE mip_orders')
          || sql.trimStart().startsWith('UPDATE mip_payment_attempts')) {
          return { affectedRows: 1 }
        }
        return { affectedRows: 1 }
      },
    }
    const result = await grantOwnerTestMembership({ transaction: work => work(tx) }, environment, {
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
    const statements = calls.map(call => call.sql)
    assert.ok(statements.some(sql => sql.includes('INSERT INTO mip_orders')))
    assert.ok(statements.some(sql => sql.includes("INSERT INTO mip_payment_attempts") && sql.includes("'TEST'")))
    assert.ok(statements.some(sql => sql.includes("SET status = 'PAID'")))
    assert.ok(statements.some(sql => sql.includes('INSERT INTO mip_membership_entitlements')))
    assert.ok(statements.some(sql => sql.includes('INSERT INTO mip_outbox_events')))
    assert.ok(statements.some(sql => sql.includes('INSERT INTO mip_audit_logs')))
    const orderInsert = calls.find(call => call.sql.includes('INSERT INTO mip_orders'))
    const snapshot = JSON.parse(orderInsert.params.at(-1))
    assert.equal(snapshot.catalogStage, 'TEST')
    assert.equal(snapshot.operationSource, 'OWNER_TEST_MEMBERSHIP')
    assert.deepEqual(snapshot.attribution, { sourceType: 'PLATFORM' })
  })

  it('returns idempotently when its current TEST entitlement is already active', async () => {
    let writes = 0
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_membership_plans')) return plan
        throw new Error(`Unexpected one query: ${sql}`)
      },
      async query(sql) {
        if (sql.includes('FROM mip_users user_row')) return [{ id: ownerId }]
        if (sql.includes('INNER JOIN mip_membership_entitlements entitlement')) {
          return [{
            id: '30000000-0000-4000-8000-000000000001',
            membership_plan_id: plan.id,
            amount_cents: plan.price_cents,
            status: 'PAID',
            version: 2,
            catalog_stage: 'TEST',
            plan_key: plan.plan_key,
          }]
        }
        writes += 1
        return { affectedRows: 1 }
      },
    }
    const result = await grantOwnerTestMembership({ transaction: work => work(tx) }, environment)
    assert.equal(result.idempotent, true)
    assert.equal(result.managed, true)
    assert.equal(writes, 0)
  })

  it('does not replace an unrelated active membership with an operation-owned TEST order', async () => {
    let writes = 0
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_membership_plans')) return plan
        if (sql.includes('FROM mip_membership_entitlements entitlement')) {
          return { id: '50000000-0000-4000-8000-000000000001' }
        }
        throw new Error(`Unexpected one query: ${sql}`)
      },
      async query(sql) {
        if (sql.includes('FROM mip_users user_row')) return [{ id: ownerId }]
        if (sql.includes('INNER JOIN mip_membership_entitlements entitlement')) return []
        writes += 1
        return { affectedRows: 1 }
      },
    }
    const result = await grantOwnerTestMembership({ transaction: work => work(tx) }, environment)
    assert.deepEqual(result, {
      operation: 'GRANT',
      status: 'ACTIVE',
      membershipActive: true,
      managed: false,
      idempotent: true,
    })
    assert.equal(writes, 0)
  })

  it('revokes idempotently without writing when no operation-owned TEST membership is active', async () => {
    let writes = 0
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_membership_plans')) return plan
        if (sql.includes('FROM mip_membership_entitlements entitlement')) return null
        throw new Error(`Unexpected one query: ${sql}`)
      },
      async query(sql) {
        if (sql.includes('FROM mip_users user_row')) return [{ id: ownerId }]
        if (sql.includes('INNER JOIN mip_membership_entitlements entitlement')) return []
        writes += 1
        return { affectedRows: 1 }
      },
    }
    const result = await revokeOwnerTestMembership({ transaction: work => work(tx) }, environment)
    assert.deepEqual(result, {
      operation: 'REVOKE',
      status: 'INACTIVE',
      membershipActive: false,
      managed: false,
      idempotent: true,
    })
    assert.equal(writes, 0)
  })

  it('refuses to revoke a managed marker attached to another plan or LIVE catalog fact', async () => {
    let writes = 0
    for (const conflict of [
      { membership_plan_id: '20000000-0000-4000-8000-000000000002' },
      { catalog_stage: 'LIVE' },
    ]) {
      const tx = {
        async one(sql) {
          if (sql.includes('FROM mip_membership_plans')) return plan
          throw new Error(`Unexpected one query: ${sql}`)
        },
        async query(sql) {
          if (sql.includes('FROM mip_users user_row')) return [{ id: ownerId }]
          if (sql.includes('INNER JOIN mip_membership_entitlements entitlement')) {
            return [{
              id: '30000000-0000-4000-8000-000000000001',
              membership_plan_id: plan.id,
              amount_cents: plan.price_cents,
              status: 'PAID',
              version: 2,
              catalog_stage: 'TEST',
              plan_key: plan.plan_key,
              ...conflict,
            }]
          }
          writes += 1
          return { affectedRows: 1 }
        },
      }
      await assert.rejects(
        () => revokeOwnerTestMembership({ transaction: work => work(tx) }, environment),
        /TEST_MEMBERSHIP_STATE_CONFLICT/,
      )
    }
    assert.equal(writes, 0)
  })

  it('revokes only the active operation-owned TEST order through refund and entitlement facts', async () => {
    const calls = []
    const order = {
      id: '30000000-0000-4000-8000-000000000001',
      membership_plan_id: plan.id,
      amount_cents: plan.price_cents,
      status: 'PAID',
      version: 2,
      catalog_stage: 'TEST',
      plan_key: plan.plan_key,
    }
    const ids = idFactory([
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
    ])
    const tx = {
      async one(sql, params) {
        calls.push({ kind: 'one', sql, params })
        if (sql.includes('FROM mip_membership_plans')) return plan
        if (sql.includes('FROM mip_membership_entitlements entitlement')) return null
        throw new Error(`Unexpected one query: ${sql}`)
      },
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params })
        if (sql.includes('FROM mip_users user_row')) return [{ id: ownerId }]
        if (sql.includes('INNER JOIN mip_membership_entitlements entitlement')) return [order]
        if (sql.includes("FROM mip_orders\n     WHERE") && sql.includes("status = 'PAID'")) return []
        if (sql.includes('SELECT id, order_id FROM mip_membership_entitlements')) {
          return [{ id: '50000000-0000-4000-8000-000000000001', order_id: order.id }]
        }
        if (sql.trimStart().startsWith('UPDATE mip_')) return { affectedRows: 1 }
        return { affectedRows: 1 }
      },
    }
    const result = await revokeOwnerTestMembership({ transaction: work => work(tx) }, environment, {
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
    const statements = calls.map(call => call.sql)
    assert.ok(statements.some(sql => sql.includes('INSERT INTO mip_refunds')))
    assert.ok(statements.some(sql => sql.includes("SET status = 'REFUND_PENDING'")))
    assert.ok(statements.some(sql => sql.includes("SET status = 'SUCCEEDED'")))
    assert.ok(statements.some(sql => sql.includes("SET status = 'REFUNDED'")))
    assert.ok(statements.some(sql => sql.includes("revocation_reason = 'ORDER_REFUNDED'")))
    assert.ok(statements.some(sql => sql.includes('INSERT INTO mip_outbox_events')))
    assert.ok(statements.some(sql => sql.includes('INSERT INTO mip_audit_logs')))
  })
})

function idFactory(values) {
  let index = 0
  const factory = () => values[index++]
  factory.values = values
  return factory
}
