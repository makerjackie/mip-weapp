import type { BranchId, CooperationRoleKey, OpportunityId } from '../mip'

export type OpportunityStatus = 'DRAFT' | 'PUBLISHED' | 'ENDED' | 'UNPUBLISHED'
export type OpportunityStatusFilter = 'RECRUITING' | 'COMPLETED'

export interface OpportunityTag {
  id: string
  key: string
  label: string
}

export interface OpportunityTagGroup extends OpportunityTag {
  options: OpportunityTag[]
}

export interface OpportunityAuthor {
  profileRef: string
  nickname: string
  avatarUrl?: string
  headline?: string
}

export interface OpportunitySummary {
  id: OpportunityId
  title: string
  valueSummary: string
  targetSummary: string
  city?: OpportunityTag
  branchId?: BranchId
  branchName?: string
  coverUrl?: string
  roles: CooperationRoleKey[]
  industryTags: OpportunityTag[]
  abilityTags: OpportunityTag[]
  referralCount: number
  status: OpportunityStatus
  publishedAt: string
  author: OpportunityAuthor
  mine: boolean
}

export interface OpportunityDetail extends OpportunitySummary {
  description: string
  coverAssetId?: string
  version: number
  referralActive: boolean
  interestActive: boolean
  canEdit: boolean
}

export interface OpportunityFilter {
  status: OpportunityStatusFilter
  keyword?: string
  cityTagId?: string
  branchId?: BranchId
  roleKey?: CooperationRoleKey
  industryTagIds?: string[]
  abilityTagIds?: string[]
  cursor?: string
  limit?: number
}

export interface OpportunityPage {
  items: OpportunitySummary[]
  nextCursor?: string
}

export interface OpportunityCatalog {
  branches: Array<{ id: BranchId, name: string, cityName: string }>
  cityTags: OpportunityTag[]
  industryGroups: OpportunityTagGroup[]
  industryTags: OpportunityTag[]
  abilityTags: OpportunityTag[]
}

export interface OpportunityDraft {
  id?: OpportunityId
  expectedVersion?: number
  title: string
  valueSummary: string
  targetSummary: string
  description: string
  scopeType: 'PLATFORM' | 'BRANCH'
  branchId?: BranchId
  cityTagId?: string
  coverAssetId?: string
  roleKeys: CooperationRoleKey[]
  industryTagIds: string[]
  abilityTagIds: string[]
  publish: boolean
}

export interface OpportunityMutationResult {
  id: OpportunityId
  status: OpportunityStatus
  version: number
}

export interface OpportunityInteractionResult {
  active: boolean
  version: number
  referralCount?: number
}

export type ReceivedInteractionCategory = 'REFERRAL' | 'PROFILE_INTEREST'
export type ReceivedInteractionStatus = 'ACTIVE' | 'CANCELLED'
export type ReceivedInterestSourceType = 'OPPORTUNITY' | 'COOPERATION_CARD' | 'SUPER_CASE'

export interface ReceivedInteractionActor {
  profileRef: string
  nickname: string
  avatarUrl?: string
  headline?: string
}

interface ReceivedInteractionBase {
  status: ReceivedInteractionStatus
  actor: ReceivedInteractionActor
  messageId?: string
  unread: boolean
  updatedAt: string
}

export interface ReceivedReferral extends ReceivedInteractionBase {
  kind: 'REFERRAL'
  note?: string
  opportunity: {
    id: OpportunityId
    title: string
    status: OpportunityStatus
  }
}

export interface ReceivedProfileInterest extends ReceivedInteractionBase {
  kind: 'PROFILE_INTEREST'
  source: {
    type: ReceivedInterestSourceType
    label: string
    status: OpportunityStatus
  }
}

export type ReceivedInteraction = ReceivedReferral | ReceivedProfileInterest

export interface ReceivedInteractionPage {
  category: ReceivedInteractionCategory
  items: ReceivedInteraction[]
  unreadCount: number
  nextCursor?: string
}
