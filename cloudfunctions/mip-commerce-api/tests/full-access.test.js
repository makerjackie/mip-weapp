'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertFullAccessUser,
  configuredAgreements,
  createFullAccessPolicy,
} = require('../domain/full-access')
const { createCommerceRepository } = require('../domain/repository')

const caller = { appId: 'wx-app', identityKey: 'identity-key' }
const userId = '10000000-0000-4000-8000-000000000001'

function existingOrder(overrides = {}) {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    user_id: userId,
    order_type: 'MEMBERSHIP',
    membership_plan_id: '30000000-0000-4000-8000-000000000001',
    amount_cents: 79900,
    currency: 'CNY',
    status: 'CREATED',
    version: 1,
    product_snapshot_json: JSON.stringify({ attribution: { sourceType: 'PLATFORM' } }),
    ...overrides,
  }
}

describe('commerce full access', () => {
  it('loads the same current agreement, phone, and profile facts under the AppID', async () => {
    const agreements = [{ key: 'SERVICE_AGREEMENT', version: 'v2' }]
    const calls = []
    const policy = createFullAccessPolicy({ agreements })
    const user = await policy.loadByUserId({
      async one(sql, params) {
        calls.push({ sql, params })
        return {
          id: userId,
          status: 'ACTIVE',
          primary_branch_id: 'branch-a',
          nickname: ' 玩家 ',
          phone_verified_at: new Date('2026-08-24T00:00:00.000Z'),
          agreement_0_accepted: 1,
        }
      },
    }, caller.appId, userId, { lock: true })

    assert.deepEqual(user, {
      id: userId,
      status: 'ACTIVE',
      phoneBound: true,
      profileComplete: true,
      agreementsAccepted: true,
    })
    assert.deepEqual(calls[0].params, ['SERVICE_AGREEMENT', 'v2', caller.appId, userId])
    assert.match(calls[0].sql, /FROM mip_agreement_acceptances/)
    assert.match(calls[0].sql, /LEFT JOIN mip_private_profiles/)
    assert.match(calls[0].sql, /LEFT JOIN mip_profiles/)
    assert.match(calls[0].sql, /WHERE u\.app_id = \? AND u\.id = \?[\s\S]*FOR UPDATE/)
  })

  it('fails in the client requirement order and accepts only a complete active user', () => {
    assert.throws(() => assertFullAccessUser(null), /AUTH_REQUIRED/)
    assert.throws(() => assertFullAccessUser({ status: 'CLOSED' }), /FORBIDDEN/)
    assert.throws(() => assertFullAccessUser({
      status: 'ACTIVE', agreementsAccepted: false, phoneBound: false, profileComplete: false,
    }), /AGREEMENT_REQUIRED/)
    assert.throws(() => assertFullAccessUser({
      status: 'ACTIVE', agreementsAccepted: true, phoneBound: false, profileComplete: false,
    }), /PHONE_REQUIRED/)
    assert.throws(() => assertFullAccessUser({
      status: 'ACTIVE', agreementsAccepted: true, phoneBound: true, profileComplete: false,
    }), /PROFILE_REQUIRED/)
    assert.doesNotThrow(() => assertFullAccessUser({
      status: 'ACTIVE', agreementsAccepted: true, phoneBound: true, profileComplete: true,
    }))
  })

  it('gates a new purchase but keeps idempotent order and refund recovery available', async () => {
    let accessLoads = 0
    const fullAccessPolicy = {
      async loadByUserId() {
        accessLoads += 1
        return {
          id: userId,
          status: 'ACTIVE',
          agreementsAccepted: false,
          phoneBound: false,
          profileComplete: false,
        }
      },
    }
    const currentOrder = existingOrder()
    const existingRefund = {
      id: '40000000-0000-4000-8000-000000000001',
      order_id: currentOrder.id,
      amount_cents: 79900,
      status: 'PENDING',
    }
    let mode = 'checkout-replay'
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_user_identities')) return { user_id: userId }
        if (sql.includes('FROM mip_orders') && sql.includes('idempotency_key')) {
          return mode === 'checkout-replay' ? currentOrder : null
        }
        if (sql.includes('FROM mip_refunds') && sql.includes('idempotency_key')) {
          return existingRefund
        }
        throw new Error(`unexpected read: ${sql}`)
      },
      async query(sql) {
        writes.push(sql)
        return { affectedRows: 1 }
      },
    }
    const repository = createCommerceRepository({
      transaction: work => work(tx),
    }, { fullAccessPolicy })
    const input = {
      planId: currentOrder.membership_plan_id,
      idempotencyKey: 'checkout-request',
      attribution: { sourceType: 'PLATFORM' },
      catalogStage: 'TEST',
    }
    const ids = {
      orderId: currentOrder.id,
      merchantOrderNo: 'MIP-ORDER',
      outboxId: '50000000-0000-4000-8000-000000000001',
      createdAt: '2026-08-24T00:00:00.000Z',
    }

    await assert.doesNotReject(() => repository.createCheckout(
      caller,
      input,
      ids,
      () => assert.fail('existing checkout must not be recreated'),
    ))
    assert.equal(accessLoads, 0)

    mode = 'new-checkout'
    await assert.rejects(
      () => repository.createCheckout(caller, input, ids, () => assert.fail('plan must not load')),
      /AGREEMENT_REQUIRED/,
    )
    assert.equal(accessLoads, 1)

    await assert.doesNotReject(() => repository.requestRefund(caller, {
      orderId: currentOrder.id,
      idempotencyKey: 'refund-request',
    }, {
      refundId: existingRefund.id,
      merchantRefundNo: 'MIPR-REFUND',
      outboxId: '60000000-0000-4000-8000-000000000001',
    }, () => assert.fail('existing refund must not be recalculated')))
    assert.equal(accessLoads, 1)
    assert.equal(writes.length, 0)
  })

  it('keeps agreement parsing aligned with the identity function contract', () => {
    assert.deepEqual(configuredAgreements().map(({ key, version }) => ({ key, version })), [
      { key: 'SERVICE_AGREEMENT', version: 'draft-2026-08-24' },
      { key: 'PRIVACY_POLICY', version: 'draft-2026-08-24' },
    ])
    assert.throws(() => configuredAgreements('[]'), /AGREEMENT_CONFIG_INVALID/)
  })
})
