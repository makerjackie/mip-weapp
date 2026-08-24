import { MipAdminError } from './types'

export type AdminAnnouncementScopeType = 'PLATFORM' | 'BRANCH'
export type AdminAnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN'
export type AdminAnnouncementSafetyStatus = 'PENDING' | 'PASSED' | 'REJECTED' | 'ERROR'
export type AdminAnnouncementTargetType = 'EVENT' | 'OPPORTUNITY'

export interface AdminAnnouncement {
  id: string
  scopeType: AdminAnnouncementScopeType
  branchId: string | null
  branchName: string
  title: string
  summary: string
  body?: string
  targetType: AdminAnnouncementTargetType | null
  targetId: string | null
  status: AdminAnnouncementStatus
  contentSafetyStatus: AdminAnnouncementSafetyStatus
  isPinned: boolean
  visibleFrom: string
  visibleUntil: string | null
  publishedAt: string | null
  withdrawnAt: string | null
  version: number
  updatedAt: string
}

export interface AdminAnnouncementScope {
  platform: boolean
  branches: Array<{ id: string, name: string }>
}

export interface AdminAnnouncementDraft {
  announcementId?: string
  expectedVersion?: number
  scopeType: AdminAnnouncementScopeType
  branchId: string | null
  title: string
  summary: string
  body: string
  targetType: AdminAnnouncementTargetType | null
  targetId: string | null
  visibleFrom: string
  visibleUntil: string | null
}

export interface AdminAnnouncementFilters {
  status?: AdminAnnouncementStatus | ''
  scopeType?: AdminAnnouncementScopeType | ''
  branchId?: string
  query?: string
  limit?: number
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const statuses = new Set(['DRAFT', 'PUBLISHED', 'WITHDRAWN'])
const safetyStatuses = new Set(['PENDING', 'PASSED', 'REJECTED', 'ERROR'])
const targetTypes = new Set(['EVENT', 'OPPORTUNITY'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function nullableDate(value: unknown) {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function invalidResponse(label: string) {
  return new MipAdminError('INVALID_RESPONSE', `运营服务返回了无效的${label}`)
}

function parseAnnouncement(value: unknown, requireBody: boolean): AdminAnnouncement {
  const keys = [
    'id',
    'scopeType',
    'branchId',
    'branchName',
    'title',
    'summary',
    ...(requireBody ? ['body'] : []),
    'targetType',
    'targetId',
    'status',
    'contentSafetyStatus',
    'isPinned',
    'visibleFrom',
    'visibleUntil',
    'publishedAt',
    'withdrawnAt',
    'version',
    'updatedAt',
  ]
  if (!record(value)
    || !hasOnlyKeys(value, keys)
    || typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || !['PLATFORM', 'BRANCH'].includes(String(value.scopeType))
    || !(value.branchId === null || (typeof value.branchId === 'string' && uuidPattern.test(value.branchId)))
    || (value.scopeType === 'PLATFORM' && value.branchId !== null)
    || (value.scopeType === 'BRANCH' && value.branchId === null)
    || typeof value.branchName !== 'string'
    || value.branchName.length > 80
    || typeof value.title !== 'string'
    || value.title.length < 1
    || value.title.length > 100
    || typeof value.summary !== 'string'
    || value.summary.length < 1
    || value.summary.length > 240
    || (requireBody && (typeof value.body !== 'string' || value.body.length < 1 || value.body.length > 5_000))
    || !(value.targetType === null || targetTypes.has(String(value.targetType)))
    || !(value.targetId === null || (typeof value.targetId === 'string' && uuidPattern.test(value.targetId)))
    || Boolean(value.targetType) !== Boolean(value.targetId)
    || !statuses.has(String(value.status))
    || !safetyStatuses.has(String(value.contentSafetyStatus))
    || typeof value.isPinned !== 'boolean'
    || typeof value.visibleFrom !== 'string'
    || !Number.isFinite(Date.parse(value.visibleFrom))
    || !nullableDate(value.visibleUntil)
    || !nullableDate(value.publishedAt)
    || !nullableDate(value.withdrawnAt)
    || !Number.isInteger(value.version)
    || Number(value.version) < 1
    || typeof value.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw invalidResponse('公告信息')
  }
  return value as unknown as AdminAnnouncement
}

export function parseAdminAnnouncementSummary(value: unknown) {
  return parseAnnouncement(value, false)
}

export function parseAdminAnnouncementDetail(value: unknown) {
  return parseAnnouncement(value, true)
}

export function parseAdminAnnouncementPage(value: unknown) {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || value.nextCursor !== null) {
    throw invalidResponse('公告列表')
  }
  return {
    items: value.items.map(parseAdminAnnouncementSummary),
    nextCursor: null,
  }
}

export function parseAdminAnnouncementScopes(value: unknown): AdminAnnouncementScope {
  if (!record(value)
    || !hasOnlyKeys(value, ['platform', 'branches'])
    || typeof value.platform !== 'boolean'
    || !Array.isArray(value.branches)) {
    throw invalidResponse('公告范围')
  }
  const branches = value.branches.map((branch) => {
    if (!record(branch)
      || !hasOnlyKeys(branch, ['id', 'name'])
      || typeof branch.id !== 'string'
      || !uuidPattern.test(branch.id)
      || typeof branch.name !== 'string'
      || branch.name.length < 1
      || branch.name.length > 80) {
      throw invalidResponse('公告范围')
    }
    return { id: branch.id, name: branch.name }
  })
  if (new Set(branches.map(branch => branch.id)).size !== branches.length) {
    throw invalidResponse('公告范围')
  }
  return { platform: value.platform, branches }
}
