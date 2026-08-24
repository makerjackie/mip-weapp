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

test('disables voice drafts when the private audio store is not configured', () => {
  const service = createAiService({
    repository: {},
    provider: { capability: () => ({ textDrafts: true, voiceDrafts: true }) },
    audioStore: { configured: false },
  })
  assert.deepEqual(service.getCapability(), {
    textDrafts: true,
    voiceDrafts: false,
    refinementDrafts: false,
    digitalAvatars: false,
    reason: 'STORAGE_NOT_CONFIGURED',
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

test('marks the private draft failed when provider processing fails', async () => {
  let failed = false
  const service = createAiService({
    repository: {
      async createTextDraft() { return draft },
      async failDraft() { failed = true },
    },
    provider: {
      capability: () => ({ textDrafts: true, voiceDrafts: false }),
      async structureText() { throw new Error('provider detail that must not escape') },
    },
  })
  await assert.rejects(() => service.createTextDraft(caller, {
    purpose: 'PROFILE',
    transcriptText: '资料内容',
  }), /AI_PROVIDER_UNAVAILABLE/)
  assert.equal(failed, true)
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

test('recovers a committed voice upload instead of deleting it after an uncertain commit result', async () => {
  let removeCalls = 0
  const created = {
    draft,
    asset: { cloud_file_id: uploadedAsset().cloudFileId, content_type: 'audio/mpeg', content_bytes: 4 },
  }
  const service = createAiService({
    repository: {
      async createVoiceDraftFromUpload() { throw new Error('COMMIT_RESULT_UNKNOWN') },
      async recoverVoiceDraftFromUpload() { return { state: 'COMMITTED', created } },
      async completeDraft() { return { ...draft, status: 'DRAFT_READY', version: 2 } },
      async failDraft() { throw new Error('unexpected failure') },
    },
    provider: {
      capability: () => ({ textDrafts: true, voiceDrafts: true }),
      async transcribeAndStructure() {
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
  }), /AI_PROVIDER_UNAVAILABLE/)
  assert.deepEqual(restored, [caller.appId, caller.userId, draft.id, 2])
  assert.equal(completed, false)
})
