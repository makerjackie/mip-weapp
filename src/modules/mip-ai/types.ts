import type { Brand, UserId } from '../mip'

export type AiDraftId = Brand<string, 'AiDraftId'>
export type AiDraftPurpose = 'PROFILE' | 'COOPERATION_CARD' | 'SUPER_CASE'
export type AiDraftStatus
  = | 'UPLOADED'
    | 'TRANSCRIBING'
    | 'STRUCTURING'
    | 'DRAFT_READY'
    | 'FAILED'
    | 'CONFIRMED'
    | 'EXPIRED'
    | 'DELETED'

export interface AiDraft {
  id: AiDraftId
  userId: UserId
  purpose: AiDraftPurpose
  status: AiDraftStatus
  transcriptText?: string
  structuredDraft?: Record<string, unknown>
  expiresAt: string
  version: number
}

export interface AiDraftConfirmation {
  draftId: AiDraftId
  expectedVersion: number
  editedDraft: Record<string, unknown>
}

export interface AiDraftSourceConfirmation {
  draftId: AiDraftId
  expectedVersion: number
}

export interface AiCapability {
  voiceDrafts: boolean
  textDrafts: boolean
  reason?: 'PROVIDER_NOT_CONFIGURED' | 'STORAGE_NOT_CONFIGURED'
}

export interface AiDraftPage {
  items: AiDraft[]
  nextCursor?: string
}

export interface AiTextDraftIntent {
  purpose: AiDraftPurpose
  transcriptText: string
}

export interface AiVoiceDraftIntent {
  purpose: AiDraftPurpose
  audioAssetId: string
}

export interface AiVoiceUploadIntent {
  purpose: AiDraftPurpose
  audioBase64: string
  contentType: 'audio/mpeg'
}

export interface MipAiGateway {
  getCapability: () => Promise<AiCapability>
  listDrafts: (cursor?: string, limit?: number) => Promise<AiDraftPage>
  getDraft: (draftId: AiDraftId) => Promise<AiDraft>
  createTextDraft: (intent: AiTextDraftIntent) => Promise<AiDraft>
  createVoiceDraft: (intent: AiVoiceDraftIntent) => Promise<AiDraft>
  createVoiceDraftUpload: (intent: AiVoiceUploadIntent) => Promise<AiDraft>
  updateDraft: (confirmation: AiDraftConfirmation) => Promise<AiDraft>
  deleteDraft: (draftId: AiDraftId, expectedVersion: number) => Promise<{ draftId: AiDraftId, status: 'DELETED' }>
}

export class MipAiError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'MipAiError'
    this.code = code
    this.retryable = retryable
  }
}
