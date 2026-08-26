import { MipAdminError } from './types'

export type AdminEventCatalogKind = 'TYPE' | 'TAG'
export type AdminEventCatalogStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'

export interface AdminEventCatalogItem {
  id: string
  kind: AdminEventCatalogKind
  key: string
  name: string
  description: string
  sortOrder: number
  status: AdminEventCatalogStatus
  usageCount: number
  version: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminEventCatalogListInput {
  kind: AdminEventCatalogKind
  status?: AdminEventCatalogStatus | ''
  query?: string
  cursor?: string
  limit?: number
}

export type AdminEventCatalogSaveInput = {
  kind: AdminEventCatalogKind
  key: string
  name: string
  description: string
  sortOrder: number
  catalogId?: never
  expectedVersion?: never
} | {
  kind: AdminEventCatalogKind
  catalogId: string
  expectedVersion: number
  name: string
  description: string
  sortOrder: number
  key?: never
}

export interface AdminEventCatalogStatusInput {
  kind: AdminEventCatalogKind
  catalogId: string
  expectedVersion: number
  status: Exclude<AdminEventCatalogStatus, 'ARCHIVED'>
}

export interface AdminEventCatalogArchiveInput {
  kind: AdminEventCatalogKind
  catalogId: string
  expectedVersion: number
  reason: string
}

export interface AdminEventVideoRecapDestination {
  provider: 'WECHAT_CHANNELS'
  type: 'PROFILE' | 'ACTIVITY'
  finderUserName: string
  feedId: string | null
}

export interface AdminEventVideoRecap {
  id: string
  eventId: string
  eventTitle: string
  title: string
  summary: string
  destination: AdminEventVideoRecapDestination
  sortOrder: number
  status: AdminEventCatalogStatus
  version: number
  activatedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminEventVideoRecapListInput {
  eventId?: string
  status?: AdminEventCatalogStatus | ''
  query?: string
  cursor?: string
  limit?: number
}

export type AdminEventVideoRecapSaveInput = {
  eventId: string
  title: string
  summary: string
  destination: AdminEventVideoRecapDestination
  sortOrder: number
  recapId?: never
  expectedVersion?: never
} | {
  recapId: string
  expectedVersion: number
  eventId: string
  title: string
  summary: string
  destination: AdminEventVideoRecapDestination
  sortOrder: number
}

export interface AdminEventVideoRecapStatusInput {
  recapId: string
  expectedVersion: number
  status: Exclude<AdminEventCatalogStatus, 'ARCHIVED'>
}

export interface AdminEventVideoRecapArchiveInput {
  recapId: string
  expectedVersion: number
  reason: string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const stableKeyPattern = /^[\w.:-]+$/
const destinationTokenPattern = /^[\w=:+/.-]+$/
const catalogKinds = new Set(['TYPE', 'TAG'])
const statuses = new Set(['ACTIVE', 'INACTIVE', 'ARCHIVED'])

function defined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function nullableDate(value: unknown): value is string | null {
  return value === null || date(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1
}

function invalid(label: string): never {
  throw new MipAdminError('INVALID_RESPONSE', `运营服务返回了无效的${label}数据`)
}

function destination(value: unknown): value is AdminEventVideoRecapDestination {
  if (!record(value)
    || !hasExactKeys(value, ['provider', 'type', 'finderUserName', 'feedId'])
    || value.provider !== 'WECHAT_CHANNELS'
    || !['PROFILE', 'ACTIVITY'].includes(String(value.type))
    || typeof value.finderUserName !== 'string' || !value.finderUserName
    || value.finderUserName.length > 128 || !destinationTokenPattern.test(value.finderUserName)
    || !(value.feedId === null || (typeof value.feedId === 'string'
      && value.feedId.length > 0 && value.feedId.length <= 256
      && destinationTokenPattern.test(value.feedId)))) {
    return false
  }
  return (value.type === 'PROFILE' && value.feedId === null)
    || (value.type === 'ACTIVITY' && typeof value.feedId === 'string')
}

export function createAdminEventCatalogListRequest(input: AdminEventCatalogListInput) {
  return defined({
    kind: input.kind,
    status: input.status,
    query: input.query,
    cursor: input.cursor,
    limit: input.limit,
  }) as unknown as AdminEventCatalogListInput
}

export function createAdminEventCatalogSaveRequest(input: AdminEventCatalogSaveInput) {
  return 'catalogId' in input
    ? {
        kind: input.kind,
        catalogId: input.catalogId,
        expectedVersion: input.expectedVersion,
        name: input.name,
        description: input.description,
        sortOrder: input.sortOrder,
      }
    : {
        kind: input.kind,
        key: input.key,
        name: input.name,
        description: input.description,
        sortOrder: input.sortOrder,
      }
}

export function createAdminEventCatalogStatusRequest(input: AdminEventCatalogStatusInput) {
  return {
    kind: input.kind,
    catalogId: input.catalogId,
    expectedVersion: input.expectedVersion,
    status: input.status,
  }
}

export function createAdminEventCatalogArchiveRequest(input: AdminEventCatalogArchiveInput) {
  return {
    kind: input.kind,
    catalogId: input.catalogId,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
  }
}

export function createAdminEventVideoRecapListRequest(input: AdminEventVideoRecapListInput = {}) {
  return defined({
    eventId: input.eventId,
    status: input.status,
    query: input.query,
    cursor: input.cursor,
    limit: input.limit,
  }) as unknown as AdminEventVideoRecapListInput
}

export function createAdminEventVideoRecapSaveRequest(input: AdminEventVideoRecapSaveInput) {
  const common = {
    eventId: input.eventId,
    title: input.title,
    summary: input.summary,
    destination: {
      provider: input.destination.provider,
      type: input.destination.type,
      finderUserName: input.destination.finderUserName,
      feedId: input.destination.feedId,
    },
    sortOrder: input.sortOrder,
  }
  return 'recapId' in input
    ? { recapId: input.recapId, expectedVersion: input.expectedVersion, ...common }
    : common
}

export function createAdminEventVideoRecapStatusRequest(input: AdminEventVideoRecapStatusInput) {
  return {
    recapId: input.recapId,
    expectedVersion: input.expectedVersion,
    status: input.status,
  }
}

export function createAdminEventVideoRecapArchiveRequest(input: AdminEventVideoRecapArchiveInput) {
  return {
    recapId: input.recapId,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
  }
}

export function parseAdminEventCatalogItem(value: unknown): AdminEventCatalogItem {
  if (!record(value)
    || !hasExactKeys(value, [
      'id',
      'kind',
      'key',
      'name',
      'description',
      'sortOrder',
      'status',
      'usageCount',
      'version',
      'archivedAt',
      'createdAt',
      'updatedAt',
    ])
    || !uuid(value.id)
    || typeof value.kind !== 'string' || !catalogKinds.has(value.kind)
    || typeof value.key !== 'string' || !value.key || value.key.length > 64
    || !stableKeyPattern.test(value.key)
    || typeof value.name !== 'string' || !value.name || value.name.length > 80
    || typeof value.description !== 'string' || value.description.length > 300
    || !nonNegativeInteger(value.sortOrder)
    || typeof value.status !== 'string' || !statuses.has(value.status)
    || !nonNegativeInteger(value.usageCount)
    || !positiveInteger(value.version)
    || !nullableDate(value.archivedAt)
    || !date(value.createdAt)
    || !date(value.updatedAt)
    || ((value.status === 'ARCHIVED') !== (value.archivedAt !== null))) {
    invalid('活动目录')
  }
  return value as unknown as AdminEventCatalogItem
}

export function parseAdminEventCatalogPage(value: unknown) {
  if (!record(value)
    || !hasExactKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')) {
    invalid('活动目录列表')
  }
  return { items: value.items.map(parseAdminEventCatalogItem), nextCursor: value.nextCursor }
}

export function parseAdminEventVideoRecap(value: unknown): AdminEventVideoRecap {
  if (!record(value)
    || !hasExactKeys(value, [
      'id',
      'eventId',
      'eventTitle',
      'title',
      'summary',
      'destination',
      'sortOrder',
      'status',
      'version',
      'activatedAt',
      'archivedAt',
      'createdAt',
      'updatedAt',
    ])
    || !uuid(value.id)
    || !uuid(value.eventId)
    || typeof value.eventTitle !== 'string' || value.eventTitle.length > 120
    || typeof value.title !== 'string' || !value.title || value.title.length > 120
    || typeof value.summary !== 'string' || value.summary.length > 300
    || !destination(value.destination)
    || !nonNegativeInteger(value.sortOrder)
    || typeof value.status !== 'string' || !statuses.has(value.status)
    || !positiveInteger(value.version)
    || !nullableDate(value.activatedAt)
    || !nullableDate(value.archivedAt)
    || !date(value.createdAt)
    || !date(value.updatedAt)
    || (value.status === 'ACTIVE' && value.activatedAt === null)
    || ((value.status === 'ARCHIVED') !== (value.archivedAt !== null))) {
    invalid('视频回顾')
  }
  return value as unknown as AdminEventVideoRecap
}

export function parseAdminEventVideoRecapPage(value: unknown) {
  if (!record(value)
    || !hasExactKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')) {
    invalid('视频回顾列表')
  }
  return { items: value.items.map(parseAdminEventVideoRecap), nextCursor: value.nextCursor }
}
