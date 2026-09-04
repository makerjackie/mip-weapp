'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { canonicalJson } = require('../lib/web-bff-auth')
const { createWebLoginConfirmationClient } = require('../lib/web-login-client')

const SECRET = 'web-login-confirm-secret-with-at-least-thirty-two-bytes'
const NOW = Date.UTC(2030, 0, 1)

function fixture(response = new Response(JSON.stringify({ confirmed: true }), { status: 200 })) {
  const calls = []
  const client = createWebLoginConfirmationClient({
    endpoint: 'https://mipmini.01mvp.com/api/internal/auth/challenge/confirm',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return response
    },
    now: () => NOW,
    nonce: () => '0123456789abcdefghijklmn',
    secret: SECRET,
  })
  return { calls, client }
}

describe('Web login confirmation client', () => {
  it('sends only a signed trusted principal and short-lived challenge code', async () => {
    const { calls, client } = fixture()
    assert.deepEqual(await client.confirm({
      appId: 'wx-mip-app',
      openId: 'openid-admin',
      challengeCode: '123456',
    }), { confirmed: true })

    const body = JSON.parse(calls[0].options.body)
    const { signature, ...unsigned } = body
    assert.equal(calls[0].url, 'https://mipmini.01mvp.com/api/internal/auth/challenge/confirm')
    assert.deepEqual(unsigned.principal, { appId: 'wx-mip-app', openId: 'openid-admin' })
    assert.equal(unsigned.timestamp, NOW)
    assert.match(signature, /^[a-f0-9]{64}$/)
    assert.equal(canonicalJson(unsigned).includes(SECRET), false)
  })

  it('signs an opaque mini-program scene token without adding a login code', async () => {
    const { calls, client } = fixture()
    const challengeToken = '0123456789abcdefghijklmnopqrstuv'
    assert.deepEqual(await client.confirm({
      appId: 'wx-mip-app',
      openId: 'openid-admin',
      challengeToken,
    }), { confirmed: true })

    const body = JSON.parse(calls[0].options.body)
    assert.equal(body.challengeToken, challengeToken)
    assert.equal(Object.hasOwn(body, 'challengeCode'), false)
    assert.match(body.signature, /^[a-f0-9]{64}$/)
  })

  it('maps an invalid or expired code without treating it as a transport failure', async () => {
    const response = new Response(JSON.stringify({
      error: { code: 'CHALLENGE_NOT_FOUND', message: '登录码无效或已过期' },
    }), { status: 404 })
    const { client } = fixture(response)

    await assert.rejects(
      () => client.confirm({ appId: 'wx-mip-app', openId: 'openid-admin', challengeCode: '123456' }),
      error => error.code === 'WEB_LOGIN_CHALLENGE_NOT_FOUND',
    )
  })

  it('maps reviewed BFF rejection codes to stable service errors', async () => {
    const cases = [
      [400, 'CONFIRMATION_INVALID', 'WEB_LOGIN_REQUEST_INVALID'],
      [401, 'CONFIRMATION_SIGNATURE_INVALID', 'WEB_LOGIN_AUTH_REJECTED'],
      [429, 'CHALLENGE_RATE_LIMITED', 'WEB_LOGIN_RATE_LIMITED'],
      [503, 'AUTH_NOT_CONFIGURED', 'WEB_LOGIN_CONFIG_REQUIRED'],
    ]

    for (const [status, responseCode, expectedCode] of cases) {
      const { client } = fixture(new Response(JSON.stringify({
        error: { code: responseCode, message: 'rejected' },
      }), { status }))
      await assert.rejects(
        () => client.confirm({ appId: 'wx-mip-app', openId: 'openid-admin', challengeCode: '123456' }),
        error => error.code === expectedCode,
      )
    }
  })

  it('distinguishes a timeout from other network failures', async () => {
    for (const [failure, expectedCode] of [
      [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), 'WEB_LOGIN_TIMEOUT'],
      [new Error('offline'), 'WEB_LOGIN_NETWORK_ERROR'],
    ]) {
      const client = createWebLoginConfirmationClient({
        endpoint: 'https://mipmini.01mvp.com/api/internal/auth/challenge/confirm',
        fetchImpl: async () => { throw failure },
        now: () => NOW,
        nonce: () => '0123456789abcdefghijklmn',
        secret: SECRET,
      })
      await assert.rejects(
        () => client.confirm({ appId: 'wx-mip-app', openId: 'openid-admin', challengeCode: '123456' }),
        error => error.code === expectedCode,
      )
    }
  })

  it('fails closed for missing configuration or malformed input', async () => {
    await assert.rejects(
      () => createWebLoginConfirmationClient({}).confirm({}),
      error => error.code === 'WEB_LOGIN_CONFIG_REQUIRED',
    )
    const { client } = fixture()
    await assert.rejects(
      () => client.confirm({ appId: 'wx-mip-app', openId: 'openid-admin', challengeCode: '12345A' }),
      error => error.code === 'WEB_LOGIN_REQUEST_INVALID',
    )
    await assert.rejects(
      () => client.confirm({
        appId: 'wx-mip-app',
        openId: 'openid-admin',
        challengeCode: '123456',
        challengeToken: '0123456789abcdefghijklmnopqrstuv',
      }),
      error => error.code === 'WEB_LOGIN_REQUEST_INVALID',
    )
  })
})
