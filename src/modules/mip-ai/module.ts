import type { AiDraftConfirmation, AiDraftId, AiTextDraftIntent, AiVoiceDraftIntent, AiVoiceUploadIntent, MipAiGateway } from './types'
import { confirmAiDraft } from './domain'

export function createMipAiModule(gateway: MipAiGateway) {
  return {
    getCapability: () => gateway.getCapability(),
    listDrafts: (cursor?: string, limit = 20) => gateway.listDrafts(cursor, Math.min(30, Math.max(1, limit))),
    getDraft: (draftId: AiDraftId) => gateway.getDraft(draftId),

    createTextDraft(intent: AiTextDraftIntent) {
      const transcriptText = intent.transcriptText.trim()
      if (!transcriptText || transcriptText.length > 8000) {
        throw new Error('请输入 1–8000 个字的原始内容')
      }
      return gateway.createTextDraft({ ...intent, transcriptText })
    },

    createVoiceDraft: (intent: AiVoiceDraftIntent) => gateway.createVoiceDraft(intent),
    createVoiceDraftUpload: (intent: AiVoiceUploadIntent) => gateway.createVoiceDraftUpload(intent),

    async updateDraft(confirmation: AiDraftConfirmation) {
      const current = await gateway.getDraft(confirmation.draftId)
      const normalized = confirmAiDraft(current, confirmation)
      return gateway.updateDraft({
        ...confirmation,
        editedDraft: normalized.structuredDraft,
      })
    },

    deleteDraft: (draftId: AiDraftId, expectedVersion: number) => gateway.deleteDraft(draftId, expectedVersion),
  }
}

export type MipAiModule = ReturnType<typeof createMipAiModule>
