'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  OPERATION_SPECS,
  TASK_ADMIN_TRANSPORT,
  createTaskAdminClient,
} = require('../lib/task-admin-client')
const { verifyTaskAdminRequest } = require('../../mip-tasks-api/lib/internal-admin-transport')

const SECRET = 'task-admin-hmac-secret-with-at-least-32-characters'
const APP_ID = 'wx1234567890abcdef'
const USER_ID = '10000000-0000-4000-8000-000000000001'

function clientWith(cloud, extra = {}) {
  return createTaskAdminClient({
    cloud,
    secret: SECRET,
    now: () => 1_700_000_000_000,
    nonce: () => 'nonce-abcdefghijklmnopqrstuvwxyz',
    ...extra,
  })
}

describe('task admin typed client', () => {
  it('exposes only the twelve reviewed task operations', () => {
    assert.deepEqual(Object.keys(OPERATION_SPECS).sort(), [
      'mip.admin.tasks.assignMembers',
      'mip.admin.tasks.assignableMembers.list',
      'mip.admin.tasks.completions.export',
      'mip.admin.tasks.completions.get',
      'mip.admin.tasks.completions.list',
      'mip.admin.tasks.delete',
      'mip.admin.tasks.get',
      'mip.admin.tasks.list',
      'mip.admin.tasks.publish',
      'mip.admin.tasks.revokeMembers',
      'mip.admin.tasks.save',
      'mip.admin.tasks.unpublish',
    ].sort())
  })

  it('signs a request that the task transport can authenticate and preserves mutation idempotency', async () => {
    let captured
    const client = clientWith({
      async callFunction(input) {
        captured = input.data
        const verified = verifyTaskAdminRequest(captured, {
          secret: SECRET,
          allowedAppIds: new Set([APP_ID]),
          now: () => 1_700_000_000_000,
        })
        assert.equal(verified.action, 'admin.saveTask')
        assert.deepEqual(verified.input, {
          taskId: 'task-a',
          expectedVersion: 2,
          idempotencyKey: 'task.save-retry-0001',
          task: { name: 'n' },
        })
        return { result: { ok: true, data: { taskId: 'task-a' } } }
      },
    })
    const result = await client.execute({
      appId: APP_ID,
      actorUserId: USER_ID,
      action: 'mip.admin.tasks.save',
      input: {
        taskId: 'task-a',
        expectedVersion: 2,
        idempotencyKey: 'task.save-retry-0001',
        task: { name: 'n' },
      },
    })
    assert.deepEqual(result, { taskId: 'task-a' })
    assert.equal(captured.transport, TASK_ADMIN_TRANSPORT)
    assert.equal(captured.sourceFunction, 'mip-admin-api')
  })

  it('requires a valid retry key for every task mutation before transport', async () => {
    let invoked = false
    const client = clientWith({ async callFunction() { invoked = true } })
    for (const input of [
      { taskId: 'task-a', expectedVersion: 1 },
      { taskId: 'task-a', expectedVersion: 1, idempotencyKey: 'short' },
    ]) {
      await assert.rejects(
        () => client.execute({
          appId: APP_ID,
          actorUserId: USER_ID,
          action: 'mip.admin.tasks.publish',
          input,
        }),
        error => error.code === 'VALIDATION_FAILED',
      )
    }
    assert.equal(invoked, false)
  })

  it('rejects unknown top-level and nested input fields before transport', async () => {
    let invoked = false
    const client = clientWith({ async callFunction() { invoked = true } })
    await assert.rejects(
      () => client.execute({
        appId: APP_ID, actorUserId: USER_ID, action: 'mip.admin.tasks.save',
        input: { task: { name: 'n', hiddenRule: true } },
      }),
      error => error.code === 'VALIDATION_FAILED',
    )
    await assert.rejects(
      () => client.execute({
        appId: APP_ID, actorUserId: USER_ID, action: 'mip.admin.tasks.list',
        input: { filters: { query: '', hidden: 'no' } },
      }),
      error => error.code === 'VALIDATION_FAILED',
    )
    assert.equal(invoked, false)
  })

  it('fails closed for an unconfigured transport and arbitrary action', async () => {
    const client = createTaskAdminClient({ cloud: {}, secret: '' })
    await assert.rejects(
      () => client.execute({ appId: APP_ID, actorUserId: USER_ID, action: 'admin.deleteAll', input: {} }),
      error => error.code === 'TASKS_OPERATION_NOT_ALLOWED',
    )
    await assert.rejects(
      () => client.execute({ appId: APP_ID, actorUserId: USER_ID, action: 'mip.admin.tasks.list', input: {} }),
      error => error.code === 'TASKS_DISPATCH_CONFIG_REQUIRED',
    )
  })
})
