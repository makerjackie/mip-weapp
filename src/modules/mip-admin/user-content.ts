import { MipAdminError } from './types'

export type AdminUserContentKind = 'COOPERATION_CARD' | 'SUPER_CASE'
export type AdminUserContentStatus = 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED'
export type AdminUserContentSafetyStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ERROR'

export interface AdminUserContentOwner {
  userId: string
  nickname: string
  branchId: string | null
  branchName: string
  cityName: string
}

export interface AdminUserContentListItem {
  id: string
  kind: AdminUserContentKind
  title: string
  summary: string
  roleKey: string | null
  status: AdminUserContentStatus
  contentSafetyStatus: AdminUserContentSafetyStatus
  version: number
  owner: AdminUserContentOwner
  publishedAt: string
  archivedAt: string | null
  updatedAt: string
}

export interface AdminUserContentModerationHistory {
  action: 'UNPUBLISH'
  actorNickname: string
  reason: string
  createdAt: string
}

interface AdminUserContentDetailBase {
  id: string
  kind: AdminUserContentKind
  status: AdminUserContentStatus
  contentSafetyStatus: AdminUserContentSafetyStatus
  version: number
  owner: AdminUserContentOwner
  publishedAt: string
  archivedAt: string | null
  updatedAt: string
  moderationHistory: AdminUserContentModerationHistory[]
}

export interface AdminCooperationCardDetail extends AdminUserContentDetailBase {
  kind: 'COOPERATION_CARD'
  roleKey: string
  positioning: string
  targetSummary: string
  roleFields: Record<string, string | string[]>
  abilityScores: Record<string, number>
}

export interface AdminSuperCaseDetail extends AdminUserContentDetailBase {
  kind: 'SUPER_CASE'
  projectName: string
  summary: string
  startedOn: string | null
  endedOn: string | null
  responsibility: string
  cityLabel: string
  industryLabel: string
  caseType: string
  description: string
  coverUrl: string
  media: Array<{ assetId: string, url: string, caption: string }>
}

export type AdminUserContentDetail = AdminCooperationCardDetail | AdminSuperCaseDetail

export interface AdminUserContentListInput {
  kind?: AdminUserContentKind | 'ALL'
  status?: AdminUserContentStatus | 'ALL'
  contentSafetyStatus?: AdminUserContentSafetyStatus | ''
  branchId?: string
  ownerUserId?: string
  roleKey?: string
  query?: string
  cursor?: string
  limit?: number
}

export interface AdminUserContentPage {
  items: AdminUserContentListItem[]
  nextCursor: string | null
}

export interface AdminUserContentUnpublishInput {
  kind: AdminUserContentKind
  contentId: string
  expectedVersion: number
  reason: string
}

export interface AdminUserContentMutationResult {
  id: string
  kind: AdminUserContentKind
  status: 'UNPUBLISHED'
  version: number
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const kinds = new Set(['COOPERATION_CARD', 'SUPER_CASE'])
const statuses = new Set(['PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'])
const safetyStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED', 'ERROR'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const expected = new Set(keys)
  const actual = Reflect.ownKeys(value)
  return actual.length === expected.size
    && actual.every(key => typeof key === 'string' && expected.has(key))
}

function uuid(value: unknown) {
  return typeof value === 'string' && uuidPattern.test(value)
}

function version(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1
}

function shortText(value: unknown, maximum: number, required = false) {
  return typeof value === 'string' && value.length <= maximum && (!required || value.length > 0)
}

function dateTime(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function nullableDateTime(value: unknown) {
  return value === null || dateTime(value)
}

function nullableDate(value: unknown) {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的用户内容数据')
}

function owner(value: unknown) {
  return record(value)
    && exactKeys(value, ['userId', 'nickname', 'branchId', 'branchName', 'cityName'])
    && uuid(value.userId)
    && shortText(value.nickname, 64, true)
    && (value.branchId === null || uuid(value.branchId))
    && shortText(value.branchName, 80)
    && shortText(value.cityName, 80)
}

function history(value: unknown) {
  return record(value)
    && exactKeys(value, ['action', 'actorNickname', 'reason', 'createdAt'])
    && value.action === 'UNPUBLISH'
    && shortText(value.actorNickname, 64, true)
    && shortText(value.reason, 300, true)
    && dateTime(value.createdAt)
}

function media(value: unknown) {
  return record(value)
    && exactKeys(value, ['assetId', 'url', 'caption'])
    && uuid(value.assetId)
    && shortText(value.url, 1024, true)
    && shortText(value.caption, 160)
}

function roleFields(value: unknown) {
  if (!record(value) || Object.keys(value).length > 12) {
    return false
  }
  return Object.entries(value).every(([key, field]) => key.length > 0 && key.length <= 64 && (
    shortText(field, 1000, true)
    || (Array.isArray(field)
      && field.length > 0
      && field.length <= 12
      && field.every(item => shortText(item, 80, true)))
  ))
}

function abilityScores(value: unknown) {
  return record(value)
    && Object.keys(value).length <= 20
    && Object.entries(value).every(([key, score]) => (
      key.length > 0 && key.length <= 64
      && Number.isInteger(score) && Number(score) >= 0 && Number(score) <= 5
    ))
}

function assertDetailBase(value: Record<string, unknown>) {
  if (!uuid(value.id)
    || !statuses.has(String(value.status))
    || !safetyStatuses.has(String(value.contentSafetyStatus))
    || !version(value.version)
    || !owner(value.owner)
    || !dateTime(value.publishedAt)
    || !nullableDateTime(value.archivedAt)
    || !dateTime(value.updatedAt)
    || !Array.isArray(value.moderationHistory)
    || value.moderationHistory.length > 50
    || value.moderationHistory.some(item => !history(item))) {
    invalid()
  }
}

function parseListItem(value: unknown): AdminUserContentListItem {
  if (!record(value)
    || !exactKeys(value, [
      'id',
      'kind',
      'title',
      'summary',
      'roleKey',
      'status',
      'contentSafetyStatus',
      'version',
      'owner',
      'publishedAt',
      'archivedAt',
      'updatedAt',
    ])
    || !uuid(value.id)
    || !kinds.has(String(value.kind))
    || !shortText(value.title, 500, true)
    || !shortText(value.summary, 500)
    || !(value.roleKey === null || shortText(value.roleKey, 32, true))
    || !statuses.has(String(value.status))
    || !safetyStatuses.has(String(value.contentSafetyStatus))
    || !version(value.version)
    || !owner(value.owner)
    || !dateTime(value.publishedAt)
    || !nullableDateTime(value.archivedAt)
    || !dateTime(value.updatedAt)) {
    invalid()
  }
  if ((value.kind === 'COOPERATION_CARD') !== (typeof value.roleKey === 'string')) {
    invalid()
  }
  return value as unknown as AdminUserContentListItem
}

export function parseAdminUserContentPage(value: unknown): AdminUserContentPage {
  if (!record(value)
    || !exactKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || value.items.length > 50
    || !(value.nextCursor === null || (typeof value.nextCursor === 'string' && value.nextCursor.length <= 512))) {
    invalid()
  }
  return {
    items: value.items.map(parseListItem),
    nextCursor: value.nextCursor as string | null,
  }
}

export function parseAdminUserContentDetail(value: unknown): AdminUserContentDetail {
  if (!record(value) || !kinds.has(String(value.kind))) {
    invalid()
  }
  const baseKeys = [
    'id',
    'kind',
    'status',
    'contentSafetyStatus',
    'version',
    'owner',
    'publishedAt',
    'archivedAt',
    'updatedAt',
    'moderationHistory',
  ]
  if (value.kind === 'COOPERATION_CARD') {
    if (!exactKeys(value, [
      ...baseKeys,
      'roleKey',
      'positioning',
      'targetSummary',
      'roleFields',
      'abilityScores',
    ])) {
      invalid()
    }
  }
  else if (!exactKeys(value, [
    ...baseKeys,
    'projectName',
    'summary',
    'startedOn',
    'endedOn',
    'responsibility',
    'cityLabel',
    'industryLabel',
    'caseType',
    'description',
    'coverUrl',
    'media',
  ])) {
    invalid()
  }
  assertDetailBase(value)

  if (value.kind === 'COOPERATION_CARD') {
    if (!shortText(value.roleKey, 32, true)
      || !shortText(value.positioning, 500, true)
      || !shortText(value.targetSummary, 500, true)
      || !roleFields(value.roleFields)
      || !abilityScores(value.abilityScores)) {
      invalid()
    }
    return value as unknown as AdminCooperationCardDetail
  }
  if (!shortText(value.projectName, 120, true)
    || !shortText(value.summary, 240, true)
    || !nullableDate(value.startedOn)
    || !nullableDate(value.endedOn)
    || !shortText(value.responsibility, 500, true)
    || !shortText(value.cityLabel, 80)
    || !shortText(value.industryLabel, 80)
    || !shortText(value.caseType, 80)
    || !shortText(value.description, 20_000, true)
    || !shortText(value.coverUrl, 1024)
    || !Array.isArray(value.media)
    || value.media.length > 20
    || value.media.some(item => !media(item))) {
    invalid()
  }
  return value as unknown as AdminSuperCaseDetail
}

export function parseAdminUserContentMutation(
  value: unknown,
  input: AdminUserContentUnpublishInput,
): AdminUserContentMutationResult {
  if (!record(value)
    || !exactKeys(value, ['id', 'kind', 'status', 'version'])
    || value.id !== input.contentId
    || value.kind !== input.kind
    || value.status !== 'UNPUBLISHED'
    || value.version !== input.expectedVersion + 1) {
    invalid()
  }
  return value as unknown as AdminUserContentMutationResult
}
