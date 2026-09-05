'use strict'

const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { describe, it } = require('node:test')
const { canonicalJson } = require('../lib/web-bff-auth')
const {
  WEB_LOGIN_QR_PAGE,
  codeEnvironment,
  createWebLoginQrCodeRoute,
} = require('../lib/web-login-qr-code')

const SECRET = 'web-bff-upstream-secret-with-at-least-thirty-two-bytes'
const NOW = Date.UTC(2030, 0, 1)
const TOKEN = '0123456789abcdefghijklmnopqrstuv'
const APP_ID = 'wx-mip-app'

function png() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
}

function jpeg() {
  return Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0])
}

function envelope(overrides = {}) {
  const unsigned = {
    transport: 'MIP_WEB_LOGIN_QR_V1',
    timestamp: NOW,
    nonce: '0123456789abcdefghijklmn',
    appId: APP_ID,
    challengeToken: TOKEN,
    ...overrides,
  }
  return {
    ...unsigned,
    signature: createHmac('sha256', SECRET).update(canonicalJson(unsigned)).digest('hex'),
  }
}

describe('Web login mini-program code route', () => {
  it('generates a no-identity mini-program code for the fixed confirmation page', async () => {
    let request
    const replayed = []
    const route = createWebLoginQrCodeRoute({
      allowedAppIds: new Set([APP_ID]),
      cloud: { openapi: { wxacode: { getUnlimited: async value => { request = value; return { buffer: png() } } } } },
      replayGuard: { consume: async value => replayed.push(value) },
      secret: SECRET,
      stage: 'production',
      now: () => NOW,
    })

    const result = await route(envelope())

    assert.deepEqual(request, {
      scene: TOKEN,
      page: WEB_LOGIN_QR_PAGE,
      width: 430,
      checkPath: true,
      envVersion: 'release',
    })
    assert.equal(replayed.length, 1)
    assert.deepEqual(replayed[0], {
      appId: APP_ID,
      nonce: '0123456789abcdefghijklmn',
      principalIdentityKey: replayed[0].principalIdentityKey,
      action: 'mip.admin.webLogin.qr.generate',
      requestHash: replayed[0].requestHash,
    })
    assert.match(replayed[0].principalIdentityKey, /^[a-f0-9]{64}$/)
    assert.match(replayed[0].requestHash, /^[a-f0-9]{64}$/)
    assert.deepEqual(result, {
      ok: true,
      data: { contentType: 'image/png', imageBase64: png().toString('base64') },
    })
  })

  it('uses server-side WeChat credentials without relying on the CloudBase OpenAPI token', async () => {
    const directAppId = 'wx0123456789abcdef'
    const requests = []
    let cloudCalls = 0
    const route = createWebLoginQrCodeRoute({
      allowedAppIds: new Set([directAppId]),
      cloud: { openapi: { wxacode: { getUnlimited: async () => { cloudCalls += 1 } } } },
      fetchImpl: async (url, init = {}) => {
        requests.push({ url: String(url), init })
        if (String(url).startsWith('https://api.weixin.qq.com/cgi-bin/token?')) {
          return new Response(JSON.stringify({ access_token: 't'.repeat(64), expires_in: 7200 }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(jpeg(), { headers: { 'content-type': 'image/jpeg' } })
      },
      replayGuard: { consume: async () => {} },
      secret: SECRET,
      stage: 'production',
      envVersion: 'trial',
      now: () => NOW,
      wechatAppId: directAppId,
      wechatAppSecret: 's'.repeat(32),
    })

    const result = await route(envelope({ appId: directAppId }))

    assert.equal(cloudCalls, 0)
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url.includes('secret='), true)
    assert.deepEqual(JSON.parse(requests[1].init.body), {
      scene: TOKEN,
      page: WEB_LOGIN_QR_PAGE,
      width: 430,
      check_path: false,
      env_version: 'trial',
    })
    assert.deepEqual(result, {
      ok: true,
      data: { contentType: 'image/jpeg', imageBase64: jpeg().toString('base64') },
    })
  })

  it('opens an unpublished development build when explicitly configured in production', async () => {
    let request
    const route = createWebLoginQrCodeRoute({
      allowedAppIds: new Set([APP_ID]),
      cloud: { openapi: { wxacode: { getUnlimited: async value => { request = value; return png() } } } },
      replayGuard: { consume: async () => {} },
      secret: SECRET,
      stage: 'production',
      envVersion: 'develop',
      now: () => NOW,
    })

    assert.equal((await route(envelope())).ok, true)
    assert.equal(request.envVersion, 'develop')
    assert.equal(request.checkPath, false)
    assert.equal(request.page, WEB_LOGIN_QR_PAGE)
  })

  it('rejects tampered or unexpected envelope fields before calling WeChat', async () => {
    let calls = 0
    const route = createWebLoginQrCodeRoute({
      allowedAppIds: new Set([APP_ID]),
      cloud: { openapi: { wxacode: { getUnlimited: async () => { calls += 1; return png() } } } },
      replayGuard: { consume: async () => { calls += 100 } },
      secret: SECRET,
      stage: 'production',
      now: () => NOW,
    })
    const signed = envelope()
    const failures = [
      { ...signed, challengeToken: `${TOKEN.slice(0, -1)}w` },
      { ...signed, principal: { openId: 'must-not-be-accepted' } },
      envelope({ appId: 'wx-not-allowed' }),
      envelope({ timestamp: NOW - 60_001 }),
    ]

    for (const event of failures) {
      assert.deepEqual(await route(event), {
        ok: false,
        error: { code: 'AUTH_REQUIRED', message: '请求未通过验证', retryable: false },
      })
    }
    assert.equal(calls, 0)
  })

  it('fails closed for provider errors and invalid image bytes', async () => {
    for (const [getUnlimited, reason] of [
      [async () => { throw new Error('provider detail') }, 'provider detail'],
      [async () => ({ buffer: Buffer.from('not-an-image') }), 'WEB_LOGIN_QR_INVALID_RESPONSE'],
    ]) {
      const route = createWebLoginQrCodeRoute({
        allowedAppIds: new Set([APP_ID]),
        cloud: { openapi: { wxacode: { getUnlimited } } },
        replayGuard: { consume: async () => {} },
        secret: SECRET,
        stage: 'production',
        now: () => NOW,
      })
      assert.deepEqual(await route(envelope()), {
        ok: false,
        error: {
          code: 'WEB_LOGIN_QR_UNAVAILABLE',
          message: '小程序码暂时无法生成',
          retryable: true,
          diagnostic: { reason },
        },
      })
    }
  })

  it('rejects a replay before calling WeChat', async () => {
    let calls = 0
    const route = createWebLoginQrCodeRoute({
      allowedAppIds: new Set([APP_ID]),
      cloud: { openapi: { wxacode: { getUnlimited: async () => { calls += 1; return png() } } } },
      replayGuard: { consume: async () => { throw new Error('WEB_BFF_REPLAYED') } },
      secret: SECRET,
      stage: 'production',
      now: () => NOW,
    })

    assert.deepEqual(await route(envelope()), {
      ok: false,
      error: { code: 'WEB_LOGIN_QR_REPLAYED', message: '请求已处理', retryable: false },
    })
    assert.equal(calls, 0)
  })

  it('maps deployment stages to WeChat code environments', () => {
    assert.equal(codeEnvironment('development'), 'develop')
    assert.equal(codeEnvironment('test'), 'develop')
    assert.equal(codeEnvironment('staging'), 'trial')
    assert.equal(codeEnvironment('production'), 'release')
    assert.equal(codeEnvironment('production', 'trial'), 'trial')
    assert.equal(codeEnvironment('production', 'develop'), 'develop')
    assert.equal(codeEnvironment('development', 'release'), 'release')
    assert.throws(() => codeEnvironment('production', 'preview'), /WEB_LOGIN_QR_CONFIG_REQUIRED/)
    assert.throws(() => codeEnvironment(''), /WEB_LOGIN_QR_CONFIG_REQUIRED/)
  })
})
