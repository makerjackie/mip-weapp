import { MipAdminError } from './types'

export type AdminEventCommentStatus = 'PENDING' | 'PUBLISHED' | 'HIDDEN'
export type AdminEventCommentReportStatus = 'PENDING' | 'REVIEWING'
export type AdminEventCommentReportCategory
  = | 'SPAM'
    | 'HARASSMENT'
    | 'FRAUD'
    | 'INAPPROPRIATE_CONTENT'
    | 'IMPERSONATION'
    | 'OTHER'

export interface AdminEventCommentSettings {
  commentsEnabled: boolean
  moderationMode: 'AUTO' | 'REVIEW'
  version: number
}

export interface AdminEventComment {
  id: string
  authorNickname: string
  body: string
  status: AdminEventCommentStatus
  version: number
  createdAt: string | null
  editedAt: string | null
}

export interface AdminEventCommentReport {
  id: string
  commentId: string
  commentAuthorNickname: string
  commentBody: string
  commentStatus: AdminEventCommentStatus | 'DELETED'
  reporterNickname: string
  category: AdminEventCommentReportCategory
  description: string
  status: AdminEventCommentReportStatus
  version: number
  claimedByMe: boolean
  createdAt: string | null
  reviewedAt: string | null
}

export interface AdminEventCommentState {
  event: {
    id: string
    title: string
    status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'CANCELLED' | 'ENDED' | 'ARCHIVED'
    version: number
  }
  settings: AdminEventCommentSettings
  comments: AdminEventComment[]
  reports: AdminEventCommentReport[]
}

export interface AdminEventCommentMutationResult {
  id: string
  status: 'PUBLISHED' | 'HIDDEN'
  version: number
}

export interface AdminEventCommentReportMutationResult {
  id: string
  status: 'REVIEWING' | 'RESOLVED' | 'DISMISSED'
  version: number
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const eventStatuses = new Set(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED', 'ARCHIVED'])
const commentStatuses = new Set(['PENDING', 'PUBLISHED', 'HIDDEN'])
const reportedCommentStatuses = new Set([...commentStatuses, 'DELETED'])
const reportStatuses = new Set(['PENDING', 'REVIEWING'])
const reportCategories = new Set(['SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER'])
const claimResultStatuses = new Set<AdminEventCommentReportMutationResult['status']>(['REVIEWING'])
const closeResultStatuses = new Set<AdminEventCommentReportMutationResult['status']>(['RESOLVED', 'DISMISSED'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function only(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  const actual = Object.keys(value)
  return actual.length === allowed.size && actual.every(key => allowed.has(key))
}

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动评论数据')
}

function nullableDate(value: unknown) {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

export function parseEventCommentSettings(value: unknown): AdminEventCommentSettings {
  if (!record(value)
    || !only(value, ['commentsEnabled', 'moderationMode', 'version'])
    || typeof value.commentsEnabled !== 'boolean'
    || !['AUTO', 'REVIEW'].includes(String(value.moderationMode))
    || !Number.isInteger(value.version) || Number(value.version) < 0) {
    invalid()
  }
  return value as unknown as AdminEventCommentSettings
}

function parseEvent(value: unknown): AdminEventCommentState['event'] {
  if (!record(value)
    || !only(value, ['id', 'title', 'status', 'version'])
    || typeof value.id !== 'string' || !uuidPattern.test(value.id)
    || typeof value.title !== 'string' || !value.title || value.title.length > 120
    || !eventStatuses.has(String(value.status))
    || !Number.isInteger(value.version) || Number(value.version) < 1) {
    invalid()
  }
  return value as unknown as AdminEventCommentState['event']
}

function parseComment(value: unknown): AdminEventComment {
  if (!record(value)
    || !only(value, ['id', 'authorNickname', 'body', 'status', 'version', 'createdAt', 'editedAt'])
    || typeof value.id !== 'string' || !uuidPattern.test(value.id)
    || typeof value.authorNickname !== 'string' || !value.authorNickname || value.authorNickname.length > 80
    || typeof value.body !== 'string' || !value.body || value.body.length > 800
    || !commentStatuses.has(String(value.status))
    || !Number.isInteger(value.version) || Number(value.version) < 1
    || !nullableDate(value.createdAt) || !nullableDate(value.editedAt)) {
    invalid()
  }
  return value as unknown as AdminEventComment
}

function parseReport(value: unknown): AdminEventCommentReport {
  if (!record(value)
    || !only(value, ['id', 'commentId', 'commentAuthorNickname', 'commentBody', 'commentStatus', 'reporterNickname', 'category', 'description', 'status', 'version', 'claimedByMe', 'createdAt', 'reviewedAt'])
    || typeof value.id !== 'string' || !uuidPattern.test(value.id)
    || typeof value.commentId !== 'string' || !uuidPattern.test(value.commentId)
    || typeof value.commentAuthorNickname !== 'string' || !value.commentAuthorNickname
    || value.commentAuthorNickname.length > 80
    || typeof value.commentBody !== 'string' || !value.commentBody || value.commentBody.length > 800
    || !reportedCommentStatuses.has(String(value.commentStatus))
    || typeof value.reporterNickname !== 'string' || !value.reporterNickname || value.reporterNickname.length > 80
    || !reportCategories.has(String(value.category))
    || typeof value.description !== 'string' || value.description.length > 300
    || !reportStatuses.has(String(value.status))
    || !Number.isInteger(value.version) || Number(value.version) < 1
    || typeof value.claimedByMe !== 'boolean'
    || !nullableDate(value.createdAt) || !nullableDate(value.reviewedAt)) {
    invalid()
  }
  return value as unknown as AdminEventCommentReport
}

export function parseEventCommentState(value: unknown): AdminEventCommentState {
  if (!record(value)
    || !only(value, ['event', 'settings', 'comments', 'reports'])
    || !Array.isArray(value.comments) || value.comments.length > 100
    || !Array.isArray(value.reports) || value.reports.length > 100) {
    invalid()
  }
  return {
    event: parseEvent(value.event),
    settings: parseEventCommentSettings(value.settings),
    comments: value.comments.map(parseComment),
    reports: value.reports.map(parseReport),
  }
}

export function parseEventCommentMutationResult(value: unknown): AdminEventCommentMutationResult {
  if (!record(value)
    || !only(value, ['id', 'status', 'version'])
    || typeof value.id !== 'string' || !uuidPattern.test(value.id)
    || !['PUBLISHED', 'HIDDEN'].includes(String(value.status))
    || !Number.isInteger(value.version) || Number(value.version) < 1) {
    invalid()
  }
  return value as unknown as AdminEventCommentMutationResult
}

function parseEventCommentReportMutationResult(
  value: unknown,
  statuses: ReadonlySet<AdminEventCommentReportMutationResult['status']>,
): AdminEventCommentReportMutationResult {
  if (!record(value)
    || !only(value, ['id', 'status', 'version'])
    || typeof value.id !== 'string' || !uuidPattern.test(value.id)
    || !statuses.has(value.status as AdminEventCommentReportMutationResult['status'])
    || !Number.isInteger(value.version) || Number(value.version) < 1) {
    invalid()
  }
  return value as unknown as AdminEventCommentReportMutationResult
}

export function parseEventCommentReportClaimResult(value: unknown) {
  return parseEventCommentReportMutationResult(value, claimResultStatuses)
}

export function parseEventCommentReportCloseResult(value: unknown) {
  return parseEventCommentReportMutationResult(value, closeResultStatuses)
}
