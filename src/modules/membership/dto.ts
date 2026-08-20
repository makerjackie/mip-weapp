import type {
  EventDetail,
  EventParticipantsPage,
  EventParticipantSummary,
  EventSummary,
  RegistrationAnswers,
  RegistrationCancellationOutcome,
  RegistrationHistoryItem,
  RegistrationLifecycleState,
  RegistrationOutcome,
  RegistrationQuestion,
} from './types'

export class MembershipDtoError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MembershipDtoError'
    this.code = code
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new MembershipDtoError('INVALID_RESPONSE', `会员服务返回了无效的 ${field}`)
  }
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new MembershipDtoError('INVALID_RESPONSE', `会员服务返回了无效的 ${field}`)
  }
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MembershipDtoError('INVALID_RESPONSE', `会员服务返回了无效的 ${field}`)
  }
  return value
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  if (typeof value !== 'string') {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的可选字符串')
  }
  return value
}

function requireUuid(value: unknown, field: string): string {
  const text = requireString(value, field)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new MembershipDtoError('INVALID_RESPONSE', `会员服务返回了无效的 ${field}`)
  }
  return text
}

const REGISTRATION_STATES = new Set([
  'PENDING_REVIEW',
  'WAITLISTED',
  'REGISTERED',
  'CANCELLATION_PENDING',
  'ATTENDED',
  'REJECTED',
  'CANCELLED',
])
const EVENT_STATES = new Set(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'])
const ACTIVITY_TYPES = new Set(['PUBLIC_FREE', 'MEMBER_INCLUDED', 'PAID'])

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
}

function parseParticipant(value: unknown): EventParticipantSummary {
  if (!record(value)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的参与者资料')
  }
  for (const forbidden of ['userId', 'user_id', 'openid', 'openId', 'phoneNumber', 'phone_number', 'ticketCode', 'ticket_code']) {
    if (Object.hasOwn(value, forbidden)) {
      throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了不允许的参与者字段')
    }
  }
  return {
    id: requireUuid(value.id, 'participant.id'),
    nickname: requireString(value.nickname, 'participant.nickname'),
    city: typeof value.city === 'string' ? value.city : '',
    headline: typeof value.headline === 'string' ? value.headline : '',
    bio: typeof value.bio === 'string' ? value.bio : '',
    organization: typeof value.organization === 'string' ? value.organization : '',
    roleTitle: typeof value.roleTitle === 'string' ? value.roleTitle : '',
    industry: typeof value.industry === 'string' ? value.industry : '',
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : '',
    tags: stringArray(value.tags),
    interests: stringArray(value.interests),
    skills: stringArray(value.skills),
    detailLocked: Boolean(value.detailLocked),
    registeredAt: requireString(value.registeredAt, 'participant.registeredAt'),
  }
}

function parseQuestion(value: unknown): RegistrationQuestion {
  if (!record(value)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的报名问题')
  }
  const type = requireString(value.type, 'question.type')
  if (!['SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'PHONE', 'ID_CARD', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'BOOLEAN'].includes(type)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的报名问题类型')
  }
  return {
    id: requireString(value.id, 'question.id'),
    label: requireString(value.label, 'question.label'),
    description: typeof value.description === 'string' ? value.description : '',
    type: type as RegistrationQuestion['type'],
    required: requireBoolean(value.required, 'question.required'),
    options: stringArray(value.options),
    profileField: optionalString(value.profileField),
    privacy: value.privacy === 'PUBLIC_WITH_CONSENT' ? 'PUBLIC_WITH_CONSENT' : 'ORGANIZER_ONLY',
    sortOrder: typeof value.sortOrder === 'number' ? value.sortOrder : 0,
    prefillValue: value.prefillValue as RegistrationAnswers[string],
  }
}

export function parseEventSummary(value: unknown): EventSummary {
  if (!record(value)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的活动摘要')
  }
  const eventState = requireString(value.eventState, 'eventState')
  if (!EVENT_STATES.has(eventState)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的活动状态')
  }
  const activityType = requireString(value.activityType, 'activityType')
  if (!ACTIVITY_TYPES.has(activityType)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的活动类型')
  }
  const registrationState = value.registrationState === null || value.registrationState === undefined
    ? null
    : requireString(value.registrationState, 'registrationState')
  if (registrationState && !REGISTRATION_STATES.has(registrationState)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的报名状态')
  }
  return {
    id: requireUuid(value.id, 'id'),
    title: requireString(value.title, 'title'),
    startsAt: requireString(value.startsAt, 'startsAt'),
    location: requireString(value.location, 'location'),
    priceCents: requireNumber(value.priceCents, 'priceCents'),
    memberFree: requireBoolean(value.memberFree, 'memberFree'),
    activityType: activityType as EventSummary['activityType'],
    registered: requireBoolean(value.registered, 'registered'),
    registrationState: registrationState as RegistrationLifecycleState | null,
    coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : '',
    capacity: value.capacity === null || value.capacity === undefined
      ? null
      : requireNumber(value.capacity, 'capacity'),
    registrationCount: requireNumber(value.registrationCount, 'registrationCount'),
    registrationOpen: requireBoolean(value.registrationOpen, 'registrationOpen'),
    registrationMode: value.registrationMode === 'APPROVAL' ? 'APPROVAL' : 'AUTO',
    waitlistEnabled: Boolean(value.waitlistEnabled),
    eventMode: ['ONLINE', 'HYBRID'].includes(String(value.eventMode))
      ? value.eventMode as EventSummary['eventMode']
      : 'OFFLINE',
    eventState: eventState as EventSummary['eventState'],
  }
}

export function parseEventDetail(value: unknown): EventDetail {
  const summary = parseEventSummary(value)
  if (!record(value)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的活动详情')
  }
  const registrationState = value.registrationState === null || value.registrationState === undefined
    ? null
    : requireString(value.registrationState, 'registrationState')
  if (registrationState && !REGISTRATION_STATES.has(registrationState)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的报名状态')
  }
  return {
    ...summary,
    summary: typeof value.summary === 'string' ? value.summary : '',
    description: requireString(value.description, 'description'),
    notices: typeof value.notices === 'string' ? value.notices : '',
    organizer: record(value.organizer)
      ? {
          id: requireString(value.organizer.id, 'organizer.id'),
          nickname: requireString(value.organizer.nickname, 'organizer.nickname'),
          headline: typeof value.organizer.headline === 'string' ? value.organizer.headline : '',
          avatarUrl: typeof value.organizer.avatarUrl === 'string' ? value.organizer.avatarUrl : '',
        }
      : null,
    venueName: typeof value.venueName === 'string' ? value.venueName : '',
    address: typeof value.address === 'string' ? value.address : '',
    latitude: value.latitude === null || value.latitude === undefined
      ? null
      : requireNumber(value.latitude, 'latitude'),
    longitude: value.longitude === null || value.longitude === undefined
      ? null
      : requireNumber(value.longitude, 'longitude'),
    onlineUrl: typeof value.onlineUrl === 'string' ? value.onlineUrl : '',
    endsAt: optionalString(value.endsAt),
    registrationDeadline: optionalString(value.registrationDeadline),
    cancellationPolicy: typeof value.cancellationPolicy === 'string' ? value.cancellationPolicy : '',
    formVersion: requireNumber(value.formVersion, 'formVersion'),
    registrationForm: Array.isArray(value.registrationForm)
      ? value.registrationForm.map(parseQuestion)
      : [],
    registrationAnswers: record(value.registrationAnswers)
      ? value.registrationAnswers as RegistrationAnswers
      : {},
    registrationSharesProfile: Boolean(value.registrationSharesProfile),
    registrationVersion: value.registrationVersion === null || value.registrationVersion === undefined
      ? null
      : requireNumber(value.registrationVersion, 'registrationVersion'),
    waitlistPosition: value.waitlistPosition === null || value.waitlistPosition === undefined
      ? null
      : requireNumber(value.waitlistPosition, 'waitlistPosition'),
    reviewReason: optionalString(value.reviewReason),
    changes: Array.isArray(value.changes)
      ? value.changes.filter(record).map(item => ({
          version: requireNumber(item.version, 'change.version'),
          type: ['SCHEDULE', 'VENUE', 'REGISTRATION', 'STATUS'].includes(String(item.type))
            ? item.type as EventDetail['changes'][number]['type']
            : 'CONTENT',
          summary: requireString(item.summary, 'change.summary'),
          createdAt: requireString(item.createdAt, 'change.createdAt'),
        }))
      : [],
    albumEnabled: Boolean(value.albumEnabled),
    albumPreview: Array.isArray(value.albumPreview)
      ? value.albumPreview.filter(record).map(item => ({
          id: requireString(item.id, 'album.id'),
          imageUrl: requireString(item.imageUrl, 'album.imageUrl'),
          caption: typeof item.caption === 'string' ? item.caption : '',
          nickname: typeof item.nickname === 'string' ? item.nickname : '活动成员',
          avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : '',
        }))
      : [],
    participantPreview: Array.isArray(value.participantPreview)
      ? value.participantPreview.map(parseParticipant)
      : [],
    visibleParticipantCount: typeof value.visibleParticipantCount === 'number'
      ? value.visibleParticipantCount
      : 0,
    posterUrl: typeof value.posterUrl === 'string' ? value.posterUrl : '',
    canManage: Boolean(value.canManage),
    managerRole: optionalString(value.managerRole),
    membershipActive: requireBoolean(value.membershipActive, 'membershipActive'),
    phoneBound: requireBoolean(value.phoneBound, 'phoneBound'),
    registrationState: registrationState as EventDetail['registrationState'],
    cancelledByType: optionalString(value.cancelledByType) as EventDetail['cancelledByType'],
    cancellationReason: optionalString(value.cancellationReason),
    cancelledAt: optionalString(value.cancelledAt),
    canCancel: requireBoolean(value.canCancel, 'canCancel'),
    canEditRegistration: Boolean(value.canEditRegistration),
    canRegister: requireBoolean(value.canRegister, 'canRegister'),
  }
}

export function parseEventParticipantsPage(value: unknown): EventParticipantsPage {
  if (!record(value)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的参与者列表')
  }
  return {
    eventId: requireUuid(value.eventId, 'eventId'),
    eventTitle: requireString(value.eventTitle, 'eventTitle'),
    totalRegistrationCount: requireNumber(value.totalRegistrationCount, 'totalRegistrationCount'),
    visibleParticipantCount: requireNumber(value.visibleParticipantCount, 'visibleParticipantCount'),
    roleFilters: stringArray(value.roleFilters),
    items: Array.isArray(value.items) ? value.items.map(parseParticipant) : [],
    nextCursor: optionalString(value.nextCursor),
  }
}

export function parseRegistrationHistoryItem(value: unknown): RegistrationHistoryItem {
  if (!record(value)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的报名历史')
  }
  if (Object.hasOwn(value, 'ticketCode') || Object.hasOwn(value, 'userId') || Object.hasOwn(value, 'openid')) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了不允许的身份字段')
  }
  const registrationState = requireString(value.registrationState, 'registrationState')
  if (!REGISTRATION_STATES.has(registrationState)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的报名状态')
  }
  const eventState = requireString(value.eventState, 'eventState')
  if (!EVENT_STATES.has(eventState)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的活动状态')
  }
  const status = requireString(value.status, 'status')
  if (!REGISTRATION_STATES.has(status)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的报名状态')
  }
  return {
    id: requireUuid(value.id, 'id'),
    eventId: requireUuid(value.eventId, 'eventId'),
    title: requireString(value.title, 'title'),
    startsAt: requireString(value.startsAt, 'startsAt'),
    location: requireString(value.location, 'location'),
    status: status as RegistrationHistoryItem['status'],
    eventState: eventState as RegistrationHistoryItem['eventState'],
    registrationState: registrationState as RegistrationHistoryItem['registrationState'],
    cancelledByType: optionalString(value.cancelledByType) as RegistrationHistoryItem['cancelledByType'],
    cancellationReason: optionalString(value.cancellationReason),
    cancelledAt: optionalString(value.cancelledAt),
    canCancel: requireBoolean(value.canCancel, 'canCancel'),
    ticketCodeMasked: requireString(value.ticketCodeMasked, 'ticketCodeMasked'),
  }
}

export function parseRegistrationList(value: unknown): RegistrationHistoryItem[] {
  if (!Array.isArray(value)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的报名列表')
  }
  return value.map(parseRegistrationHistoryItem)
}

export function parseRegisterEventResult(value: unknown): RegistrationOutcome {
  if (!record(value)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的报名结果')
  }
  if (value.kind === 'PAYMENT_REQUIRED') {
    return {
      kind: 'PAYMENT_REQUIRED',
      eventId: requireUuid(value.eventId, 'eventId'),
      orderId: requireUuid(value.orderId, 'orderId'),
      expiresAt: optionalString(value.expiresAt),
      idempotent: typeof value.idempotent === 'boolean' ? value.idempotent : undefined,
    }
  }
  const status = requireString(value.status, 'status')
  if (!REGISTRATION_STATES.has(status)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的报名状态')
  }
  return {
    kind: 'REGISTERED',
    eventId: requireUuid(value.eventId, 'eventId'),
    id: requireUuid(value.id, 'id'),
    status: status as RegistrationLifecycleState,
    version: value.version === undefined ? undefined : requireNumber(value.version, 'version'),
    ticketCodeMasked: typeof value.ticketCodeMasked === 'string' ? value.ticketCodeMasked : undefined,
    idempotent: typeof value.idempotent === 'boolean' ? value.idempotent : undefined,
  }
}

export function parseCancelRegistrationResult(value: unknown): RegistrationCancellationOutcome {
  if (!record(value)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的取消结果')
  }
  const status = requireString(value.status, 'status')
  if (!['CANCELLED', 'CANCELLATION_PENDING'].includes(status)) {
    throw new MembershipDtoError('INVALID_RESPONSE', '会员服务返回了无效的取消状态')
  }
  return {
    eventId: requireUuid(value.eventId, 'eventId'),
    id: requireUuid(value.id, 'id'),
    status: status as RegistrationCancellationOutcome['status'],
    version: value.version === undefined ? undefined : requireNumber(value.version, 'version'),
    refundId: optionalString(value.refundId),
    refundStatus: optionalString(value.refundStatus),
    idempotent: typeof value.idempotent === 'boolean' ? value.idempotent : undefined,
  }
}
