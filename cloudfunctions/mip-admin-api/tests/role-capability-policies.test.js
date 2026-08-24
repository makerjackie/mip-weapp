'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  CAPABILITIES,
  authorize,
  capabilitiesForBinding,
} = require('../domain/capabilities')
const { lockMutationAuthorization } = require('../domain/mutation-authorization')
const { createRoleCapabilityPolicyRepository } = require('../domain/role-capability-policies')
const { createAdminService } = require('../domain/service')

const caller = { appId: 'wx-rbac', identityKey: 'identity-key' }

function serviceRepository(roleKey, capabilities) {
  const audits = []
  return {
    audits,
    resolveUser: async () => ({
      id: 'admin-user',
      status: 'ACTIVE',
      agreementsAccepted: true,
      phoneBound: true,
      profileComplete: true,
    }),
    listRoleBindings: async () => [{
      roleKey,
      scopeType: roleKey === 'BRANCH_ADMIN' ? 'BRANCH' : 'PLATFORM',
      scopeId: roleKey === 'BRANCH_ADMIN' ? 'branch-a' : null,
      ...(capabilities ? { capabilities } : {}),
    }],
    listRoleCapabilityPolicies: async () => [],
    recordAudit: async audit => audits.push(audit),
    updateRoleCapabilityPolicy: async input => ({
      roleKey: input.roleKey,
      capabilities: input.capabilities,
      version: input.expectedVersion + 1,
      updatedAt: input.now.toISOString(),
    }),
    resetRoleCapabilityPolicy: async input => ({
      roleKey: input.roleKey,
      capabilities: [],
      mode: 'DEFAULT',
      version: input.expectedVersion + 1,
      updatedAt: input.now.toISOString(),
    }),
  }
}

describe('configurable role capabilities', () => {
  it('uses the safe default only when no policy exists and fails closed for malformed policies', () => {
    const defaultBinding = { roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }
    assert.equal(capabilitiesForBinding(defaultBinding).includes(CAPABILITIES.USERS_READ), true)
    const reduced = { ...defaultBinding, capabilities: [CAPABILITIES.DASHBOARD] }
    assert.equal(authorize([reduced], CAPABILITIES.DASHBOARD), reduced)
    assert.throws(() => authorize([reduced], CAPABILITIES.USERS_READ), /FORBIDDEN/)
    assert.deepEqual(capabilitiesForBinding({ ...defaultBinding, policyCapabilities: '["refunds.submit"]' }), [])
    assert.equal(capabilitiesForBinding({
      roleKey: 'PLATFORM_OWNER',
      scopeType: 'PLATFORM',
      scopeId: null,
      policyCapabilities: '[]',
    }).includes(CAPABILITIES.ROLES_CHANGE), true)
  })

  it('applies the effective policy to every service authorization in the request', async () => {
    const repository = serviceRepository('PLATFORM_OPERATIONS', [CAPABILITIES.DASHBOARD])
    let usersRead = false
    repository.listUsers = async () => { usersRead = true; return [] }
    const service = createAdminService({ repository })
    const session = await service.getSession(caller)
    assert.deepEqual(session.capabilities.map(item => item.capability), [CAPABILITIES.DASHBOARD])
    assert.deepEqual(session.roles, [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }])
    await assert.rejects(() => service.listUsers(caller), error => error?.code === 'FORBIDDEN')
    assert.equal(usersRead, false)
  })

  it('allows only a platform owner to read and update policies', async () => {
    const ownerRepository = serviceRepository('PLATFORM_OWNER')
    const owner = createAdminService({ repository: ownerRepository, now: () => new Date('2026-08-24T00:00:00.000Z') })
    const page = await owner.listRoleCapabilityPolicies(caller)
    assert.equal(page.items.length, 6)
    assert.equal(page.items.every(item => item.source === 'DEFAULT' && item.version === 0), true)
    assert.equal(page.items.some(item => item.roleKey === 'PLATFORM_OWNER'), false)

    const updated = await owner.updateRoleCapabilityPolicy(caller, {
      roleKey: 'EVENT_STAFF',
      capabilities: [CAPABILITIES.DASHBOARD, CAPABILITIES.EVENTS_READ],
      expectedVersion: 0,
    })
    assert.equal(updated.version, 1)
    assert.equal(updated.source, 'CUSTOM')
    assert.deepEqual(updated.capabilities, [CAPABILITIES.DASHBOARD, CAPABILITIES.EVENTS_READ])
    const reset = await owner.updateRoleCapabilityPolicy(caller, {
      roleKey: 'EVENT_STAFF',
      expectedVersion: 1,
      reset: true,
    })
    assert.equal(reset.source, 'DEFAULT')
    assert.equal(reset.version, 2)
    assert.deepEqual(reset.capabilities, reset.allowedCapabilities)
    await assert.rejects(() => owner.updateRoleCapabilityPolicy(caller, {
      roleKey: 'PLATFORM_OPERATIONS',
      capabilities: [CAPABILITIES.REFUNDS_SUBMIT],
      expectedVersion: 0,
    }), error => error?.code === 'VALIDATION_FAILED')
    await assert.rejects(() => owner.updateRoleCapabilityPolicy(caller, {
      roleKey: 'PLATFORM_OWNER',
      capabilities: [],
      expectedVersion: 0,
    }), error => error?.code === 'VALIDATION_FAILED')
    await assert.rejects(() => owner.updateRoleCapabilityPolicy(caller, {
      roleKey: 'PLATFORM_OWNER',
      expectedVersion: 0,
      reset: true,
    }), error => error?.code === 'VALIDATION_FAILED')

    const branchAdmin = createAdminService({ repository: serviceRepository('BRANCH_ADMIN') })
    await assert.rejects(() => branchAdmin.listRoleCapabilityPolicies(caller), error => error?.code === 'FORBIDDEN')
    await assert.rejects(() => branchAdmin.updateRoleCapabilityPolicy(caller, {
      roleKey: 'EVENT_STAFF',
      expectedVersion: 0,
      reset: true,
    }), error => error?.code === 'FORBIDDEN')
  })

  it('rechecks the policy while holding the role binding lock for mutations', async () => {
    const reads = []
    const tx = {
      async one(sql) {
        reads.push(sql)
        if (sql.includes('FROM mip_users')) return { id: 'admin-user', status: 'ACTIVE' }
        return {
          scope_type: 'PLATFORM',
          scope_id: '00000000-0000-0000-0000-000000000000',
          role_key: 'PLATFORM_OPERATIONS',
          status: 'ACTIVE',
          policy_capabilities_json: JSON.stringify([CAPABILITIES.DASHBOARD]),
        }
      },
    }
    await assert.rejects(() => lockMutationAuthorization(tx, {
      appId: caller.appId,
      actorUserId: 'admin-user',
      authorization: {
        capability: CAPABILITIES.USERS_EDIT,
        effectiveGrant: { roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null },
      },
    }), error => error?.code === 'FORBIDDEN')
    assert.match(reads[1], /LEFT JOIN mip_role_capability_policies/)
    assert.match(reads[1], /FOR UPDATE/)
  })

  it('uses optimistic versions and an audited owner-only transaction when saving', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_role_capability_policies')) return null
        throw new Error(`unexpected read: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = createRoleCapabilityPolicyRepository({
      query: async () => [],
      transaction: work => work(tx),
    }, {
      id: () => 'audit-id',
      lockMutation: async () => ({
        capability: CAPABILITIES.ROLES_CHANGE,
        effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
      }),
    })
    const result = await repository.updateRoleCapabilityPolicy({
      appId: caller.appId,
      actorUserId: 'admin-user',
      roleKey: 'EVENT_STAFF',
      capabilities: [CAPABILITIES.EVENTS_READ],
      expectedVersion: 0,
      now: new Date('2026-08-24T00:00:00.000Z'),
      audit: {
        appId: caller.appId,
        actorUserId: 'admin-user',
        scopeType: 'PLATFORM',
        scopeId: null,
        action: 'admin.role_capability_policies.update',
        resourceType: 'ROLE_CAPABILITY_POLICY',
        resourceId: 'EVENT_STAFF',
        effectiveRole: 'PLATFORM_OWNER',
        metadata: {},
      },
    })
    assert.equal(result.version, 1)
    assert.equal(writes.some(item => item.sql.includes('INSERT INTO mip_role_capability_policies')), true)
    assert.equal(writes.some(item => item.sql.includes('INSERT INTO mip_audit_logs')), true)
  })

  it('marks the locked custom policy as default and audits an owner reset', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_role_capability_policies')) {
          return { role_key: 'EVENT_STAFF', policy_mode: 'CUSTOM', version: 3 }
        }
        throw new Error(`unexpected read: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = createRoleCapabilityPolicyRepository({
      query: async () => [],
      transaction: work => work(tx),
    }, {
      id: () => 'audit-id',
      lockMutation: async () => ({
        capability: CAPABILITIES.ROLES_CHANGE,
        effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
      }),
    })
    const result = await repository.resetRoleCapabilityPolicy({
      appId: caller.appId,
      actorUserId: 'admin-user',
      roleKey: 'EVENT_STAFF',
      expectedVersion: 3,
      now: new Date('2026-08-24T00:00:00.000Z'),
      authorization: {
        capability: CAPABILITIES.ROLES_CHANGE,
        effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
      },
      audit: {
        appId: caller.appId,
        actorUserId: 'admin-user',
        scopeType: 'PLATFORM',
        scopeId: null,
        action: 'admin.role_capability_policies.reset',
        resourceType: 'ROLE_CAPABILITY_POLICY',
        resourceId: 'EVENT_STAFF',
        effectiveRole: 'PLATFORM_OWNER',
        metadata: { expectedVersion: 3 },
      },
    })
    assert.equal(result.version, 4)
    assert.deepEqual(result.capabilities, roleCapabilitiesFor('EVENT_STAFF'))
    assert.equal(writes.some(item => item.sql.includes("SET policy_mode = 'DEFAULT'")), true)
    assert.equal(writes.some(item => item.sql.includes('DELETE FROM mip_role_capability_policies')), false)
    assert.equal(writes.some(item => item.sql.includes('INSERT INTO mip_audit_logs')), true)
    const completedWrites = writes.length
    await assert.rejects(() => repository.resetRoleCapabilityPolicy({
      appId: caller.appId,
      actorUserId: 'admin-user',
      roleKey: 'EVENT_STAFF',
      expectedVersion: 2,
      now: new Date('2026-08-24T00:00:00.000Z'),
      authorization: {
        capability: CAPABILITIES.ROLES_CHANGE,
        effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
      },
      audit: {
        appId: caller.appId,
        actorUserId: 'admin-user',
        scopeType: 'PLATFORM',
        scopeId: null,
        action: 'admin.role_capability_policies.reset',
        resourceType: 'ROLE_CAPABILITY_POLICY',
        resourceId: 'EVENT_STAFF',
        effectiveRole: 'PLATFORM_OWNER',
        metadata: { expectedVersion: 2 },
      },
    }), error => error?.code === 'CONFLICT')
    assert.equal(writes.length, completedWrites)
  })

  it('creates a versioned default marker when no custom policy exists', async () => {
    const writes = []
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_role_capability_policies')) return null
        throw new Error(`unexpected read: ${sql}`)
      },
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = createRoleCapabilityPolicyRepository({
      query: async () => [],
      transaction: work => work(tx),
    }, {
      id: () => 'audit-id',
      lockMutation: async () => ({
        capability: CAPABILITIES.ROLES_CHANGE,
        effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
      }),
    })
    const result = await repository.resetRoleCapabilityPolicy({
      appId: caller.appId,
      actorUserId: 'admin-user',
      roleKey: 'EVENT_STAFF',
      expectedVersion: 0,
      now: new Date('2026-08-24T00:00:00.000Z'),
      authorization: {
        capability: CAPABILITIES.ROLES_CHANGE,
        effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
      },
      audit: {
        appId: caller.appId,
        actorUserId: 'admin-user',
        scopeType: 'PLATFORM',
        scopeId: null,
        action: 'admin.role_capability_policies.reset',
        resourceType: 'ROLE_CAPABILITY_POLICY',
        resourceId: 'EVENT_STAFF',
        effectiveRole: 'PLATFORM_OWNER',
        metadata: { expectedVersion: 0 },
      },
    })
    assert.equal(result.mode, 'DEFAULT')
    assert.equal(result.version, 1)
    assert.equal(writes.some(item => item.sql.includes("'DEFAULT', JSON_ARRAY(), 1")), true)
    assert.equal(writes.some(item => item.sql.includes('INSERT INTO mip_audit_logs')), true)
  })
})

function roleCapabilitiesFor(roleKey) {
  return capabilitiesForBinding({ roleKey })
}
