import type {
  EventDiscoveryFilters,
  EventDiscoveryOption,
  EventFeedResult,
  EventVideoRecap,
  MipEventDetail,
  MipEventListItem,
  RegistrationField,
} from './types'
import { MipEventsError } from './types'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const finderUserNamePattern = /^sph[A-Za-z0-9]+$/
const feedIdPattern = /^[\w=:+/.-]+$/
const stableKeyPattern = /^[\w.:-]{1,64}$/
const eventListKeys = [
  'id',
  'scopeType',
  'branchId',
  'branchName',
  'title',
  'summary',
  'coverUrl',
  'eventTypeLabel',
  'tags',
  'videoRecaps',
  'mode',
  'accessType',
  'startsAt',
  'endsAt',
  'cityName',
  'venueName',
  'status',
  'capacity',
  'registrationCount',
  'participantPreview',
  'registrationStatus',
  'albumEnabled',
] as const
const eventDetailKeys = [
  ...eventListKeys,
  'organizer',
  'invitationAttribution',
  'description',
  'contentMedia',
  'notices',
  'address',
  'latitude',
  'longitude',
  'onlineAccessAvailable',
  'onlineUrl',
  'registrationPolicy',
  'registrationOpensAt',
  'registrationDeadline',
  'cancellationDeadline',
  'priceCents',
  'currency',
  'formVersion',
  'registrationSchema',
  'changes',
  'canRegister',
  'canCancel',
  'canRetryRefund',
  'registrationVersion',
  'canCheckIn',
  'canInteract',
  'albumSubmissionPolicy',
] as const

function invalid(label: string): never {
  throw new MipEventsError('INVALID_RESPONSE', `活动服务返回了无效的${label}数据`)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every(key => allowed.includes(key))
}

function hasKeys(value: Record<string, unknown>, required: readonly string[]) {
  return required.every(key => Object.hasOwn(value, key))
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function boundedString(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0)
}

function optionalString(value: unknown, max: number, allowEmpty = false) {
  return value === undefined || boundedString(value, max, allowEmpty)
}

function dateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function optionalDate(value: unknown) {
  return value === undefined || dateString(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1
}

function stringList(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every(item => boundedString(item, maxLength))
    && new Set(value).size === value.length
}

function parseDiscoveryOptions(value: unknown, maxItems: number): EventDiscoveryOption[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    invalid('活动筛选目录')
  }
  const keys = new Set<string>()
  return value.map((item) => {
    if (!record(item)
      || !onlyKeys(item, ['key', 'name'])
      || !hasKeys(item, ['key', 'name'])
      || !boundedString(item.key, 64)
      || !stableKeyPattern.test(item.key)
      || !boundedString(item.name, 80)
      || keys.has(item.key)) {
      invalid('活动筛选目录')
    }
    keys.add(item.key)
    return item as unknown as EventDiscoveryOption
  })
}

export function parseEventDiscoveryFilters(value: unknown): EventDiscoveryFilters {
  if (!record(value)
    || !onlyKeys(value, ['eventTypes', 'tags'])
    || !hasKeys(value, ['eventTypes', 'tags'])) {
    invalid('活动筛选目录')
  }
  return {
    eventTypes: parseDiscoveryOptions(value.eventTypes, 100),
    tags: parseDiscoveryOptions(value.tags, 200),
  }
}

function parseVideoRecap(value: unknown): EventVideoRecap {
  if (!record(value)
    || !onlyKeys(value, ['id', 'title', 'summary', 'destination'])
    || !hasKeys(value, ['id', 'title', 'summary', 'destination'])
    || !uuid(value.id)
    || !boundedString(value.title, 120)
    || !boundedString(value.summary, 300, true)
    || !record(value.destination)
    || !onlyKeys(value.destination, ['provider', 'type', 'finderUserName', 'feedId'])
    || !hasKeys(value.destination, ['provider', 'type', 'finderUserName', 'feedId'])
    || value.destination.provider !== 'WECHAT_CHANNELS'
    || !['PROFILE', 'ACTIVITY'].includes(String(value.destination.type))
    || !boundedString(value.destination.finderUserName, 128)
    || !finderUserNamePattern.test(value.destination.finderUserName)
    || !(value.destination.feedId === null
      || (boundedString(value.destination.feedId, 256) && feedIdPattern.test(value.destination.feedId)))
    || (value.destination.type === 'PROFILE' && value.destination.feedId !== null)
    || (value.destination.type === 'ACTIVITY' && typeof value.destination.feedId !== 'string')) {
    invalid('视频回顾')
  }
  return value as unknown as EventVideoRecap
}

function participantPreview(value: unknown) {
  return record(value)
    && onlyKeys(value, ['participantRef', 'nickname', 'avatarUrl'])
    && hasKeys(value, ['participantRef', 'nickname'])
    && boundedString(value.participantRef, 2048)
    && boundedString(value.nickname, 120)
    && optionalString(value.avatarUrl, 4096, true)
}

function validEventListFields(value: Record<string, unknown>) {
  return hasKeys(value, [
    'id',
    'scopeType',
    'title',
    'summary',
    'eventTypeLabel',
    'tags',
    'videoRecaps',
    'mode',
    'accessType',
    'startsAt',
    'endsAt',
    'status',
    'registrationCount',
    'participantPreview',
    'albumEnabled',
  ])
  && uuid(value.id)
  && ['PLATFORM', 'BRANCH'].includes(String(value.scopeType))
  && (value.branchId === undefined || uuid(value.branchId))
  && optionalString(value.branchName, 120)
  && boundedString(value.title, 120)
  && boundedString(value.summary, 300, true)
  && optionalString(value.coverUrl, 4096, true)
  && boundedString(value.eventTypeLabel, 80)
  && stringList(value.tags, 100, 80)
  && Array.isArray(value.videoRecaps)
  && value.videoRecaps.length <= 100
  && value.videoRecaps.every(item => Boolean(parseVideoRecap(item)))
  && ['OFFLINE', 'ONLINE', 'HYBRID'].includes(String(value.mode))
  && ['FREE', 'MEMBER_INCLUDED', 'PAID'].includes(String(value.accessType))
  && dateString(value.startsAt)
  && dateString(value.endsAt)
  && optionalString(value.cityName, 80)
  && optionalString(value.venueName, 160)
  && ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED'].includes(String(value.status))
  && (value.capacity === undefined || positiveInteger(value.capacity))
  && nonNegativeInteger(value.registrationCount)
  && Array.isArray(value.participantPreview)
  && value.participantPreview.length <= 4
  && value.participantPreview.every(participantPreview)
  && (value.registrationStatus === undefined || [
    'PENDING_REVIEW',
    'WAITLISTED',
    'PAYMENT_PENDING',
    'REGISTERED',
    'CANCELLATION_PENDING',
    'CANCELLED',
    'REJECTED',
    'ATTENDED',
  ].includes(String(value.registrationStatus)))
  && typeof value.albumEnabled === 'boolean'
}

export function parseMipEventListItem(value: unknown): MipEventListItem {
  if (!record(value) || !onlyKeys(value, eventListKeys) || !validEventListFields(value)) {
    invalid('活动列表')
  }
  return value as unknown as MipEventListItem
}

function registrationField(value: unknown): value is RegistrationField {
  if (!record(value)
    || !onlyKeys(value, ['key', 'label', 'type', 'required', 'options', 'maxLength'])
    || !hasKeys(value, ['key', 'label', 'type', 'required'])
    || !boundedString(value.key, 64)
    || !boundedString(value.label, 120)
    || !['TEXT', 'TEXTAREA', 'SELECT', 'BOOLEAN'].includes(String(value.type))
    || typeof value.required !== 'boolean'
    || !(value.options === undefined || stringList(value.options, 100, 120))
    || !(value.maxLength === undefined || positiveInteger(value.maxLength))) {
    return false
  }
  return value.type !== 'SELECT' || (Array.isArray(value.options) && value.options.length > 0)
}

function organizer(value: unknown) {
  return record(value)
    && onlyKeys(value, ['profileRef', 'nickname', 'avatarUrl', 'headline'])
    && hasKeys(value, ['profileRef'])
    && boundedString(value.profileRef, 2048)
    && optionalString(value.nickname, 120)
    && optionalString(value.avatarUrl, 4096, true)
    && optionalString(value.headline, 240)
}

function invitationAttribution(value: unknown) {
  return record(value)
    && onlyKeys(value, ['sourceType', 'displayName', 'avatarUrl'])
    && hasKeys(value, ['sourceType', 'displayName'])
    && ['PLATFORM', 'USER'].includes(String(value.sourceType))
    && boundedString(value.displayName, 120)
    && optionalString(value.avatarUrl, 4096, true)
}

function contentMedia(value: unknown) {
  return record(value)
    && onlyKeys(value, ['imageUrl', 'caption'])
    && hasKeys(value, ['imageUrl', 'caption'])
    && boundedString(value.imageUrl, 4096, true)
    && boundedString(value.caption, 300, true)
}

function eventChange(value: unknown) {
  return record(value)
    && onlyKeys(value, ['version', 'summary', 'createdAt'])
    && hasKeys(value, ['version', 'summary', 'createdAt'])
    && positiveInteger(value.version)
    && boundedString(value.summary, 300)
    && dateString(value.createdAt)
}

export function parseMipEventDetail(value: unknown): MipEventDetail {
  if (!record(value)
    || !onlyKeys(value, eventDetailKeys)
    || !validEventListFields(value)
    || !hasKeys(value, [
      'description',
      'contentMedia',
      'onlineAccessAvailable',
      'registrationPolicy',
      'priceCents',
      'currency',
      'formVersion',
      'registrationSchema',
      'changes',
      'canRegister',
      'canCancel',
      'canRetryRefund',
      'canCheckIn',
      'canInteract',
      'albumSubmissionPolicy',
    ])
    || !boundedString(value.description, 50000, true)
    || !Array.isArray(value.contentMedia) || value.contentMedia.length > 100 || !value.contentMedia.every(contentMedia)
    || !(value.organizer === undefined || organizer(value.organizer))
    || !(value.invitationAttribution === undefined || invitationAttribution(value.invitationAttribution))
    || !(value.notices === undefined || boundedString(value.notices, 10000, true))
    || !(value.address === undefined || boundedString(value.address, 500, true))
    || !(value.latitude === undefined || (typeof value.latitude === 'number' && value.latitude >= -90 && value.latitude <= 90))
    || !(value.longitude === undefined || (typeof value.longitude === 'number' && value.longitude >= -180 && value.longitude <= 180))
    || typeof value.onlineAccessAvailable !== 'boolean'
    || !(value.onlineUrl === undefined || (boundedString(value.onlineUrl, 4096) && /^https:\/\//i.test(value.onlineUrl)))
    || (value.onlineAccessAvailable !== (typeof value.onlineUrl === 'string'))
    || !['AUTO', 'APPROVAL'].includes(String(value.registrationPolicy))
    || !optionalDate(value.registrationOpensAt)
    || !optionalDate(value.registrationDeadline)
    || !optionalDate(value.cancellationDeadline)
    || !nonNegativeInteger(value.priceCents)
    || value.currency !== 'CNY'
    || !positiveInteger(value.formVersion)
    || !Array.isArray(value.registrationSchema)
    || value.registrationSchema.length > 100
    || !value.registrationSchema.every(registrationField)
    || !Array.isArray(value.changes) || value.changes.length > 20 || !value.changes.every(eventChange)
    || typeof value.canRegister !== 'boolean'
    || typeof value.canCancel !== 'boolean'
    || typeof value.canRetryRefund !== 'boolean'
    || !(value.registrationVersion === undefined || positiveInteger(value.registrationVersion))
    || typeof value.canCheckIn !== 'boolean'
    || typeof value.canInteract !== 'boolean'
    || !['AUTO', 'REVIEW'].includes(String(value.albumSubmissionPolicy))) {
    invalid('活动详情')
  }
  return value as unknown as MipEventDetail
}

export function parseEventFeedResult(value: unknown): EventFeedResult {
  if (!record(value)
    || !onlyKeys(value, ['items', 'cities', 'nextCursor'])
    || !hasKeys(value, ['items'])
    || !Array.isArray(value.items)
    || value.items.length > 30
    || !(value.cities === undefined || stringList(value.cities, 500, 80))
    || !(value.nextCursor === undefined || boundedString(value.nextCursor, 2048))) {
    invalid('活动列表')
  }
  return {
    items: value.items.map(parseMipEventListItem),
    ...(value.cities === undefined ? {} : { cities: value.cities as string[] }),
    ...(value.nextCursor === undefined ? {} : { nextCursor: value.nextCursor as string }),
  }
}
