'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createHandler } = require('../domain/handler')

test('health checks persistence without exposing notification configuration', async () => {
  const handler = createHandler({
    async health() {
      return { service: 'mip-notification-worker', persistence: 'cloudbase-mysql' }
    },
    service: {},
  })
  assert.deepEqual(await handler({ action: 'health' }), {
    ok: true,
    data: { service: 'mip-notification-worker', persistence: 'cloudbase-mysql' },
  })
})

test('accepts worker actions only after internal verification', async () => {
  const handler = createHandler({
    verifyInternal(event) {
      assert.equal(event.signature, 'signed')
      return { appId: 'wx-app', message: { title: '活动提醒' } }
    },
    service: {
      async publishMessage(input) {
        return { appId: input.appId, title: input.message.title }
      },
    },
  })
  assert.deepEqual(await handler({ action: 'publishMessage', signature: 'signed' }), {
    ok: true,
    data: { appId: 'wx-app', title: '活动提醒' },
  })
})

test('routes a signed delivery reconcile without exposing it to clients', async () => {
  const handler = createHandler({
    verifyInternal(event) {
      assert.equal(event.signature, 'signed')
      return { taskId: 'task-a', actorUserId: 'operator-a' }
    },
    service: {
      async reconcileDeliveryTask(input) {
        return { taskId: input.taskId, effect: 'UNCHANGED' }
      },
    },
  })
  assert.deepEqual(await handler({ action: 'reconcileDeliveryTask', signature: 'signed' }), {
    ok: true,
    data: { taskId: 'task-a', effect: 'UNCHANGED' },
  })
})

test('does not expose user inbox actions', async () => {
  let verified = false
  const handler = createHandler({
    verifyInternal() {
      verified = true
      return {}
    },
    service: {},
  })
  assert.deepEqual(await handler({ action: 'listInbox' }), {
    ok: false,
    error: { code: 'NOT_FOUND', message: '操作不存在', retryable: false },
  })
  assert.equal(verified, false)
})
