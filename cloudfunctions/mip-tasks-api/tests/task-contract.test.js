'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { actions, createHandler } = require('../domain/handler')
const {
  TASKS_CAPABILITY,
  adminCompletionDto,
  assignmentMemberDto,
  assertTaskLevelEligible,
  assertTaskTemplate,
  assertTasksAdmin,
  createTaskRepository,
  replaceTaskLevelRules,
  userTaskDto,
} = require('../domain/repository')
const { createTaskService } = require('../domain/service')
const { normalizeCompletionFilters, normalizeTask } = require('../domain/validation')
const { buildTaskWorkbook, safeCell } = require('../domain/workbook')
const { createProfileRef } = require('../lib/profile-ref')

const appId = 'wx1234567890abcdef'
const userId = '11111111-1111-4111-8111-111111111111'
const taskId = '22222222-2222-4222-8222-222222222222'
const completionId = '33333333-3333-4333-8333-333333333333'
const growthEntryId = '44444444-4444-4444-8444-444444444444'
const profileRefSecret = 'task-assignment-profile-reference-secret-more-than-32'

test('task input only accepts bounded server-owned reward configuration', () => {
  assert.deepEqual(normalizeTask({
    name: '提交合作记录',
    content: '上传一张合作记录图片。',
    rewardExperience: 20,
    attachmentRequired: true,
  }), {
    name: '提交合作记录',
    content: '上传一张合作记录图片。',
    rewardExperience: 20,
    attachmentRequired: true,
    assignmentMode: 'ALL',
    endsAt: null,
    templateAssetId: null,
    eligibleLevelIds: undefined,
  })
  const levelId = '77777777-7777-4777-8777-777777777777'
  assert.deepEqual(normalizeTask({
    name: '等级任务',
    content: '仅部分等级可完成。',
    rewardExperience: 1,
    eligibleLevelIds: [levelId, levelId],
  }).eligibleLevelIds, [levelId])
  assert.deepEqual(normalizeTask({
    name: '解除等级限制', content: '适用于全部等级。', rewardExperience: 1, eligibleLevelIds: [],
  }).eligibleLevelIds, [])
  assert.throws(() => normalizeTask({
    name: '任务', content: '内容', rewardExperience: 1, eligibleLevelIds: null,
  }), /VALIDATION_FAILED/)
  assert.throws(() => normalizeTask({ name: '任务', content: '内容', rewardExperience: -1 }), /VALIDATION_FAILED/)
  assert.throws(() => normalizeCompletionFilters({ resultStatus: 'UNKNOWN' }), /VALIDATION_FAILED/)
})

test('completion writes one immutable fact and awards the task reward once', async () => {
  const writes = []
  let completion = null
  let nextId = 0
  const ids = [completionId, growthEntryId,
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666']
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_task_cards')) {
        return {
          id: taskId,
          name: '任务一',
          content: '完成任务说明',
          reward_experience: 25,
          attachment_required: 0,
          status: 'PUBLISHED',
          version: 3,
        }
      }
      if (sql.includes('FROM mip_task_completions')) return completion
      if (sql.includes('FROM mip_growth_accounts')) return { experience_balance: 100, version: 4 }
      return null
    },
    async query(sql, params) {
      writes.push({ sql, params })
      if (sql.includes('INSERT INTO mip_task_completions')) {
        completion = {
          id: completionId,
          task_id: taskId,
          task_name_snapshot: '任务一',
          reward_experience: 25,
          result_status: 'SUCCESS',
          completed_at: new Date('2026-08-24T08:00:00Z'),
          attachment_url: null,
        }
      }
      return { affectedRows: 1 }
    },
  }
  const database = {
    transaction: work => work(tx),
  }
  const repository = createTaskRepository(database, { createId: () => ids[nextId++] })
  const first = await repository.completeTask({ appId, userId }, { taskId, rewardExperience: 999999 })
  const second = await repository.completeTask({ appId, userId }, { taskId })

  assert.equal(first.rewardExperience, 25)
  assert.equal(first.alreadyCompleted, false)
  assert.equal(second.alreadyCompleted, true)
  assert.equal(writes.filter(item => item.sql.includes('INSERT INTO mip_growth_entries')).length, 1)
  assert.equal(writes.filter(item => item.sql.includes('INSERT INTO mip_task_completions')).length, 1)
  assert.equal(writes.filter(item => item.sql.includes("'task.completed'" )).length >= 2, true)
})

test('task management requires a current platform owner or operations binding', async () => {
  const caller = { appId, userId }
  assert.equal(await assertTasksAdmin({ one: async () => ({ role_key: 'PLATFORM_OPERATIONS' }) }, caller), 'PLATFORM_OPERATIONS')
  const repository = createTaskRepository({ one: async () => ({ role_key: 'PLATFORM_OPERATIONS' }) })
  assert.deepEqual(await repository.getAdminSession(caller), {
    capability: TASKS_CAPABILITY,
    roleKey: 'PLATFORM_OPERATIONS',
  })
  await assert.rejects(
    assertTasksAdmin({ one: async () => null }, caller),
    /FORBIDDEN/,
  )
})

test('task management respects a configured platform operations policy', async () => {
  const repository = createTaskRepository({
    async one(sql) {
      assert.match(sql, /LEFT JOIN mip_role_capability_policies/)
      return { role_key: 'PLATFORM_OPERATIONS', policy_capabilities_json: '[]' }
    },
  })
  await assert.rejects(() => repository.getAdminSession({ appId, userId }), /FORBIDDEN/)
})

test('task management hides soft-deleted records unless explicitly filtered', async () => {
  let listSql = ''
  const repository = createTaskRepository({
    async one() { return { role_key: 'PLATFORM_OWNER' } },
    async query(sql) {
      listSql = sql
      return []
    },
  })

  await repository.listAdminTasks({ appId, userId }, {})
  assert.match(listSql, /task\.status <> 'DELETED'/)
})

test('publishing an already published task does not emit another state event', async () => {
  const repository = createTaskRepository({
    transaction: work => work({
      async one(sql) {
        if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
        if (sql.includes('FROM mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
        if (sql.includes('FROM mip_task_cards')) {
          return { id: taskId, app_id: appId, status: 'PUBLISHED', version: 4 }
        }
        return null
      },
      async query() { throw new Error('unexpected write') },
    }),
  })

  await assert.rejects(
    repository.transitionTask({ appId, userId }, { taskId, expectedVersion: 4 }, 'PUBLISHED'),
    /INVALID_STATE/,
  )
})

test('publish checks current display content before changing state', async () => {
  const calls = []
  const repository = {
    getAdminTask: async () => ({ id: taskId, name: '任务一', content: '任务说明' }),
    transitionTask: async (_caller, _event, status) => ({ status }),
  }
  const service = createTaskService(repository, {
    async assertSafe(_caller, values) { calls.push(values) },
  })
  const result = await service.transitionTask({ appId, userId }, { taskId, expectedVersion: 1 }, 'PUBLISHED')
  assert.equal(result.status, 'PUBLISHED')
  assert.deepEqual(calls, [['任务一', '任务说明']])
})

test('task save authorizes capability before using the content safety API', async () => {
  let safetyCalled = false
  const service = createTaskService({
    getAdminSession: async () => { throw new Error('FORBIDDEN') },
    saveTask: async () => { throw new Error('unexpected save') },
  }, {
    async assertSafe() { safetyCalled = true },
  })
  await assert.rejects(
    service.saveTask({ appId, userId }, { task: { name: '任务', content: '内容' } }),
    /FORBIDDEN/,
  )
  assert.equal(safetyCalled, false)
})

test('task completion rejects an attachment that is not a complete owned media fact', async () => {
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_task_cards')) {
        return {
          id: taskId,
          name: '任务一',
          content: '完成任务说明',
          reward_experience: 25,
          attachment_required: 1,
          status: 'PUBLISHED',
          version: 3,
        }
      }
      if (sql.includes('FROM mip_task_completions')) return null
      if (sql.includes('FROM mip_media_assets')) {
        return {
          id: '77777777-7777-4777-8777-777777777777',
          cloud_file_id: '',
          content_bytes: 1024,
          content_type: 'image/png',
          width_px: 96,
          height_px: 96,
          status: 'READY',
          purpose: 'TASK_ATTACHMENT',
          owner_user_id: userId,
        }
      }
      return null
    },
    async query() { throw new Error('must not write') },
  }
  const repository = createTaskRepository({ transaction: work => work(tx) })
  await assert.rejects(
    repository.completeTask({ appId, userId }, {
      taskId,
      attachmentAssetId: '77777777-7777-4777-8777-777777777777',
    }),
    /ATTACHMENT_INVALID/,
  )
})

test('user task status distinguishes an ended task and preserves a prior completion', () => {
  const ended = userTaskDto({
    id: taskId,
    name: '任务一',
    content: '说明',
    reward_experience: 10,
    attachment_required: 0,
    ends_at: new Date(Date.now() - 1000),
    version: 2,
  })
  assert.equal(ended.status, 'ENDED')
  const completed = userTaskDto({
    ...ended,
    id: taskId,
    name: '任务一',
    content: '说明',
    reward_experience: 10,
    attachment_required: 0,
    awarded_experience: 10,
    ends_at: new Date(Date.now() - 1000),
    version: 2,
    completion_id: completionId,
    completed_at: new Date(),
  })
  assert.equal(completed.status, 'COMPLETED')
})

test('completion rejects an ended task before writing a completion or reward', async () => {
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_task_cards')) return {
        id: taskId,
        name: '已截止任务',
        content: '说明',
        reward_experience: 10,
        attachment_required: 0,
        assignment_mode: 'ALL',
        ends_at: new Date(Date.now() - 1000),
        is_ended: 1,
        status: 'PUBLISHED',
        version: 1,
      }
      if (sql.includes('FROM mip_task_completions')) return null
      return null
    },
    async query() { throw new Error('must not write') },
  }
  const repository = createTaskRepository({ transaction: work => work(tx) })
  await assert.rejects(repository.completeTask({ appId, userId }, { taskId }), /TASK_ENDED/)
})

test('an ended task still returns the prior completion for an idempotent retry', async () => {
  const prior = {
    id: completionId,
    task_id: taskId,
    task_name_snapshot: '任务一',
    reward_experience: 10,
    result_status: 'SUCCESS',
    completed_at: new Date('2026-08-24T08:00:00Z'),
  }
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_task_cards')) return {
        id: taskId,
        status: 'PUBLISHED',
        assignment_mode: 'SELECTED',
        is_ended: 1,
      }
      if (sql.includes('FROM mip_task_completions')) return prior
      return null
    },
    async query() { throw new Error('must not write') },
  }
  const repository = createTaskRepository({ transaction: work => work(tx) })
  await assert.doesNotReject(async () => {
    const result = await repository.completeTask({ appId, userId }, { taskId })
    assert.equal(result.alreadyCompleted, true)
  })
})

test('selected tasks require an active app-scoped assignment', async () => {
  let listSql = ''
  const repository = createTaskRepository({
    async query(sql) { listSql = sql; return [] },
  })
  await repository.listTasks({ appId, userId }, {})
  assert.match(listSql, /assignment\.user_id = \? AND assignment\.status = 'ACTIVE'/)
  assert.match(listSql, /task\.assignment_mode = 'ALL'/)
  assert.match(listSql, /mip_task_level_rules/)
  assert.match(listSql, /mip_growth_accounts/)
  assert.match(listSql, /current_level\.minimum_experience DESC/)
})

test('completion rechecks the server growth account and rejects a client-bypassed level', async () => {
  const eligibleLevelId = '77777777-7777-4777-8777-777777777777'
  const currentLevelId = '88888888-8888-4888-8888-888888888888'
  const reads = []
  const adapter = {
    async one(sql) {
      reads.push(sql)
      if (sql.includes('FROM mip_growth_accounts')) return { experience_balance: 80, version: 2 }
      if (sql.includes('ORDER BY level_id LIMIT 1')) return { level_id: eligibleLevelId }
      if (sql.includes('FROM mip_growth_levels')) return { id: currentLevelId }
      if (sql.includes('AND level_id = ?')) return null
      return null
    },
  }
  await assert.rejects(
    assertTaskLevelEligible(adapter, appId, userId, taskId, { currentLevelId: eligibleLevelId }),
    /TASK_LEVEL_NOT_ELIGIBLE/,
  )
  assert.equal(reads.some(sql => sql.includes('experience_balance')), true)
})

test('an unrestricted task accepts the server account without creating a rule fact', async () => {
  const adapter = {
    async one(sql) {
      if (sql.includes('FROM mip_growth_accounts')) return { experience_balance: 20, version: 3 }
      if (sql.includes('FROM mip_task_level_rules')) return null
      return null
    },
  }
  const account = await assertTaskLevelEligible(adapter, appId, userId, taskId)
  assert.equal(account.experience_balance, 20)
  assert.equal(account.persisted, true)
})

test('admin level rules are an exact active-level set and retain prior ids for audit', async () => {
  const oldLevelId = '77777777-7777-4777-8777-777777777777'
  const nextLevelId = '88888888-8888-4888-8888-888888888888'
  const writes = []
  const adapter = {
    async query(sql, params) {
      if (sql.includes('SELECT level_id FROM mip_task_level_rules')) return [{ level_id: oldLevelId }]
      if (sql.includes('SELECT id FROM mip_growth_levels')) return [{ id: nextLevelId }]
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const prior = await replaceTaskLevelRules(
    adapter,
    { appId, userId },
    taskId,
    [nextLevelId],
  )
  assert.deepEqual(prior, [oldLevelId])
  assert.match(writes[0].sql, /DELETE FROM mip_task_level_rules/)
  assert.deepEqual(writes[1].params, [appId, taskId, nextLevelId, userId])
})

test('task save validates active levels and audits the exact eligibility change', async () => {
  const levelId = '88888888-8888-4888-8888-888888888888'
  const auditWrites = []
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
      if (sql.includes('FROM mip_task_cards task')) {
        return {
          id: taskId,
          name: '等级任务',
          content: '仅部分等级可完成。',
          reward_experience: 10,
          attachment_required: 0,
          assignment_mode: 'ALL',
          status: 'DRAFT',
          version: 1,
        }
      }
      return null
    },
    async query(sql, params) {
      if (sql.includes('SELECT level_id FROM mip_task_level_rules')) return []
      if (sql.includes('SELECT id FROM mip_growth_levels')) return [{ id: levelId }]
      if (sql.includes('SELECT rule.task_id')) {
        return [{
          task_id: taskId,
          id: levelId,
          level_key: 'LEVEL_1',
          name: '等级 1',
          minimum_experience: 0,
          status: 'ACTIVE',
        }]
      }
      if (sql.includes('INSERT INTO mip_audit_logs')) auditWrites.push(params)
      return { affectedRows: 1 }
    },
  }
  const repository = createTaskRepository(
    { transaction: work => work(tx) },
    { createId: () => taskId },
  )
  const saved = await repository.saveTask({ appId, userId }, {
    task: {
      name: '等级任务',
      content: '仅部分等级可完成。',
      rewardExperience: 10,
      eligibleLevelIds: [levelId],
    },
  })
  assert.deepEqual(saved.eligibleLevels.map(level => level.id), [levelId])
  assert.deepEqual(JSON.parse(auditWrites[0][5]), {
    status: 'DRAFT',
    previousEligibleLevelIds: [],
    eligibleLevelIds: [levelId],
  })
})

test('task update preserves level rules when eligibleLevelIds is omitted and only clears on an explicit empty list', async () => {
  const levelId = '88888888-8888-4888-8888-888888888888'
  const writes = []
  const auditWrites = []
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
      if (sql.includes('FROM mip_task_cards\n')) return { status: 'DRAFT', version: 1 }
      if (sql.includes('FROM mip_task_cards task')) {
        return {
          id: taskId,
          name: '等级任务',
          content: '更新后的说明。',
          reward_experience: 10,
          attachment_required: 0,
          assignment_mode: 'ALL',
          status: 'DRAFT',
          version: 2,
        }
      }
      return null
    },
    async query(sql, params) {
      writes.push({ sql, params })
      if (sql.includes('SELECT level_id FROM mip_task_level_rules')) return [{ level_id: levelId }]
      if (sql.includes('SELECT rule.task_id')) {
        return [{
          task_id: taskId,
          id: levelId,
          level_key: 'LEVEL_1',
          name: '等级 1',
          minimum_experience: 0,
          status: 'ACTIVE',
        }]
      }
      if (sql.includes('INSERT INTO mip_audit_logs')) auditWrites.push(params)
      return { affectedRows: 1 }
    },
  }
  const repository = createTaskRepository({ transaction: work => work(tx) })
  const saved = await repository.saveTask({ appId, userId }, {
    taskId,
    expectedVersion: 1,
    task: {
      name: '等级任务',
      content: '更新后的说明。',
      rewardExperience: 10,
    },
  })
  assert.deepEqual(saved.eligibleLevels.map(level => level.id), [levelId])
  assert.equal(writes.some(call => call.sql.includes('DELETE FROM mip_task_level_rules')), false)
  assert.deepEqual(JSON.parse(auditWrites[0][5]), {
    status: 'DRAFT',
    previousEligibleLevelIds: [levelId],
    eligibleLevelIds: [levelId],
  })
})

test('assignment member references are opaque and bound to the trusted AppID', () => {
  const result = assignmentMemberDto({
    id: userId,
    nickname: '测试成员',
    branch_name: '广州分会',
    assignment_status: 'ACTIVE',
    assigned_at: new Date('2026-08-24T08:00:00Z'),
  }, { appId, profileRefSecret })
  assert.match(result.memberRef, /^p1\./)
  assert.equal(result.memberRef.includes(userId), false)
  assert.equal(result.assignmentStatus, 'ACTIVE')
})

test('member search is restricted to an existing selected-member task in the trusted AppID', async () => {
  let listed = false
  const repository = createTaskRepository({
    async one(sql) {
      if (sql.includes('FROM mip_admin_role_bindings')) return { role_key: 'PLATFORM_OPERATIONS' }
      if (sql.includes('FROM mip_task_cards')) return { status: 'DRAFT', assignment_mode: 'ALL' }
      return null
    },
    async query() { listed = true; return [] },
  })
  await assert.rejects(repository.listAssignableMembers({ appId, userId }, {
    filters: { taskId },
  }), /ASSIGNMENT_MODE_REQUIRED/)
  assert.equal(listed, false)
})

test('batch revoke soft-updates active assignments and writes an audit fact', async () => {
  const memberId = '77777777-7777-4777-8777-777777777777'
  const memberRef = createProfileRef({ appId, userId: memberId }, profileRefSecret)
  const writes = []
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
      if (sql.includes('FROM mip_task_cards')) return { status: 'PUBLISHED', assignment_mode: 'SELECTED', version: 3 }
      return null
    },
    async query(sql, params) {
      if (sql.startsWith('SELECT id FROM mip_users')) return [{ id: memberId }]
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const repository = createTaskRepository({ transaction: work => work(tx) })
  const result = await repository.revokeMembers({ appId, userId, profileRefSecret }, {
    taskId,
    expectedVersion: 3,
    memberRefs: [memberRef],
  })
  assert.equal(result.changedCount, 1)
  assert.match(writes[0].sql, /UPDATE mip_task_assignments SET status = 'REVOKED'/)
  assert.doesNotMatch(writes[0].sql, /DELETE/)
  assert.match(writes[1].sql, /INSERT INTO mip_audit_logs/)
})

test('batch assignment creates or reactivates app-scoped member facts without deleting history', async () => {
  const memberId = '77777777-7777-4777-8777-777777777777'
  const memberRef = createProfileRef({ appId, userId: memberId }, profileRefSecret)
  const writes = []
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
      if (sql.includes('FROM mip_task_cards')) return { status: 'DRAFT', assignment_mode: 'SELECTED', version: 2 }
      return null
    },
    async query(sql, params) {
      if (sql.startsWith('SELECT id FROM mip_users')) return [{ id: memberId }]
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const repository = createTaskRepository({
    transaction: work => work(tx),
  }, { createId: () => '88888888-8888-4888-8888-888888888888' })
  const result = await repository.assignMembers({ appId, userId, profileRefSecret }, {
    taskId,
    expectedVersion: 2,
    memberRefs: [memberRef],
  })
  assert.equal(result.changedCount, 1)
  assert.match(writes[0].sql, /INSERT INTO mip_task_assignments/)
  assert.match(writes[0].sql, /ON DUPLICATE KEY UPDATE/)
  assert.match(writes[0].sql, /status = 'ACTIVE'/)
  assert.doesNotMatch(writes[0].sql, /DELETE/)
})

test('task templates require a complete READY TASK_TEMPLATE media fact', async () => {
  await assert.rejects(
    assertTaskTemplate({ one: async () => ({
      status: 'READY',
      purpose: 'TASK_ATTACHMENT',
      cloud_file_id: 'cloud://env/mip/task.png',
      content_type: 'image/png',
      content_bytes: 1024,
      width_px: 96,
      height_px: 96,
    }) }, { appId }, '77777777-7777-4777-8777-777777777777'),
    /TEMPLATE_INVALID/,
  )
})

test('completion lists defer attachment downloads until an authorized detail read', () => {
  const row = {
    id: completionId,
    task_id: taskId,
    task_name_snapshot: '任务一',
    task_content_snapshot: '完成任务说明',
    nickname: '测试用户',
    reward_experience: 25,
    result_status: 'SUCCESS',
    result_message: null,
    completed_at: new Date('2026-08-24T08:00:00Z'),
    attachment_asset_id: '77777777-7777-4777-8777-777777777777',
    attachment_url: 'cloud://env/mip/test/task-attachments/a.png',
    attachment_content_type: 'image/png',
    attachment_bytes: 1024,
  }
  assert.equal(adminCompletionDto(row, false).attachment.url, '')
  assert.equal(adminCompletionDto(row, true).attachment.url, row.attachment_url)
})

test('handler returns stable client errors and never exposes internal messages', async () => {
  const handler = createHandler({
    health: async () => ({ service: 'mip-tasks-api' }),
    resolveCaller: async () => ({ appId, userId }),
    service: { listTasks: async () => { throw new Error('database uri leaked') } },
  })
  const response = await handler({ action: 'listTasks' })
  assert.equal(response.ok, false)
  assert.equal(response.error.code, 'SERVICE_UNAVAILABLE')
  assert.equal(response.error.message.includes('database'), false)
})

test('handler dispatches the nested v1 input and keeps legacy flat requests compatible', async () => {
  const calls = []
  const handler = createHandler({
    resolveCaller: async () => ({ appId, userId }),
    service: {
      async getTask(_caller, input) {
        calls.push(input)
        return { id: input.taskId }
      },
    },
  })
  const v1 = await handler({
    contractVersion: 1,
    action: 'getTask',
    input: { taskId },
  })
  const legacy = await handler({ action: 'getTask', taskId })
  assert.deepEqual(v1, { ok: true, data: { id: taskId } })
  assert.deepEqual(legacy, v1)
  assert.deepEqual(calls, [{ taskId }, { taskId }])
  assert.equal(Object.keys(actions).length, 17)
})

test('handler rejects flat v1 fields and nested action injection cannot replace the route', async () => {
  const calls = []
  const handler = createHandler({
    resolveCaller: async () => ({ appId, userId }),
    service: {
      async listTasks(_caller, input) {
        calls.push({ route: 'listTasks', input })
        return { items: [] }
      },
      async transitionTask() {
        calls.push({ route: 'admin.deleteTask' })
        throw new Error('unexpected route')
      },
    },
  })
  const injected = await handler({
    contractVersion: 1,
    action: 'listTasks',
    input: { action: 'admin.deleteTask', cursor: 'cursor-1' },
  })
  assert.equal(injected.ok, true)
  assert.deepEqual(calls, [{ route: 'listTasks', input: { cursor: 'cursor-1' } }])

  const flat = await handler({
    contractVersion: 1,
    action: 'listTasks',
    input: {},
    taskId,
  })
  assert.equal(flat.ok, false)
  assert.equal(flat.error.code, 'VALIDATION_FAILED')
  assert.equal(calls.length, 1)
})

test('workbook neutralizes formulas and builds an xlsx archive', () => {
  assert.equal(safeCell('=SUM(A1:A2)').startsWith("'="), true)
  const workbook = buildTaskWorkbook([{
    nickname: '=HYPERLINK("bad")',
    task_name_snapshot: '任务一',
    completed_at: '2026-08-24T08:00:00Z',
    attachment_asset_id: null,
    reward_experience: 10,
    result_status: 'SUCCESS',
  }])
  assert.equal(workbook.readUInt32LE(0), 0x04034b50)
})
