import type { Brand, UserId } from '../mip'

export type AiDraftId = Brand<string, 'AiDraftId'>
export type AiDraftPurpose = 'PROFILE' | 'COOPERATION_CARD' | 'SUPER_CASE' | 'OPPORTUNITY'

export interface AiOpportunityDraftFields {
  title?: string
  valueSummary?: string
  cityLabel?: string
  targetSummary?: string
  description?: string
}
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
  refinementDrafts: boolean
  digitalAvatars: boolean
  reason?: 'PROVIDER_NOT_CONFIGURED' | 'STORAGE_NOT_CONFIGURED'
}

export const digitalAvatarStyles = [
  { key: 'PROFESSIONAL', label: '职业形象', description: '适合个人资料和合作名片' },
  { key: 'ILLUSTRATED', label: '插画形象', description: '保留人物特征的插画风格' },
  { key: 'MONOCHROME', label: '黑白形象', description: '黑白、高对比度的人像风格' },
] as const

export type DigitalAvatarStyleKey = (typeof digitalAvatarStyles)[number]['key']
export type DigitalAvatarGenerationId = Brand<string, 'DigitalAvatarGenerationId'>
export type DigitalAvatarGenerationStatus = 'PROCESSING' | 'READY' | 'FAILED'

export interface DigitalAvatarGeneration {
  id: DigitalAvatarGenerationId
  sourceAvatarAssetId: string
  styleKey: DigitalAvatarStyleKey
  status: DigitalAvatarGenerationStatus
  outputAssetId?: string
  outputUrl?: string
  failureCode?: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface DigitalAvatarGenerationIntent {
  sourceAvatarAssetId: string
  styleKey: DigitalAvatarStyleKey
  requestId: string
}

export interface DigitalAvatarGenerationPage {
  items: DigitalAvatarGeneration[]
}

export interface AiDraftPage {
  items: AiDraft[]
  nextCursor?: string
}

export interface AiTextDraftIntent {
  purpose: AiDraftPurpose
  transcriptText: string
  requestId?: string
}

export interface AiVoiceDraftIntent {
  purpose: AiDraftPurpose
  audioAssetId: string
  requestId?: string
}

export interface AiVoiceUploadIntent {
  purpose: AiDraftPurpose
  audioBase64: string
  contentType: 'audio/mpeg'
  requestId?: string
}

export interface AiDraftRefinementIntent {
  draftId: AiDraftId
  expectedVersion: number
  supplementalText: string
}

export interface MipAiGateway {
  getCapability: () => Promise<AiCapability>
  listDrafts: (cursor?: string, limit?: number) => Promise<AiDraftPage>
  getDraft: (draftId: AiDraftId) => Promise<AiDraft>
  createTextDraft: (intent: AiTextDraftIntent) => Promise<AiDraft>
  createVoiceDraft: (intent: AiVoiceDraftIntent) => Promise<AiDraft>
  createVoiceDraftUpload: (intent: AiVoiceUploadIntent) => Promise<AiDraft>
  continueDraft: (intent: AiDraftRefinementIntent) => Promise<AiDraft>
  updateDraft: (confirmation: AiDraftConfirmation) => Promise<AiDraft>
  deleteDraft: (draftId: AiDraftId, expectedVersion: number) => Promise<{ draftId: AiDraftId, status: 'DELETED' }>
  listDigitalAvatars: (limit?: number) => Promise<DigitalAvatarGenerationPage>
  generateDigitalAvatar: (intent: DigitalAvatarGenerationIntent) => Promise<DigitalAvatarGeneration>
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
