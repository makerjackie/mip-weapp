'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  DEFAULT_TIMEOUT_MS,
  MEDIA_ADMIN_OPERATION,
  MEDIA_ADMIN_PURPOSE_CAPABILITIES,
  MEDIA_ADMIN_TRANSPORT,
  boundedTimeout,
  createMediaAdminClient,
} = require('../lib/media-admin-client')
const {
  MEDIA_ADMIN_PURPOSE_CAPABILITIES: TARGET_PURPOSE_CAPABILITIES,
  verifyMediaAdminRequest,
} = require('../../mip-media-api/lib/internal-admin-transport')

const SECRET = 'media-admin-hmac-secret-with-at-least-32-characters'
const APP_ID = 'wx1234567890abcdef'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const PNG_96 = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAAzUlEQVR4Ae3BQQEAIACEMLz+ndUWfNjO/YhmRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1YhqRDWiGlGNqEZUI6oR1QMN1AS8ycHTLwAAAABJRU5ErkJggg=='
const PNG_1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lBuwAAAAAElFTkSuQmCC'

function clientWith(cloud, extra = {}) {
  return createMediaAdminClient({
    cloud,
    secret: SECRET,
    now: () => 1_700_000_000_000,
    nonce: () => 'nonce-abcdefghijklmnopqrstuvwxyz',
    ...extra,
  })
}

describe('media admin typed client', () => {
  it('keeps the client purpose/capability allowlist identical to the trusted target', () => {
    assert.deepEqual(MEDIA_ADMIN_PURPOSE_CAPABILITIES, TARGET_PURPOSE_CAPABILITIES)
    assert.equal(MEDIA_ADMIN_OPERATION, 'mip.admin.media.uploadImage')
  })

  it('signs a typed image request accepted by the media trusted adapter', async () => {
    let captured
    const client = clientWith({
      async callFunction(input) {
        captured = input
        const verified = verifyMediaAdminRequest(input.data, {
          secret: SECRET,
          allowedAppIds: new Set([APP_ID]),
          now: () => 1_700_000_000_000,
        })
        assert.equal(verified.capability, 'banners.manage')
        assert.deepEqual(verified.input, { purpose: 'BANNER', imageBase64: PNG_96 })
        return { result: { ok: true, data: { assetId: 'asset-a', width: 96, height: 96 } } }
      },
    })
    const result = await client.execute({
      appId: APP_ID,
      actorUserId: USER_ID,
      action: MEDIA_ADMIN_OPERATION,
      input: { purpose: 'BANNER', imageBase64: PNG_96 },
    })
    assert.deepEqual(result, { assetId: 'asset-a', width: 96, height: 96 })
    assert.equal(captured.name, 'mip-media-api')
    assert.equal(captured.data.transport, MEDIA_ADMIN_TRANSPORT)
    assert.equal(captured.data.sourceFunction, 'mip-admin-api')
  })

  it('rejects arbitrary actions, fields, purposes, encodings, MIME, and dimensions before transport', async () => {
    let invoked = false
    const client = clientWith({ async callFunction() { invoked = true } })
    const cases = [
      { action: 'mip.admin.media.deleteAll', input: { purpose: 'BANNER', imageBase64: PNG_96 }, code: 'MEDIA_OPERATION_NOT_ALLOWED' },
      { action: MEDIA_ADMIN_OPERATION, input: { purpose: 'BANNER', imageBase64: PNG_96, ownerUserId: USER_ID }, code: 'VALIDATION_FAILED' },
      { action: MEDIA_ADMIN_OPERATION, input: { purpose: 'AVATAR', imageBase64: PNG_96 }, code: 'PURPOSE_INVALID' },
      { action: MEDIA_ADMIN_OPERATION, input: { purpose: 'BANNER', imageBase64: `data:image/png;base64,${PNG_96}` }, code: 'IMAGE_INVALID' },
      { action: MEDIA_ADMIN_OPERATION, input: { purpose: 'BANNER', imageBase64: Buffer.from('plain text payload').toString('base64') }, code: 'IMAGE_INVALID' },
      { action: MEDIA_ADMIN_OPERATION, input: { purpose: 'BANNER', imageBase64: PNG_1 }, code: 'IMAGE_DIMENSIONS_INVALID' },
    ]
    for (const item of cases) {
      await assert.rejects(
        () => client.execute({ appId: APP_ID, actorUserId: USER_ID, action: item.action, input: item.input }),
        error => error.code === item.code,
      )
    }
    assert.equal(invoked, false)
  })

  it('fails closed for identity, configuration, target errors, and timeout bounds', async () => {
    const unconfigured = createMediaAdminClient({ cloud: {}, secret: '' })
    await assert.rejects(
      () => unconfigured.execute({
        appId: APP_ID, actorUserId: USER_ID, action: MEDIA_ADMIN_OPERATION,
        input: { purpose: 'BANNER', imageBase64: PNG_96 },
      }),
      error => error.code === 'MEDIA_DISPATCH_CONFIG_REQUIRED',
    )
    const client = clientWith({ async callFunction() { return { result: { ok: false, error: { code: 'FORBIDDEN' } } } } })
    await assert.rejects(
      () => client.execute({
        appId: 'forged app', actorUserId: USER_ID, action: MEDIA_ADMIN_OPERATION,
        input: { purpose: 'BANNER', imageBase64: PNG_96 },
      }),
      error => error.code === 'AUTH_REQUIRED',
    )
    await assert.rejects(
      () => client.execute({
        appId: APP_ID, actorUserId: USER_ID, action: MEDIA_ADMIN_OPERATION,
        input: { purpose: 'BANNER', imageBase64: PNG_96 },
      }),
      error => error.code === 'FORBIDDEN',
    )
    assert.equal(boundedTimeout(250), 250)
    assert.equal(boundedTimeout(50_001), DEFAULT_TIMEOUT_MS)
  })

  it('marks a transport timeout as retryable without treating upload as successful', async () => {
    const client = clientWith({
      async callFunction() {
        await new Promise(resolve => setTimeout(resolve, 300))
        return { result: { ok: true, data: {} } }
      },
    }, { timeoutMs: 250 })
    await assert.rejects(
      () => client.execute({
        appId: APP_ID, actorUserId: USER_ID, action: MEDIA_ADMIN_OPERATION,
        input: { purpose: 'BANNER', imageBase64: PNG_96 },
      }),
      error => error.code === 'MEDIA_DISPATCH_UNAVAILABLE' && error.retryable === true,
    )
  })
})
