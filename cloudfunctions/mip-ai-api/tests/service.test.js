'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createAiService } = require('../domain/service')

const caller = {
  appId: 'wx-app',
  userId: '10000000-0000-4000-8000-000000000001',
}
const draft = {
  id: '20000000-0000-4000-8000-000000000001',
  purpose: 'PROFILE',
  version: 1,
}

test('does not create a draft when the real provider is unavailable', async () => {
  let created = false
  const service = createAiService({
    repository: { async createTextDraft() { created = true } },
    provider: { capability: () => ({ textDrafts: false, voiceDrafts: false }) },
  })
  await assert.rejects(() => service.createTextDraft(caller, {
    purpose: 'PROFILE',
    transcriptText: '需要整理的资料',
  }), /AI_PROVIDER_UNAVAILABLE/)
  assert.equal(created, false)
})

test('disables voice drafts when the private audio store is not configured', async () => {
  const service = createAiService({
    repository: {},
    provider: { capability: () => ({ textDrafts: true, voiceDrafts: true }) },
    audioStore: { configured: false },
  })
  assert.deepEqual(await service.getCapability(), {
    textDrafts: true,
    voiceDrafts: false,
    refinementDrafts: false,
    digitalAvatars: false,
    reason: 'STORAGE_NOT_CONFIGURED',
  })
})

test('does not advertise draft actions until the configured Provider is ready', async () => {
  const service = createAiService({
    repository: {},
    provider: {
      capability: () => ({
        textDrafts: true,
        voiceDrafts: true,
        refinementDrafts: true,
        digitalAvatars: false,
      }),
      readiness: async () => false,
    },
    audioStore: { configured: true },
  })
  assert.deepEqual(await service.getCapability(), {
    textDrafts: false,
    voiceDrafts: false,
    refinementDrafts: false,
    digitalAvatars: false,
    reason: 'PROVIDER_NOT_CONFIGURED',
  })
})

test('degrades a readiness exception to unavailable capability without exposing it', async () => {
  const service = createAiService({
    repository: {},
    provider: {
      capability: () => ({
        textDrafts: true,
        voiceDrafts: true,
        refinementDrafts: true,
        digitalAvatars: false,
      }),
      async readiness() { throw new Error('private readiness failure') },
    },
    audioStore: { configured: true },
  })
  assert.deepEqual(await service.getCapability(), {
    textDrafts: false,
    voiceDrafts: false,
    refinementDrafts: false,
    digitalAvatars: false,
    reason: 'PROVIDER_NOT_CONFIGURED',
  })
})

test('does not advertise digital avatars until the isolated Provider readiness contract passes', async () => {
  const service = createAiService({
    repository: {},
    provider: {
      capability: () => ({
        textDrafts: false,
        voiceDrafts: false,
        refinementDrafts: false,
        digitalAvatars: true,
      }),
      avatarReadiness: async () => false,
    },
    avatarStore: { configured: true },
  })
  assert.deepEqual(await service.getCapability(), {
    textDrafts: false,
    voiceDrafts: false,
    refinementDrafts: false,
    digitalAvatars: false,
    reason: 'PROVIDER_NOT_CONFIGURED',
  })
})

test('validates the current owned profile avatar before provider generation and persists the output fact', async () => {
  const calls = []
  const generation = {
    id: '40000000-0000-4000-8000-000000000001',
    version: 1,
    status: 'PROCESSING',
  }
  const output = {
    assetId: '50000000-0000-4000-8000-000000000001',
    objectKey: 'mip/development/app/digital-avatars/user/output.png',
    cloudFileId: 'cloud://env/mip/development/app/digital-avatars/user/output.png',
    contentSha256: 'b'.repeat(64),
    contentType: 'image/png',
    contentBytes: 1024,
    width: 512,
    height: 512,
  }
  const repository = {
    async createAvatarGeneration(_appId, _userId, input) {
      calls.push(['source', input])
      return {
        generation,
        source: {
          cloudFileId: 'cloud://env/mip/development/app/avatars/user/source.png',
          contentSha256: 'a'.repeat(64),
          contentType: 'image/png',
          contentBytes: 2048,
          width: 512,
          height: 512,
        },
      }
    },
    async registerPendingAvatarOutput(_appId, asset) { calls.push(['pending', asset.assetId]) },
    async completeAvatarGeneration(_appId, _userId, generationId, version, asset, jobKey) {
      calls.push(['complete', generationId, version, asset.assetId, jobKey])
      return { ...generation, status: 'READY', version: 2, outputAssetId: asset.assetId }
    },
    async recoverAvatarGenerationOutput() { throw new Error('unexpected recovery') },
    async failAvatarGeneration() { throw new Error('unexpected failure') },
  }
  const service = createAiService({
    repository,
    provider: {
      capability: () => ({ digitalAvatars: true }),
      async generateDigitalAvatar(input) {
        calls.push(['provider', input.styleKey, input.sourceContentSha256])
        return {
          contentType: 'image/png',
          imageBase64: Buffer.alloc(32).toString('base64'),
          providerJobKey: 'private-avatar-job',
        }
      },
    },
    avatarStore: {
      configured: true,
      async store(input) {
        calls.push(['store', input.contentType])
        return output
      },
    },
  })
  const result = await service.generateDigitalAvatar(caller, {
    sourceAvatarAssetId: '30000000-0000-4000-8000-000000000001',
    styleKey: 'professional',
    requestId: 'digital-avatar:test-success',
  })
  assert.equal(result.status, 'READY')
  assert.deepEqual(calls.map(item => item[0]), ['source', 'provider', 'store', 'pending', 'complete'])
  assert.equal(calls[1][1], 'PROFESSIONAL')
})

test('records a failed generation without accepting a provider URL as output', async () => {
  let failedCode = ''
  const service = createAiService({
    repository: {
      async createAvatarGeneration() {
        return {
          generation: { id: '40000000-0000-4000-8000-000000000001', version: 1 },
          source: {
            cloudFileId: 'cloud://env/source.png',
            contentSha256: 'a'.repeat(64),
            contentType: 'image/png',
            contentBytes: 2048,
            width: 512,
            height: 512,
          },
        }
      },
      async failAvatarGeneration(_appId, _userId, _generationId, _version, code) {
        failedCode = code
        return true
      },
    },
    provider: {
      capability: () => ({ digitalAvatars: true }),
      async generateDigitalAvatar() { throw new Error('private provider response') },
    },
    avatarStore: { configured: true },
  })
  await assert.rejects(() => service.generateDigitalAvatar(caller, {
    sourceAvatarAssetId: '30000000-0000-4000-8000-000000000001',
    styleKey: 'MONOCHROME',
    requestId: 'digital-avatar:test-failure',
  }), /DIGITAL_AVATAR_PROVIDER_UNAVAILABLE/)
  assert.equal(failedCode, 'DIGITAL_AVATAR_PROVIDER_UNAVAILABLE')
})

test('replays a completed digital avatar request without calling the provider again', async () => {
  let providerCalls = 0
  const ready = {
    id: '40000000-0000-4000-8000-000000000001',
    version: 2,
    status: 'READY',
    outputAssetId: '50000000-0000-4000-8000-000000000001',
  }
  const service = createAiService({
    repository: {
      async createAvatarGeneration() {
        return { generation: ready, source: null, replayed: true }
      },
    },
    provider: {
      capability: () => ({ digitalAvatars: true }),
      async generateDigitalAvatar() { providerCalls += 1 },
    },
    avatarStore: { configured: true },
  })

  const result = await service.generateDigitalAvatar(caller, {
    sourceAvatarAssetId: '30000000-0000-4000-8000-000000000001',
    styleKey: 'PROFESSIONAL',
    requestId: 'digital-avatar:replay-ready',
  })
  assert.equal(result, ready)
  assert.equal(providerCalls, 0)
})

test('stores provider output as a draft instead of an official profile', async () => {
  let completed
  const repository = {
    async createTextDraft() { return draft },
    async completeDraft(...args) {
      completed = args
      return { ...draft, status: 'DRAFT_READY', version: 2, structuredDraft: args[4].structuredDraft }
    },
    async failDraft() { throw new Error('unexpected failure') },
  }
  const service = createAiService({
    repository,
    provider: {
      capability: () => ({ textDrafts: true, voiceDrafts: false }),
      async structureText() {
        return { transcriptText: '资料内容', structuredDraft: { headline: '产品负责人' } }
      },
    },
  })
  const result = await service.createTextDraft(caller, { purpose: 'PROFILE', transcriptText: '资料内容' })
  assert.equal(result.status, 'DRAFT_READY')
  assert.deepEqual(completed[4].structuredDraft, { headline: '产品负责人' })
  assert.equal(typeof repository.saveProfile, 'undefined')
})

test('marks the private draft failed only for an explicit invalid provider response', async () => {
  let failed = false
  const service = createAiService({
    repository: {
      async createTextDraft() { return draft },
      async failDraft() { failed = true },
    },
    provider: {
      capability: () => ({ textDrafts: true, voiceDrafts: false }),
      async structureText() { throw new Error('AI_PROVIDER_RESPONSE_INVALID') },
    },
  })
  await assert.rejects(() => service.createTextDraft(caller, {
    purpose: 'PROFILE',
    transcriptText: '资料内容',
  }), /AI_PROVIDER_RESPONSE_INVALID/)
  assert.equal(failed, true)
})

test('keeps the private draft processing when the provider result is unknown', async () => {
  let failed = false
  const service = createAiService({
    repository: {
      async createTextDraft() { return draft },
      async failDraft() { failed = true },
    },
    provider: {
      capability: () => ({ textDrafts: true, voiceDrafts: false }),
      async structureText() { throw new Error('transport timeout detail') },
    },
  })
  await assert.rejects(() => service.createTextDraft(caller, {
    purpose: 'PROFILE',
    transcriptText: '资料内容',
  }), /AI_PROVIDER_RESULT_UNKNOWN/)
  assert.equal(failed, false)
})

test('does not disguise a post-provider ownership fence as a provider error', async () => {
  let failed = false
  const service = createAiService({
    repository: {
      async createTextDraft() { return draft },
      async completeDraft() { throw new Error('FORBIDDEN') },
      async failDraft() { failed = true },
    },
    provider: {
      capability: () => ({ textDrafts: true, voiceDrafts: false }),
      async structureText() {
        return { transcriptText: '资料内容', structuredDraft: { headline: '产品负责人' } }
      },
    },
  })
  await assert.rejects(() => service.createTextDraft(caller, {
    purpose: 'PROFILE',
    transcriptText: '资料内容',
  }), /FORBIDDEN/)
  assert.equal(failed, false)
})

test('claims and completes a keyed text request around the existing draft write', async () => {
  const calls = []
  const ready = { ...draft, status: 'DRAFT_READY', version: 2 }
  const service = createAiService({
    repository: {
      async claimDraftRequest(_appId, _userId, input) {
        calls.push(['claim', input.kind, input.requestId, input.inputHash])
        return { state: 'CLAIMED', requestId: input.requestId, leaseToken: '30000000-0000-4000-8000-000000000001', draft }
      },
      async completeKeyedDraft(_appId, _userId, input) {
        calls.push(['atomic-complete', input.requestId, input.inputHash, input.leaseToken])
        return ready
      },
      async recoverCompletedDraftRequest() { throw new Error('unexpected recovery') },
      async failDraft() { throw new Error('unexpected failure') },
      async failDraftRequest() { throw new Error('unexpected failure') },
    },
    provider: {
      capability: () => ({ textDrafts: true }),
      async structureText() {
        calls.push(['provider'])
        return { transcriptText: '资料内容', structuredDraft: { headline: '产品负责人' } }
      },
    },
  })
  const result = await service.createTextDraft(caller, {
    purpose: 'PROFILE',
    transcriptText: '资料内容',
    requestId: 'ai-draft:text-one',
  })
  assert.equal(result, ready)
  assert.deepEqual(calls.map(item => item[0]), ['claim', 'provider', 'atomic-complete'])
  assert.match(calls[0][3], /^[0-9a-f]{64}$/)
  assert.equal(calls[0][3], calls[2][2])
  assert.equal(calls[2][3], '30000000-0000-4000-8000-000000000001')
})

test('replays a completed keyed draft without calling the provider', async () => {
  let providerCalls = 0
  const ready = { ...draft, status: 'DRAFT_READY', version: 2 }
  const service = createAiService({
    repository: {
      async claimDraftRequest() { return { state: 'REPLAY', response: ready } },
    },
    provider: {
      capability: () => ({ textDrafts: true }),
      async structureText() { providerCalls += 1 },
    },
  })
  assert.equal(await service.createTextDraft(caller, {
    purpose: 'PROFILE',
    transcriptText: '资料内容',
    requestId: 'ai-draft:replay-one',
  }), ready)
  assert.equal(providerCalls, 0)
})

test('reuses the same draft operation after an unknown keyed provider result', async () => {
  const providerInputs = []
  let claimCount = 0
  let failedDraft = false
  let failedRequest = false
  const ready = { ...draft, status: 'DRAFT_READY', version: 2 }
  const service = createAiService({
    repository: {
      async claimDraftRequest(_appId, _userId, input) {
        claimCount += 1
        return {
          state: claimCount === 1 ? 'CLAIMED' : 'RESUMED',
          requestId: input.requestId,
          leaseToken: claimCount === 1
            ? '30000000-0000-4000-8000-000000000001'
            : '30000000-0000-4000-8000-000000000002',
          draft,
        }
      },
      async failDraft() { failedDraft = true },
      async failDraftRequest() { failedRequest = true },
      async completeKeyedDraft() { return ready },
      async recoverCompletedDraftRequest() { return null },
    },
    provider: {
      capability: () => ({ textDrafts: true }),
      async structureText(input) {
        providerInputs.push(input)
        if (providerInputs.length === 1) throw new Error('AI_PROVIDER_RESULT_UNKNOWN')
        return { transcriptText: '资料内容', structuredDraft: { headline: '产品负责人' } }
      },
    },
  })
  const event = {
    purpose: 'PROFILE',
    transcriptText: '资料内容',
    requestId: 'ai-draft:resume-unknown',
  }
  await assert.rejects(() => service.createTextDraft(caller, event), /AI_PROVIDER_RESULT_UNKNOWN/)
  assert.equal(await service.createTextDraft(caller, event), ready)
  assert.deepEqual(providerInputs.map(input => [input.draftId, input.expectedVersion]), [
    [draft.id, draft.version],
    [draft.id, draft.version],
  ])
  assert.equal(failedDraft, false)
  assert.equal(failedRequest, false)
})

test('fences a terminal keyed provider failure with the same request lease', async () => {
  let failureInput
  const service = createAiService({
    repository: {
      async claimDraftRequest(_appId, _userId, input) {
        return {
          state: 'CLAIMED',
          requestId: input.requestId,
          leaseToken: '30000000-0000-4000-8000-000000000001',
          draft,
        }
      },
      async failKeyedDraft(_appId, _userId, input, code) {
        failureInput = { ...input, code }
        return true
      },
      async failDraft() { throw new Error('unfenced failure path') },
    },
    provider: {
      capability: () => ({ textDrafts: true }),
      async structureText() { throw new Error('AI_PROVIDER_REJECTED') },
    },
  })
  await assert.rejects(() => service.createTextDraft(caller, {
    purpose: 'PROFILE',
    transcriptText: '资料内容',
    requestId: 'ai-draft:terminal-failure',
  }), /AI_PROVIDER_REJECTED/)
  assert.deepEqual(failureInput, {
    requestId: 'ai-draft:terminal-failure',
    inputHash: failureInput.inputHash,
    leaseToken: '30000000-0000-4000-8000-000000000001',
    draftId: draft.id,
    expectedVersion: draft.version,
    code: 'AI_PROVIDER_REJECTED',
  })
  assert.match(failureInput.inputHash, /^[0-9a-f]{64}$/)
})

test('rereads a keyed request when the request completion result is unknown', async () => {
  const ready = { ...draft, status: 'DRAFT_READY', version: 2 }
  let recoveryInput
  const service = createAiService({
    repository: {
      async claimDraftRequest(_appId, _userId, input) {
        return { state: 'CLAIMED', requestId: input.requestId, leaseToken: '30000000-0000-4000-8000-000000000001', draft }
      },
      async completeKeyedDraft() { throw new Error('COMMIT_RESULT_UNKNOWN') },
      async recoverCompletedDraftRequest(_appId, _userId, input) { recoveryInput = input; return ready },
    },
    provider: {
      capability: () => ({ textDrafts: true }),
      async structureText() {
        return { transcriptText: '资料内容', structuredDraft: { headline: '产品负责人' } }
      },
    },
  })
  assert.equal(await service.createTextDraft(caller, {
    purpose: 'PROFILE',
    transcriptText: '资料内容',
    requestId: 'ai-draft:unknown-complete',
  }), ready)
  assert.equal(recoveryInput.requestId, 'ai-draft:unknown-complete')
})

test('does not turn a draft-only completion into a request replay', async () => {
  const service = createAiService({
    repository: {
      async claimDraftRequest(_appId, _userId, input) {
        return { state: 'CLAIMED', requestId: input.requestId, leaseToken: '30000000-0000-4000-8000-000000000001', draft }
      },
      async completeKeyedDraft() { throw new Error('COMMIT_RESULT_UNKNOWN') },
      async recoverCompletedDraftRequest() { return null },
    },
    provider: {
      capability: () => ({ textDrafts: true }),
      async structureText() {
        return { transcriptText: '资料内容', structuredDraft: { headline: '产品负责人' } }
      },
    },
  })
  await assert.rejects(() => service.createTextDraft(caller, {
    purpose: 'PROFILE',
    transcriptText: '资料内容',
    requestId: 'ai-draft:unknown-draft',
  }), /COMMIT_RESULT_UNKNOWN/)
})

function voiceUploadEvent() {
  return {
    purpose: 'PROFILE',
    audioBase64: 'SUQzAA==',
    contentType: 'audio/mpeg',
  }
}

function uploadedAsset() {
  return {
    assetId: '30000000-0000-4000-8000-000000000001',
    objectKey: 'mip/development/app/ai/user/30000000-0000-4000-8000-000000000001.mp3',
    cloudFileId: 'cloud://env/mip/development/app/ai/user/30000000-0000-4000-8000-000000000001.mp3',
    contentSha256: 'a'.repeat(64),
    contentType: 'audio/mpeg',
    contentBytes: 4,
  }
}

test('claims a keyed voice upload and persists its allocation before uploading bytes', async () => {
  const calls = []
  const asset = uploadedAsset()
  const ready = { ...draft, status: 'DRAFT_READY', version: 2 }
  const created = {
    draft,
    asset: {
      cloud_file_id: asset.cloudFileId,
      content_sha256: asset.contentSha256,
      content_type: asset.contentType,
      content_bytes: asset.contentBytes,
    },
  }
  const service = createAiService({
    repository: {
      async claimDraftRequest(_appId, _userId, input) {
        calls.push(['claim', input.allocation.assetId, input.allocation.objectKey])
        return {
          state: 'CLAIMED',
          requestId: input.requestId,
          leaseToken: '40000000-0000-4000-8000-000000000001',
          draftId: draft.id,
          allocation: input.allocation,
        }
      },
      async createVoiceDraftFromUpload(_appId, _userId, stored, _purpose, draftId) {
        calls.push(['persist', stored.assetId, draftId])
        return created
      },
      async completeKeyedDraft() { return ready },
      async recoverCompletedDraftRequest() { throw new Error('unexpected recovery') },
      async recoverVoiceDraftFromUpload() { throw new Error('unexpected recovery') },
    },
    provider: {
      capability: () => ({ voiceDrafts: true }),
      async transcribeAndStructure() {
        calls.push(['provider'])
        return { transcriptText: '资料', structuredDraft: { headline: '产品负责人' } }
      },
    },
    audioStore: {
      configured: true,
      preallocate() {
        calls.push(['preallocate'])
        return { assetId: asset.assetId, objectKey: asset.objectKey }
      },
      async store(input) {
        calls.push(['upload', input.assetId, input.objectKey])
        return asset
      },
    },
  })
  assert.equal(await service.createVoiceDraftUpload(caller, {
    ...voiceUploadEvent(),
    requestId: 'ai-draft:voice-upload',
  }), ready)
  assert.deepEqual(calls.map(item => item[0]), ['preallocate', 'claim', 'upload', 'persist', 'provider'])
  assert.deepEqual(calls[1].slice(1), [asset.assetId, asset.objectKey])
  assert.deepEqual(calls[2].slice(1), [asset.assetId, asset.objectKey])
  assert.equal(calls[3][2], draft.id)
})

test('claims an owned keyed voice asset before provider processing', async () => {
  const asset = uploadedAsset()
  const ready = { ...draft, status: 'DRAFT_READY', version: 2 }
  let claimInput
  let providerInput
  const service = createAiService({
    repository: {
      async claimDraftRequest(_appId, _userId, input) {
        claimInput = input
        return {
          state: 'CLAIMED',
          requestId: input.requestId,
          leaseToken: '40000000-0000-4000-8000-000000000001',
          draft,
          asset: {
            cloud_file_id: asset.cloudFileId,
            content_sha256: asset.contentSha256,
            content_type: asset.contentType,
            content_bytes: asset.contentBytes,
          },
        }
      },
      async completeKeyedDraft() { return ready },
      async recoverCompletedDraftRequest() { throw new Error('unexpected recovery') },
    },
    provider: {
      capability: () => ({ voiceDrafts: true }),
      async transcribeAndStructure(input) {
        providerInput = input
        return { transcriptText: '资料', structuredDraft: { headline: '产品负责人' } }
      },
    },
  })
  assert.equal(await service.createVoiceDraft(caller, {
    purpose: 'PROFILE',
    audioAssetId: asset.assetId,
    requestId: 'ai-draft:voice-asset',
  }), ready)
  assert.equal(claimInput.kind, 'VOICE_ASSET')
  assert.equal(claimInput.audioAssetId, asset.assetId)
  assert.equal(providerInput.audioFileId, asset.cloudFileId)
})

test('keeps a keyed voice request processing when upload completion is unknown', async () => {
  let failedRequest = false
  const asset = uploadedAsset()
  const service = createAiService({
    repository: {
      async claimDraftRequest(_appId, _userId, input) {
        return {
          state: 'CLAIMED',
          requestId: input.requestId,
          leaseToken: '40000000-0000-4000-8000-000000000001',
          draftId: draft.id,
          allocation: input.allocation,
        }
      },
      async failDraftRequest() { failedRequest = true },
    },
    provider: { capability: () => ({ voiceDrafts: true }) },
    audioStore: {
      configured: true,
      preallocate: () => ({ assetId: asset.assetId, objectKey: asset.objectKey }),
      async store() { throw new Error('cloud transport timeout') },
    },
  })
  await assert.rejects(() => service.createVoiceDraftUpload(caller, {
    ...voiceUploadEvent(),
    requestId: 'ai-draft:upload-unknown',
  }), /AI_AUDIO_UPLOAD_RESULT_UNKNOWN/)
  assert.equal(failedRequest, false)
})

test('does not delete uploaded bytes when database registration is unknown', async () => {
  let removed = false
  let failedRequest = false
  const asset = uploadedAsset()
  const service = createAiService({
    repository: {
      async claimDraftRequest(_appId, _userId, input) {
        return {
          state: 'CLAIMED',
          requestId: input.requestId,
          leaseToken: '40000000-0000-4000-8000-000000000001',
          draftId: draft.id,
          allocation: input.allocation,
        }
      },
      async createVoiceDraftFromUpload() { throw new Error('COMMIT_RESULT_UNKNOWN') },
      async recoverVoiceDraftFromUpload() { return { state: 'UNKNOWN' } },
      async registerPendingAudioUpload() { throw new Error('DB_RESULT_UNKNOWN') },
      async failDraftRequest() { failedRequest = true },
    },
    provider: { capability: () => ({ voiceDrafts: true }) },
    audioStore: {
      configured: true,
      preallocate: () => ({ assetId: asset.assetId, objectKey: asset.objectKey }),
      async store() { return asset },
      async remove() { removed = true; return true },
    },
  })
  await assert.rejects(() => service.createVoiceDraftUpload(caller, {
    ...voiceUploadEvent(),
    requestId: 'ai-draft:db-unknown',
  }), /AI_AUDIO_UPLOAD_RESULT_UNKNOWN/)
  assert.equal(removed, false)
  assert.equal(failedRequest, false)
})

test('recovers a committed voice upload instead of deleting it after an uncertain commit result', async () => {
  let removeCalls = 0
  const created = {
    draft,
    asset: {
      cloud_file_id: uploadedAsset().cloudFileId,
      content_sha256: uploadedAsset().contentSha256,
      content_type: 'audio/mpeg',
      content_bytes: 4,
    },
  }
  let providerInput
  const service = createAiService({
    repository: {
      async createVoiceDraftFromUpload() { throw new Error('COMMIT_RESULT_UNKNOWN') },
      async recoverVoiceDraftFromUpload() { return { state: 'COMMITTED', created } },
      async completeDraft() { return { ...draft, status: 'DRAFT_READY', version: 2 } },
      async failDraft() { throw new Error('unexpected failure') },
    },
    provider: {
      capability: () => ({ textDrafts: true, voiceDrafts: true }),
      async transcribeAndStructure(input) {
        providerInput = input
        return { transcriptText: '资料', structuredDraft: { headline: '产品负责人' } }
      },
    },
    audioStore: {
      configured: true,
      async store() { return uploadedAsset() },
      async remove() { removeCalls += 1; return true },
    },
  })
  const result = await service.createVoiceDraftUpload(caller, voiceUploadEvent())
  assert.equal(result.status, 'DRAFT_READY')
  assert.equal(removeCalls, 0)
  assert.equal(providerInput.expectedVersion, draft.version)
  assert.equal(providerInput.audioContentSha256, uploadedAsset().contentSha256)
  assert.equal(providerInput.audioContentBytes, 4)
  assert.equal(providerInput.audioContentType, 'audio/mpeg')
})

test('keeps a PENDING voice cleanup fact when closure wins and deletion fails', async () => {
  let marked = false
  const service = createAiService({
    repository: {
      async createVoiceDraftFromUpload() { throw new Error('FORBIDDEN') },
      async recoverVoiceDraftFromUpload() { return { state: 'PENDING' } },
      async markPendingAudioUploadDeleted() { marked = true },
    },
    provider: { capability: () => ({ textDrafts: true, voiceDrafts: true }) },
    audioStore: {
      configured: true,
      async store() { return uploadedAsset() },
      async remove() { return false },
    },
  })
  await assert.rejects(() => service.createVoiceDraftUpload(caller, voiceUploadEvent()), /FORBIDDEN/)
  assert.equal(marked, false)
})

test('marks a failed voice tombstone DELETED only after exact storage deletion succeeds', async () => {
  let marked = false
  const service = createAiService({
    repository: {
      async createVoiceDraftFromUpload() { throw new Error('FORBIDDEN') },
      async recoverVoiceDraftFromUpload() { return { state: 'PENDING' } },
      async markPendingAudioUploadDeleted() { marked = true; return true },
    },
    provider: { capability: () => ({ textDrafts: true, voiceDrafts: true }) },
    audioStore: {
      configured: true,
      async store() { return uploadedAsset() },
      async remove() { return true },
    },
  })
  await assert.rejects(() => service.createVoiceDraftUpload(caller, voiceUploadEvent()), /FORBIDDEN/)
  assert.equal(marked, true)
})

test('supports consecutive refinement turns without writing an official resource', async () => {
  let current = {
    ...draft,
    status: 'DRAFT_READY',
    transcriptText: '第一轮内容',
    structuredDraft: { headline: '原标题' },
  }
  const repository = {
    async beginDraftRefinement(_appId, _userId, input) {
      assert.equal(input.expectedVersion, current.version)
      current = { ...current, status: 'STRUCTURING', version: current.version + 1 }
      return current
    },
    async completeDraft(_appId, _userId, _draftId, expectedVersion, result) {
      assert.equal(expectedVersion, current.version)
      current = {
        ...current,
        status: 'DRAFT_READY',
        transcriptText: result.transcriptText,
        structuredDraft: result.structuredDraft,
        version: current.version + 1,
      }
      return current
    },
    async getDraft() { return current },
    async restoreDraftAfterRefinement() { throw new Error('unexpected restore') },
  }
  const turns = []
  const service = createAiService({
    repository,
    provider: {
      capability: () => ({ textDrafts: true, voiceDrafts: true, refinementDrafts: true }),
      async refineDraft(input) {
        turns.push(input)
        return {
          structuredDraft: { headline: input.supplementalText },
          providerJobKey: `job-${turns.length}`,
        }
      },
    },
  })
  const second = await service.continueDraft(caller, {
    draftId: draft.id,
    expectedVersion: 1,
    supplementalText: '第二轮内容',
  })
  const third = await service.continueDraft(caller, {
    draftId: draft.id,
    expectedVersion: second.version,
    supplementalText: '第三轮内容',
  })
  assert.equal(third.version, 5)
  assert.equal(third.transcriptText, '第一轮内容\n\n第二轮内容\n\n第三轮内容')
  assert.deepEqual(third.structuredDraft, { headline: '第三轮内容' })
  assert.deepEqual(turns[1].currentStructuredDraft, { headline: '第二轮内容' })
  assert.equal(typeof repository.saveProfile, 'undefined')
})

test('restores the last ready draft when refinement provider processing fails', async () => {
  let restored
  let completed = false
  const service = createAiService({
    repository: {
      async beginDraftRefinement() {
        return {
          ...draft,
          status: 'STRUCTURING',
          version: 2,
          transcriptText: '原内容',
          structuredDraft: { headline: '原标题' },
        }
      },
      async restoreDraftAfterRefinement(...args) { restored = args; return true },
      async completeDraft() { completed = true },
    },
    provider: {
      capability: () => ({ textDrafts: true, voiceDrafts: true, refinementDrafts: true }),
      async refineDraft() { throw new Error('private provider failure') },
    },
  })
  await assert.rejects(() => service.continueDraft(caller, {
    draftId: draft.id,
    expectedVersion: 1,
    supplementalText: '补充内容',
  }), /AI_PROVIDER_RESULT_UNKNOWN/)
  assert.deepEqual(restored, [caller.appId, caller.userId, draft.id, 2])
  assert.equal(completed, false)
})
