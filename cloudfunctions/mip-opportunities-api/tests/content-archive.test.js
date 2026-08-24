'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const test = require('node:test')
const {
  archiveCooperationCard,
  getCooperationCard,
  listMyCooperationCards,
  saveCooperationCard,
} = require('../domain/cooperation')
const {
  archiveSuperCase,
  getSuperCase,
  listMySuperCases,
  saveSuperCase,
} = require('../domain/cases')

const appId = 'wx-content-archive'
const userId = '10000000-0000-4000-8000-000000000001'
const otherUserId = '10000000-0000-4000-8000-000000000099'
const resourceId = '20000000-0000-4000-8000-000000000002'
const caller = { appId, userId, profileRefSecret: 'test-profile-secret' }

function archiveDatabase(table, existing = {}) {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ method: 'one', sql, params })
      if (sql.includes('FROM mip_idempotency_keys')) return null
      if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
      if (sql.includes(`FROM ${table}`)) {
        return {
          owner_user_id: userId,
          status: 'PUBLISHED',
          version: 4,
          ...existing,
        }
      }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ method: 'query', sql, params })
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

test('owners archive cooperation cards and super cases without deleting records or media facts', async () => {
  for (const entry of [
    {
      mutation: archiveCooperationCard,
      table: 'mip_cooperation_cards',
      status: 'ARCHIVED',
      operation: 'cooperation-card.archive',
      action: 'COOPERATION_CARD_ARCHIVED',
      key: 'cooperation-archive-test',
    },
    {
      mutation: archiveSuperCase,
      table: 'mip_super_cases',
      status: 'ARCHIVED',
      operation: 'super-case.archive',
      action: 'SUPER_CASE_ARCHIVED',
      key: 'super-case-archive-test',
    },
  ]) {
    const fixture = archiveDatabase(entry.table)
    const result = await entry.mutation(fixture.database, caller, {
      id: resourceId,
      expectedVersion: 4,
      idempotencyKey: entry.key,
    })

    assert.deepEqual(result, { id: resourceId, status: entry.status, version: 5 })
    const idempotency = fixture.calls.find(call => call.sql.includes('INSERT INTO mip_idempotency_keys'))
    assert.equal(idempotency.params[3], entry.operation)
    const update = fixture.calls.find(call => call.sql.includes(`UPDATE ${entry.table}`))
    assert.match(update.sql, /SET status = 'ARCHIVED', archived_at = UTC_TIMESTAMP\(3\), version = version \+ 1/)
    assert.match(update.sql, /version = \? AND status <> 'ARCHIVED'/)
    assert.deepEqual(update.params, [appId, resourceId, 4])
    const audit = fixture.calls.find(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.equal(audit.params[5], entry.action)
    assert.equal(fixture.calls.some(call => /DELETE FROM/i.test(call.sql)), false)
  }
})

test('archive mutations enforce owner, expected version, and terminal archived state', async () => {
  for (const mutation of [archiveCooperationCard, archiveSuperCase]) {
    const table = mutation === archiveCooperationCard ? 'mip_cooperation_cards' : 'mip_super_cases'
    await assert.rejects(
      mutation(archiveDatabase(table, { owner_user_id: otherUserId }).database, caller, {
        id: resourceId,
        expectedVersion: 4,
        idempotencyKey: `archive-owner-${mutation.name}`,
      }),
      /FORBIDDEN/,
    )
    await assert.rejects(
      mutation(archiveDatabase(table, { version: 5 }).database, caller, {
        id: resourceId,
        expectedVersion: 4,
        idempotencyKey: `archive-version-${mutation.name}`,
      }),
      /CONFLICT/,
    )
    await assert.rejects(
      mutation(archiveDatabase(table, { status: 'ARCHIVED' }).database, caller, {
        id: resourceId,
        expectedVersion: 4,
        idempotencyKey: `archive-terminal-${mutation.name}`,
      }),
      /CONFLICT/,
    )
  }
})

test('archive mutation replays a completed idempotent response without a second write', async () => {
  const request = { id: resourceId, expectedVersion: 4 }
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  for (const [mutation, status] of [
    [archiveCooperationCard, 'ARCHIVED'],
    [archiveSuperCase, 'ARCHIVED'],
  ]) {
    const calls = []
    const response = { id: resourceId, status, version: 5 }
    const database = {
      async transaction(work) {
        return work({
          async one(sql, params) {
            calls.push({ method: 'one', sql, params })
            return { request_hash: requestHash, status: 'COMPLETED', response_json: JSON.stringify(response) }
          },
          async query(sql, params) {
            calls.push({ method: 'query', sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }
    assert.deepEqual(await mutation(database, caller, {
      ...request,
      idempotencyKey: `archive-replay-${mutation.name}`,
    }), response)
    assert.equal(calls.some(call => call.method === 'query'), false)
  }
})

test('owner lists and details hide archived content', async () => {
  for (const list of [listMyCooperationCards, listMySuperCases]) {
    const calls = []
    const result = await list({
      async query(sql, params) {
        calls.push({ sql, params })
        return []
      },
    }, caller, {})
    assert.deepEqual(result, { items: [], nextCursor: undefined })
    assert.match(calls[0].sql, /owner_user_id = \? AND c\.status <> 'ARCHIVED'/)
  }

  for (const get of [getCooperationCard, getSuperCase]) {
    let queryCount = 0
    await assert.rejects(
      get({
        async one() {
          return { owner_user_id: userId, status: 'ARCHIVED', version: 5 }
        },
        async query() {
          queryCount += 1
          return []
        },
      }, caller, resourceId),
      /NOT_FOUND/,
    )
    assert.equal(queryCount, 0)
  }
})

function archivedSaveDatabase(table, extra = {}) {
  const calls = []
  const database = {
    async transaction(work) {
      return work({
        async one(sql, params) {
          calls.push({ method: 'one', sql, params })
          if (sql.includes('FROM mip_idempotency_keys')) return null
          if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
          if (sql.includes(`FROM ${table}`)) {
            return { owner_user_id: userId, status: 'ARCHIVED', version: 4, ...extra }
          }
          throw new Error(`unexpected one: ${sql}`)
        },
        async query(sql, params) {
          calls.push({ method: 'query', sql, params })
          return []
        },
      })
    },
  }
  return { calls, database }
}

test('save APIs cannot restore archived cooperation cards or super cases', async () => {
  const contentSafety = { async assertSafe() {} }
  const cooperation = archivedSaveDatabase('mip_cooperation_cards', { role_key: 'connector' })
  await assert.rejects(
    saveCooperationCard(cooperation.database, contentSafety, caller, {
      idempotencyKey: 'archived-cooperation-save',
      draft: {
        id: resourceId,
        expectedVersion: 4,
        roleKey: 'connector',
        positioning: '负责资源引荐',
        targetSummary: '完成合作对接',
        roleFields: { circles: ['创业者'], resources: ['渠道'], target: '促成合作' },
        abilityScores: {
          business_development: 4,
          resource_integration: 4,
          capital_operation: 2,
          strategy_planning: 3,
          visual_design: 1,
          delivery_management: 3,
        },
        publish: false,
      },
    }),
    /FORBIDDEN/,
  )
  assert.equal(cooperation.calls.some(call => call.sql.includes('UPDATE mip_cooperation_cards')), false)

  const superCase = archivedSaveDatabase('mip_super_cases')
  await assert.rejects(
    saveSuperCase(superCase.database, contentSafety, caller, {
      idempotencyKey: 'archived-super-case-save',
      draft: {
        id: resourceId,
        expectedVersion: 4,
        projectName: '品牌项目',
        summary: '完成品牌升级',
        responsibility: '项目统筹',
        description: '项目按计划完成。',
        mediaAssetIds: [],
        publish: false,
      },
    }),
    /FORBIDDEN/,
  )
  assert.equal(superCase.calls.some(call => call.sql.includes('UPDATE mip_super_cases')), false)
  assert.equal(superCase.calls.some(call => /DELETE FROM mip_super_case_media/.test(call.sql)), false)
})
