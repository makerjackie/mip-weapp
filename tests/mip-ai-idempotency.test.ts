import type { UserId } from '../src/modules/mip'
import type { AiDraft, AiDraftId, MipAiGateway } from '../src/modules/mip-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMipAiGateway } from '../src/modules/mip-ai/cloudbase-gateway'
import { createMipAiModule } from '../src/modules/mip-ai/module'

const cloudHarness = vi.hoisted(() => ({ callFunction: vi.fn() }))

vi.mock('../src/platform/cloudbase/client', () => ({
  requireCloudClient: vi.fn(async () => ({ callFunction: cloudHarness.callFunction })),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { aiFunctionName: 'mip-ai-api' } },
}))

const draft: AiDraft = {
  id: '20000000-0000-4000-8000-000000000001' as AiDraftId,
  userId: '10000000-0000-4000-8000-000000000001' as UserId,
  purpose: 'PROFILE',
  status: 'DRAFT_READY',
  expiresAt: '2099-01-01T00:00:00.000Z',
  version: 2,
}

function gateway(overrides: Partial<MipAiGateway> = {}): MipAiGateway {
  return {
    getCapability: async () => ({ textDrafts: true, voiceDrafts: true, refinementDrafts: false, digitalAvatars: false }),
    listDrafts: async () => ({ items: [] }),
    getDraft: async () => draft,
    createTextDraft: async () => draft,
    createVoiceDraft: async () => draft,
    createVoiceDraftUpload: async () => draft,
    prepareVoiceUpload: async () => ({
      purpose: 'PROFILE',
      assetId: '30000000-0000-4000-8000-000000000001',
      objectKey: 'mip/development/a/ai/b/30000000-0000-4000-8000-000000000001.mp3',
      contentType: 'audio/mpeg',
      maximumContentBytes: 6 * 1024 * 1024,
    }),
    createVoiceDraftStorage: async () => draft,
    continueDraft: async () => draft,
    updateDraft: async () => draft,
    deleteDraft: async draftId => ({ draftId, status: 'DELETED' }),
    listDigitalAvatars: async () => ({ items: [] }),
    generateDigitalAvatar: async () => { throw new Error('not configured') },
    ...overrides,
  }
}

afterEach(() => {
  cloudHarness.callFunction.mockReset()
  vi.useRealTimers()
})

describe('MIP AI create idempotency', () => {
  it('adds a request id to every new-client create while preserving a stable caller id', async () => {
    const createTextDraft = vi.fn(async () => draft)
    const createVoiceDraft = vi.fn(async () => draft)
    const createVoiceDraftUpload = vi.fn(async () => draft)
    const module = createMipAiModule(gateway({ createTextDraft, createVoiceDraft, createVoiceDraftUpload }))

    await module.createTextDraft({ purpose: 'PROFILE', transcriptText: ' 资料 ' })
    await module.createVoiceDraft({ purpose: 'PROFILE', audioAssetId: '30000000-0000-4000-8000-000000000001' })
    await module.createVoiceDraftUpload({ purpose: 'PROFILE', audioBase64: 'SUQzAA==', contentType: 'audio/mpeg' })
    await module.createTextDraft({ purpose: 'PROFILE', transcriptText: '资料', requestId: 'ai-draft:stable-request' })

    for (const invocation of [createTextDraft, createVoiceDraft, createVoiceDraftUpload]) {
      expect(invocation.mock.calls[0][0].requestId).toMatch(/^[\w.:-]{8,128}$/)
    }
    expect(createTextDraft.mock.calls[1][0].requestId).toBe('ai-draft:stable-request')
  })

  it('retries transport loss only for keyed creates', async () => {
    vi.useFakeTimers()
    const api = createMipAiGateway('mip-ai-api')
    cloudHarness.callFunction
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ result: { ok: true, data: draft } })
    const keyed = api.createTextDraft({
      purpose: 'PROFILE',
      transcriptText: '资料',
      requestId: 'ai-draft:transport-retry',
    })
    await vi.runAllTimersAsync()
    await expect(keyed).resolves.toEqual(draft)
    expect(cloudHarness.callFunction).toHaveBeenCalledTimes(2)

    cloudHarness.callFunction.mockReset()
    cloudHarness.callFunction.mockRejectedValue(new Error('response lost'))
    await expect(
      api.createTextDraft({ purpose: 'PROFILE', transcriptText: 'legacy client' }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(cloudHarness.callFunction).toHaveBeenCalledTimes(1)
  })
})
