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

export interface OpportunityTeamMember extends OpportunityAuthor {
  userKind: 'PLAYER'
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
  teamMembers: OpportunityTeamMember[]
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
  referralTarget?: OpportunityAuthor
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

export type PeopleKindFilter = 'ALL' | 'PLAYER' | 'GUEST'
export type PeopleSearchScope = 'GLOBAL' | 'PLAYER'

export interface PeopleFilter {
  scope?: PeopleSearchScope
  kind?: PeopleKindFilter
  keyword?: string
  branchId?: BranchId
  industryTagIds?: string[]
  abilityTagIds?: string[]
  cursor?: string
  limit?: number
}

export interface PublicProfileOrganization {
  name: string
  role?: string
}

export interface PublicPerson {
  profileRef: string
  isSelf: boolean
  userKind: 'PLAYER' | 'GUEST'
  joinedAt: string
  nickname?: string
  avatarUrl?: string
  identityStatus?: string
  headline?: string
  introduction?: string
  companies?: PublicProfileOrganization[]
  organizations?: PublicProfileOrganization[]
  primaryIndustry?: OpportunityTag
  abilities?: OpportunityTag[]
  primaryBranch?: { id: BranchId, name: string, cityName: string }
}

export interface PeoplePage {
  items: PublicPerson[]
  nextCursor?: string
}

export interface PublicProfileCooperationCard {
  id: string
  roleKey: CooperationRoleKey
  positioning: string
  targetSummary: string
  abilityScores: Record<string, number>
  status: 'PUBLISHED'
  publishedAt: string
}

export interface PublicProfileSuperCase {
  id: string
  projectName: string
  summary: string
  responsibility: string
  caseType?: string
  cityLabel?: string
  industryLabel?: string
  coverUrl?: string
  status: 'PUBLISHED'
  publishedAt: string
}

export interface PublicProfileOpportunity {
  id: OpportunityId
  title: string
  valueSummary: string
  targetSummary: string
  referralCount: number
  branchName?: string
  cityLabel?: string
  coverUrl?: string
  status: 'PUBLISHED'
  publishedAt: string
}

export interface PublicProfileAggregate {
  profile: PublicPerson
  cooperationCards: PublicProfileCooperationCard[]
  superCases: PublicProfileSuperCase[]
  opportunities: PublicProfileOpportunity[]
  interestActive: boolean
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
  teamProfileRefs?: string[]
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

export type ReceivedInteractionCategory = 'REFERRAL' | 'PROFILE_INTEREST' | 'VISITOR'
export type ReceivedInteractionStatus = 'ACTIVE' | 'CANCELLED'
export type ReceivedInterestSourceType = 'OPPORTUNITY' | 'COOPERATION_CARD' | 'SUPER_CASE' | 'PROFILE'

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

export interface ReceivedVisitor extends ReceivedInteractionBase {
  kind: 'VISITOR'
  visitCount: number
  lastVisitedAt: string
}

export type ReceivedInteraction = ReceivedReferral | ReceivedProfileInterest | ReceivedVisitor

export interface ReceivedInteractionPage {
  category: ReceivedInteractionCategory
  items: ReceivedInteraction[]
  unreadCount: number
  nextCursor?: string
}
