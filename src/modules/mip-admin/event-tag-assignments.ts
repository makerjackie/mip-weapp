import { MipAdminError } from './error'

export type AdminEventTagCatalogStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'

export interface AdminEventTagOption {
  id: string
  key: string
  name: string
  description: string
  sortOrder: number
  catalogStatus: AdminEventTagCatalogStatus
  selectable: boolean
  selected: boolean
  assignmentVersion: number | null
}

export interface AdminEventTagAssignments {
  eventId: string
  eventVersion: number
  tags: AdminEventTagOption[]
}

export interface AdminEventTagAssignmentReplaceInput {
  eventId: string
  expectedVersion: number
  tagIds: string[]
}

export interface AdminEventTagAssignmentReplaceResult extends AdminEventTagAssignments {
  idempotent: boolean
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const stableKeyPattern = /^[\w.:-]+$/
const statuses = new Set<AdminEventTagCatalogStatus>(['ACTIVE', 'INACTIVE', 'ARCHIVED'])

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动标签数据')
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1
}

function parseTag(value: unknown): AdminEventTagOption {
  const keys = [
    'id',
    'key',
    'name',
    'description',
    'sortOrder',
    'catalogStatus',
    'selectable',
    'selected',
    'assignmentVersion',
  ] as const
  if (!record(value)
    || !exact(value, keys)
    || !uuid(value.id)
    || typeof value.key !== 'string'
    || value.key.length < 1
    || value.key.length > 64
    || !stableKeyPattern.test(value.key)
    || typeof value.name !== 'string'
    || value.name.length < 1
    || value.name.length > 80
    || typeof value.description !== 'string'
    || value.description.length > 300
    || !Number.isInteger(value.sortOrder)
    || Number(value.sortOrder) < 0
    || !statuses.has(value.catalogStatus as AdminEventTagCatalogStatus)
    || typeof value.selectable !== 'boolean'
    || typeof value.selected !== 'boolean'
    || !(value.assignmentVersion === null || positiveInteger(value.assignmentVersion))) {
    invalid()
  }
  if (value.selectable !== (value.catalogStatus === 'ACTIVE')
    || value.selected !== (value.assignmentVersion !== null)) {
    invalid()
  }
  return value as unknown as AdminEventTagOption
}

export function createAdminEventTagAssignmentsGetRequest(eventId: string) {
  if (!uuid(eventId)) {
    throw new MipAdminError('VALIDATION_FAILED', '活动标识无效')
  }
  return { eventId }
}

export function createAdminEventTagAssignmentsReplaceRequest(
  input: AdminEventTagAssignmentReplaceInput,
) {
  if (!uuid(input.eventId)
    || !positiveInteger(input.expectedVersion)
    || !Array.isArray(input.tagIds)
    || input.tagIds.length > 100
    || input.tagIds.some(tagId => !uuid(tagId))
    || new Set(input.tagIds).size !== input.tagIds.length) {
    throw new MipAdminError('VALIDATION_FAILED', '活动标签设置无效')
  }
  return {
    eventId: input.eventId,
    expectedVersion: input.expectedVersion,
    tagIds: [...input.tagIds].sort(),
  }
}

export function parseAdminEventTagAssignments(value: unknown): AdminEventTagAssignments {
  if (!record(value)
    || !exact(value, ['eventId', 'eventVersion', 'tags'])
    || !uuid(value.eventId)
    || !positiveInteger(value.eventVersion)
    || !Array.isArray(value.tags)) {
    invalid()
  }
  const tags = value.tags.map(parseTag)
  if (new Set(tags.map(tag => tag.id)).size !== tags.length
    || new Set(tags.map(tag => tag.key)).size !== tags.length) {
    invalid()
  }
  return {
    eventId: value.eventId,
    eventVersion: value.eventVersion,
    tags,
  }
}

export function parseAdminEventTagAssignmentReplaceResult(
  value: unknown,
): AdminEventTagAssignmentReplaceResult {
  if (!record(value)
    || !exact(value, ['eventId', 'eventVersion', 'tags', 'idempotent'])
    || typeof value.idempotent !== 'boolean') {
    invalid()
  }
  const state = parseAdminEventTagAssignments({
    eventId: value.eventId,
    eventVersion: value.eventVersion,
    tags: value.tags,
  })
  return { ...state, idempotent: value.idempotent }
}
