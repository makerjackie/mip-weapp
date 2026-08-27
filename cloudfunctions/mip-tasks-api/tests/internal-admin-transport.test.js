'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  TASK_ADMIN_TRANSPORT,
  createInternalTaskHandler,
  signTaskAdminRequest,
  verifyTaskAdminRequest,
} = require('../lib/internal-admin-transport')

const SECRET = 'task-admin-hmac-secret-with-at-least-32-characters'
const APP_ID = 'wx1234567890abcdef'
const USER_ID = '10000000-0000-4000-8000-000000000001'

function request(overrides = {}) {
  const value = {
    transport: TASK_ADMIN_TRANSPORT,
    protocol: 'mip-tasks-admin/v1',
    timestamp: 1_700_000_000_000,
    nonce: 'nonce-abcdefghijklmnopqrstuvwxyz',
    appId: APP_ID,
    actorUserId: USER_ID,
    action: 'admin.listTasks',
    input: { limit: 10 },
    sourceFunction: 'mip-admin-api',
    ...overrides,
  }
  return { ...value, signature: signTaskAdminRequest(value, SECRET) }
}

describe('tasks internal admin transport', () => {
  it('requires the allowlisted source, app, action, signature, and clock', () => {
    assert.doesNotThrow(() => verifyTaskAdminRequest(request(), {
      secret: SECRET, allowedAppIds: new Set([APP_ID]), now: () => 1_700_000_000_000,
    }))
    for (const overrides of [
      { appId: 'wx-other' },
      { action: 'admin.completeTask' },
      { sourceFunction: 'mip-other-api' },
      { timestamp: 1_600_000_000_000 },
    ]) {
      assert.throws(() => verifyTaskAdminRequest(request(overrides), {
        secret: SECRET, allowedAppIds: new Set([APP_ID]), now: () => 1_700_000_000_000,
      }), /AUTH_REQUIRED/)
    }
  })

  it('ignores only known CloudBase metadata and rejects unknown transport fields', () => {
    const event = request()
    event.userInfo = { appId: 'framework-injected' }
    event.tcbContext = {}
    event.frameworkContext = { requestId: 'framework-injected' }
    assert.doesNotThrow(() => verifyTaskAdminRequest(event, {
      secret: SECRET, allowedAppIds: new Set([APP_ID]), now: () => 1_700_000_000_000,
    }))
    const invalid = request()
    invalid.extra = true
    assert.throws(() => verifyTaskAdminRequest(invalid, {
      secret: SECRET, allowedAppIds: new Set([APP_ID]), now: () => 1_700_000_000_000,
    }), /AUTH_REQUIRED/)
  })

  it('requires a signed retry key and exact reviewed input for every mutation', () => {
    const valid = request({
      action: 'admin.publishTask',
      input: {
        taskId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 2,
        idempotencyKey: 'task-publish-retry-0001',
      },
    })
    assert.doesNotThrow(() => verifyTaskAdminRequest(valid, {
      secret: SECRET, allowedAppIds: new Set([APP_ID]), now: () => 1_700_000_000_000,
    }))
    for (const input of [
      { taskId: '22222222-2222-4222-8222-222222222222', expectedVersion: 2 },
      {
        taskId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 2,
        idempotencyKey: 'short',
      },
      {
        taskId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 2,
        idempotencyKey: 'task-publish-retry-0001',
        unreviewed: true,
      },
    ]) {
      assert.throws(() => verifyTaskAdminRequest(request({
        action: 'admin.publishTask',
        input,
      }), {
        secret: SECRET, allowedAppIds: new Set([APP_ID]), now: () => 1_700_000_000_000,
      }), /AUTH_REQUIRED/)
    }
  })

  it('fails closed when the secret is missing and never calls service', async () => {
    let invoked = false
    const handler = createInternalTaskHandler({
      service: { listAdminTasks: async () => { invoked = true } },
      secret: '', allowedAppIds: new Set([APP_ID]), profileRefSecret: SECRET,
      now: () => 1_700_000_000_000,
      assertAdminReady: async () => {},
    })
    const result = await handler(request())
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'TASKS_INTERNAL_AUTH_CONFIG_REQUIRED')
    assert.equal(invoked, false)
  })

  it('wakes post-commit processing only after a verified mutation succeeds', async () => {
    const calls = []
    const handler = createInternalTaskHandler({
      service: {
        async transitionTask(_caller, input, status) {
          calls.push({ type: 'mutation', input, status })
          return { id: input.taskId, status }
        },
      },
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      profileRefSecret: SECRET,
      now: () => 1_700_000_000_000,
      assertAdminReady: async () => {},
      afterSuccessfulMutation: async ({ request: verified }) => {
        calls.push({ type: 'wakeup', action: verified.action, appId: verified.appId })
      },
    })
    const result = await handler(request({
      action: 'admin.publishTask',
      input: {
        taskId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 2,
        idempotencyKey: 'task-publish-retry-0001',
      },
    }))
    assert.equal(result.ok, true)
    assert.deepEqual(calls.map(item => item.type), ['mutation', 'wakeup'])
    assert.deepEqual(calls[1], {
      type: 'wakeup',
      action: 'admin.publishTask',
      appId: APP_ID,
    })
  })
})
