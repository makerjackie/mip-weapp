'use strict'
const assert = require('node:assert/strict')
const { it } = require('node:test')
const { effectivePolicyCapabilities, templateAllowsBinding } = require('../domain/role-template-policy')
const { capabilitiesForBinding, authorize } = require('../domain/capabilities')
const { lockMutationAuthorization } = require('../domain/mutation-authorization')
const { createRoleTemplateRepository, createRoleTemplates, lockTemplateForBinding } = require('../domain/role-templates')

const binding = { role_key: 'BRANCH_ADMIN', scope_type: 'BRANCH', scope_id: 'branch-a', status: 'ACTIVE',
  role_template_id: '12', template_base_role_key: 'BRANCH_ADMIN', template_status: 'ACTIVE',
  template_capabilities_json: '["events.read","events.write"]', policy_capabilities_json: '["events.read"]' }
it('intersects a template with role policy and keeps each scope independent', () => {
  assert.deepEqual(effectivePolicyCapabilities(binding), ['events.read'])
  const rows = [binding, { ...binding, scope_id: 'branch-b', template_capabilities_json: '["events.write"]', policy_capabilities_json: null }]
  const grants = rows.filter(templateAllowsBinding).map(row => ({ roleKey: row.role_key, scopeType: row.scope_type, scopeId: row.scope_id,
    capabilities: capabilitiesForBinding({ roleKey: row.role_key, policyCapabilities: effectivePolicyCapabilities(row) }) }))
  assert.equal(authorize(grants, 'events.read', { scopeType: 'BRANCH', scopeId: 'branch-a' }).scopeId, 'branch-a')
  assert.throws(() => authorize(grants, 'events.write', { scopeType: 'BRANCH', scopeId: 'branch-a' }), error => error.code === 'FORBIDDEN')
  assert.equal(authorize(grants, 'events.write', { scopeType: 'BRANCH', scopeId: 'branch-b' }).scopeId, 'branch-b')
  assert.deepEqual(effectivePolicyCapabilities({ role_key: 'BRANCH_ADMIN', policy_capabilities_json: null }), null)
})
it('never falls back to broad permissions for a missing, stopped, mismatched or invalid template', () => {
  for (const patch of [{ template_status: null }, { template_status: 'INACTIVE' }, { template_base_role_key: 'PLATFORM_OPERATIONS' },
    { template_capabilities_json: '{}' }, { template_capabilities_json: '["events.read","events.read"]' }, { role_key: 'PLATFORM_OWNER' }]) {
    assert.equal(templateAllowsBinding({ ...binding, ...patch }), false)
    assert.deepEqual(effectivePolicyCapabilities({ ...binding, ...patch }), [])
  }
  assert.deepEqual(capabilitiesForBinding({ roleKey: 'EVENT_STAFF', policyCapabilities: ['roles.change'] }), [])
})
it('rechecks the current template in the write transaction after a previously valid session', async () => {
  let current = { ...binding, policy_capabilities_json: null }
  const tx = { one: async sql => sql.includes('FROM mip_users') ? { id: 'actor', status: 'ACTIVE' } : current }
  const input = { appId: 'app-a', actorUserId: 'actor', authorization: { capability: 'events.write', effectiveGrant: { roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a' } } }
  assert.equal((await lockMutationAuthorization(tx, input)).effectiveGrant.capabilities.includes('events.write'), true)
  current = { ...current, template_status: 'INACTIVE' }
  await assert.rejects(lockMutationAuthorization(tx, input), error => error.code === 'FORBIDDEN')
  current = { ...binding, policy_capabilities_json: '["events.read"]' }
  await assert.rejects(lockMutationAuthorization(tx, input), error => error.code === 'FORBIDDEN')
})
it('gates binding writes and rejects app mismatches, permission expansion and protected owners', async () => {
  const previous = process.env.MIP_ADMIN_ROLE_TEMPLATES_ENABLED
  try {
    process.env.MIP_ADMIN_ROLE_TEMPLATES_ENABLED = 'false'
    const tx = { one: async () => ({ role_id: '12', status: 'ACTIVE', base_role_key: 'BRANCH_ADMIN', capabilities: '["events.read"]' }) }
    const authorization = { effectiveGrant: { capabilities: ['roles.change', 'events.read'] } }
    await assert.rejects(lockTemplateForBinding(tx, { appId: 'app-a' }, authorization, '12', 'BRANCH_ADMIN'), error => error.code === 'ROLE_TEMPLATES_NOT_ENABLED')
    process.env.MIP_ADMIN_ROLE_TEMPLATES_ENABLED = 'true'
    assert.equal(await lockTemplateForBinding(tx, { appId: 'app-a' }, authorization, '12', 'BRANCH_ADMIN'), '12')
    await assert.rejects(lockTemplateForBinding({ one: async () => null }, { appId: 'app-b' }, authorization, '12', 'BRANCH_ADMIN'), error => error.code === 'FORBIDDEN')
    await assert.rejects(lockTemplateForBinding(tx, { appId: 'app-a' }, { effectiveGrant: { capabilities: ['roles.change'] } }, '12', 'BRANCH_ADMIN'), error => error.code === 'FORBIDDEN')
    await assert.rejects(lockTemplateForBinding(tx, { appId: 'app-a' }, authorization, '12', 'PLATFORM_OWNER'), error => error.code === 'FORBIDDEN')
  } finally { if (previous === undefined) delete process.env.MIP_ADMIN_ROLE_TEMPLATES_ENABLED; else process.env.MIP_ADMIN_ROLE_TEMPLATES_ENABLED = previous }
})
it('creates, copies, stops and rejects stale edits without changing the source or deleting bound roles', async () => {
  const source = { role_id: 12, app_id: 'app-a', role_name: '活动只读', description: '说明', base_role_key: 'BRANCH_ADMIN', capabilities: '["events.read"]', status: 'ACTIVE', is_system: 0, version: 3 }
  const writes = [], audits = []
  const tx = { one: async () => source, query: async (sql, params) => { writes.push({ sql, params }); return { affectedRows: 1, insertId: 13 } } }
  const repo = createRoleTemplateRepository({ transaction: work => work(tx) }, {
    lockMutation: async () => ({ effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM' } }), writeAudit: async (_, value) => audits.push(value),
  })
  const input = { appId: 'app-a', actorUserId: 'actor', templateId: '12', expectedVersion: 3, name: '新岗位', description: '复制说明', baseRoleKey: 'BRANCH_ADMIN', capabilities: ['events.read'], audit: {} }
  assert.deepEqual(await repo.mutateRoleTemplate({ ...input, operation: 'copy' }), { id: '13', version: 1 })
  assert.equal(writes.some(write => write.sql.startsWith('UPDATE mip_admin_roles')), false)
  assert.equal(audits[0].metadata.before.name, '活动只读')
  writes.length = 0
  await repo.mutateRoleTemplate({ appId: 'app-a', actorUserId: 'actor', templateId: '12', expectedVersion: 3, operation: 'status', status: 'INACTIVE', audit: {} })
  assert.deepEqual(writes[0].params.slice(0, 4), ['活动只读', '说明', '["events.read"]', 'INACTIVE'])
  const count = writes.length
  await assert.rejects(repo.mutateRoleTemplate({ ...input, expectedVersion: 2, operation: 'update' }), error => error.code === 'CONFLICT')
  assert.equal(writes.length, count)
  assert.equal(writes.some(write => /DELETE/.test(write.sql)), false)
})
it('rejects role creation outside the system maximum before any write', async () => {
  let written = false
  const api = createRoleTemplates({ access: { session: async () => ({ caller: { appId: 'app-a', userId: 'actor' } }), requirePlatformOwner: () => ({}), mutationAuthorization: () => ({}), audit: () => ({}) }, repository: { mutateRoleTemplate: async () => { written = true } } })
  for (const [baseRoleKey, capabilities] of [['PLATFORM_OWNER', []], ['EVENT_STAFF', ['roles.change']], ['BRANCH_ADMIN', ['events.read', 'events.read']]]) {
    await assert.rejects(api.createRole({}, { name: '岗位', baseRoleKey, capabilities, idempotencyKey: 'new-template' }), error => error.code === 'VALIDATION_FAILED')
  }
  assert.equal(written, false)
})
