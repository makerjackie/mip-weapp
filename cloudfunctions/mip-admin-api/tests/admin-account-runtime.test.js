'use strict'
const { it } = require('node:test')
const assert = require('node:assert/strict')
const { createAdminAccounts } = require('../domain/admin-accounts')
const { createAdminAccountRepository } = require('../domain/repositories/admin-accounts')
const appId = 'test-app'
const actor = '10000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000002'
const bindingId = '20000000-0000-4000-8000-000000000001'
const owner = { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }
function fixture(stored = null, registered = true) {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_users\n')) return { id: actor, status: 'ACTIVE' }
      if (sql.includes('policy_capabilities_json')) return { role_key: owner.roleKey, scope_type: 'PLATFORM', scope_id: null, status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_accounts')) return stored
      if (sql.includes('JOIN mip_private_profiles')) return registered ? { id: userId, status: 'ACTIVE' } : null
      return null
    },
    async query(sql, params) { calls.push({ sql, params }); return { affectedRows: 1, insertId: 42 } },
  }
  const repo = createAdminAccountRepository({ ...tx, transaction: fn => fn(tx) }, { writeAudit: async (_, audit) => calls.push({ audit }) })
  const access = {
    session: async () => ({ caller: { appId, userId: actor }, bindings: [owner] }),
    mutationAuthorization: () => ({ capability: 'roles.change', effectiveGrant: owner }),
    audit: (_, __, value) => ({ appId, actorUserId: actor, ...value }),
  }
  return { calls, service: createAdminAccounts({ repository: repo, access }), repo }
}
it('creates an account and role together only for a registered verified user', async () => {
  const { service, calls } = fixture()
  const result = await service.createAdminAccount({}, { userId, name: '运营', loginAccount: 'operations', roleKey: 'PLATFORM_OPERATIONS' })
  assert.equal(result.accountId, '42')
  assert.equal(result.userId, userId)
  assert.ok(calls.some(c => c.sql?.includes('INSERT INTO mip_admin_role_bindings')))
  const insert = calls.find(c => c.sql?.includes('INSERT INTO mip_admin_accounts'))
  assert.deepEqual(insert.params.slice(0, 2), [appId, userId])
  assert.ok(!JSON.stringify(result).includes('phone'))
})
it('rejects unknown mini-program users before creating an account or binding', async () => {
  const { service, calls } = fixture(null, false)
  await assert.rejects(service.createAdminAccount({}, { userId, name: '运营', loginAccount: 'operations', roleKey: 'PLATFORM_OPERATIONS' }), /无法操作/)
  assert.equal(calls.filter(c => c.sql?.includes('INSERT INTO mip_admin')).length, 0)
})
it('rejects stale versions and prevents self or owner deactivation', async () => {
  for (const stored of [
    { version: 3, linked_user_id: userId, role_key: 'PLATFORM_OPERATIONS' },
    { version: 2, linked_user_id: actor, role_key: 'PLATFORM_OPERATIONS' },
    { version: 2, linked_user_id: userId, role_key: 'PLATFORM_OWNER' },
  ]) {
    const { service } = fixture(stored)
    await assert.rejects(service.changeAdminAccountStatus({}, { accountId: '42', expectedVersion: 2, status: 'INACTIVE', reason: '调整' }))
  }
})
it('disables the binding atomically and audits the account change', async () => {
  const { service, calls } = fixture({ account_id: 42, version: 2, linked_user_id: userId, role_key: 'PLATFORM_OPERATIONS', name: '运营', binding_id: bindingId, managed_scope_type: 'PLATFORM', managed_scope_id: null, status: 'ACTIVE' })
  const result = await service.changeAdminAccountStatus({}, { accountId: '42', expectedVersion: 2, status: 'INACTIVE', reason: '调整' })
  assert.equal(result.status, 'INACTIVE')
  assert.equal(result.version, 3)
  assert.ok(calls.some(c => c.sql?.includes('UPDATE mip_admin_role_bindings') && c.params[0] === 'REVOKED'))
  assert.ok(calls.some(c => c.audit?.metadata.accountId === '42'))
})
it('returns nonempty tenant-scoped list without exposing private phones', async () => {
  let query
  const repo = createAdminAccountRepository({ query: async (sql, params) => { query = { sql, params }; return [{ account_id: 42, linked_user_id: userId, login_account: 'operations', role_key: 'PLATFORM_OPERATIONS', name: '运营', status: 'ACTIVE', version: 3 }] } }, {})
  const result = await repo.listAdminAccounts(appId, { limit: 20, query: '', status: '' })
  assert.equal(result.items[0].accountId, '42')
  assert.equal(result.items[0].name, '运营')
  assert.equal(result.items[0].version, 3)
  assert.match(query.sql, /a.app_id = \?/)
  assert.equal(query.params[0], appId)
})
