'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createAvatarProviderRequest,
  verifyAvatarProviderResponse,
} = require('../../mip-ai-api/lib/avatar-provider-contract')
const {
  createProviderResponse,
  verifyProviderRequest,
} = require('../lib/contract')

const appId = 'wx1234567890abcdef'
const secret = 'avatar-provider-secret-that-is-longer-than-thirty-two'
const now = 1_800_000_000_000

function request(overrides = {}) {
  return createAvatarProviderRequest({
    appId,
    generationId: '20000000-0000-4000-8000-000000000001',
    styleKey: 'PROFESSIONAL',
    sourceImageFileId: 'cloud://env/mip/development/0123456789abcdef01234567/avatars/89abcdef0123456789abcdef/30000000-0000-4000-8000-000000000001.png',
    sourceContentSha256: 'a'.repeat(64),
    sourceContentType: 'image/png',
    sourceContentBytes: 1024,
    sourceWidth: 512,
    sourceHeight: 512,
    ...overrides,
  }, secret, now)
}

test('accepts the caller contract and returns a caller-verifiable signed response', () => {
  const signed = request()
  const verified = verifyProviderRequest(signed, {
    allowedAppIds: new Set([appId]),
    secret,
    now: () => now,
  })
  const data = {
    contentType: 'image/png',
    imageBase64: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(24),
    ]).toString('base64'),
    providerJobKey: 'job-1',
  }
  const response = createProviderResponse(verified, data, secret, now)
  assert.deepEqual(verifyAvatarProviderResponse(response, signed, secret, now), data)
})

test('strips only well-formed CloudBase transport metadata before verification', () => {
  const signed = request()
  const verify = value => verifyProviderRequest(value, {
    allowedAppIds: new Set([appId]),
    secret,
    now: () => now,
  })
  const verified = verify({
    ...signed,
    frameworkContext: { requestId: 'framework-injected' },
    tcbContext: {},
    userInfo: { appId: 'transport-app', openId: 'transport-openid' },
  })

  assert.deepEqual(verified, signed)
  assert.equal(Object.hasOwn(verified, 'frameworkContext'), false)
  assert.equal(Object.hasOwn(verified, 'tcbContext'), false)
  assert.equal(Object.hasOwn(verified, 'userInfo'), false)
  for (const metadata of [
    { frameworkContext: null },
    { tcbContext: [] },
    { userInfo: 'untrusted' },
    { userInfo: new Date(now) },
  ]) {
    assert.throws(() => verify({ ...signed, ...metadata }), /FORBIDDEN/)
  }
  assert.throws(() => verify({ ...signed, frameworkContext: {}, extra: true }), /FORBIDDEN/)
})

test('rejects app, timestamp, action, signature, digest, identity, and unknown-field changes', () => {
  const signed = request()
  const verify = value => verifyProviderRequest(value, {
    allowedAppIds: new Set([appId]),
    secret,
    now: () => now,
  })
  for (const changed of [
    { ...signed, timestamp: now - 300_001 },
    { ...signed, appId: 'wxabcdef1234567890' },
    { ...signed, action: 'structureText' },
    { ...signed, signature: '0'.repeat(64) },
    { ...signed, payloadDigest: '0'.repeat(64) },
    { ...signed, requestId: '0'.repeat(64) },
    { ...signed, extra: true },
    { ...signed, payload: { ...signed.payload, styleKey: 'MONOCHROME' } },
  ]) {
    assert.throws(() => verify(changed), /FORBIDDEN|REQUEST_INVALID/)
  }
})

test('keeps operation identity stable while binding source and style into the request identity', () => {
  const first = request()
  const same = request()
  const changed = request({ styleKey: 'MONOCHROME' })
  assert.equal(first.operationKey, same.operationKey)
  assert.equal(first.requestId, same.requestId)
  assert.equal(first.operationKey, changed.operationKey)
  assert.notEqual(first.requestId, changed.requestId)
  assert.notEqual(first.payloadDigest, changed.payloadDigest)
})

test('rejects non-MIP object paths and mismatched image extensions before signing', () => {
  assert.throws(() => request({ sourceImageFileId: 'cloud://env/other-project/avatar.png' }), /REQUEST_INVALID/)
  assert.throws(() => request({
    sourceContentType: 'image/jpeg',
    sourceImageFileId: 'cloud://env/mip/development/0123456789abcdef01234567/avatars/89abcdef0123456789abcdef/30000000-0000-4000-8000-000000000001.png',
  }), /REQUEST_INVALID/)
})
