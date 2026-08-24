'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createHandler } = require('../domain/handler')

test('serves user actions from trusted caller context', async () => {
  const calls = []
  const handler = createHandler({
    async resolveCaller() {
      return { appId: 'wx-app', userId: 'user-id', openId: 'open-id' }
    },
    service: {
      async listInbox(caller, event) {
        calls.push({ caller, event })
        return { items: [], unreadCount: 0 }
      },
    },
  })
  assert.deepEqual(await handler({ action: 'listInbox', limit: 20 }), {
    ok: true,
    data: { items: [], unreadCount: 0 },
  })
  assert.equal(calls[0].caller.userId, 'user-id')
})

test('does not expose worker actions to client callers', async () => {
  let resolved = false
  const handler = createHandler({
    async resolveCaller() {
      resolved = true
      return {}
    },
    service: {},
  })
  assert.deepEqual(await handler({ action: 'publishMessage' }), {
    ok: false,
    error: { code: 'NOT_FOUND', message: '消息不存在', retryable: false },
  })
  assert.equal(resolved, false)
})

test('records a customer-service window only through the trusted caller action', async () => {
  let caller
  const handler = createHandler({
    async resolveCaller() {
      return { appId: 'wx-app', userId: 'user-id', openId: 'open-id' }
    },
    service: {
      async recordCustomerServiceInteraction(value) {
        caller = value
        return {
          channel: 'WECHAT_CUSTOMER_SERVICE',
          availableUntil: '2026-08-26T00:00:00.000Z',
        }
      },
    },
  })
  assert.deepEqual(await handler({ action: 'recordCustomerServiceInteraction' }), {
    ok: true,
    data: {
      channel: 'WECHAT_CUSTOMER_SERVICE',
      availableUntil: '2026-08-26T00:00:00.000Z',
    },
  })
  assert.equal(caller.openId, 'open-id')
})

test('health checks persistence without exposing configuration', async () => {
  const handler = createHandler({
    async health() {
      return { service: 'mip-notifications-api', persistence: 'cloudbase-mysql' }
    },
    service: {},
  })
  assert.deepEqual(await handler({ action: 'health' }), {
    ok: true,
    data: { service: 'mip-notifications-api', persistence: 'cloudbase-mysql' },
  })
})
