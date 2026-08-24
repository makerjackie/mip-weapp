'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createHandler } = require('../domain/handler')

test('public reads resolve only the trusted app scope', async () => {
  let callerResolved = false
  const handler = createHandler({
    health: async () => ({}),
    resolveAppId: () => 'wx-app',
    async resolveCaller() {
      callerResolved = true
      return { appId: 'wx-app', userId: 'user' }
    },
    assertAdminReady: async () => {},
    service: {
      listActive: async appId => [{ appId }],
    },
  })
  assert.deepEqual(await handler({ action: 'mip.banners.listActive' }), {
    ok: true,
    data: [{ appId: 'wx-app' }],
  })
  assert.equal(callerResolved, false)
})

test('admin writes resolve an authenticated caller and preserve conflict errors', async () => {
  const caller = { appId: 'wx-app', userId: 'user' }
  const calls = []
  const handler = createHandler({
    health: async () => ({}),
    resolveAppId: () => 'wx-app',
    resolveCaller: async () => caller,
    assertAdminReady: async (received) => {
      assert.equal(received, caller)
      calls.push('access')
    },
    service: {
      async changeStatus(received, event) {
        calls.push('service')
        assert.equal(received, caller)
        assert.equal(event.expectedVersion, 2)
        throw new Error('CONFLICT')
      },
    },
  })
  assert.deepEqual(await handler({
    action: 'mip.banners.admin.changeStatus',
    bannerId: 'banner',
    expectedVersion: 2,
  }), {
    ok: false,
    error: {
      code: 'CONFLICT',
      message: 'Banner 状态已变化，请刷新后重试',
      retryable: true,
    },
  })
  assert.deepEqual(calls, ['access', 'service'])
})

test('admin actions stop before the service when the full-access gate fails', async () => {
  let serviceCalled = false
  const handler = createHandler({
    health: async () => ({}),
    resolveAppId: () => 'wx-app',
    resolveCaller: async () => ({ appId: 'wx-app', userId: 'user' }),
    assertAdminReady: async () => { throw new Error('PHONE_REQUIRED') },
    service: {
      async listAdmin() {
        serviceCalled = true
        return []
      },
    },
  })
  const result = await handler({ action: 'mip.banners.admin.list' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'PHONE_REQUIRED')
  assert.equal(serviceCalled, false)
})

test('health proves persistence without identity resolution', async () => {
  let resolved = false
  const handler = createHandler({
    health: async () => ({ service: 'mip-banners-api', persistence: 'cloudbase-mysql' }),
    resolveAppId: () => {
      resolved = true
      return 'wx-app'
    },
    resolveCaller: async () => {
      resolved = true
      return {}
    },
    assertAdminReady: async () => {
      resolved = true
    },
    service: {},
  })
  assert.deepEqual(await handler({ action: 'health' }), {
    ok: true,
    data: { service: 'mip-banners-api', persistence: 'cloudbase-mysql' },
  })
  assert.equal(resolved, false)
})
