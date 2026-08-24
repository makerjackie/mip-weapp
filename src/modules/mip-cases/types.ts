import type { SuperCaseId } from '../mip'
import type { AiDraftSourceConfirmation } from '../mip-ai/types'

export type SuperCaseStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'

export interface SuperCaseSummary {
  id: SuperCaseId
  projectName: string
  summary: string
  responsibility: string
  cityLabel?: string
  industryLabel?: string
  caseType?: string
  coverUrl?: string
  status: SuperCaseStatus
  publishedAt: string
  author: { profileRef: string, nickname: string, avatarUrl?: string, headline?: string }
  mine: boolean
}

export interface SuperCaseDetail extends SuperCaseSummary {
  startedOn?: string
  endedOn?: string
  description: string
  media: Array<{ url: string, caption?: string }>
  coverAssetId?: string
  mediaAssetIds?: string[]
  version: number
  interestActive: boolean
  canEdit: boolean
}

export interface SuperCaseDraft {
  id?: SuperCaseId
  expectedVersion?: number
  projectName: string
  summary: string
  startedOn?: string
  endedOn?: string
  responsibility: string
  cityTagId?: string
  industryTagId?: string
  caseType?: string
  description: string
  coverAssetId?: string
  mediaAssetIds: string[]
  publish: boolean
  aiConfirmation?: AiDraftSourceConfirmation
}

export interface SuperCasePage {
  items: SuperCaseSummary[]
  nextCursor?: string
}
