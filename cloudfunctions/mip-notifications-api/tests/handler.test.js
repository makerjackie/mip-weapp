'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  CONTRACT_VERSION,
  actions,
  createHandler,
  normalizeRequest,
} = require('../domain/handler')

test('fixes the public contract at four user actions plus health', async () => {
  assert.equal(CONTRACT_VERSION, 1)
  assert.deepEqual(Object.keys(actions).sort(), [
    'listInbox',
    'markRead',
    'recordCustomerServiceInteraction',
    'recordSubscriptionDecision',
  ])

  let resolved = false
  const handler = createHandler({
    async health() {
      return { service: 'mip-notifications-api', persistence: 'cloudbase-mysql' }
    },
    async resolveCaller() {
      resolved = true
      return {}
    },
    service: {},
  })
  assert.deepEqual(await handler({ contractVersion: 1, action: 'health', input: {} }), {
    ok: true,
    data: { service: 'mip-notifications-api', persistence: 'cloudbase-mysql' },
  })
  assert.equal(resolved, false)
})

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
  assert.deepEqual(await handler({
    contractVersion: 1,
    action: 'listInbox',
    input: {
      limit: 20,
      appId: 'forged-app',
      userId: 'forged-user',
      openId: 'forged-open-id',
    },
  }), {
    ok: true,
    data: { items: [], unreadCount: 0 },
  })
  assert.deepEqual(calls[0], {
    caller: { appId: 'wx-app', userId: 'user-id', openId: 'open-id' },
    event: {
      limit: 20,
      appId: 'forged-app',
      userId: 'forged-user',
      openId: 'forged-open-id',
    },
  })
})

test('accepts trusted CloudBase metadata outside the neutral messaging envelope', async () => {
  const calls = []
  let resolved = false
  const handler = createHandler({
    async resolveCaller() {
      resolved = true
      return { appId: 'wx-app', userId: 'user-id', openId: 'open-id' }
    },
    service: {
      async listInbox(_caller, input) {
        calls.push(input)
        return { items: [], unreadCount: 0 }
      },
    },
  })

  assert.deepEqual(await handler({
    contractVersion: 1,
    action: 'listInbox',
    input: { limit: 20 },
    userInfo: { appId: 'wx-app', openId: 'open-id' },
    tcbContext: { requestId: 'cloudbase-request' },
  }), { ok: true, data: { items: [], unreadCount: 0 } })
  assert.deepEqual(calls, [{ limit: 20 }])

  resolved = false
  const malformed = await handler({
    contractVersion: 1,
    action: 'listInbox',
    input: {},
    userInfo: null,
  })
  assert.equal(malformed.error.code, 'VALIDATION_FAILED')
  assert.equal(resolved, false)
})

test('keeps legacy flat requests compatible', () => {
  assert.deepEqual(normalizeRequest({ action: 'listInbox', cursor: 'cursor-1', limit: 12 }), {
    action: 'listInbox',
    input: { cursor: 'cursor-1', limit: 12 },
    legacy: true,
  })
  assert.deepEqual(normalizeRequest({
    action: 'recordSubscriptionDecision',
    templateKey: 'EVENT_REMINDER',
    decision: 'ACCEPTED',
  }), {
    action: 'recordSubscriptionDecision',
    input: { templateKey: 'EVENT_REMINDER', decision: 'ACCEPTED' },
    legacy: true,
  })
})

test('rejects flat v1 fields and strips nested route injection', async () => {
  const calls = []
  const handler = createHandler({
    async resolveCaller() {
      return { appId: 'wx-app', userId: 'user-id', openId: 'open-id' }
    },
    service: {
      async markRead(_caller, input) {
        calls.push(input)
        return { messageId: input.messageId, readAt: '2026-08-25T00:00:00.000Z' }
      },
      async recordSubscriptionDecision() {
        throw new Error('FORBIDDEN')
      },
    },
  })

  assert.deepEqual(await handler({
    contractVersion: 1,
    action: 'markRead',
    input: { messageId: 'message-1' },
    messageId: 'flat-message',
  }), {
    ok: false,
    error: { code: 'VALIDATION_FAILED', message: '提交内容格式不正确', retryable: false },
  })
  assert.deepEqual(await handler({
    contractVersion: 1,
    action: 'markRead',
    input: {
      action: 'recordSubscriptionDecision',
      contractVersion: 999,
      input: { templateKey: 'EVENT_REMINDER', decision: 'ACCEPTED' },
      messageId: 'message-1',
    },
  }), {
    ok: true,
    data: { messageId: 'message-1', readAt: '2026-08-25T00:00:00.000Z' },
  })
  assert.deepEqual(calls, [{ messageId: 'message-1' }])
})

test('does not expose worker, unknown, or prototype actions to client callers', async () => {
  let resolved = false
  const handler = createHandler({
    async resolveCaller() {
      resolved = true
      return {}
    },
    service: {},
  })
  const expected = {
    ok: false,
    error: { code: 'NOT_FOUND', message: '消息不存在', retryable: false },
  }
  for (const action of ['publishMessage', 'unknownAction', 'toString', 'constructor', '__proto__']) {
    assert.deepEqual(await handler({ contractVersion: 1, action, input: {} }), expected)
  }
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
