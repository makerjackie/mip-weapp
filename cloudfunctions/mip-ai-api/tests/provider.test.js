'use strict'

const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const test = require('node:test')
const { createCloudAiProvider, normalizeProviderResult, providerPayload } = require('../lib/provider')

test('reports unavailable instead of creating a fake draft', async () => {
  const provider = createCloudAiProvider({}, '')
  assert.deepEqual(provider.capability(), {
    voiceDrafts: false,
    textDrafts: false,
    reason: 'PROVIDER_NOT_CONFIGURED',
  })
  await assert.rejects(() => provider.structureText({}), /AI_PROVIDER_UNAVAILABLE/)
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
  assert.equal(request.name, 'mip-ai-provider')
  assert.equal(
    request.data.signature,
    createHmac('sha256', secret).update(providerPayload(request.data)).digest('hex'),
  )
  assert.equal(Object.hasOwn(request.data, 'transcriptText'), true)
  assert.throws(() => normalizeProviderResult({ transcriptText: '', structuredDraft: {} }), /AI_PROVIDER_RESPONSE_INVALID/)
})
