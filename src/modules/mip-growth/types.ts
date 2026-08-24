import type { Brand, UserId } from '../mip'

export type GrowthLevelId = Brand<string, 'GrowthLevelId'>
export type GrowthRuleId = Brand<string, 'GrowthRuleId'>
export type GrowthMetric = 'EXPERIENCE' | 'CONTRIBUTION' | 'COIN'

export interface GrowthLevel {
  id: GrowthLevelId
  levelKey: string
  name: string
  minimumExperience: number
  benefits: string[]
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
}

export interface GrowthRule {
  id: GrowthRuleId
  ruleKey: string
  name: string
  metric: GrowthMetric
  deltaValue: number
  dailyLimitValue?: number
  sourceEventType: string
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
}

export interface GrowthAccount {
  userId: UserId
  experienceBalance: number
  contributionBalance: number
  coinBalance: number
  version: number
}

export interface GrowthEntry {
  id: string
  ruleKey?: string
  ruleName?: string
  sourceEventType: string
  metric: GrowthMetric
  deltaValue: number
  balanceAfter: number
  createdAt: string
}

export interface GrowthSnapshot {
  account: GrowthAccount
  currentLevel: GrowthLevel
  levels: GrowthLevel[]
  earningRules: GrowthRule[]
  nextLevel?: GrowthLevel
  experienceToNextLevel?: number
  levelProgressPercent: number
}

export interface GrowthEntryPage {
  items: GrowthEntry[]
  nextCursor?: string
}

export interface BadgeCollectionItem {
  id: string
  key: string
  name: string
  description: string
  iconName?: string
  imageUrl?: string
  placeholderShape: 'CIRCLE' | 'DIAMOND' | 'HEXAGON'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  equippedSlot?: number
  awardedAt: string
}

export interface BadgeCollection {
  version: number
  maximumEquipped: 3
  items: BadgeCollectionItem[]
}

export interface GrowthEntryIntent {
  userId: UserId
  rule: GrowthRule
  sourceEventId: string
  sourceEventType: string
  awardedToday: number
}

export interface GrowthEntryProjection {
  metric: GrowthMetric
  requestedDelta: number
  appliedDelta: number
  balanceAfter: number
  capped: boolean
}

export interface MipGrowthGateway {
  getSnapshot: () => Promise<GrowthSnapshot>
  listEntries: (cursor?: string, limit?: number) => Promise<GrowthEntryPage>
  listBadgeCollection: () => Promise<BadgeCollection>
  equipBadges: (badgeIds: string[], expectedVersion: number) => Promise<BadgeCollection>
}

export class MipGrowthError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'MipGrowthError'
    this.code = code
    this.retryable = retryable
  }
}
