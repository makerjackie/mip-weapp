export const reportCategoryOptions = [
  { value: 'SPAM', label: '垃圾信息' },
  { value: 'HARASSMENT', label: '骚扰行为' },
  { value: 'FRAUD', label: '欺诈风险' },
  { value: 'INAPPROPRIATE_CONTENT', label: '不当内容' },
  { value: 'IMPERSONATION', label: '冒充他人' },
  { value: 'OTHER', label: '其他问题' },
] as const

export type ReportCategory = (typeof reportCategoryOptions)[number]['value']

export interface CommunityRelationship {
  profileRef: string
  isSelf: boolean
  blocked: boolean
}

export interface BlockMutationResult {
  profileRef: string
  blocked: boolean
  changed: boolean
  version: number
}

export interface BlockedProfile {
  profileRef: string
  nickname: string
  avatarUrl?: string
  headline?: string
  cityName?: string
  blockedAt: string
}

export interface BlockedProfilePage {
  items: BlockedProfile[]
  nextCursor?: string
}

export interface ReportReceipt {
  reportId: string
  status: 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'
  idempotent: boolean
}

export interface CommunityReportIntent {
  profileRef: string
  category: ReportCategory
  description: string
  requestId: string
}

export type EventCommentStatus = 'PENDING' | 'PUBLISHED' | 'HIDDEN' | 'DELETED'

export interface EventComment {
  id: string
  body: string
  status: EventCommentStatus
  author: {
    profileRef: string
    nickname: string
    headline: string
    avatarUrl: string
  }
  mine: boolean
  canEdit: boolean
  canDelete: boolean
  version: number
  createdAt?: string
  editedAt?: string
}

export interface EventCommentPage {
  event: {
    id: string
    title: string
    status: 'PUBLISHED' | 'CANCELLED' | 'ENDED'
  }
  settings: {
    commentsEnabled: boolean
    moderationMode: 'AUTO' | 'REVIEW'
    version: number
  }
  items: EventComment[]
  nextCursor?: string
}

export interface EventCommentSubmissionInput {
  eventId: string
  body: string
  commentId?: string
  expectedVersion?: number
}

export interface EventCommentSubmissionIntent {
  fingerprint: string
  idempotencyKey: string
}

export interface EventCommentDeleteIntent {
  fingerprint: string
  idempotencyKey: string
}

export interface EventCommentReportInput {
  eventId: string
  commentId: string
  expectedVersion: number
  category: ReportCategory
  description?: string
}

export interface EventCommentReportIntent {
  fingerprint: string
  idempotencyKey: string
  requestId: string
}

export class MipCommunityError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'MipCommunityError'
    this.code = code
    this.retryable = retryable
  }
}
