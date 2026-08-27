'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  WEB_BFF_TRANSPORT,
  createWebBffRoute,
  signWebBffEnvelope,
} = require('../lib/web-bff-auth')

const SECRET = 'web-bff-test-secret-that-is-at-least-thirty-two-bytes'
const NOW = Date.UTC(2030, 0, 1)

function envelope(action = 'mip.admin.dashboard.overview.get') {
  return signWebBffEnvelope({
    transport: WEB_BFF_TRANSPORT,
    timestamp: NOW,
    nonce: '0123456789abcdefghijklmn',
    principal: { appId: 'wx-mip-app', openId: 'openid-admin' },
    request: { contractVersion: 1, action, input: {} },
  }, SECRET)
}

function fixture() {
  const calls = []
  const route = createWebBffRoute({
    application: {
      async execute(principal, action, input) {
        calls.push({ principal, action, input })
        return { action }
      },
    },
    issuePrincipal(context) {
      return Object.freeze({ trusted: true, appId: context.APPID, openId: context.OPENID })
    },
    secret: SECRET,
    now: () => NOW,
  })
  return { calls, route }
}

describe('Web BFF trusted query adapter', () => {
  it('issues the principal only after verifying the server signature', async () => {
    const { calls, route } = fixture()
    const result = await route(envelope())

    assert.equal(result.ok, true)
    assert.deepEqual(calls, [{
      principal: { trusted: true, appId: 'wx-mip-app', openId: 'openid-admin' },
      action: 'mip.admin.dashboard.overview.get',
      input: {},
    }])
  })

  it('rejects a browser-forged principal before issuing it', async () => {
    const { calls, route } = fixture()
    const forged = envelope()
    forged.principal.openId = 'attacker'

    const result = await route(forged)

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'AUTH_REQUIRED')
    assert.equal(calls.length, 0)
  })

  it('rejects expired envelopes and all mutation actions', async () => {
    const { calls, route } = fixture()
    const expired = signWebBffEnvelope({ ...envelope(), timestamp: NOW - 60_001 }, SECRET)

    const expiredResult = await route(expired)
    const mutationResult = await route(envelope('mip.admin.users.update'))

    assert.equal(expiredResult.ok, false)
    assert.equal(expiredResult.error.code, 'AUTH_REQUIRED')
    assert.equal(mutationResult.ok, false)
    assert.equal(mutationResult.error.code, 'FORBIDDEN')
    assert.equal(calls.length, 0)
  })

  it('fails closed when the shared BFF secret is not configured', async () => {
    const calls = []
    const route = createWebBffRoute({
      application: { execute: async () => calls.push('executed') },
      issuePrincipal: () => calls.push('issued'),
      secret: '',
      now: () => NOW,
    })

    const result = await route(envelope())

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'SERVICE_UNAVAILABLE')
    assert.equal(calls.length, 0)
  })
})
