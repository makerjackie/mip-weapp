'use strict'

const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createOpportunityArchiveRepository } = require('../domain/opportunity-archive')

const APP = 'test-app'
const ID = '10000000-0000-4000-8000-000000000001'
const ACTOR = '10000000-0000-4000-8000-000000000002'
const SCOPE = { scopeType: 'PLATFORM', scopeId: null }

function fixture(status = 'PUBLISHED', version = 4) {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ sql, params })
      return { id: ID, app_id: APP, title: '发布中的机会', status, version,
        scope_type: 'PLATFORM', branch_id: null }
    },
    async query(sql, params) {
      calls.push({ sql, params })
      return sql.includes('INSERT INTO mip_opportunity_delete_snapshots')
        ? { affectedRows: 1, insertId: 17 } : { affectedRows: 1 }
    },
  }
  const repository = createOpportunityArchiveRepository({ transaction: fn => fn(tx) }, {
    lockMutation: async () => SCOPE,
    assertScope: () => {},
    writeAudit: async (_, audit) => calls.push({ audit }),
    now: () => new Date('2030-01-01T00:00:00Z'),
  })
  const input = { appId: APP, actorUserId: ACTOR, opportunityId: ID, expectedVersion: 4,
    authorizedScope: SCOPE, reason: '重复内容', audit: (snapshotRef, fromStatus) => ({ snapshotRef, fromStatus }) }
  return { calls, input, repository }
}

it('soft-deletes a published opportunity while retaining a tenant-scoped pre-delete snapshot and audit', async () => {
  const { calls, input, repository } = fixture()
  const result = await repository.deleteOpportunity(input)
  assert.equal(result.status, 'ARCHIVED')
  assert.equal(result.snapshotRef, '17')
  const snapshot = calls.find(call => call.sql?.includes('INSERT INTO mip_opportunity_delete_snapshots'))
  assert.equal(snapshot.params[1], APP)
  assert.equal(snapshot.params[2], ID)
  assert.equal(JSON.parse(snapshot.params[0]).title, '发布中的机会')
  assert.ok(calls.some(call => call.sql?.includes("status <> 'ARCHIVED'") && call.params[3] === APP))
  assert.deepEqual(calls.find(call => call.audit).audit, { snapshotRef: '17', fromStatus: 'PUBLISHED' })
})

it('rejects a stale version before writing the snapshot', async () => {
  const { calls, input, repository } = fixture('PUBLISHED', 5)
  await assert.rejects(repository.deleteOpportunity(input), error => error.code === 'CONFLICT')
  assert.equal(calls.filter(call => call.sql?.includes('INSERT INTO mip_opportunity_delete_snapshots')).length, 0)
})
