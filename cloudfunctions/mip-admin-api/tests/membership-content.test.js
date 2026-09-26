'use strict'
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createMembershipContent } = require('../domain/membership-content')
const { createMembershipContentRepository } = require('../domain/repositories/membership-content')
const grant = { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }
const draft = { title: '演示协议', body: '第一条\n第二条', isDemo: true }
function service(bindings = [grant], calls = []) {
  return createMembershipContent({ access: {
    session: async () => ({ caller: { appId: 'app', userId: 'admin' }, bindings }),
    mutationAuthorization: () => ({ effectiveGrant: grant, capability: 'growth.configure' }),
    audit: (_context, _grant, input) => input,
  }, repository: {
    getMembershipAgreement: async appId => ({ ...draft, version: 2, appId }),
    saveMembershipAgreement: async input => { calls.push(input); return { version: input.expectedVersion + 1 } },
  } })
}
describe('configurable membership agreement', () => {
  it('restricts configuration to platform administrators and binds the app server-side', async () => {
    const calls = []
    assert.equal((await service().getMembershipAgreement({})).appId, 'app')
    const admin = service([grant], calls)
    await admin.saveMembershipAgreement({}, { expectedVersion: 2, draft: { ...draft, appId: 'other' }, idempotencyKey: 'retry' })
    assert.equal(calls[0].appId, 'app')
    assert.equal(calls[0].idempotencyKey, 'retry')
    assert.deepEqual(calls[0].draft, draft)
    const branch = service([{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch' }])
    await assert.rejects(() => branch.saveMembershipAgreement({}, { expectedVersion: 0, draft }), { code: 'FORBIDDEN' })
    await assert.rejects(() => branch.getMembershipAgreement({}), { code: 'FORBIDDEN' })
  })
  it('requires an explicit demo flag, nonempty content and a valid version', async () => {
    for (const input of [{ expectedVersion: -1, draft }, { expectedVersion: 0, draft: { ...draft, isDemo: undefined } }, { expectedVersion: 0, draft: { ...draft, body: '' } }, { expectedVersion: 0, draft: { ...draft, body: '字'.repeat(8001) } }, { expectedVersion: 0, draft: { ...draft, body: '\ud800'.repeat(5000) } }]) {
      await assert.rejects(() => service().saveMembershipAgreement({}, input), { code: 'VALIDATION_FAILED' })
    }
  })
  it('checks authorization and version before any update, then audits a successful save', async () => {
    const calls = []
    const tx = { one: async () => ({ version: 2 }), query: async (_sql, params) => { calls.push(params); return { affectedRows: 1 } } }
    const repo = createMembershipContentRepository({ transaction: fn => fn(tx) }, {
      lockMutation: async () => { calls.push('lock'); return {} }, assertScope: () => calls.push('scope'), writeAudit: async () => calls.push('audit'),
    })
    await assert.rejects(() => repo.saveMembershipAgreement({ appId: 'app', actorUserId: 'admin', expectedVersion: 1, draft }), { code: 'CONFLICT' })
    assert.deepEqual(calls, ['lock', 'scope'])
    calls.length = 0
    assert.deepEqual(await repo.saveMembershipAgreement({ appId: 'app', actorUserId: 'admin', expectedVersion: 2, draft }), { version: 3 })
    assert.deepEqual(calls, ['lock', 'scope', ['app', JSON.stringify(draft), 'admin'], 'audit'])
  })
  it('projects only public agreement fields from app settings', async () => {
    const repo = createMembershipContentRepository({ one: async (_sql, params) => {
      assert.deepEqual(params, ['app'])
      return { value_json: JSON.stringify({ ...draft, secret: 'hidden' }), version: 2, updated_at: 'today' }
    } }, {})
    assert.deepEqual(await repo.getMembershipAgreement('app'), { ...draft, version: 2, updatedAt: 'today' })
  })
})
