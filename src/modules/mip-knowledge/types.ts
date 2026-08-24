import type { ClientPaymentOutcome } from '../mip-commerce'

export type KnowledgeContentType = 'HOT_NEWS' | 'ARTICLE' | 'WEB' | 'VIDEO' | 'PRIVATE_CHANNEL' | 'EXPERT_SHARE'
export type KnowledgeAccessType = 'FREE' | 'MEMBER' | 'MEMBER_OR_PAID'

export interface KnowledgeCategory {
  id: string
  categoryKey: string
  name: string
  summary: string
  sortOrder: number
  publishedCount: number
}

export interface KnowledgeProduct {
  id: string
  name: string
  priceCents: number
  currency: 'CNY'
  catalogStage: 'TEST' | 'LIVE'
}

export interface KnowledgeContentSummary {
  id: string
  contentType: KnowledgeContentType
  title: string
  summary: string
  authorName: string
  accessType: KnowledgeAccessType
  category: { id: string, name: string }
  sourceName: string
  coverUrl: string
  product: KnowledgeProduct | null
  publishedAt?: string
}

export interface KnowledgeContentDetail extends KnowledgeContentSummary {
  access: {
    accessType: KnowledgeAccessType
    unlocked: boolean
    reason: 'FREE' | 'MEMBERSHIP' | 'PURCHASED' | 'MEMBERSHIP_REQUIRED' | 'PURCHASE_REQUIRED'
  }
  body: string
  externalUrl: string
  channel: null | { finderUserName: string, feedId: string }
  entitlement: null | { id: string, endsAt?: string, firstAccessedAt?: string }
  refundPolicy: null | { policy: 'BEFORE_ACCESS' | 'NON_REFUNDABLE', windowHours: number, unlockDays: number | null }
}

export interface KnowledgeComment {
  id: string
  parentCommentId?: string
  body: string
  status: 'PENDING' | 'PUBLISHED' | 'HIDDEN' | 'DELETED'
  author: { profileRef: string, nickname: string, headline: string, avatarUrl: string }
  mine: boolean
  canDelete: boolean
  version: number
  createdAt?: string
  editedAt?: string
}

export interface KnowledgeCommentPage {
  settings: { commentsEnabled: boolean, moderationMode: 'AUTO' | 'REVIEW', version: number }
  items: KnowledgeComment[]
  nextCursor?: string
}

export interface KnowledgePurchaseOutcome {
  payment: ClientPaymentOutcome
  contentId: string
}
