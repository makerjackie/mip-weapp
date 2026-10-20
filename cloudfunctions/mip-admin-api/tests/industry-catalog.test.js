'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminAccess } = require('../domain/access')
const { createIndustryCatalogAdmin } = require('../domain/industry-catalog')
const { createIndustryCatalogRepository } = require('../domain/repositories/industry-catalog')

const caller = { appId: 'wx-industry-test', userId: '11111111-1111-4111-8111-111111111111' }
const groupId = '22222222-2222-4222-8222-222222222222'
const tagId = '33333333-3333-4333-8333-333333333333'
function service(roleKey, overrides = {}) {
  const repository = {
    resolveUser: async () => ({ id: caller.userId, status: 'ACTIVE', agreementsAccepted: true, phoneBound: true, profileComplete: true }),
    listRoleBindings: async () => [{ roleKey, scopeType: roleKey === 'BRANCH_ADMIN' ? 'BRANCH' : 'PLATFORM', scopeId: roleKey === 'BRANCH_ADMIN' ? groupId : null, status: 'ACTIVE' }],
    listIndustryCatalog: async appId => ({ appId, items: [] }),
    saveIndustryTag: async input => input,
    changeIndustryTagStatus: async input => input,
    ...overrides,
  }
  return createIndustryCatalogAdmin({ access: createAdminAccess({ repository }), repository })
}
const draft = { label: '人工智能', parentId: groupId, popular: true, sortOrder: 3 }

describe('superadmin industry catalog', () => {
  it('uses the authenticated app and owner grant for all writes', async () => {
    const api = service('PLATFORM_OWNER')
    assert.equal((await api.listIndustryCatalog(caller)).appId, caller.appId)
    const input = await api.saveIndustryTag(caller, draft)
    assert.equal(input.appId, caller.appId)
    assert.equal(input.authorization.capability, 'industries.manage')
    assert.equal(input.authorization.effectiveGrant.roleKey, 'PLATFORM_OWNER')
    assert.equal(input.audit(tagId).resourceId, tagId)
    assert.equal(input.audit(tagId).action, 'admin.industries.create')
  })

  it('rejects operations, finance and branch roles at the real access boundary', async () => {
    for (const role of ['PLATFORM_OPERATIONS', 'PLATFORM_FINANCE', 'BRANCH_ADMIN']) {
      const api = service(role)
      for (const run of [() => api.listIndustryCatalog(caller), () => api.saveIndustryTag(caller, draft), () => api.changeIndustryTagStatus(caller, { tagId, expectedVersion: 2, enabled: false })]) {
        await assert.rejects(run, error => error.code === 'FORBIDDEN')
      }
    }
  })

  it('rejects client app identity, invalid hierarchy flags, missing versions and fractional sort', async () => {
    const api = service('PLATFORM_OWNER')
    for (const input of [{ ...draft, appId: 'other' }, { ...draft, parentId: null }, { ...draft, sortOrder: 1.1 }, { ...draft, tagId }, { ...draft, label: '' }]) {
      await assert.rejects(() => api.saveIndustryTag(caller, input), error => error.code === 'VALIDATION_FAILED')
    }
  })
})

function repositoryFixture(options = {}) {
  const calls = []
  const row = { id: tagId, parent_id: groupId, selectable: 1, popular: 1, enabled: 1, label: '人工智能', sort_order: 3, version: 2, ...options.row }
  const tx = {
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('industry_catalog_mutex')) return {}
      if (sql.includes('COUNT(*)')) return { total: 2 }
      if (sql.includes('label = ?')) return options.duplicate ? { id: 'duplicate' } : null
      if (sql.includes('FROM mip_tags')) {
        return params[1] === groupId ? { id: groupId, parent_id: null, selectable: 0, enabled: options.parentEnabled ?? 1 } : row
      }
      throw new Error('Unexpected SQL')
    },
    async query(sql, params) { calls.push({ sql, params }); return { affectedRows: options.affectedRows ?? 1 } },
  }
  const repository = createIndustryCatalogRepository({ transaction: run => run(tx), query: async (sql, params) => { calls.push({ sql, params }); return [row] } }, {
    createId: () => tagId,
    lockMutationAuthorization: async () => { calls.push({ type: 'reauthorize' }); return { effectiveGrant: { roleKey: options.role || 'PLATFORM_OWNER' } } },
    assertMutationScope: (_authorization, scope) => assert.deepEqual(scope, { scopeType: 'PLATFORM', scopeId: null }),
    writeAudit: async (_tx, audit) => calls.push({ type: 'audit', audit }),
  })
  const input = { ...caller, actorUserId: caller.userId, ...draft, tagId, expectedVersion: 2, audit: id => ({ id }) }
  return { repository, calls, input }
}

describe('industry persistence contracts', () => {
  it('returns real nonempty metadata with stable IDs and booleans', async () => {
    const { repository, calls } = repositoryFixture()
    const result = await repository.listIndustryCatalog(caller.appId)
    assert.deepEqual(result.items[0], { id: tagId, parentId: groupId, label: '人工智能', selectable: true, popular: true, enabled: true, sortOrder: 3, version: 2 })
    assert.deepEqual(calls[0].params, [caller.appId])
  })

  it('locks authorization and the app catalog before editing, retaining relation IDs', async () => {
    const { repository, calls, input } = repositoryFixture()
    assert.deepEqual(await repository.saveIndustryTag(input), { id: tagId, version: 3 })
    assert.equal(calls[0].type, 'reauthorize')
    const update = calls.find(call => call.sql?.startsWith('UPDATE mip_tags'))
    assert.deepEqual(update.params, ['人工智能', groupId, 1, 3, caller.appId, tagId, 2])
    assert.equal(calls.filter(call => call.type === 'audit').length, 1)
    assert.equal(calls.some(call => /DELETE|UPDATE mip_profile_tags/.test(call.sql || '')), false)
  })

  it('creates inactive options, refusing duplicate sibling names and stale versions', async () => {
    const fixture = repositoryFixture()
    await fixture.repository.saveIndustryTag({ ...fixture.input, tagId: null, expectedVersion: null })
    const insert = fixture.calls.find(call => call.sql?.startsWith('INSERT INTO mip_tags'))
    assert.match(insert.sql, /0, \?\)/)
    for (const options of [{ duplicate: true }, { row: { version: 3 } }, { affectedRows: 0 }]) {
      const f = repositoryFixture(options)
      await assert.rejects(() => f.repository.saveIndustryTag(f.input), error => ['CONFLICT', 'VALIDATION_FAILED'].includes(error.code))
      assert.equal(f.calls.some(call => call.type === 'audit'), false)
    }
  })

  it('rechecks the exact owner role in the transaction and rejects inactive parents on activation', async () => {
    for (const options of [{ role: 'PLATFORM_OPERATIONS' }, { parentEnabled: 0 }]) {
      const f = repositoryFixture(options)
      await assert.rejects(() => f.repository.changeIndustryTagStatus({ ...f.input, enabled: true }), error => ['FORBIDDEN', 'VALIDATION_FAILED'].includes(error.code))
      assert.equal(f.calls.some(call => call.sql?.startsWith('UPDATE mip_tags')), false)
    }
  })
})
