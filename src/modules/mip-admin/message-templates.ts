import { MipAdminError } from './types'

export type AdminMessageTemplateStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
export type AdminMessageTemplateSafetyStatus = 'PENDING' | 'PASSED' | 'REJECTED' | 'ERROR'

export interface AdminMessageTemplate {
  id: string
  scopeType: 'PLATFORM' | 'BRANCH'
  branchId: string | null
  branchName: string
  status: AdminMessageTemplateStatus
  currentRevisionNumber: number
  name: string
  title: string
  body: string
  contentSafetyStatus: AdminMessageTemplateSafetyStatus
  revisionCreatedAt: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface AdminMessageTemplateDraftContent {
  scopeType: 'PLATFORM' | 'BRANCH'
  branchId: string | null
  name: string
  title: string
  body: string
}

export type AdminMessageTemplateDraft = AdminMessageTemplateDraftContent & (
  | { templateId?: never, expectedVersion?: never }
  | { templateId: string, expectedVersion: number }
)

export interface AdminMessageTemplateFilters {
  status?: AdminMessageTemplateStatus | ''
  query?: string
  limit?: number
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const statuses = new Set(['DRAFT', 'ACTIVE', 'ARCHIVED'])
const safetyStatuses = new Set(['PENDING', 'PASSED', 'REJECTED', 'ERROR'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的消息模板数据')
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function parseMessageTemplate(value: unknown): AdminMessageTemplate {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'id',
      'scopeType',
      'branchId',
      'branchName',
      'status',
      'currentRevisionNumber',
      'name',
      'title',
      'body',
      'contentSafetyStatus',
      'revisionCreatedAt',
      'version',
      'createdAt',
      'updatedAt',
    ])
    || typeof value.id !== 'string' || !uuidPattern.test(value.id)
    || typeof value.scopeType !== 'string' || !['PLATFORM', 'BRANCH'].includes(value.scopeType)
    || !(value.branchId === null || (typeof value.branchId === 'string' && uuidPattern.test(value.branchId)))
    || typeof value.branchName !== 'string' || value.branchName.length > 80
    || typeof value.status !== 'string' || !statuses.has(value.status)
    || !Number.isInteger(value.currentRevisionNumber) || Number(value.currentRevisionNumber) < 1
    || typeof value.name !== 'string' || !value.name || value.name.length > 100
    || typeof value.title !== 'string' || !value.title || value.title.length > 100
    || typeof value.body !== 'string' || !value.body || value.body.length > 500
    || typeof value.contentSafetyStatus !== 'string' || !safetyStatuses.has(value.contentSafetyStatus)
    || !isDate(value.revisionCreatedAt)
    || !Number.isInteger(value.version) || Number(value.version) < 1
    || !isDate(value.createdAt)
    || !isDate(value.updatedAt)) {
    invalid()
  }
  if ((value.scopeType === 'PLATFORM') !== (value.branchId === null)) {
    invalid()
  }
  return value as unknown as AdminMessageTemplate
}

export function parseMessageTemplatePage(value: unknown) {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')) {
    invalid()
  }
  return { items: value.items.map(parseMessageTemplate), nextCursor: value.nextCursor }
}
