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
    reason: 'STORAGE_NOT_CONFIGURED',
  })
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
