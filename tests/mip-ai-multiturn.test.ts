import type { UserId } from '../src/modules/mip'
import type { AiDraft, AiDraftId, MipAiGateway } from '../src/modules/mip-ai'
import { describe, expect, it, vi } from 'vitest'
import { createMipAiModule } from '../src/modules/mip-ai'

const draft: AiDraft = {
  id: '20000000-0000-4000-8000-000000000001' as AiDraftId,
  userId: '10000000-0000-4000-8000-000000000001' as UserId,
  purpose: 'PROFILE',
  status: 'DRAFT_READY',
  transcriptText: '第一轮内容',
  structuredDraft: { headline: '产品负责人' },
  expiresAt: '2099-01-01T00:00:00.000Z',
  version: 3,
}

function gateway(continueDraft: MipAiGateway['continueDraft']): MipAiGateway {
  return {
    getCapability: async () => ({
      textDrafts: true,
      voiceDrafts: true,
      refinementDrafts: true,
      digitalAvatars: false,
    }),
    listDrafts: async () => ({ items: [draft] }),
    getDraft: async () => draft,
    createTextDraft: async () => draft,
    createVoiceDraft: async () => draft,
    createVoiceDraftUpload: async () => draft,
    continueDraft,
    updateDraft: async () => draft,
    deleteDraft: async draftId => ({ draftId, status: 'DELETED' }),
    listDigitalAvatars: async () => ({ items: [] }),
    generateDigitalAvatar: async () => { throw new Error('数字分身未配置') },
  }
}

describe('MIP AI multi-turn drafts', () => {
  it('submits a normalized supplement against the current draft version', async () => {
    const continueDraft = vi.fn(async () => ({ ...draft, version: 5 }))
    const module = createMipAiModule(gateway(continueDraft))
    await expect(module.continueDraft({
      draftId: draft.id,
      expectedVersion: draft.version,
      supplementalText: ' 补充项目管理经历 ',
    })).resolves.toMatchObject({ version: 5 })
    expect(continueDraft).toHaveBeenCalledWith({
      draftId: draft.id,
      expectedVersion: draft.version,
      supplementalText: '补充项目管理经历',
    })
  })

  it('rejects an empty or oversized turn before calling the cloud function', async () => {
    const continueDraft = vi.fn(async () => draft)
    const module = createMipAiModule(gateway(continueDraft))
    expect(() => module.continueDraft({
      draftId: draft.id,
      expectedVersion: draft.version,
      supplementalText: ' ',
    })).toThrow('请输入 1–4000 个字的补充内容')
    expect(() => module.continueDraft({
      draftId: draft.id,
      expectedVersion: draft.version,
      supplementalText: 'a'.repeat(4001),
    })).toThrow('请输入 1–4000 个字的补充内容')
    expect(continueDraft).not.toHaveBeenCalled()
  })
})
