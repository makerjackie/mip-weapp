import type {
  AiDraftConfirmation,
  AiDraftId,
  AiDraftRefinementIntent,
  AiTextDraftIntent,
  AiVoiceDraftIntent,
  AiVoiceUploadIntent,
  DigitalAvatarGenerationIntent,
  MipAiGateway,
} from './types'
import { createIntentKey } from '../mip-shell/presentation'
import { confirmAiDraft } from './domain'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const digitalAvatarStyleKeys = new Set(['PROFESSIONAL', 'ILLUSTRATED', 'MONOCHROME'])

function downloadImage(url: string) {
  return new Promise<string>((resolve, reject) => {
    wx.downloadFile({
      url,
      success: result => result.statusCode >= 200 && result.statusCode < 300 && result.tempFilePath
        ? resolve(result.tempFilePath)
        : reject(new Error('数字分身下载失败')),
      fail: reject,
    })
  })
}

function saveImage(filePath: string) {
  return new Promise<void>((resolve, reject) => {
    wx.saveImageToPhotosAlbum({ filePath, success: () => resolve(), fail: reject })
  })
}

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
      return gateway.createTextDraft({
        ...intent,
        transcriptText,
        requestId: intent.requestId || createIntentKey('ai-draft-text'),
      })
    },

    createVoiceDraft: (intent: AiVoiceDraftIntent) => gateway.createVoiceDraft({
      ...intent,
      requestId: intent.requestId || createIntentKey('ai-draft-voice'),
    }),
    createVoiceDraftUpload: (intent: AiVoiceUploadIntent) => gateway.createVoiceDraftUpload({
      ...intent,
      requestId: intent.requestId || createIntentKey('ai-draft-upload'),
    }),

    continueDraft(intent: AiDraftRefinementIntent) {
      const supplementalText = intent.supplementalText.trim()
      if (!Number.isInteger(intent.expectedVersion) || intent.expectedVersion < 1
        || !supplementalText || supplementalText.length > 4000) {
        throw new Error('请输入 1–4000 个字的补充内容')
      }
      return gateway.continueDraft({ ...intent, supplementalText })
    },

    async updateDraft(confirmation: AiDraftConfirmation) {
      const current = await gateway.getDraft(confirmation.draftId)
      const normalized = confirmAiDraft(current, confirmation)
      return gateway.updateDraft({
        ...confirmation,
        editedDraft: normalized.structuredDraft,
      })
    },

    deleteDraft: (draftId: AiDraftId, expectedVersion: number) => gateway.deleteDraft(draftId, expectedVersion),

    listDigitalAvatars: (limit = 12) => gateway.listDigitalAvatars(Math.min(20, Math.max(1, limit))),

    generateDigitalAvatar(intent: DigitalAvatarGenerationIntent) {
      if (!uuidPattern.test(intent.sourceAvatarAssetId)
        || !digitalAvatarStyleKeys.has(intent.styleKey)
        || !/^[\w.:-]{8,128}$/.test(intent.requestId)) {
        throw new Error('数字分身生成参数无效')
      }
      return gateway.generateDigitalAvatar(intent)
    },

    async saveDigitalAvatar(outputUrl: string) {
      if (!outputUrl || /^cloud:\/\//.test(outputUrl) || /^http:\/\//.test(outputUrl)) {
        throw new Error('数字分身文件不可用')
      }
      const filePath = /^https:\/\//.test(outputUrl) ? await downloadImage(outputUrl) : outputUrl
      await saveImage(filePath)
    },
  }
}

export type MipAiModule = ReturnType<typeof createMipAiModule>
