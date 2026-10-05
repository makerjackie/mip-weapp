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

export interface CooperationCircleEntry { name?: string, identity?: string, years?: string, trait?: string }

export interface CooperationQuirkEntry { external?: string, internal?: string, advice?: string }

export type CooperationRoleFieldValue = string | number | Array<string | CooperationCircleEntry | CooperationQuirkEntry>

export interface CooperationCardDetail extends CooperationCardSummary {
  roleFields: Record<string, CooperationRoleFieldValue>
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
  roleFields: Record<string, CooperationRoleFieldValue>
  abilityScores: Record<string, number>
  publish: boolean
  aiConfirmation?: AiDraftSourceConfirmation
}

export interface CooperationCardPage {
  items: CooperationCardSummary[]
  nextCursor?: string
}

export interface CooperationTalentCard {
  id: CooperationCardId
  roleKey: CooperationRoleKey
  positioning: string
  targetSummary: string
  abilityScores: Record<string, number>
  publishedAt: string
}

export interface CooperationTalentSummary {
  talentKey: string
  profileRef: string
  author: Omit<CooperationAuthor, 'profileRef'>
  joinedAt: string
  cards: CooperationTalentCard[]
}

export interface CooperationTalentPage {
  items: CooperationTalentSummary[]
  nextCursor?: string
}

export interface CooperationCardFilter {
  keyword?: string
  branchId?: BranchId
  roleKey?: CooperationRoleKey
  industryTagIds?: string[]
  abilityTagIds?: string[]
  cursor?: string
  limit?: number
}

export interface CooperationCatalog {
  branches: Array<{ id: BranchId, name: string, cityName: string }>
  industryGroups: CooperationTagGroup[]
  industryTags: CooperationTag[]
}
