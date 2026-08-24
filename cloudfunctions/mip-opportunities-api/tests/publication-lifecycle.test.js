'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { unpublishCooperationCard } = require('../domain/cooperation')
const { unpublishSuperCase } = require('../domain/cases')

const appId = 'wx-publication-lifecycle'
const userId = '10000000-0000-4000-8000-000000000001'
const resourceId = '20000000-0000-4000-8000-000000000002'

function databaseFor(table) {
  const calls = []
  const tx = {
    async one(sql) {
      calls.push({ sql, params: [] })
      if (sql.includes('FROM mip_users')) {
        return { id: userId, status: 'ACTIVE' }
      }
      if (sql.includes('FROM mip_idempotency_keys')) return null
      if (sql.includes(`FROM ${table}`)) {
        return { owner_user_id: userId, status: 'PUBLISHED', version: 4 }
      }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  return {
    calls,
    database: {
      async transaction(work) {
        return work(tx)
      },
    },
  }
}

test('owner can unpublish a cooperation card with version and audit protection', async () => {
  const fixture = databaseFor('mip_cooperation_cards')
  const result = await unpublishCooperationCard(fixture.database, { appId, userId }, {
    id: resourceId,
    expectedVersion: 4,
    idempotencyKey: 'cooperation-unpublish-test',
  })

  assert.deepEqual(result, { id: resourceId, status: 'UNPUBLISHED', version: 5 })
  const update = fixture.calls.find(call => call.sql.includes('UPDATE mip_cooperation_cards'))
  assert.match(update.sql, /SET status = 'UNPUBLISHED', version = version \+ 1/)
  assert.deepEqual(update.params, [appId, resourceId, 4])
  const audit = fixture.calls.find(call => call.sql.includes('INSERT INTO mip_audit_logs'))
  assert.equal(audit.params[5], 'COOPERATION_CARD_UNPUBLISHED')
})

test('owner can unpublish a super case without deleting its media facts', async () => {
  const fixture = databaseFor('mip_super_cases')
  const result = await unpublishSuperCase(fixture.database, { appId, userId }, {
    id: resourceId,
    expectedVersion: 4,
    idempotencyKey: 'super-case-unpublish-test',
  })

  assert.deepEqual(result, { id: resourceId, status: 'UNPUBLISHED', version: 5 })
  const update = fixture.calls.find(call => call.sql.includes('UPDATE mip_super_cases'))
  assert.match(update.sql, /SET status = 'UNPUBLISHED', version = version \+ 1/)
  assert.deepEqual(update.params, [appId, resourceId, 4])
  assert.equal(fixture.calls.some(call => /DELETE FROM mip_super_case_media/.test(call.sql)), false)
  const audit = fixture.calls.find(call => call.sql.includes('INSERT INTO mip_audit_logs'))
  assert.equal(audit.params[5], 'SUPER_CASE_UNPUBLISHED')
})

test('publication lifecycle rejects stale or non-published mutations', async () => {
  for (const mutation of [unpublishCooperationCard, unpublishSuperCase]) {
    const database = {
      async transaction(work) {
        return work({
          async one(sql) {
            if (sql.includes('FROM mip_users')) {
              return { id: userId, status: 'ACTIVE' }
            }
            if (sql.includes('FROM mip_idempotency_keys')) return null
            return { owner_user_id: userId, status: 'DRAFT', version: 4 }
          },
          async query() {
            return { affectedRows: 1 }
          },
        })
      },
    }
    await assert.rejects(
      mutation(database, { appId, userId }, {
        id: resourceId,
        expectedVersion: 4,
        idempotencyKey: `publication-conflict-${mutation.name}`,
      }),
      /CONFLICT/,
    )
  }
})
