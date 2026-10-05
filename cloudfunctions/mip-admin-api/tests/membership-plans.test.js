'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { requestHash } = require('../domain/idempotency')
const { createMembershipPlans } = require('../domain/membership-plans')
const { createMembershipPlansRepository } = require('../domain/repositories/membership-plans')
const grant = { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }
const plan = { id: 'plan-a', planKey: 'annual', catalogStage: 'LIVE', name: '一年会员', durationDays: 365, priceCents: 600000, currency: 'CNY', status: 'ACTIVE', version: 3, updatedAt: 'today' }
function service(bindings = [grant], calls = []) {
  return createMembershipPlans({ access: {
    session: async () => ({ caller: { appId: 'app', userId: 'admin' }, bindings }),
    mutationAuthorization: () => ({ effectiveGrant: grant, capability: 'growth.configure' }),
    audit: (_context, _grant, input) => input,
  }, repository: {
    listMembershipPlans: async appId => { calls.push({ list: appId }); return { items: [{ ...plan, appId }] } },
    saveMembershipPlanPrice: async input => { calls.push(input); return { planId: input.planId, priceCents: input.priceCents, version: input.expectedVersion + 1 } },
  } })
}
describe('membership plan price administration', () => {
  it('restricts plan reads and price saves to platform administrators', async () => {
    const branch = service([{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch' }])
    await assert.rejects(() => branch.listMembershipPlans({}), { code: 'FORBIDDEN' })
    await assert.rejects(() => branch.saveMembershipPlanPrice({}, { planId: 'plan-a', expectedVersion: 3, priceCents: 600000 }), { code: 'FORBIDDEN' })
    const calls = []
    assert.equal((await service([grant], calls).listMembershipPlans({})).items[0].name, '一年会员')
    assert.equal(calls[0].list, 'app')
  })
  it('binds the app and actor server-side and accepts the retry key', async () => {
    const calls = []
    await service([grant], calls).saveMembershipPlanPrice({}, { appId: 'other', planId: ' plan-a ', expectedVersion: 3, priceCents: 688800, idempotencyKey: 'retry' })
    assert.equal(calls[0].appId, 'app')
    assert.equal(calls[0].actorUserId, 'admin')
    assert.equal(calls[0].planId, 'plan-a')
    assert.equal(calls[0].priceCents, 688800)
    assert.equal(calls[0].idempotencyKey, 'retry')
    assert.equal(calls[0].audit.resourceType, 'MEMBERSHIP_PLAN')
    assert.equal(calls[0].audit.metadata.priceCents, 688800)
  })
  it('validates the plan id, version, and price range', async () => {
    const admin = service()
    for (const input of [
      { expectedVersion: 3, priceCents: 600000 },
      { planId: '   ', expectedVersion: 3, priceCents: 600000 },
      { planId: 'plan-a', expectedVersion: 0, priceCents: 600000 },
      { planId: 'plan-a', expectedVersion: 1.5, priceCents: 600000 },
      { planId: 'plan-a', expectedVersion: 3, priceCents: 0 },
      { planId: 'plan-a', expectedVersion: 3, priceCents: -600000 },
      { planId: 'plan-a', expectedVersion: 3, priceCents: 600000.5 },
      { planId: 'plan-a', expectedVersion: 3, priceCents: 100000001 },
    ]) {
      await assert.rejects(() => admin.saveMembershipPlanPrice({}, input), { code: 'VALIDATION_FAILED' })
    }
  })
  it('checks authorization and version before any update, then audits the old and new price', async () => {
    const calls = []
    const tx = { one: async () => ({ price_cents: 600000, version: 3 }), query: async (_sql, params) => { calls.push(params); return { affectedRows: 1 } } }
    const repo = createMembershipPlansRepository({ transaction: fn => fn(tx) }, {
      lockMutation: async () => { calls.push('lock'); return {} }, assertScope: () => calls.push('scope'),
      writeAudit: async (_tx, audit) => calls.push({ audit }),
    })
    await assert.rejects(() => repo.saveMembershipPlanPrice({ appId: 'app', actorUserId: 'admin', planId: 'plan-a', expectedVersion: 2, priceCents: 688800, audit: { metadata: { priceCents: 688800 } } }), { code: 'CONFLICT' })
    assert.deepEqual(calls, ['lock', 'scope'])
    calls.length = 0
    assert.deepEqual(await repo.saveMembershipPlanPrice({ appId: 'app', actorUserId: 'admin', planId: 'plan-a', expectedVersion: 3, priceCents: 688800, audit: { metadata: { priceCents: 688800 } } }), { planId: 'plan-a', priceCents: 688800, version: 4 })
    assert.deepEqual(calls[2], [688800, 'app', 'plan-a', 3])
    assert.equal(calls[3].audit.metadata.priceCents, 688800)
    assert.equal(calls[3].audit.metadata.previousPriceCents, 600000)
  })
  it('rejects an unknown plan without writing anything', async () => {
    const writes = []
    const repo = createMembershipPlansRepository({ transaction: fn => fn({ one: async () => null }) }, {
      lockMutation: async () => ({}), assertScope: () => {}, writeAudit: async () => writes.push('audit'),
    })
    await assert.rejects(() => repo.saveMembershipPlanPrice({ appId: 'app', actorUserId: 'admin', planId: 'missing', expectedVersion: 1, priceCents: 100, audit: { metadata: {} } }), { code: 'NOT_FOUND' })
    assert.deepEqual(writes, [])
  })
  it('replays a completed idempotent save instead of writing twice', async () => {
    const input = { appId: 'app', actorUserId: 'admin', planId: 'plan-a', expectedVersion: 3, priceCents: 688800, idempotencyKey: 'retry-1', audit: { metadata: { priceCents: 688800 } } }
    const response = { planId: 'plan-a', priceCents: 688800, version: 4 }
    const writes = []
    const duplicate = Object.assign(new Error('ER_DUP_ENTRY'), { code: 'ER_DUP_ENTRY' })
    const tx = {
      query: async () => { throw duplicate },
      one: async (_sql, params) => {
        assert.deepEqual(params, ['app', 'admin', 'membership.plan.price.save', 'retry-1'])
        return { request_hash: requestHash({ expectedVersion: input.expectedVersion, planId: input.planId, priceCents: input.priceCents }), status: 'COMPLETED', response_json: JSON.stringify(response) }
      },
    }
    const repo = createMembershipPlansRepository({ transaction: fn => fn(tx) }, {
      lockMutation: async () => ({}), assertScope: () => {}, writeAudit: async () => writes.push('audit'),
    })
    assert.deepEqual(await repo.saveMembershipPlanPrice(input), { ...response, idempotent: true })
    assert.deepEqual(writes, [])
  })
  it('projects only public plan fields for the admin panel', async () => {
    const repo = createMembershipPlansRepository({ query: async (_sql, params) => {
      assert.deepEqual(params, ['app'])
      return [{ id: 'plan-a', plan_key: 'annual', catalog_stage: 'TEST', name: '一年会员', duration_days: 365, price_cents: 600000, currency: 'CNY', status: 'ACTIVE', version: 2, updated_at: new Date('2026-10-05T00:00:00.000Z') }]
    } }, {})
    assert.deepEqual(await repo.listMembershipPlans('app'), { items: [{ id: 'plan-a', planKey: 'annual', catalogStage: 'TEST', name: '一年会员', durationDays: 365, priceCents: 600000, currency: 'CNY', status: 'ACTIVE', version: 2, updatedAt: '2026-10-05T00:00:00.000Z' }] })
  })

})
