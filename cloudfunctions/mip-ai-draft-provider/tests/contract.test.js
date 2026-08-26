'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createDraftProviderRequest,
  verifyDraftProviderResponse,
} = require('../../mip-ai-api/lib/draft-provider-contract')
const {
  createProviderResponse,
  verifyProviderRequest,
} = require('../lib/contract')

const appId = 'wx1234567890abcdef'
const secret = 'ai-provider-secret-that-is-longer-than-thirty-two'
const now = 1_800_000_000_000

function request(overrides = {}) {
  return createDraftProviderRequest('structureText', {
    appId,
    draftId: '20000000-0000-4000-8000-000000000001',
    purpose: 'PROFILE',
    expectedVersion: 1,
    transcriptText: '产品与交付经验',
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
    transcriptText: '产品与交付经验',
    structuredDraft: { headline: '产品负责人' },
    providerJobKey: 'job-1',
  }
  const response = createProviderResponse(verified, data, secret, now)
  assert.deepEqual(verifyDraftProviderResponse(response, signed, secret, now), data)
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

test('rejects payload, app, timestamp, action, signature, and unknown-field changes', () => {
  const signed = request()
  const verify = value => verifyProviderRequest(value, {
    allowedAppIds: new Set([appId]),
    secret,
    now: () => now,
  })
  for (const changed of [
    { ...signed, timestamp: now - 300_001 },
    { ...signed, appId: 'wxabcdef1234567890' },
    { ...signed, action: 'generateDigitalAvatar' },
    { ...signed, signature: '0'.repeat(64) },
    { ...signed, extra: true },
    { ...signed, payload: { ...signed.payload, transcriptText: 'changed' } },
  ]) {
    assert.throws(() => verify(changed), /FORBIDDEN/)
  }
})

test('binds a stable operation key to version and a stable request ID to content', () => {
  const first = request()
  const same = request()
  const changed = request({ transcriptText: '另一段资料' })
  const nextVersion = request({ expectedVersion: 2 })
  assert.equal(first.operationKey, same.operationKey)
  assert.equal(first.requestId, same.requestId)
  assert.equal(first.operationKey, changed.operationKey)
  assert.notEqual(first.requestId, changed.requestId)
  assert.notEqual(first.operationKey, nextVersion.operationKey)
})

test('requires signed voice metadata including exact hash, bytes, type, and MIP object path', () => {
  const voice = createDraftProviderRequest('transcribeAndStructure', {
    appId,
    draftId: '20000000-0000-4000-8000-000000000001',
    purpose: 'PROFILE',
    expectedVersion: 1,
    audioFileId: 'cloud://env/mip/development/0123456789abcdef01234567/ai/89abcdef0123456789abcdef/30000000-0000-4000-8000-000000000001.mp3',
    audioContentSha256: 'a'.repeat(64),
    audioContentType: 'audio/mpeg',
    audioContentBytes: 1024,
  }, secret, now)
  assert.doesNotThrow(() => verifyProviderRequest(voice, {
    allowedAppIds: new Set([appId]),
    secret,
    now: () => now,
  }))
  const invalidPath = createDraftProviderRequest('transcribeAndStructure', {
    ...voice.payload,
    audioFileId: 'cloud://env/other-project/audio.mp3',
  }, secret, now)
  assert.throws(() => verifyProviderRequest(invalidPath, {
    allowedAppIds: new Set([appId]),
    secret,
    now: () => now,
  }), /REQUEST_INVALID/)
})
