'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const { createTaskRepository } = require('../domain/repository')
const { normalizeTaskFilters, normalizeCompletionFilters } = require('../domain/validation')

const appId = 'wx-filter-tests'
const actor = '11111111-1111-4111-8111-111111111111'
const owner = '22222222-2222-4222-8222-222222222222'
const id = number => `33333333-3333-4333-8333-${String(number).padStart(12, '0')}`
const at = day => `2030-01-${String(day).padStart(2, '0')}T00:00:00.000Z`
const rewards = kind => JSON.stringify({ [kind]: { enabled: true, amount: 25 } })

function fixture(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`
    CREATE TABLE mip_task_cards (id TEXT, app_id TEXT, name TEXT, content TEXT, status TEXT,
      updated_at TEXT, star_level INTEGER, assigned_owner_id TEXT, reward_config_json TEXT, reward_experience INTEGER,
      version INTEGER DEFAULT 1, attachment_required INTEGER DEFAULT 0, assignment_mode TEXT DEFAULT 'ALL',
      ends_at TEXT, template_asset_id TEXT, action_type TEXT, action_target TEXT);
    CREATE TABLE mip_task_completions (id TEXT, app_id TEXT, task_id TEXT, user_id TEXT, task_name_snapshot TEXT,
      completed_at TEXT, star_level_snapshot INTEGER, assigned_owner_id TEXT, reward_config_snapshot_json TEXT,
      reward_experience INTEGER, submission_status TEXT, result_status TEXT, attachment_asset_id TEXT);
    CREATE TABLE mip_task_assignments (app_id TEXT, task_id TEXT, status TEXT);
    CREATE TABLE mip_task_level_rules (app_id TEXT, task_id TEXT, level_id TEXT);
    CREATE TABLE mip_growth_levels (id TEXT, app_id TEXT, level_key TEXT, name TEXT, minimum_experience INTEGER, status TEXT);
    CREATE TABLE mip_profiles (app_id TEXT, user_id TEXT, nickname TEXT);
    CREATE TABLE mip_media_assets (app_id TEXT, id TEXT, cloud_file_id TEXT, content_type TEXT, content_bytes INTEGER,
      status TEXT, purpose TEXT);
  `)
  db.prepare('INSERT INTO mip_profiles VALUES (?, ?, ?)').run(appId, actor, '测试用户')
  db.prepare('INSERT INTO mip_profiles VALUES (?, ?, ?)').run('other-app', actor, '其他租户用户')
  function add(number, { tenant = appId, star = 3, ownerId = owner, reward = 'contribution', workflow = 'REVIEW' } = {}) {
    const config = workflow === 'REVIEW' ? rewards(reward) : null
    db.prepare('INSERT INTO mip_task_cards (id, app_id, name, content, status, updated_at, star_level, assigned_owner_id, reward_config_json, reward_experience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id(number), tenant, `任务 ${number}`, '内容', 'PUBLISHED', at(number), star, ownerId, config, 25)
    db.prepare('INSERT INTO mip_task_completions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id(number), tenant, id(number), actor, `任务 ${number}`, at(number), star, ownerId, config, 25,
      // Legacy completion rows can retain migration defaults. Their success is
      // still displayed as approved, and must match that status filter.
      'pending_review', workflow === 'REVIEW' ? 'PENDING' : 'SUCCESS', null)
  }
  add(1); add(2); add(3)
  add(4, { star: 1 }); add(5, { ownerId: actor }); add(6, { reward: 'bonus' })
  add(7, { workflow: 'DIRECT', star: 0 })
  add(8, { tenant: 'other-app' })
  const queries = []
  const adapter = {
    async one(sql, params) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_task_cards')) return db.prepare(sql.replace('FOR UPDATE', '')).get(...params)
      assert.match(sql, /binding.app_id = \? AND binding.user_id = \?/)
      if (params[0] !== appId || params[1] !== actor) return null
      return { role_key: 'PLATFORM_OWNER' }
    },
    async query(sql, params = []) {
      queries.push({ sql, params })
      if (sql.includes('INSERT INTO mip_audit_logs')) return { affectedRows: 1 }
      const statement = db.prepare(sql.replace('FOR UPDATE', ''))
      const values = params.map(value => value instanceof Date ? value.toISOString() : value)
      if (sql.trim().startsWith('SELECT')) return statement.all(...values)
      return { affectedRows: statement.run(...values).changes }
    },
  }
  const repository = createTaskRepository({ ...adapter, transaction: work => work(adapter) })
  return { repository, queries }
}

async function allPages(read) {
  const items = []
  let cursor
  do {
    const page = await read(cursor)
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

test('task filters apply before pagination and cannot cross AppID or owner boundaries', async t => {
  const { repository } = fixture(t)
  const filters = { starLevel: '3', assignedOwnerId: owner, rewardType: 'contribution', workflowMode: 'REVIEW' }
  const items = await allPages(cursor => repository.listAdminTasks({ appId, userId: actor }, { filters, limit: 1, cursor }))
  assert.deepEqual(items.map(row => row.id), [id(3), id(2), id(1)])
  assert.ok(items.every(row => row.workflowMode === 'REVIEW'))
  const bonus = await repository.listAdminTasks({ appId, userId: actor }, { filters: { rewardType: 'bonus' } })
  assert.deepEqual(bonus.items.map(row => row.id), [id(6)])
  const legacy = await repository.listAdminTasks({ appId, userId: actor }, { filters: { rewardType: 'experience', workflowMode: 'DIRECT' } })
  assert.deepEqual(legacy.items.map(row => row.id), [id(7)])
  await assert.rejects(repository.listAdminTasks({ appId: 'other-app', userId: actor }, { filters }), /FORBIDDEN/)
})

test('completion star, owner and rewards use historical snapshots across every page and export', async t => {
  const { repository } = fixture(t)
  const filters = { starLevel: 3, assignedOwnerId: owner, rewardType: 'contribution', workflowMode: 'REVIEW', submissionStatus: 'pending_review' }
  const rows = await allPages(cursor => repository.listCompletions({ appId, userId: actor }, { filters, limit: 1, cursor }))
  assert.deepEqual(rows.map(row => row.id), [id(3), id(2), id(1)])
  assert.ok(rows.every(row => row.nickname === '测试用户' && row.starLevel === 3 && row.workflowMode === 'REVIEW'))
  const exported = await repository.exportCompletions({ appId, userId: actor }, { filters })
  assert.equal(exported.rowCount, rows.length)
  assert.equal(Buffer.from(exported.contentBase64, 'base64').subarray(0, 2).toString(), 'PK')
  const direct = await repository.listCompletions({ appId, userId: actor }, { filters: { workflowMode: 'DIRECT', submissionStatus: 'approved' } })
  assert.deepEqual(direct.items.map(row => [row.id, row.submissionStatus, row.workflowMode]), [[id(7), 'approved', 'DIRECT']])
})

test('invalid filters fail instead of silently falling back to an unfiltered list', () => {
  for (const filter of [{ starLevel: 6 }, { starLevel: 'bad' }, { rewardType: 'unknown' }, { assignedOwnerId: 'not-an-id' }, { workflowMode: 'NPC' }]) {
    assert.throws(() => normalizeTaskFilters(filter), /VALIDATION_FAILED/)
    assert.throws(() => normalizeCompletionFilters(filter), /VALIDATION_FAILED/)
  }
})


test('saving direct-task public fields keeps its persisted workflow and recorded reward', async t => {
  const { repository } = fixture(t)
  const caller = { appId, userId: actor }
  const before = await repository.getAdminTask(caller, { taskId: id(7) })
  assert.equal(before.workflowMode, 'DIRECT')
  const saved = await repository.saveTask(caller, {
    taskId: id(7), expectedVersion: before.version,
    task: { name: '修改说明后的早会', content: '只改说明', rewardExperience: before.rewardExperience,
      attachmentRequired: before.attachmentRequired, assignmentMode: before.assignmentMode,
      endsAt: before.endsAt, eligibleLevelIds: [], actionType: before.actionType, actionTarget: before.actionTarget },
  })
  const reread = await repository.getAdminTask(caller, { taskId: id(7) })
  assert.equal(saved.version, before.version + 1)
  assert.equal(reread.content, '只改说明')
  assert.equal(reread.workflowMode, 'DIRECT')
  assert.equal(reread.rewardConfig, null)
  assert.equal(reread.rewardExperience, before.rewardExperience)
})
