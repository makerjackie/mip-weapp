import type { BranchId, CooperationCardId, CooperationRoleKey } from '../mip'
import type { AiDraftSourceConfirmation } from '../mip-ai/types'

export type CooperationCardStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED'

export interface CooperationAuthor {
  profileRef: string
  nickname: string
  avatarUrl?: string
  headline?: string
  cityName?: string
  primaryIndustry?: CooperationTag
}

export interface CooperationTag {
  id: string
  key: string
  label: string
}

export interface CooperationTagGroup extends CooperationTag {
  options: CooperationTag[]
}

export interface CooperationCardSummary {
  id: CooperationCardId
  roleKey: CooperationRoleKey
  positioning: string
  targetSummary: string
  abilityScores: Record<string, number>
  status: CooperationCardStatus
  publishedAt: string
  author: CooperationAuthor
  mine: boolean
  version?: number
}

export interface CooperationCardDetail extends CooperationCardSummary {
  roleFields: Record<string, string | string[] | number>
  version: number
  interestActive: boolean
  canEdit: boolean
}

export interface CooperationCardDraft {
  id?: CooperationCardId
  expectedVersion?: number
  roleKey: CooperationRoleKey
  positioning: string
  targetSummary: string
  roleFields: Record<string, string | string[] | number>
  abilityScores: Record<string, number>
  publish: boolean
  aiConfirmation?: AiDraftSourceConfirmation
}

export interface CooperationCardPage {
  items: CooperationCardSummary[]
  nextCursor?: string
}

export interface CooperationCardFilter {
  keyword?: string
  branchId?: BranchId
  roleKey?: CooperationRoleKey
  industryTagIds?: string[]
  cursor?: string
  limit?: number
}

export interface CooperationCatalog {
  branches: Array<{ id: BranchId, name: string, cityName: string }>
  industryGroups: CooperationTagGroup[]
  industryTags: CooperationTag[]
}
