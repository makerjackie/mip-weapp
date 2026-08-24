'use strict'

const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const test = require('node:test')
const {
  createAiProviderAdapter,
  createCloudAiProvider,
  normalizeProviderResult,
  providerPayload,
} = require('../lib/provider')

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
  await assert.rejects(() => provider.refineDraft({}), /AI_PROVIDER_UNAVAILABLE/)
})

test('binds all refinement context while allowing a structured-only response', async () => {
  const secret = 'ai-provider-secret-that-is-longer-than-thirty-two'
  let request
  const provider = createCloudAiProvider({
    async callFunction(input) {
      request = input
      return {
        result: {
          ok: true,
          data: {
            structuredDraft: { headline: '更新后的标题' },
            providerJobKey: 'refine-job-private',
          },
        },
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
    createHmac('sha256', secret).update(providerPayload(request.data)).digest('hex'),
  )
  assert.notEqual(
    providerPayload({ ...request.data, supplementalText: '另一段内容' }),
    providerPayload(request.data),
  )
})

test('validates the configured provider response', async () => {
  const secret = 'ai-provider-secret-that-is-longer-than-thirty-two'
  let request
  const provider = createCloudAiProvider({
    async callFunction(input) {
      request = input
      return {
        result: {
          ok: true,
          data: {
            transcriptText: '产品与交付经验',
            structuredDraft: { headline: '产品负责人' },
            providerJobKey: 'provider-job-private',
          },
        },
      }
    },
  }, 'mip-ai-provider', secret)
  const result = await provider.structureText({
    appId: 'wx-app',
    draftId: '20000000-0000-4000-8000-000000000001',
    purpose: 'PROFILE',
    transcriptText: '产品与交付经验',
  })
  assert.equal(result.transcriptText, '产品与交付经验')
  assert.equal(provider.capability().digitalAvatars, false)
  assert.equal(request.name, 'mip-ai-provider')
  assert.equal(
    request.data.signature,
    createHmac('sha256', secret).update(providerPayload(request.data)).digest('hex'),
  )
  assert.equal(Object.hasOwn(request.data, 'transcriptText'), true)
  assert.throws(() => normalizeProviderResult({ transcriptText: '', structuredDraft: {} }), /AI_PROVIDER_RESPONSE_INVALID/)
})

test('binds digital-avatar source and style while accepting only the strict image result', async () => {
  const secret = 'ai-provider-secret-that-is-longer-than-thirty-two'
  let request
  const imageBase64 = Buffer.alloc(32, 7).toString('base64')
  const provider = createCloudAiProvider({
    async callFunction(input) {
      request = input
      return {
        result: {
          ok: true,
          data: {
            contentType: 'image/png',
            imageBase64,
            providerJobKey: 'avatar-job-private',
          },
        },
      }
    },
  }, 'mip-ai-provider', secret, { avatarFunctionName: 'mip-avatar-provider' })
  const result = await provider.generateDigitalAvatar({
    appId: 'wx-app',
    generationId: '20000000-0000-4000-8000-000000000001',
    styleKey: 'PROFESSIONAL',
    sourceImageFileId: 'cloud://env/mip/development/app/avatars/user/source.png',
    sourceContentSha256: 'a'.repeat(64),
    sourceContentType: 'image/png',
    sourceContentBytes: 1024,
    sourceWidth: 512,
    sourceHeight: 512,
  })
  assert.equal(result.imageBase64, imageBase64)
  assert.equal(request.data.action, 'generateDigitalAvatar')
  assert.equal(
    request.data.signature,
    createHmac('sha256', secret).update(providerPayload(request.data)).digest('hex'),
  )
  assert.notEqual(
    providerPayload({ ...request.data, styleKey: 'MONOCHROME' }),
    providerPayload(request.data),
  )
  const invalidProvider = createCloudAiProvider({
    async callFunction() {
      return {
        result: {
          ok: true,
          data: {
            contentType: 'image/png',
            imageBase64,
            providerJobKey: 'avatar-job-private',
            outputUrl: 'https://untrusted.example/avatar.png',
          },
        },
      }
    },
  }, 'mip-ai-provider', secret, { avatarFunctionName: 'mip-avatar-provider' })
  await assert.rejects(
    () => invalidProvider.generateDigitalAvatar(request.data),
    /DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID/,
  )
})
