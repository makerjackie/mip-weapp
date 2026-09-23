'use strict'

const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createAdminEntitlements } = require('../domain/entitlements')

const owner = { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }
function fixture() {
  const calls = []
  const access = {
    session: async () => ({ caller: { appId: 'test-app', userId: 'owner-1' }, bindings: [owner] }),
    mutationAuthorization: (_, capability) => ({ capability }),
    audit: (_, __, data) => data,
  }
  const repository = {
    listEntitlementTransactions: async input => { calls.push(['list', input]); return { items: [{ id: 'entry-1' }], nextCursor: null } },
    grantGrowthEntitlement: async input => { calls.push(['growth', input]); return { entitlementNo: 'entry-1' } },
  }
  const memberships = {
    getMembership: async (_, input) => { calls.push(['getMembership', input]); return { chainVersion: 4 } },
    grantMembership: async (_, input) => { calls.push(['grantMembership', input]); return { id: 'entitlement-1' } },
  }
  return { calls, service: createAdminEntitlements({ access, repository, memberships }) }
}

it('lists real entitlement transactions using tenant, filter and cursor inputs', async () => {
  const { calls, service } = fixture()
  const result = await service.listEntitlementTransactions({}, { filters: { entitlementType: 'EXP' }, limit: 20 })
  assert.deepEqual(result.items, [{ id: 'entry-1' }])
  assert.equal(calls[0][1].appId, 'test-app')
  assert.equal(calls[0][1].filters.entitlementType, 'EXP')
})

it('grants experience through the authoritative growth ledger', async () => {
  const { calls, service } = fixture()
  await service.grantEntitlement({}, { userId: 'user-1', entitlementType: 'EXP', amount: 100, idempotencyKey: 'grant-1' })
  assert.equal(calls[0][0], 'growth')
  assert.equal(calls[0][1].metric, 'EXPERIENCE')
  assert.equal(calls[0][1].authorization.capability, 'memberships.adjust')
  assert.equal(calls[0][1].amount, 100)
})

it('extends membership via the chain and rejects unsupported or ambiguous grants', async () => {
  const { calls, service } = fixture()
  await service.grantEntitlement({}, { userId: 'user-1', entitlementType: 'MEMBERSHIP', idempotencyKey: 'grant-2' })
  assert.equal(calls[1][0], 'grantMembership')
  assert.equal(calls[1][1].expectedChainVersion, 4)
  assert.equal(calls[1][1].durationMonths, 12)
  for (const input of [
    { entitlementType: 'EVENT_PASS', amount: 1 },
    { entitlementType: 'EXP', amount: 1, months: 12 },
    { entitlementType: 'MEMBERSHIP', amount: 1 },
  ]) {
    await assert.rejects(service.grantEntitlement({}, { userId: 'user-1', idempotencyKey: 'bad', ...input }),
      error => error.code === 'VALIDATION_FAILED')
  }
})
