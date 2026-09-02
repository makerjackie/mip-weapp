import { MipAdminError } from './error'

export interface AdminOpportunityCommentSettings {
  commentsEnabled: boolean
  reviewsEnabled: boolean
  callsEnabled: boolean
  moderationMode: 'AUTO' | 'REVIEW'
  version: number
}

export interface AdminOpportunityComment {
  id: string
  authorProfileRef: string
  authorNickname: string
  type: 'COMMENT' | 'REVIEW'
  body: string
  rating: number | null
  participant: boolean
  status: 'PENDING' | 'PUBLISHED' | 'HIDDEN'
  callCount: number
  version: number
  createdAt: string | null
  editedAt: string | null
}

export interface AdminOpportunityCommentReport {
  id: string
  commentId: string
  reporterProfileRef: string
  reporterNickname: string
  category: 'SPAM' | 'HARASSMENT' | 'FRAUD' | 'INAPPROPRIATE_CONTENT' | 'IMPERSONATION' | 'OTHER'
  description: string
  status: 'PENDING' | 'REVIEWING'
  version: number
  createdAt: string | null
}

export interface AdminOpportunityCommentState {
  settings: AdminOpportunityCommentSettings
  comments: AdminOpportunityComment[]
  reports: AdminOpportunityCommentReport[]
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const profileRef = /^p1\.[\w-]{16}\.[\w-]{48}\.[\w-]{22}$/
const reportCategories = new Set(['SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的评论管理数据')
}

function only(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function nullableDate(value: unknown) {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

export function parseOpportunityCommentSettings(value: unknown): AdminOpportunityCommentSettings {
  if (!record(value)
    || !only(value, ['commentsEnabled', 'reviewsEnabled', 'callsEnabled', 'moderationMode', 'version'])
    || typeof value.commentsEnabled !== 'boolean'
    || typeof value.reviewsEnabled !== 'boolean'
    || typeof value.callsEnabled !== 'boolean'
    || !['AUTO', 'REVIEW'].includes(String(value.moderationMode))
    || !Number.isInteger(value.version) || Number(value.version) < 0) {
    invalid()
  }
  return value as unknown as AdminOpportunityCommentSettings
}

function parseComment(value: unknown): AdminOpportunityComment {
  if (!record(value)
    || !only(value, ['id', 'authorProfileRef', 'authorNickname', 'type', 'body', 'rating', 'participant', 'status', 'callCount', 'version', 'createdAt', 'editedAt'])
    || typeof value.id !== 'string' || !uuid.test(value.id)
    || typeof value.authorProfileRef !== 'string' || !profileRef.test(value.authorProfileRef)
    || typeof value.authorNickname !== 'string' || !value.authorNickname
    || !['COMMENT', 'REVIEW'].includes(String(value.type))
    || typeof value.body !== 'string' || !value.body || value.body.length > 800
    || !(value.rating === null || (Number.isInteger(value.rating) && Number(value.rating) >= 1 && Number(value.rating) <= 5))
    || typeof value.participant !== 'boolean'
    || !['PENDING', 'PUBLISHED', 'HIDDEN'].includes(String(value.status))
    || !Number.isInteger(value.callCount) || Number(value.callCount) < 0
    || !Number.isInteger(value.version) || Number(value.version) < 1
    || !nullableDate(value.createdAt) || !nullableDate(value.editedAt)) {
    invalid()
  }
  return value as unknown as AdminOpportunityComment
}

function parseReport(value: unknown): AdminOpportunityCommentReport {
  if (!record(value)
    || !only(value, ['id', 'commentId', 'reporterProfileRef', 'reporterNickname', 'category', 'description', 'status', 'version', 'createdAt'])
    || typeof value.id !== 'string' || !uuid.test(value.id)
    || typeof value.commentId !== 'string' || !uuid.test(value.commentId)
    || typeof value.reporterProfileRef !== 'string' || !profileRef.test(value.reporterProfileRef)
    || typeof value.reporterNickname !== 'string' || !value.reporterNickname
    || !reportCategories.has(String(value.category))
    || typeof value.description !== 'string' || value.description.length > 300
    || !['PENDING', 'REVIEWING'].includes(String(value.status))
    || !Number.isInteger(value.version) || Number(value.version) < 1
    || !nullableDate(value.createdAt)) {
    invalid()
  }
  return value as unknown as AdminOpportunityCommentReport
}

export function parseOpportunityCommentState(value: unknown): AdminOpportunityCommentState {
  if (!record(value) || !only(value, ['settings', 'comments', 'reports'])
    || !Array.isArray(value.comments) || !Array.isArray(value.reports)) {
    invalid()
  }
  return {
    settings: parseOpportunityCommentSettings(value.settings),
    comments: value.comments.map(parseComment),
    reports: value.reports.map(parseReport),
  }
}
