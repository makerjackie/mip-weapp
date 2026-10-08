import type { BranchId, CooperationCardId, CooperationRoleKey } from '../mip'
import type { AiDraftSourceConfirmation } from '../mip-ai/types'

export type CooperationCardStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED'

/** 成长等级（服务端 loadPublicLevel 同口径；无成长账户或配置不完整时缺省）。 */
export interface CooperationAuthorLevel {
  number: number
  name: string
}

/** 佩戴勋章（服务端取第一佩戴槽位；未佩戴时缺省）。 */
export interface CooperationAuthorBadge {
  name: string
  imageUrl?: string
  placeholderShape?: string
}

/** 佩戴勋章列表（人才列表口径：服务端按槽位序返回，组件兜底最多展示 3 枚）。 */
export interface CooperationAuthorBadgeItem {
  id: string
  name: string
  imageUrl?: string
}

/** 邀请人标注（服务端判定玩家/平台：USER=玩家邀请人，PLATFORM=MIP 平台）。 */
export interface CooperationAuthorInviter {
  sourceType: 'USER' | 'PLATFORM'
  displayName: string
  avatarUrl?: string
}

export interface CooperationAuthor {
  profileRef: string
  nickname: string
  avatarUrl?: string
  headline?: string
  cityName?: string
  primaryIndustry?: CooperationTag
  level?: CooperationAuthorLevel
  badge?: CooperationAuthorBadge
  /** 当前身份状态（档案 seven-label 口径，visibility 门控后缺省省略）。 */
  identityStatus?: string
  badges?: CooperationAuthorBadgeItem[]
  inviter?: CooperationAuthorInviter
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
