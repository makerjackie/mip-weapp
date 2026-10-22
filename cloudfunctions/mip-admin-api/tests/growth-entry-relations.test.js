'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const { attachGrowthEntryRelations } = require('../domain/repositories/growth-entry-relations')
const { createGrowthOperationsRepository } = require('../domain/repositories/growth-operations')

test('growth links use tenant-scoped stored relations, not opaque event ids', async () => {
  const calls = []
  const database = { async query(sql, params) { calls.push({ sql, params }); return [
    { id: 'entry-1', event_id: 'real-event' }, { id: 'entry-2', completion_id: 'real-completion' },
    { id: 'entry-3', original_transaction_no: 'original-entry' },
  ] } }
  const items = [{ id: 'entry-1', sourceEventId: 'transition' }, { id: 'entry-2', sourceEventId: 'outbox' }, { id: 'entry-3' }, { id: 'entry-4', sourceEventId: 'unknown' }]
  const result = await attachGrowthEntryRelations(database, 'app-a', items)
  assert.deepEqual(result[0].relatedResource, { kind: 'EVENT', id: 'real-event' })
  assert.deepEqual(result[1].relatedResource, { kind: 'TASK_COMPLETION', id: 'real-completion' })
  assert.equal(result[2].originalTransactionNo, 'original-entry')
  assert.equal(result[3].relatedResource, undefined)
  assert.deepEqual(calls[0].params, ['app-a', 'entry-1', 'entry-2', 'entry-3', 'entry-4'])
  assert.match(calls[0].sql, /source_event\.app_id = entry\.app_id/)
  assert.match(calls[0].sql, /checkin\.user_id = entry\.user_id/)
  assert.match(calls[0].sql, /source_event\.event_type = entry\.source_event_type/)
  assert.equal((await attachGrowthEntryRelations(database, 'app-a', [])).length, 0)
  assert.equal(calls.length, 1)
})

test('contribution date, source, server and literal keyword filters are passed before pagination', async () => {
  const calls = []
  const repository = createGrowthOperationsRepository({ async query(sql, params) { calls.push({ sql, params }); return [] } })
  await repository.listContributionTransactions({ appId: 'app-a', limit: 20, filters: {
    sinceTime: '2026-10-01 00:00:00', untilTime: '2026-10-22 00:00:00', serverId: 'server-a', behavior: 'EVENT_CHECKIN', query: 'a%b_',
  } })
  assert.match(calls[0].sql, /entry\.created_at <= \?/)
  assert.match(calls[0].sql, /entry\.source_event_type = \?/)
  assert.match(calls[0].sql, /member\.primary_branch_id = \?/)
  assert.deepEqual(calls[0].params, ['app-a', 'server-a', '2026-10-01 00:00:00', '2026-10-22 00:00:00', 'event.checked_in', '%a\\%b\\_%', 'a%b_', 'a%b_', 21])
})

test('real relation SQL follows transitions and outbox while rejecting foreign tenants and users', async t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.function('IF', (condition, yes, no) => condition ? yes : no)
  db.exec(`
    CREATE TABLE mip_growth_entries (id TEXT, app_id TEXT, user_id TEXT, source_event_id TEXT, source_event_type TEXT);
    CREATE TABLE mip_outbox_events (id TEXT, app_id TEXT, aggregate_id TEXT, aggregate_type TEXT, event_type TEXT);
    CREATE TABLE mip_event_checkin_transitions (id TEXT, app_id TEXT, user_id TEXT, event_id TEXT);
    CREATE TABLE mip_event_registrations (id TEXT, app_id TEXT, user_id TEXT, event_id TEXT);
    CREATE TABLE mip_task_completions (id TEXT, app_id TEXT, user_id TEXT);
    CREATE TABLE mip_referral_intents (id TEXT, app_id TEXT, opportunity_id TEXT);
    CREATE TABLE mip_opportunity_cooperations (id TEXT, app_id TEXT, opportunity_id TEXT);
    CREATE TABLE mip_contribution_reversals (app_id TEXT, growth_entry_id TEXT, original_txn_no TEXT);
    INSERT INTO mip_growth_entries VALUES
      ('direct', 'app-a', 'user-a', 'transition-a', 'event.checked_in'),
      ('outbox', 'app-a', 'user-a', 'outbox-a', 'task.completed'),
      ('foreign', 'app-a', 'user-a', 'transition-b', 'event.checked_in'),
      ('wrong-user', 'app-a', 'user-a', 'transition-c', 'event.checked_in'),
      ('direct', 'app-b', 'user-b', 'transition-b', 'event.checked_in');
    INSERT INTO mip_event_checkin_transitions VALUES
      ('transition-a', 'app-a', 'user-a', 'event-a'),
      ('transition-b', 'app-b', 'user-b', 'event-b'),
      ('transition-c', 'app-a', 'user-c', 'event-c');
    INSERT INTO mip_outbox_events VALUES ('outbox-a', 'app-a', 'completion-a', 'TASK_COMPLETION', 'task.completed');
    INSERT INTO mip_task_completions VALUES ('completion-a', 'app-a', 'user-a');
  `)
  const result = await attachGrowthEntryRelations({ async query(sql, params) { return db.prepare(sql).all(...params) } }, 'app-a', ['direct', 'outbox', 'foreign', 'wrong-user'].map(id => ({ id })))
  assert.deepEqual(result[0].relatedResource, { kind: 'EVENT', id: 'event-a' })
  assert.deepEqual(result[1].relatedResource, { kind: 'TASK_COMPLETION', id: 'completion-a' })
  assert.equal(result[2].relatedResource, undefined)
  assert.equal(result[3].relatedResource, undefined)
})
