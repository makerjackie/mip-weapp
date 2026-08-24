import type { AiDraftId, AiDraftPurpose } from './types'
import { mipAiModule } from './client'
import { requireAiEditorDraft } from './editor'

export async function loadAiEditorDraft(rawId: string, purpose: AiDraftPurpose) {
  const draftId = rawId.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)) {
    throw new Error('AI 草稿参数无效')
  }
  return requireAiEditorDraft(await mipAiModule.getDraft(draftId as AiDraftId), purpose)
}
