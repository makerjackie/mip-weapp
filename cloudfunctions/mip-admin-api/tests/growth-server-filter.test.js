'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const { createAdminRepository } = require('../domain/repository')

const branchA = '11111111-1111-4111-8111-111111111111'
const branchB = '22222222-2222-4222-8222-222222222222'

test('growth server filter intersects operator visibility and tenant boundary before pagination', async t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`
    CREATE TABLE mip_users (id TEXT, app_id TEXT, primary_branch_id TEXT);
    CREATE TABLE mip_profiles (user_id TEXT, app_id TEXT, nickname TEXT);
    CREATE TABLE mip_growth_entries (id TEXT, app_id TEXT, user_id TEXT, source_event_id TEXT,
      source_event_type TEXT, metric TEXT, delta_value INTEGER, balance_after INTEGER, adjustment_reason TEXT, created_at TEXT);
  `)
  const fixture = [
    ['a1', 'app-a', branchA, '2030-01-01T00:00:00.000Z'],
    ['a2', 'app-a', branchA, '2030-01-02T00:00:00.000Z'],
    ['a3', 'app-a', branchA, '2030-01-03T00:00:00.000Z'],
    ['b1', 'app-a', branchB, '2030-01-04T00:00:00.000Z'],
    ['a1', 'app-b', branchA, '2030-01-05T00:00:00.000Z'],
  ]
  for (const [user, tenant, branch, at] of fixture) {
    db.prepare('INSERT INTO mip_users VALUES (?, ?, ?)').run(user, tenant, branch)
    db.prepare('INSERT INTO mip_profiles VALUES (?, ?, ?)').run(user, tenant, `${tenant}-${user}`)
    db.prepare('INSERT INTO mip_growth_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(user, tenant, user, 'event', 'event.checked_in', 'EXPERIENCE', 10, 10, '', at)
  }
  const repository = createAdminRepository({
    async one(sql, params = []) { return db.prepare(sql).get(...params) },
    async transaction() { throw new Error('unexpected write transaction') },
    async query(sql, params = []) {
      // This fixture exercises list/scoping SQL; relation metadata has its own tests.
      if (!sql.includes('FROM mip_growth_entries ge')) return []
      return db.prepare(sql).all(...params)
    },
  })
  const visibility = { platform: false, branchIds: [branchA], eventIds: [] }
  const filters = { serverId: branchA, metric: 'EXPERIENCE' }
  const first = await repository.listGrowthEntries('app-a', visibility, filters, 1)
  assert.equal(first.items[0].nickname, 'app-a-a3')
  assert.ok(first.nextCursor)
  // Cursor is decoded by the domain module before repository use.
  const cursor = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString())
  const second = await repository.listGrowthEntries('app-a', visibility, filters, 1, cursor)
  assert.equal(second.items[0].nickname, 'app-a-a2')
  assert.deepEqual((await repository.listGrowthEntries('app-a', visibility, { serverId: branchB }, 50)).items, [])
  const platform = await repository.listGrowthEntries('app-a', { platform: true, branchIds: [], eventIds: [] }, { serverId: branchB }, 50)
  assert.deepEqual(platform.items.map(row => row.nickname), ['app-a-b1'])
})
