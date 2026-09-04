import type { AdminOperationAction } from '@mip/admin-contracts'
import type { AdminTransport } from './transport'
import type {
  AdminEvent,
  AdminPage,
  AdminRosterItem,
  AdminRosterStatus,
  AdminWebLoginConfirmation,
  MipAdminGateway,
} from './types'
import { createAdminRequest } from '@mip/admin-contracts'
import { resolveCloudFileUrls } from '../../platform/storage/cloud-media'
import { cloudbaseAdminTransport } from './cloudbase-transport'
import { MipAdminError } from './error'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const eventStatuses = new Set(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED', 'ARCHIVED'])
const eventAccessTypes = new Set(['FREE', 'MEMBER_INCLUDED', 'PAID'])
const eventContentSafetyStatuses = new Set(['PENDING', 'PASSED', 'REJECTED', 'ERROR'])
const rosterStatuses = new Set<AdminRosterStatus>([
  'PENDING_REVIEW',
  'WAITLISTED',
  'PAYMENT_PENDING',
  'REGISTERED',
  'CANCELLATION_PENDING',
  'CANCELLED',
  'REJECTED',
  'ATTENDED',
])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function validDate(value: unknown, nullable = false) {
  return (nullable && value === null)
    || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function invalidEventListResponse(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动列表')
}

function invalidResponse(label: string) {
  return new MipAdminError('INVALID_RESPONSE', `运营服务返回了无效的${label}`)
}

function parseWebLoginConfirmation(value: unknown): AdminWebLoginConfirmation {
  if (!record(value)
    || !hasOnlyKeys(value, ['confirmed'])
    || value.confirmed !== true) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的网页登录确认结果')
  }
  return { confirmed: true }
}

function parseAdminEvent(value: unknown): AdminEvent {
  const keys = [
    'id',
    'title',
    'summary',
    'scopeType',
    'branchId',
    'branchName',
    'status',
    'contentSafetyStatus',
    'startsAt',
    'endsAt',
    'cityName',
    'eventTypeKey',
    'accessType',
    'priceCents',
    'registrationPolicy',
    'albumEnabled',
    'albumSubmissionPolicy',
    'capacity',
    'registrationCount',
    'attendedCount',
    'version',
  ]
  if (!record(value)
    || !hasOnlyKeys(value, keys)
    || typeof value.id !== 'string'
    || !/^[\w-]{1,36}$/.test(value.id)
    || typeof value.title !== 'string'
    || value.title.length < 1
    || value.title.length > 120
    || typeof value.summary !== 'string'
    || value.summary.length > 300
    || !['PLATFORM', 'BRANCH'].includes(String(value.scopeType))
    || !(value.branchId === null
      || (typeof value.branchId === 'string' && /^[\w-]{1,36}$/.test(value.branchId)))
    || typeof value.branchName !== 'string'
    || value.branchName.length > 80
    || !eventStatuses.has(String(value.status))
    || !eventContentSafetyStatuses.has(String(value.contentSafetyStatus))
    || typeof value.startsAt !== 'string'
    || !Number.isFinite(Date.parse(value.startsAt))
    || typeof value.endsAt !== 'string'
    || !Number.isFinite(Date.parse(value.endsAt))
    || typeof value.cityName !== 'string'
    || value.cityName.length > 80
    || typeof value.eventTypeKey !== 'string'
    || !/^[\w.:-]{1,64}$/.test(value.eventTypeKey)
    || !eventAccessTypes.has(String(value.accessType))
    || !Number.isSafeInteger(value.priceCents)
    || Number(value.priceCents) < 0
    || !['AUTO', 'APPROVAL'].includes(String(value.registrationPolicy))
    || typeof value.albumEnabled !== 'boolean'
    || !['AUTO', 'REVIEW'].includes(String(value.albumSubmissionPolicy))
    || !(value.capacity === null || (Number.isInteger(value.capacity) && Number(value.capacity) > 0))
    || !Number.isInteger(value.registrationCount)
    || Number(value.registrationCount) < 0
    || !Number.isInteger(value.attendedCount)
    || Number(value.attendedCount) < 0
    || !Number.isInteger(value.version)
    || Number(value.version) < 1) {
    invalidEventListResponse()
  }
  if ((value.scopeType === 'PLATFORM' && value.branchId !== null)
    || (value.scopeType === 'BRANCH' && value.branchId === null)
    || Date.parse(value.endsAt as string) <= Date.parse(value.startsAt as string)
    || Number(value.attendedCount) > Number(value.registrationCount)
    || (value.accessType === 'PAID' && Number(value.priceCents) < 1)
    || (value.accessType !== 'PAID' && Number(value.priceCents) !== 0)) {
    invalidEventListResponse()
  }
  return value as unknown as AdminEvent
}

function parseAdminEventPage(value: unknown) {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === null
      || (typeof value.nextCursor === 'string' && value.nextCursor.length <= 512))) {
    invalidEventListResponse()
  }
  return {
    items: value.items.map(parseAdminEvent),
    nextCursor: value.nextCursor as string | null,
  }
}

function parseRosterPage<T>(value: unknown, label: string, parseItem: (item: unknown) => T): AdminPage<T> {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === undefined || value.nextCursor === null || typeof value.nextCursor === 'string')) {
    throw invalidResponse(label)
  }
  return {
    items: value.items.map(parseItem),
    nextCursor: value.nextCursor === undefined ? null : value.nextCursor,
  }
}

function parseRosterItem(value: unknown): AdminRosterItem {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'id',
      'nickname',
      'cityName',
      'status',
      'answers',
      'answerItems',
      'phoneBound',
      'phoneNumber',
      'submittedAt',
      'registeredAt',
      'checkedInAt',
      'version',
      'entitlementStartsAt',
      'entitlementEndsAt',
      'entitlementStatus',
    ])
    || typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || typeof value.nickname !== 'string'
    || value.nickname.length < 1
    || value.nickname.length > 64
    || typeof value.cityName !== 'string'
    || value.cityName.length > 80
    || !rosterStatuses.has(value.status as AdminRosterStatus)
    || !record(value.answers)
    || !Array.isArray(value.answerItems)
    || typeof value.phoneBound !== 'boolean'
    || !(value.phoneNumber === null || typeof value.phoneNumber === 'string')
    || !validDate(value.submittedAt)
    || !validDate(value.registeredAt, true)
    || !validDate(value.checkedInAt, true)
    || !Number.isInteger(value.version)
    || Number(value.version) < 1
    || !(value.entitlementStartsAt === undefined || validDate(value.entitlementStartsAt, true))
    || !(value.entitlementEndsAt === undefined || validDate(value.entitlementEndsAt, true))
    || !(value.entitlementStatus === undefined || value.entitlementStatus === null
      || ['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED'].includes(String(value.entitlementStatus)))) {
    throw invalidResponse('参与者名单')
  }
  for (const item of value.answerItems) {
    if (!record(item)
      || typeof item.key !== 'string'
      || item.key.length < 1
      || item.key.length > 48
      || typeof item.label !== 'string'
      || item.label.length < 1
      || item.label.length > 60
      || typeof item.value !== 'string'
      || item.value.length > 16_384) {
      throw invalidResponse('参与者名单')
    }
  }
  return value as unknown as AdminRosterItem
}

function parseAdminRosterPage(value: unknown): AdminPage<AdminRosterItem> {
  return parseRosterPage(value, '参与者名单', parseRosterItem)
}

export function createMipAdminGateway(transport: AdminTransport): MipAdminGateway {
  const call = <T>(action: AdminOperationAction, data: Record<string, unknown> = {}) => (
    transport.request<T>(createAdminRequest(action, data))
  )
  return {
    getSession: () => call('mip.admin.session'),
    confirmWebLogin: async challengeCode => parseWebLoginConfirmation(
      await call('mip.admin.webLogin.confirm', { challengeCode }),
    ),
    confirmWebLoginToken: async challengeToken => parseWebLoginConfirmation(
      await call('mip.admin.webLogin.confirm', { challengeToken }),
    ),
    listEvents: async input => parseAdminEventPage(
      await call('mip.admin.events.list', { ...(input || {}) }),
    ),
    getEvent: async eventId => resolveCloudFileUrls(
      await call('mip.admin.events.get', { eventId }),
    ),
    listRoster: async input => parseAdminRosterPage(await call('mip.admin.events.roster', { ...input })),
    checkIn: input => call('mip.admin.events.checkIn', input),
    undoCheckIn: input => call('mip.admin.events.undoCheckIn', input),
  }
}

export const cloudbaseMipAdminGateway = createMipAdminGateway(cloudbaseAdminTransport)
