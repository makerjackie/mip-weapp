import type { Brand, UserId } from '../mip'

export type GrowthLevelId = Brand<string, 'GrowthLevelId'>
export type GrowthRuleId = Brand<string, 'GrowthRuleId'>
export type GrowthMetric = 'EXPERIENCE' | 'CONTRIBUTION' | 'COIN'

/** MIW-83：权益对象化，description 供权益详情弹层展示；空说明由服务端省略。 */
export interface GrowthLevelBenefit {
  name: string
  description?: string
}

export interface GrowthLevel {
  id: GrowthLevelId
  levelKey: string
  /** MIW-104：服务端按 level_key lvNN 约定解析的业务等级号（跳号如 1/3/5/8/…/60）；旧云函数缺省时客户端回退位置序数。 */
  levelNumber?: number
  name: string
  minimumExperience: number
  benefits: GrowthLevelBenefit[]
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
}

/** MIW-104：等级号统一取值——服务端 levelNumber 优先，缺省回退快照位置序数（1-based）。 */
export function levelNumberOf(level: Pick<GrowthLevel, 'levelNumber'> | undefined, fallbackPosition: number): number {
  return Number.isFinite(level?.levelNumber) && Number(level?.levelNumber) >= 1
    ? Number(level?.levelNumber)
    : Math.max(1, fallbackPosition + 1)
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
  acquireCondition?: string
  iconName?: string
  imageUrl?: string
  placeholderShape: 'CIRCLE' | 'DIAMOND' | 'HEXAGON'
  category: 'IDENTITY' | 'HONOR'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  earned: boolean
  equippedSlot?: number
  awardedAt?: string
}

export interface BadgeCollection {
  version: number
  maximumEquipped: 3
  items: BadgeCollectionItem[]
}

export interface MipGrowthGateway {
  getSnapshot: () => Promise<GrowthSnapshot>
  listEntries: (cursor?: string, limit?: number, metric?: GrowthMetric) => Promise<GrowthEntryPage>
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
