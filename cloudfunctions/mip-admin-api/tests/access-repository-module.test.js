'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { createAdminAccessRepository } = require('../domain/repositories/access')

function createFixture({
  assertAuthorizedScope,
  assertMutationScope,
  capabilitiesForBinding,
  one,
  query,
  resolveIdentity,
} = {}) {
  const calls = []
  const database = {
    async one(sql, params) {
      calls.push({ type: 'one', sql, params })
      return one ? one(sql, params) : null
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params })
      return query ? query(sql, params) : []
    },
    async transaction(work) {
      calls.push({ type: 'transaction' })
      return work(this)
    },
  }
  const repository = createAdminAccessRepository(database, {
    assertAuthorizedScope(currentScope, authorizedScope) {
      calls.push({ type: 'authorized-scope', currentScope, authorizedScope })
      if (assertAuthorizedScope) {
        assertAuthorizedScope(currentScope, authorizedScope)
      }
    },
    assertMutationScope(authorization, currentScope) {
      calls.push({ type: 'mutation-scope', authorization, currentScope })
      if (assertMutationScope) {
        assertMutationScope(authorization, currentScope)
      }
    },
    async authorizeMutation(_tx, input, scope) {
      calls.push({ type: 'authorize', input, scope })
    },
    capabilitiesForBinding(binding) {
      calls.push({ type: 'capabilities', binding })
      return capabilitiesForBinding ? capabilitiesForBinding(binding) : []
    },
    createId: () => 'generated-id',
    eventScopeFromRow(row, eventId) {
      calls.push({ type: 'event-scope', row, eventId })
      return { scopeType: 'EVENT', scopeId: eventId, branchId: row.branch_id || null }
    },
    async lockMutationAuthorization(_tx, input) {
      calls.push({ type: 'lock', input })
      return { locked: true }
    },
    repositorySupport: {
      codeError(code) {
        return Object.assign(new Error(code), { code })
      },
      duplicateConstraint(error) {
        if (error?.code !== 'ER_DUP_ENTRY' && Number(error?.errno) !== 1062) {
          return ''
        }
        return `${error?.message || ''} ${error?.sqlMessage || ''}`
      },
      escapeLike(value) {
        return value.replace(/[\\%_]/g, '\\$&')
      },
      iso(value) {
        if (!value) {
          return null
        }
        const date = value instanceof Date ? value : new Date(value)
        return Number.isFinite(date.getTime()) ? date.toISOString() : null
      },
      json(value, fallback = {}) {
        if (value === null || value === undefined) {
          return fallback
        }
        if (typeof value === 'object') {
          return value
        }
        try {
          return JSON.parse(value)
        }
        catch {
          return fallback
        }
      },
      placeholders(values) {
        return values.map(() => '?').join(', ')
      },
    },
    async resolveIdentity(caller) {
      calls.push({ type: 'identity', caller })
      return resolveIdentity ? resolveIdentity(caller) : null
    },
    async writeAudit(_tx, audit) {
      calls.push({ type: 'audit', audit })
    },
  })
  return { calls, repository }
}

describe('admin access repository module', () => {
  it('keeps the extracted seam limited to the existing ten governance methods', () => {
    const { repository } = createFixture()
    assert.deepEqual(Object.keys(repository).sort(), [
      'changeBranchStatus',
      'createBranch',
      'listAudit',
      'listBranches',
      'listRoleBindings',
      'listRoles',
      'resolveUser',
      'searchRoleCandidates',
      'setRole',
      'updateBranch',
    ])
  })

  it('delegates identity and capability policy facts through the injected security helpers', async () => {
    const caller = { appId: 'wx-app', identityKey: 'identity-a' }
    const resolved = { id: 'user-a', status: 'ACTIVE' }
    const bindingRow = {
      scope_type: 'PLATFORM',
      scope_id: 'ignored-platform-scope',
      role_key: 'PLATFORM_OPERATIONS',
      policy_capabilities_json: '["users.read"]',
    }
    const { calls, repository } = createFixture({
      resolveIdentity: async value => value === caller ? resolved : null,
      query: async sql => sql.includes('FROM mip_admin_role_bindings') ? [bindingRow] : [],
      capabilitiesForBinding(binding) {
        assert.deepEqual(binding, {
          roleKey: 'PLATFORM_OPERATIONS',
          policyCapabilities: '["users.read"]',
        })
        return ['users.read']
      },
    })

    assert.equal(await repository.resolveUser(caller), resolved)
    assert.deepEqual(await repository.listRoleBindings('wx-app', 'user-a'), [{
      scopeType: 'PLATFORM',
      scopeId: null,
      roleKey: 'PLATFORM_OPERATIONS',
      capabilities: ['users.read'],
    }])
    assert.equal(calls.filter(call => call.type === 'identity').length, 1)
    assert.equal(calls.filter(call => call.type === 'capabilities').length, 1)
    const roleRead = calls.find(call => call.type === 'query')
    assert.match(roleRead.sql, /LEFT JOIN mip_role_capability_policies/)
    assert.deepEqual(roleRead.params, ['wx-app', 'user-a'])
  })

  it('keeps platform authorization, branch insert and audit in one transaction', async () => {
    const audit = { action: 'admin.branches.create' }
    const input = {
      appId: 'wx-app',
      actorUserId: 'admin-user',
      branchKey: 'guangzhou',
      name: '广州分会',
      cityName: '广州',
      summary: '',
      audit: branchId => ({ ...audit, resourceId: branchId }),
    }
    const { calls, repository } = createFixture({
      query: async () => ({ affectedRows: 1 }),
    })

    assert.deepEqual(await repository.createBranch(input), {
      id: 'generated-id',
      branchKey: 'guangzhou',
      name: '广州分会',
      cityName: '广州',
      summary: '',
      status: 'ACTIVE',
      version: 1,
      currentPlayerCount: 0,
      branchAdminNames: [],
      blockers: {
        activeMemberships: 0,
        activeBranchAdmins: 0,
        publishedEvents: 0,
        publishedOpportunities: 0,
      },
    })
    assert.deepEqual(calls.map(call => call.type), ['transaction', 'authorize', 'query', 'audit'])
    assert.deepEqual(calls[1].scope, { scopeType: 'PLATFORM', scopeId: null })
    assert.match(calls[2].sql, /INSERT INTO mip_city_branches/)
    assert.deepEqual(calls[2].params, [
      'generated-id',
      'wx-app',
      'guangzhou',
      '广州分会',
      '广州',
      null,
      'admin-user',
    ])
    assert.deepEqual(calls[3].audit, { ...audit, resourceId: 'generated-id' })
  })

  it('fails closed at the injected event scope check before target or role writes', async () => {
    const denied = Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })
    const authorizedScope = { scopeType: 'EVENT', scopeId: 'event-a', branchId: 'branch-a' }
    const { calls, repository } = createFixture({
      one: async sql => sql.includes('FROM mip_events')
        ? { id: 'event-a', branch_id: 'branch-a' }
        : { id: 'user-a', status: 'ACTIVE' },
      query: async () => ({ affectedRows: 1 }),
      assertAuthorizedScope(currentScope, expectedScope) {
        assert.deepEqual(currentScope, authorizedScope)
        assert.equal(expectedScope, authorizedScope)
        throw denied
      },
    })

    await assert.rejects(() => repository.setRole({
      appId: 'wx-app',
      actorUserId: 'admin-user',
      userId: 'user-a',
      roleKey: 'EVENT_STAFF',
      active: true,
      scope: { scopeType: 'EVENT', scopeId: 'event-a' },
      authorizedScope,
      audit: { action: 'admin.roles.grant' },
    }), error => error === denied)
    assert.deepEqual(calls.map(call => call.type), [
      'transaction',
      'lock',
      'one',
      'event-scope',
      'mutation-scope',
      'authorized-scope',
    ])
    assert.equal(calls.some(call => call.type === 'query'), false)
    assert.equal(calls.some(call => call.type === 'audit'), false)
  })

  it('preserves scoped audit filters, projection and cursor pagination', async () => {
    const rows = [
      {
        id: 9,
        actor_user_id: 'admin-a',
        actor_nickname: '管理员',
        scope_type: 'BRANCH',
        scope_id: 'branch-a',
        action: 'admin.roles.grant',
        resource_type: 'ADMIN_ROLE_BINDING',
        resource_id: 'binding-a',
        effective_role: 'BRANCH_ADMIN',
        metadata_json: '{"roleKey":"EVENT_STAFF"}',
        created_at: new Date('2026-08-24T02:00:00.000Z'),
      },
      {
        id: 8,
        actor_user_id: null,
        actor_nickname: null,
        scope_type: 'EVENT',
        scope_id: 'event-a',
        action: 'admin.roles.grant',
        resource_type: 'ADMIN_ROLE_BINDING',
        resource_id: null,
        effective_role: null,
        metadata_json: null,
        created_at: new Date('2026-08-24T01:00:00.000Z'),
      },
    ]
    const { calls, repository } = createFixture({ query: async () => rows })
    const page = await repository.listAudit(
      'wx-app',
      { platform: false, branchIds: ['branch-a'], eventIds: ['event-a'] },
      { action: 'admin.roles.grant', resourceType: 'ADMIN_ROLE_BINDING' },
      1,
    )

    const read = calls.find(call => call.type === 'query')
    assert.match(read.sql, /a\.scope_type = 'BRANCH'/)
    assert.match(read.sql, /a\.scope_type = 'EVENT' AND EXISTS/)
    assert.match(read.sql, /ORDER BY a\.created_at DESC, a\.id DESC LIMIT \?/)
    assert.deepEqual(read.params, [
      'wx-app',
      'branch-a',
      'branch-a',
      'event-a',
      'admin.roles.grant',
      'ADMIN_ROLE_BINDING',
      2,
    ])
    assert.deepEqual(page.items, [{
      id: '9',
      actorUserId: 'admin-a',
      actorNickname: '管理员',
      scopeType: 'BRANCH',
      scopeId: 'branch-a',
      action: 'admin.roles.grant',
      resourceType: 'ADMIN_ROLE_BINDING',
      resourceId: 'binding-a',
      effectiveRole: 'BRANCH_ADMIN',
      metadata: { roleKey: 'EVENT_STAFF' },
      createdAt: '2026-08-24T02:00:00.000Z',
    }])
    assert.equal(typeof page.nextCursor, 'string')
  })
})
