'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createAiProviderAdapter,
  createCloudAiProvider,
  normalizeProviderResult,
} = require('../lib/provider')
const {
  CONTRACT_VERSION,
  digest,
  sign,
} = require('../lib/draft-provider-contract')
const {
  CONTRACT_VERSION: AVATAR_CONTRACT_VERSION,
  digest: avatarDigest,
  sign: avatarSign,
} = require('../lib/avatar-provider-contract')

test('reports unavailable instead of creating a fake draft', async () => {
  const provider = createCloudAiProvider({}, '')
  assert.deepEqual(provider.capability(), {
    voiceDrafts: false,
    textDrafts: false,
    refinementDrafts: false,
    digitalAvatars: false,
    reason: 'PROVIDER_NOT_CONFIGURED',
  })
  await assert.rejects(() => provider.structureText({}), /AI_PROVIDER_UNAVAILABLE/)
})

test('uses an explicit unavailable adapter instead of a runtime mock', async () => {
  const provider = createAiProviderAdapter({ adapter: 'mock' })
  assert.equal(provider.capability().refinementDrafts, false)
  assert.equal(await provider.readiness(), false)
  await assert.rejects(() => provider.refineDraft({}), /AI_PROVIDER_UNAVAILABLE/)
})

test('does not reuse the draft or maintenance trust domain for digital avatars', async () => {
  const provider = createCloudAiProvider({}, 'mip-ai-draft-provider', 'd'.repeat(48), {
    avatarFunctionName: 'mip-ai-avatar-provider',
  })
  assert.equal(provider.capability().digitalAvatars, false)
  await assert.rejects(() => provider.generateDigitalAvatar({}), /AI_PROVIDER_UNAVAILABLE/)
})

test('reports configured draft capability only after the Provider readiness contract passes', async () => {
  let calls = 0
  const provider = createCloudAiProvider({
    async callFunction(input) {
      calls += 1
      assert.equal(input.data.action, 'readiness')
      return { result: { ok: true, data: { ready: true } } }
    },
  }, 'mip-ai-draft-provider', 's'.repeat(48))
  assert.equal(await provider.readiness(), true)
  assert.equal(await provider.readiness(), true)
  assert.equal(calls, 1)
})

test('retries a draft transport once with the exact same stable request identity', async () => {
  const secret = 's'.repeat(48)
  const requests = []
  const provider = createCloudAiProvider({
    async callFunction(input) {
      requests.push(input.data)
      if (requests.length === 1) throw new Error('transport')
      const data = {
        transcriptText: '资料内容',
        structuredDraft: { headline: '产品负责人' },
        providerJobKey: 'job-retried',
      }
      const result = {
        version: CONTRACT_VERSION,
        timestamp: Date.now(),
        requestId: input.data.requestId,
        operationKey: input.data.operationKey,
        ok: true,
        data,
        dataDigest: digest(data),
      }
      return { result: { ...result, signature: sign(result, secret) } }
    },
  }, 'mip-ai-draft-provider', secret)
  const result = await provider.structureText({
    appId: 'wx1234567890abcdef',
    draftId: '20000000-0000-4000-8000-000000000001',
    purpose: 'PROFILE',
    expectedVersion: 1,
    transcriptText: '资料内容',
  })
  assert.equal(result.providerJobKey, 'job-retried')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].requestId, requests[1].requestId)
  assert.equal(requests[0].operationKey, requests[1].operationKey)
  assert.equal(requests[0].payloadDigest, requests[1].payloadDigest)
  assert.equal(requests[0].signature, requests[1].signature)
})

test('binds all refinement context while allowing a structured-only response', async () => {
  const secret = 'ai-provider-secret-that-is-longer-than-thirty-two'
  let request
  const provider = createCloudAiProvider({
    async callFunction(input) {
      request = input
      const data = {
        structuredDraft: { headline: '更新后的标题' },
        providerJobKey: 'refine-job-private',
      }
      const result = {
        version: CONTRACT_VERSION,
        timestamp: Date.now(),
        requestId: input.data.requestId,
        operationKey: input.data.operationKey,
        ok: true,
        data,
        dataDigest: digest(data),
      }
      return {
        result: { ...result, signature: sign(result, secret) },
      }
    },
  }, 'mip-ai-provider', secret)
  const input = {
    appId: 'wx-app',
    draftId: '20000000-0000-4000-8000-000000000001',
    purpose: 'PROFILE',
    expectedVersion: 4,
    currentTranscript: '第一轮内容',
    currentStructuredDraft: { headline: '原标题' },
    supplementalText: '标题改为更新后的标题',
  }
  const result = await provider.refineDraft(input)
  assert.deepEqual(result.structuredDraft, { headline: '更新后的标题' })
  assert.equal(Object.hasOwn(result, 'transcriptText'), false)
  assert.equal(
    request.data.signature,
    sign(request.data, secret),
  )
  assert.notEqual(
    request.data.payloadDigest,
    digest({ ...request.data.payload, supplementalText: '另一段内容' }),
  )
})

test('validates the configured provider response', async () => {
  const secret = 'ai-provider-secret-that-is-longer-than-thirty-two'
  let request
  const provider = createCloudAiProvider({
    async callFunction(input) {
      request = input
      const data = {
        transcriptText: '产品与交付经验',
        structuredDraft: { headline: '产品负责人' },
        providerJobKey: 'provider-job-private',
      }
      const result = {
        version: CONTRACT_VERSION,
        timestamp: Date.now(),
        requestId: input.data.requestId,
        operationKey: input.data.operationKey,
        ok: true,
        data,
        dataDigest: digest(data),
      }
      return {
        result: { ...result, signature: sign(result, secret) },
      }
    },
  }, 'mip-ai-provider', secret)
  const result = await provider.structureText({
    appId: 'wx-app',
    draftId: '20000000-0000-4000-8000-000000000001',
    purpose: 'PROFILE',
    expectedVersion: 1,
    transcriptText: '产品与交付经验',
  })
  assert.equal(result.transcriptText, '产品与交付经验')
  assert.equal(provider.capability().digitalAvatars, false)
  assert.equal(request.name, 'mip-ai-provider')
  assert.equal(
    request.data.signature,
    sign(request.data, secret),
  )
  assert.equal(Object.hasOwn(request.data.payload, 'transcriptText'), true)
  assert.throws(() => normalizeProviderResult({ transcriptText: '', structuredDraft: {} }), /AI_PROVIDER_RESPONSE_INVALID/)
})

test('binds digital-avatar source and style while accepting only the strict image result', async () => {
  const secret = 'ai-provider-secret-that-is-longer-than-thirty-two'
  let request
  const imageBase64 = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(24),
  ]).toString('base64')
  const input = {
    appId: 'wx1234567890abcdef',
    generationId: '20000000-0000-4000-8000-000000000001',
    styleKey: 'PROFESSIONAL',
    sourceImageFileId: 'cloud://env/mip/development/0123456789abcdef01234567/avatars/89abcdef0123456789abcdef/30000000-0000-4000-8000-000000000001.png',
    sourceContentSha256: 'a'.repeat(64),
    sourceContentType: 'image/png',
    sourceContentBytes: 1024,
    sourceWidth: 512,
    sourceHeight: 512,
  }
  const provider = createCloudAiProvider({
    async callFunction(input) {
      request = input
      const data = {
        contentType: 'image/png',
        imageBase64,
        providerJobKey: 'avatar-job-private',
      }
      const result = {
        version: AVATAR_CONTRACT_VERSION,
        timestamp: Date.now(),
        requestId: input.data.requestId,
        operationKey: input.data.operationKey,
        ok: true,
        data,
        dataDigest: avatarDigest(data),
      }
      return {
        result: { ...result, signature: avatarSign(result, secret) },
      }
    },
  }, 'mip-ai-provider', secret, {
    avatarFunctionName: 'mip-ai-avatar-provider',
    avatarSecret: secret,
  })
  const result = await provider.generateDigitalAvatar(input)
  assert.equal(result.imageBase64, imageBase64)
  assert.equal(request.data.action, 'generateDigitalAvatar')
  assert.equal(request.data.version, AVATAR_CONTRACT_VERSION)
  assert.equal(request.data.signature, avatarSign(request.data, secret))
  assert.notEqual(
    request.data.payloadDigest,
    avatarDigest({ ...request.data.payload, styleKey: 'MONOCHROME' }),
  )
  const invalidProvider = createCloudAiProvider({
    async callFunction(call) {
      const data = {
        contentType: 'image/png',
        imageBase64,
        providerJobKey: 'avatar-job-private',
        outputUrl: 'https://untrusted.example/avatar.png',
      }
      const response = {
        version: AVATAR_CONTRACT_VERSION,
        timestamp: Date.now(),
        requestId: call.data.requestId,
        operationKey: call.data.operationKey,
        ok: true,
        data,
        dataDigest: avatarDigest(data),
      }
      return { result: { ...response, signature: avatarSign(response, secret) } }
    },
  }, 'mip-ai-provider', secret, {
    avatarFunctionName: 'mip-ai-avatar-provider',
    avatarSecret: secret,
  })
  await assert.rejects(
    () => invalidProvider.generateDigitalAvatar(input),
    /DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID/,
  )
})
