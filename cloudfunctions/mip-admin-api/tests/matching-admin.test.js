'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createMatchingAdminRepository } = require('../domain/matching-admin')

const APP_ID = 'wx-admin-matching'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const BRANCH_ID = '20000000-0000-4000-8000-000000000001'

describe('admin matching settings', () => {
  it('returns neutral defaults only within the authorized branch visibility', async () => {
    const repository = createMatchingAdminRepository({
      one: async () => null,
      query: async () => [],
    }, {
      lockMutationAuthorization: async () => ({ effectiveGrant: {} }),
      assertMutationScope() {},
    })
    const result = await repository.getMatchingAdminState(APP_ID, {
      platform: false,
      branchIds: [BRANCH_ID],
    }, { branchId: BRANCH_ID })
    assert.deepEqual(result.settings, {
      scopeKey: `BRANCH:${BRANCH_ID}`,
      scopeType: 'BRANCH',
      scopeId: BRANCH_ID,
      talentMinScore: 35,
      projectMinScore: 30,
      maximumCandidates: 100,
      externalProviderEnabled: false,
      version: 0,
    })
    await assert.rejects(() => repository.getMatchingAdminState(APP_ID, {
      platform: false,
      branchIds: [],
    }, { branchId: BRANCH_ID }), error => error?.code === 'FORBIDDEN')
  })

  it('uses optimistic versioning, scope authorization, and audit for settings updates', async () => {
    const writes = []
    const scopes = []
    const tx = {
      one: async () => ({ version: 2 }),
      async query(sql, params) {
        writes.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = createMatchingAdminRepository({
      transaction: work => work(tx),
    }, {
      lockMutationAuthorization: async () => ({ effectiveGrant: {} }),
      assertMutationScope(_authorization, scope) {
        scopes.push(scope)
      },
    })
    const result = await repository.saveMatchingSettings({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scope: { scopeType: 'BRANCH', scopeId: BRANCH_ID },
      expectedVersion: 2,
      settings: {
        talentMinScore: 40,
        projectMinScore: 45,
        maximumCandidates: 80,
        externalProviderEnabled: true,
      },
      audit: version => ({
        appId: APP_ID,
        actorUserId: ACTOR_ID,
        scopeType: 'BRANCH',
        scopeId: BRANCH_ID,
        action: 'admin.matching.settings.update',
        resourceType: 'MATCHING_SETTINGS',
        resourceId: BRANCH_ID,
        metadata: { version },
        effectiveRole: 'BRANCH_ADMIN',
      }),
    })

    assert.equal(result.version, 3)
    assert.deepEqual(scopes, [{ scopeType: 'BRANCH', scopeId: BRANCH_ID }])
    assert.equal(writes.filter(call => call.sql.includes('UPDATE mip_matching_settings')).length, 1)
    assert.equal(writes.filter(call => call.sql.includes('INSERT INTO mip_audit_logs')).length, 1)
  })

  it('locks current role authorization and source scope before recalculation dispatch', async () => {
    const calls = []
    const target = {
      id: '30000000-0000-4000-8000-000000000001',
      owner_user_id: '40000000-0000-4000-8000-000000000001',
      branch_id: BRANCH_ID,
      status: 'PUBLISHED',
      version: 7,
    }
    const repository = createMatchingAdminRepository({
      transaction: work => work({
        async one(sql) {
          calls.push(sql)
          return target
        },
      }),
    }, {
      async lockMutationAuthorization(_tx, input) {
        calls.push(`authorize:${input.authorization.capability}`)
        return { effectiveGrant: input.authorization.effectiveGrant }
      },
      assertMutationScope(_authorization, scope) {
        calls.push(`scope:${scope.scopeType}:${scope.scopeId}`)
      },
    })

    const result = await repository.authorizeMatchingRecalculation({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      opportunityId: target.id,
      expectedVersion: 7,
      authorization: {
        capability: 'opportunities.moderate',
        effectiveGrant: { roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID },
      },
    })

    assert.equal(result, target)
    assert.equal(calls.length, 3)
    assert.equal(calls[0], 'authorize:opportunities.moderate')
    assert.match(calls[1], /FROM mip_opportunities[\s\S]+FOR UPDATE/)
    assert.equal(calls[2], `scope:BRANCH:${BRANCH_ID}`)
  })

  it('rejects a source version change while the recalculation authorization is locked', async () => {
    const repository = createMatchingAdminRepository({
      transaction: work => work({
        one: async () => ({
          id: '30000000-0000-4000-8000-000000000001',
          owner_user_id: '40000000-0000-4000-8000-000000000001',
          branch_id: BRANCH_ID,
          status: 'PUBLISHED',
          version: 8,
        }),
      }),
    }, {
      lockMutationAuthorization: async () => ({ effectiveGrant: {} }),
      assertMutationScope() {},
    })
    await assert.rejects(() => repository.authorizeMatchingRecalculation({
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      opportunityId: '30000000-0000-4000-8000-000000000001',
      expectedVersion: 7,
      authorization: { capability: 'opportunities.moderate', effectiveGrant: {} },
    }), error => error?.code === 'CONFLICT')
  })
})
