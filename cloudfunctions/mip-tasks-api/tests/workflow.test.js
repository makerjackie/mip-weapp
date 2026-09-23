'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createTaskWorkflow } = require('../domain/workflow')
const { normalizeTask, normalizeRewardConfig } = require('../domain/validation')
const { createTaskAdminClient } = require('../../mip-admin-api/lib/task-admin-client')
const { createInternalTaskHandler } = require('../lib/internal-admin-transport')

const APP = 'wx1234567890abcdef'
const OWNER = '10000000-0000-4000-8000-000000000001'
const MEMBER = '20000000-0000-4000-8000-000000000002'
const TASK = '30000000-0000-4000-8000-000000000003'
const SUBMISSION = '40000000-0000-4000-8000-000000000004'
const caller = { appId: APP, userId: OWNER }
const rewards = { experience: { enabled: true, amount: 20 }, contribution: { enabled: true, amount: 5 }, bonus: { enabled: true, amount: 12.5 } }

function harness() {
  let state = {
    submission: { id: SUBMISSION, task_id: TASK, user_id: MEMBER, assigned_owner_id: OWNER,
      submission_status: 'pending_review', reward_config_snapshot_json: JSON.stringify(rewards), version: 1 },
    account: { experience_balance: 100, contribution_balance: 10, version: 1 },
    entries: [], reviews: [],
  }
  let savepoint
  let failContribution = false
  let next = 10
  const tx = {
    async one(sql, params) {
      if (sql.includes('mip_task_completions')) {
        assert.equal(params[0], APP)
        return params[1] === SUBMISSION ? structuredClone(state.submission) : null
      }
      if (sql.includes('mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('mip_growth_accounts')) return state.account
      if (sql.includes('mip_growth_entries')) return state.entries.find(entry => entry.metric === params[3]) || null
      if (sql.includes('mip_role_capability_policies')) return null
      if (sql.includes('mip_growth_levels')) return null
      return null
    },
    async query(sql, params = []) {
      if (sql === 'SAVEPOINT task_reward') savepoint = structuredClone(state)
      if (sql === 'ROLLBACK TO SAVEPOINT task_reward') state = structuredClone(savepoint)
      if (sql.includes('UPDATE mip_growth_accounts')) {
        if (sql.includes('contribution_balance')) {
          if (failContribution) throw new Error('REWARD_UNAVAILABLE')
          state.account.contribution_balance = params[0]
        }
        else state.account.experience_balance = params[0]
      }
      if (sql.includes('INSERT INTO mip_growth_entries')) {
        state.entries.push({ id: params[0], metric: params[4], delta_value: params[5], balance_after: params[6] })
      }
      if (sql.includes('UPDATE mip_task_completions')) {
        if (sql.includes("submission_status = 'rejected'")) {
          state.submission.submission_status = 'rejected'
          state.submission.review_remark = params[0]
        }
        else {
          Object.assign(state.submission, { submission_status: params[0], result_status: params[1], result_message: params[2],
            reward_experience: params[3], growth_entry_id: params[4], reward_result_json: params[7], retry_log_json: params[8] })
        }
      }
      if (sql.includes('INSERT INTO mip_task_submission_reviews')) {
        assert.equal(params[0], APP)
        state.reviews.push(params)
      }
      return { affectedRows: 1 }
    },
  }
  const workflow = createTaskWorkflow({ database: { transaction: work => work(tx) },
    createId: () => `50000000-0000-4000-8000-${String(next++).padStart(12, '0')}`,
    assertTasksAdmin: async () => 'PLATFORM_OPERATIONS', writeAudit: async () => {} })
  return { workflow, state: () => state, fail: value => { failContribution = value }, tx }
}

test('configured tasks retain all bounded server fields and require a real owner and reward', () => {
  const task = normalizeTask({ name: '任务', content: '任务内容', rewardConfig: rewards, starLevel: 4,
    purpose: '交付真实成果', completionCriteria: '提交证明', assignedOwnerId: OWNER,
    weeklyDeliverAt: '10:30', periodStartAt: '2026-09-21', periodEndAt: '2026-09-30', applicableServers: [] })
  assert.equal(task.assignedOwnerId, OWNER)
  assert.equal(task.weeklyDeliverAt, '10:30')
  assert.equal(task.rewardConfig.contribution.amount, 5)
  assert.throws(() => normalizeTask({ ...task, weeklyDeliverAt: '2026-09-21T10:30:00Z' }), /VALIDATION_FAILED/)
  assert.throws(() => normalizeTask({ ...task, assignedOwnerId: '姓名代替身份' }), /VALIDATION_FAILED/)
  assert.throws(() => normalizeRewardConfig({}), /VALIDATION_FAILED/)
  assert.throws(() => normalizeRewardConfig({ bonus: { enabled: true, amount: 1.234 } }), /VALIDATION_FAILED/)
})

test('approval credits enabled metrics exactly once and only records an offline bonus', async () => {
  const h = harness()
  const first = await h.workflow.approveSubmission(caller, { submissionId: SUBMISSION })
  assert.equal(first.submissionStatus, 'approved')
  assert.deepEqual(first.rewardResult.bonus, { granted: false, amount: 12.5, status: 'OFFLINE_PENDING' })
  assert.equal(h.state().account.experience_balance, 120)
  assert.equal(h.state().account.contribution_balance, 15)
  const replay = await h.workflow.approveSubmission(caller, { submissionId: SUBMISSION })
  assert.equal(replay.submissionStatus, 'approved')
  assert.equal(h.state().entries.length, 2)
  assert.equal(h.state().reviews.length, 1)
  await assert.rejects(h.workflow.rejectSubmission(caller, { submissionId: SUBMISSION, remark: '已通过不能退回' }), /INVALID_STATE/)
})

test('a reward failure rolls back every partial credit; retry uses the original snapshot', async () => {
  const h = harness()
  h.fail(true)
  const failed = await h.workflow.approveSubmission(caller, { submissionId: SUBMISSION })
  assert.equal(failed.submissionStatus, 'reward_failed')
  assert.equal(h.state().entries.length, 0)
  assert.equal(h.state().account.experience_balance, 100)
  h.fail(false)
  const retried = await h.workflow.retrySubmissionReward(caller, { submissionId: SUBMISSION })
  assert.equal(retried.submissionStatus, 'approved')
  assert.equal(h.state().entries.length, 2)
  assert.equal(retried.retryLog.length, 1)
  assert.equal(retried.rewardResult.experience.amount, 20)
})

test('only the assigned reviewer can approve, and rejection awards nothing', async () => {
  const h = harness()
  await assert.rejects(h.workflow.approveSubmission({ ...caller, userId: MEMBER }, { submissionId: SUBMISSION }), /FORBIDDEN/)
  await assert.rejects(h.workflow.rejectSubmission(caller, { submissionId: SUBMISSION }), /VALIDATION_FAILED/)
  const rejected = await h.workflow.rejectSubmission(caller, { submissionId: SUBMISSION, remark: '补充附件' })
  assert.equal(rejected.submissionStatus, 'rejected')
  assert.equal(h.state().entries.length, 0)
  assert.equal(h.state().submission.reward_config_snapshot_json, JSON.stringify(rewards))
})

test('new submission waits for review and does not issue a growth reward', async () => {
  const writes = []
  const h = harness()
  const result = await h.workflow.submit({ query: async (sql, params) => { writes.push({ sql, params }); return { affectedRows: 1 } } },
    caller, { id: TASK, name: '任务', content: '内容', assigned_owner_id: OWNER,
      reward_config_json: rewards, star_level: 3, version: 2 }, null, null, 'week:2')
  assert.equal(result.submissionStatus, 'pending_review')
  assert.equal(result.rewardExperience, 0)
  assert.equal(writes.length, 1)
  assert.match(writes[0].sql, /INSERT INTO mip_task_completions/)
  assert.equal(writes[0].params.at(-1), 'week:2')
})

test('admin bridge and signed owner transport both accept the extended task contract', async () => {
  const secret = 'task-contract-test-secret-at-least-32-characters'
  let stored
  const target = createInternalTaskHandler({ secret, allowedAppIds: new Set([APP]), assertAdminReady: async () => {},
    service: { saveTask: async (_caller, input) => { stored = normalizeTask(input.task); return stored } } })
  const client = createTaskAdminClient({ secret, cloud: { callFunction: async request => ({ result: await target(request.data) }) } })
  const result = await client.execute({ appId: APP, actorUserId: OWNER, action: 'mip.admin.tasks.save', input: {
    idempotencyKey: 'task-roundtrip-key-0001', task: { name: '任务', content: '内容', starLevel: 3,
      purpose: '目的', completionCriteria: '标准', assignedOwnerId: OWNER, rewardConfig: rewards, weeklyDeliverAt: '09:00' },
  } })
  assert.equal(result.assignedOwnerId, OWNER)
  assert.equal(stored.rewardConfig.bonus.amount, 12.5)
})
