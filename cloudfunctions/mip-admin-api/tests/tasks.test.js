'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminTasks } = require('../domain/tasks')

const caller = { appId: 'wx-trusted', identityKey: 'browser-value-must-be-resolved' }

function accessWith(bindings) {
  return {
    async session(received) {
      assert.equal(received, caller)
      return { caller: { appId: 'wx-server-app', userId: 'admin-user' }, bindings }
    },
  }
}

describe('admin task adapter authorization', () => {
  it('requires the server capability and forwards only the resolved caller identity', async () => {
    const calls = []
    const adapter = createAdminTasks({
      access: accessWith([{
        roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null,
        capabilities: ['tasks.manage'],
      }]),
      client: { async execute(input) { calls.push(input); return { items: [] } } },
    })
    const result = await adapter.listTasks(caller, { filters: { query: 'x' } })
    assert.deepEqual(result, { items: [] })
    assert.deepEqual(calls, [{
      appId: 'wx-server-app', actorUserId: 'admin-user',
      action: 'mip.admin.tasks.list', input: { filters: { query: 'x' } },
    }])
  })

  it('rejects a role without tasks.manage before invoking the target function', async () => {
    let invoked = false
    const adapter = createAdminTasks({
      access: accessWith([{
        roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null,
        capabilities: ['events.read'],
      }]),
      client: { async execute() { invoked = true } },
    })
    await assert.rejects(
      () => adapter.deleteTask(caller, { taskId: 'task-a', expectedVersion: 1 }),
      error => error.code === 'FORBIDDEN' && error.message === 'FORBIDDEN',
    )
    assert.equal(invoked, false)
  })
})
