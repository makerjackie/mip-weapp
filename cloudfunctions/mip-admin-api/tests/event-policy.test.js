'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminRepository } = require('../domain/repository')

function databaseFor(current = null) {
  const writes = []
  const tx = {
    async one(sql, params) {
      if (sql.includes('FROM mip_app_settings')) return current
      throw new Error(`unexpected one: ${sql} ${params}`)
    },
    async query(sql, params) {
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  return {
    writes,
    one: tx.one,
    query: tx.query,
    transaction: work => work(tx),
  }
}

describe('event registration policy', () => {
  it('uses a replaceable 24-hour default when no setting exists', async () => {
    const database = databaseFor()
    const repository = createAdminRepository(database, { authorizeMutation: async () => ({}) })
    assert.deepEqual(await repository.getEventPolicy('wx-app'), {
      cancellationHoursBeforeStart: 24,
      version: 0,
    })
  })

  it('writes one app-scoped versioned policy and immutable audit', async () => {
    const database = databaseFor()
    const repository = createAdminRepository(database, { authorizeMutation: async () => ({}) })
    const result = await repository.saveEventPolicy({
      appId: 'wx-app',
      actorUserId: '10000000-0000-4000-8000-000000000001',
      expectedVersion: 0,
      cancellationHoursBeforeStart: 12,
      authorization: {},
      audit: {
        appId: 'wx-app',
        actorUserId: '10000000-0000-4000-8000-000000000001',
        scopeType: 'PLATFORM',
        scopeId: null,
        action: 'admin.events.policy.update',
        resourceType: 'APP_SETTING',
        metadata: { expectedVersion: 0, cancellationHoursBeforeStart: 12 },
      },
    })
    assert.deepEqual(result, { cancellationHoursBeforeStart: 12, version: 1 })
    const insert = database.writes.find(call => call.sql.includes('INSERT INTO mip_app_settings'))
    assert.ok(insert)
    assert.equal(insert.params[0], 'wx-app')
    assert.deepEqual(JSON.parse(insert.params[1]), { cancellationHoursBeforeStart: 12 })
    assert.ok(database.writes.some(call => call.sql.includes('INSERT INTO mip_audit_logs')))
  })

  it('rejects a stale version before changing the policy', async () => {
    const database = databaseFor({ version: 3 })
    const repository = createAdminRepository(database, { authorizeMutation: async () => ({}) })
    await assert.rejects(() => repository.saveEventPolicy({
      appId: 'wx-app',
      actorUserId: '10000000-0000-4000-8000-000000000001',
      expectedVersion: 2,
      cancellationHoursBeforeStart: 8,
      authorization: {},
      audit: {},
    }), /CONFLICT/)
    assert.equal(database.writes.length, 0)
  })
})
