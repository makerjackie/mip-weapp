import type {
  ActivityType,
  AdminAttendanceResult,
  AdminEventCancelResult,
  AdminEventItem,
  AdminEventSaveResult,
  AdminEventStatusResult,
  AdminRegistrationQuestion,
  AdminRegistrationStatus,
  AdminRosterDownloadResult,
  AdminRosterExportResult,
  AdminRosterItem,
  AdminRosterPage,
} from './types'

export class AdminDtoError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AdminDtoError'
    this.code = code
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new AdminDtoError('INVALID_RESPONSE', `运营服务返回了无效的 ${field}`)
  }
  return value
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireUuid(value: unknown, field: string): string {
  const text = requireString(value, field)
  if (!UUID_RE.test(text)) {
    throw new AdminDtoError('INVALID_RESPONSE', `运营服务返回了无效的 ${field}`)
  }
  return text
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效字符串字段')
  }
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', `运营服务返回了无效的 ${field}`)
  }
  return value
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效数字字段')
  }
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AdminDtoError('INVALID_RESPONSE', `运营服务返回了无效的 ${field}`)
  }
  return value
}

const ACTIVITY_TYPES = new Set<ActivityType>(['PUBLIC_FREE', 'MEMBER_INCLUDED', 'PAID'])
const EVENT_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'])

function parseActivityType(value: unknown): ActivityType {
  if (typeof value !== 'string' || !ACTIVITY_TYPES.has(value as ActivityType)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动类型')
  }
  return value as ActivityType
}

function parseRegistrationQuestion(value: unknown): AdminRegistrationQuestion {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的报名问题')
  }
  const type = requireString(value.type, 'question.type')
  if (!['SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'PHONE', 'ID_CARD', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'BOOLEAN'].includes(type)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的报名问题类型')
  }
  return {
    id: requireString(value.id, 'question.id'),
    label: requireString(value.label, 'question.label'),
    description: typeof value.description === 'string' ? value.description : '',
    type: type as AdminRegistrationQuestion['type'],
    required: requireBoolean(value.required, 'question.required'),
    options: Array.isArray(value.options)
      ? value.options.filter((item): item is string => typeof item === 'string')
      : [],
    profileField: optionalString(value.profileField),
    privacy: value.privacy === 'PUBLIC_WITH_CONSENT' ? 'PUBLIC_WITH_CONSENT' : 'ORGANIZER_ONLY',
    sortOrder: typeof value.sortOrder === 'number' ? value.sortOrder : 0,
  }
}

/**
 * Decode one admin event row from unknown. Malformed ok:true payloads become INVALID_RESPONSE.
 * Illegal price/member_free combinations are rejected instead of silently becoming PUBLIC_FREE.
 */
export function parseAdminEventItem(value: unknown): AdminEventItem {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动')
  }
  const activityType = parseActivityType(value.activityType)
  const memberFree = requireBoolean(value.memberFree, 'memberFree')
  const priceCents = requireNumber(value.priceCents, 'priceCents')
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动价格')
  }
  if (priceCents > 0 && memberFree) {
    throw new AdminDtoError('EVENT_DATA_INTEGRITY', '活动价格组合非法，无法编辑或发布')
  }
  if (activityType === 'PUBLIC_FREE' && (memberFree || priceCents !== 0)) {
    throw new AdminDtoError('EVENT_DATA_INTEGRITY', '活动类型与价格标志不一致')
  }
  if (activityType === 'MEMBER_INCLUDED' && (!memberFree || priceCents !== 0)) {
    throw new AdminDtoError('EVENT_DATA_INTEGRITY', '活动类型与价格标志不一致')
  }
  if (activityType === 'PAID' && (memberFree || priceCents < 1)) {
    throw new AdminDtoError('EVENT_DATA_INTEGRITY', '活动类型与价格标志不一致')
  }

  const status = requireString(value.status, 'status')
  if (!EVENT_STATUSES.has(status)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动状态')
  }

  const version = requireNumber(value.version, 'version')
  if (!Number.isInteger(version) || version < 1) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动版本')
  }

  return {
    id: requireUuid(value.id, 'id'),
    title: requireString(value.title, 'title'),
    description: requireString(value.description, 'description'),
    notices: typeof value.notices === 'string' ? value.notices : '',
    registrationSchema: Array.isArray(value.registrationSchema)
      ? value.registrationSchema.map(parseRegistrationQuestion)
      : [],
    formVersion: requireNumber(value.formVersion, 'formVersion'),
    registrationMode: value.registrationMode === 'APPROVAL' ? 'APPROVAL' : 'AUTO',
    waitlistEnabled: Boolean(value.waitlistEnabled),
    albumEnabled: requireBoolean(value.albumEnabled, 'albumEnabled'),
    albumRequiresReview: requireBoolean(value.albumRequiresReview, 'albumRequiresReview'),
    eventMode: ['ONLINE', 'HYBRID'].includes(String(value.eventMode))
      ? value.eventMode as AdminEventItem['eventMode']
      : 'OFFLINE',
    startsAt: requireString(value.startsAt, 'startsAt'),
    endsAt: requireString(value.endsAt, 'endsAt'),
    registrationDeadline: optionalString(value.registrationDeadline),
    venueName: requireString(value.venueName, 'venueName'),
    address: requireString(value.address, 'address'),
    location: requireString(value.location, 'location'),
    latitude: optionalNumber(value.latitude),
    longitude: optionalNumber(value.longitude),
    onlineUrl: typeof value.onlineUrl === 'string' ? value.onlineUrl : '',
    capacity: optionalNumber(value.capacity),
    cancellationPolicy: requireString(value.cancellationPolicy, 'cancellationPolicy'),
    coverAssetId: optionalString(value.coverAssetId),
    coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : '',
    version,
    memberFree,
    priceCents,
    activityType,
    status: status as AdminEventItem['status'],
    cancelledAt: optionalString(value.cancelledAt),
    cancellationReason: optionalString(value.cancellationReason),
    canDuplicate: requireBoolean(value.canDuplicate ?? false, 'canDuplicate'),
    canManageTeam: requireBoolean(value.canManageTeam ?? false, 'canManageTeam'),
  }
}

export function parseAdminEventList(value: unknown): AdminEventItem[] {
  if (!Array.isArray(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动列表')
  }
  return value.map(parseAdminEventItem)
}

export function parseAdminEventSaveResult(value: unknown): AdminEventSaveResult {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的保存结果')
  }
  const version = requireNumber(value.version, 'version')
  if (!Number.isInteger(version) || version < 1) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动版本')
  }
  return {
    id: requireUuid(value.id, 'id'),
    version,
  }
}

export function parseAdminEventStatusResult(value: unknown): AdminEventStatusResult {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的状态结果')
  }
  const status = requireString(value.status, 'status')
  if (status === 'CANCELLED' || !EVENT_STATUSES.has(status)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动状态')
  }
  const version = requireNumber(value.version, 'version')
  if (!Number.isInteger(version) || version < 1) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动版本')
  }
  return {
    id: requireUuid(value.id, 'id'),
    status: status as AdminEventStatusResult['status'],
    version,
  }
}

export function parseAdminEventCancelResult(value: unknown): AdminEventCancelResult {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的取消结果')
  }
  const status = requireString(value.status, 'status')
  if (status !== 'CANCELLED') {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的取消状态')
  }
  const version = requireNumber(value.version, 'version')
  if (!Number.isInteger(version) || version < 1) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动版本')
  }
  const affectedCount = requireNumber(value.affectedCount, 'affectedCount')
  if (!Number.isInteger(affectedCount) || affectedCount < 0) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的受影响人数')
  }
  const refundIds = Array.isArray(value.refundIds)
    ? value.refundIds.map(item => requireUuid(item, 'refundId'))
    : []
  return {
    id: requireUuid(value.id, 'id'),
    status: 'CANCELLED',
    version,
    cancelledAt: optionalString(value.cancelledAt),
    cancellationReason: requireString(value.cancellationReason, 'cancellationReason'),
    affectedCount,
    refundIds,
  }
}

const REGISTRATION_STATUSES = new Set<AdminRegistrationStatus>([
  'PENDING_REVIEW',
  'WAITLISTED',
  'REGISTERED',
  'CANCELLATION_PENDING',
  'ATTENDED',
  'REJECTED',
  'CANCELLED',
])

function parseRegistrationStatus(value: unknown, field: string): AdminRegistrationStatus {
  const status = requireString(value, field)
  if (!REGISTRATION_STATUSES.has(status as AdminRegistrationStatus)) {
    throw new AdminDtoError('INVALID_RESPONSE', `运营服务返回了无效的 ${field}`)
  }
  return status as AdminRegistrationStatus
}

/** Reject internal identity leakage before the page can render it. */
function assertNoInternalIdentity(value: Record<string, unknown>, { allowPhoneNumber = false } = {}) {
  for (const key of ['openid', 'openId', 'userId', 'user_id', 'phone', 'ticketCode', 'ticket_code']) {
    if (Object.hasOwn(value, key)) {
      throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了不允许的身份字段')
    }
  }
  if (!allowPhoneNumber && Object.hasOwn(value, 'phoneNumber')) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了不允许的身份字段')
  }
}

export function parseAdminRosterItem(
  value: unknown,
  { allowPhoneNumber = false } = {},
): AdminRosterItem {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的报名名单项')
  }
  assertNoInternalIdentity(value, { allowPhoneNumber })
  const version = requireNumber(value.version, 'version')
  if (!Number.isInteger(version) || version < 1) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的报名版本')
  }
  const answers = Array.isArray(value.answers)
    ? value.answers.map((item) => {
        if (!record(item)) {
          throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的报名答案')
        }
        return {
          label: requireString(item.label, 'answer.label'),
          value: requireString(item.value, 'answer.value'),
        }
      })
    : []
  return {
    id: requireUuid(value.id, 'id'),
    nickname: requireString(value.nickname, 'nickname'),
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : '',
    city: requireString(value.city, 'city'),
    status: parseRegistrationStatus(value.status, 'status'),
    ticketCodeMasked: requireString(value.ticketCodeMasked, 'ticketCodeMasked'),
    registeredAt: requireString(value.registeredAt, 'registeredAt'),
    attendedAt: optionalString(value.attendedAt),
    phoneBound: requireBoolean(value.phoneBound, 'phoneBound'),
    phoneNumber: allowPhoneNumber ? optionalString(value.phoneNumber) : null,
    answers,
    reviewReason: optionalString(value.reviewReason),
    version,
  }
}

export function parseAdminRosterPage(value: unknown): AdminRosterPage {
  if (!record(value) || !record(value.event) || !Array.isArray(value.items)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的报名名单')
  }
  assertNoInternalIdentity(value.event)
  const eventStatus = requireString(value.event.status, 'event.status')
  if (!EVENT_STATUSES.has(eventStatus)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动状态')
  }
  const registrationCount = requireNumber(value.event.registrationCount, 'registrationCount')
  const pendingReviewCount = requireNumber(value.event.pendingReviewCount ?? 0, 'pendingReviewCount')
  const waitlistedCount = requireNumber(value.event.waitlistedCount ?? 0, 'waitlistedCount')
  const cancellationPendingCount = requireNumber(
    value.event.cancellationPendingCount ?? 0,
    'cancellationPendingCount',
  )
  const attendedCount = requireNumber(value.event.attendedCount, 'attendedCount')
  const rejectedCount = requireNumber(value.event.rejectedCount ?? 0, 'rejectedCount')
  const cancelledCount = requireNumber(value.event.cancelledCount, 'cancelledCount')
  const totalCount = requireNumber(value.event.totalCount, 'totalCount')
  if (
    ![
      registrationCount,
      pendingReviewCount,
      waitlistedCount,
      cancellationPendingCount,
      attendedCount,
      rejectedCount,
      cancelledCount,
      totalCount,
    ]
      .every(item => Number.isInteger(item) && item >= 0)
  ) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的名单统计')
  }
  const canViewSensitiveRoster = requireBoolean(
    value.canViewSensitiveRoster ?? false,
    'canViewSensitiveRoster',
  )
  return {
    event: {
      id: requireUuid(value.event.id, 'event.id'),
      title: requireString(value.event.title, 'event.title'),
      startsAt: requireString(value.event.startsAt, 'event.startsAt'),
      status: eventStatus as AdminEventItem['status'],
      registrationCount,
      pendingReviewCount,
      waitlistedCount,
      cancellationPendingCount,
      attendedCount,
      rejectedCount,
      cancelledCount,
      totalCount,
    },
    items: value.items.map(item => parseAdminRosterItem(item, {
      allowPhoneNumber: canViewSensitiveRoster,
    })),
    nextCursor: optionalString(value.nextCursor),
    canViewSensitiveRoster,
    canExportRoster: requireBoolean(value.canExportRoster ?? false, 'canExportRoster'),
    canReviewRegistration: requireBoolean(
      value.canReviewRegistration ?? false,
      'canReviewRegistration',
    ),
    canCheckIn: requireBoolean(value.canCheckIn ?? false, 'canCheckIn'),
    canUndoCheckIn: requireBoolean(value.canUndoCheckIn ?? false, 'canUndoCheckIn'),
    canOverrideCheckIn: requireBoolean(
      value.canOverrideCheckIn ?? false,
      'canOverrideCheckIn',
    ),
  }
}

export function parseAdminAttendanceResult(value: unknown): AdminAttendanceResult {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的签到结果')
  }
  const version = requireNumber(value.version, 'version')
  if (!Number.isInteger(version) || version < 1) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的报名版本')
  }
  return {
    id: requireUuid(value.id, 'id'),
    eventId: requireUuid(value.eventId, 'eventId'),
    status: parseRegistrationStatus(value.status, 'status'),
    version,
    attendedAt: optionalString(value.attendedAt),
    idempotent: typeof value.idempotent === 'boolean' ? value.idempotent : undefined,
    override: typeof value.override === 'boolean' ? value.override : undefined,
  }
}

const DOWNLOAD_TOKEN_RE = /^[a-f0-9]{64}$/i
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const EXPORT_FILE_NAME_RE = /^event-roster-[0-9TZ]+\.xlsx$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const MAX_EXPORT_BASE64_CHARS = 6 * 1024 * 1024

function requireIsoDate(value: unknown, field: string): string {
  const text = requireString(value, field)
  if (!ISO_DATE_RE.test(text) || Number.isNaN(Date.parse(text))) {
    throw new AdminDtoError('INVALID_RESPONSE', `运营服务返回了无效的 ${field}`)
  }
  return text
}

export function parseAdminRosterExportResult(value: unknown): AdminRosterExportResult {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的导出结果')
  }
  if (Object.hasOwn(value, 'objectKey') || Object.hasOwn(value, 'path')) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了不允许的导出路径')
  }
  const rowCount = requireNumber(value.rowCount, 'rowCount')
  if (!Number.isInteger(rowCount) || rowCount < 0) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的导出行数')
  }
  const downloadToken = requireString(value.downloadToken, 'downloadToken')
  if (!DOWNLOAD_TOKEN_RE.test(downloadToken)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的导出令牌')
  }
  const fileName = requireString(value.fileName, 'fileName')
  if (!EXPORT_FILE_NAME_RE.test(fileName) || fileName.includes('..') || fileName.includes('/')) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的导出文件名')
  }
  const contentType = requireString(value.contentType, 'contentType')
  if (contentType !== XLSX_CONTENT_TYPE) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的导出类型')
  }
  return {
    downloadToken,
    fileName,
    rowCount,
    expiresAt: requireIsoDate(value.expiresAt, 'expiresAt'),
    contentType,
  }
}

export function parseAdminRosterDownloadResult(value: unknown): AdminRosterDownloadResult {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的导出下载结果')
  }
  if (Object.hasOwn(value, 'objectKey') || Object.hasOwn(value, 'path')) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了不允许的导出路径')
  }
  const fileName = requireString(value.fileName, 'fileName')
  if (!EXPORT_FILE_NAME_RE.test(fileName) || fileName.includes('..') || fileName.includes('/')) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的导出文件名')
  }
  const contentType = requireString(value.contentType, 'contentType')
  if (contentType !== XLSX_CONTENT_TYPE) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的导出类型')
  }
  const contentBase64 = requireString(value.contentBase64, 'contentBase64')
  if (!/^[A-Z0-9+/]+=*$/i.test(contentBase64) || contentBase64.length > MAX_EXPORT_BASE64_CHARS) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的导出内容')
  }
  return {
    fileName,
    contentType,
    contentBase64,
  }
}

export function parseAdminSession(value: unknown): import('./types').AdminSession {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的会话')
  }
  const enabled = requireBoolean(value.enabled, 'enabled')
  const role = value.role === null || value.role === undefined
    ? null
    : requireString(value.role, 'role')
  if (role && !['owner', 'manager', 'reviewer', 'support'].includes(role)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的角色')
  }
  if (!Array.isArray(value.capabilities)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的权限列表')
  }
  return {
    enabled,
    role: role as import('./types').AdminRole | null,
    eventManagerEnabled: Boolean(value.eventManagerEnabled),
    capabilities: value.capabilities.map((item) => {
      if (typeof item !== 'string') {
        throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的权限')
      }
      return item as import('./types').AdminCapability
    }),
  }
}

export function parseAdminManagedEvent(value: unknown): import('./types').AdminManagedEvent {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动管理信息')
  }
  const status = requireString(value.status, 'status')
  if (!EVENT_STATUSES.has(status)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动状态')
  }
  const managerRole = requireString(value.managerRole, 'managerRole')
  if (!['GLOBAL', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF'].includes(managerRole)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动管理角色')
  }
  return {
    id: requireUuid(value.id, 'id'),
    title: requireString(value.title, 'title'),
    startsAt: requireString(value.startsAt, 'startsAt'),
    endsAt: requireString(value.endsAt, 'endsAt'),
    location: requireString(value.location, 'location'),
    coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : '',
    status: status as import('./types').AdminManagedEvent['status'],
    managerRole: managerRole as import('./types').AdminManagedEvent['managerRole'],
    registrationCount: requireNumber(value.registrationCount, 'registrationCount'),
    canEdit: requireBoolean(value.canEdit ?? false, 'canEdit'),
    canManageTeam: requireBoolean(value.canManageTeam ?? false, 'canManageTeam'),
    canRoster: requireBoolean(value.canRoster, 'canRoster'),
    canViewSensitiveRoster: requireBoolean(
      value.canViewSensitiveRoster ?? false,
      'canViewSensitiveRoster',
    ),
    canExportRoster: requireBoolean(value.canExportRoster ?? false, 'canExportRoster'),
    canCheckIn: requireBoolean(value.canCheckIn, 'canCheckIn'),
    canAlbum: requireBoolean(value.canAlbum, 'canAlbum'),
  }
}

export function parseAdminOrderItem(value: unknown): import('./types').AdminOrderItem {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的订单')
  }
  return {
    id: requireUuid(value.id, 'id'),
    planName: requireString(value.planName, 'planName'),
    amountCents: requireNumber(value.amountCents, 'amountCents'),
    status: requireString(value.status, 'status'),
    createdAt: requireString(value.createdAt, 'createdAt'),
    paidAt: optionalString(value.paidAt),
    canRefund: requireBoolean(value.canRefund, 'canRefund'),
    refundBlockReason: optionalString(value.refundBlockReason),
    canConfirmRefund: requireBoolean(value.canConfirmRefund, 'canConfirmRefund'),
    refundId: optionalString(value.refundId),
  }
}

export function parseAdminProfileItem(value: unknown): import('./types').AdminProfileItem {
  if (!record(value)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的资料')
  }
  if (!Array.isArray(value.tags)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的标签')
  }
  return {
    id: requireUuid(value.id, 'id'),
    nickname: requireString(value.nickname, 'nickname'),
    city: requireString(value.city, 'city'),
    headline: requireString(value.headline, 'headline'),
    tags: value.tags.map((tag) => {
      if (typeof tag !== 'string') {
        throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的标签')
      }
      return tag
    }),
    status: requireString(value.status, 'status') as import('./types').AdminProfileItem['status'],
    updatedAt: requireString(value.updatedAt, 'updatedAt'),
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : '',
  }
}

export function parseAdminDashboard(value: unknown): import('./types').AdminDashboard {
  if (!record(value) || !record(value.session) || !record(value.counts) || !Array.isArray(value.recentAudit)) {
    throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的运营概览')
  }
  return {
    session: parseAdminSession(value.session),
    counts: {
      totalUsers: requireNumber(value.counts.totalUsers, 'totalUsers'),
      newUsers7d: requireNumber(value.counts.newUsers7d, 'newUsers7d'),
      activeMembers: requireNumber(value.counts.activeMembers, 'activeMembers'),
      upcomingRegistrations: requireNumber(value.counts.upcomingRegistrations, 'upcomingRegistrations'),
      pendingProfiles: requireNumber(value.counts.pendingProfiles, 'pendingProfiles'),
      publishedEvents: requireNumber(value.counts.publishedEvents, 'publishedEvents'),
      paidOrders: requireNumber(value.counts.paidOrders, 'paidOrders'),
      pendingRefunds: requireNumber(value.counts.pendingRefunds, 'pendingRefunds'),
      operationalExceptions: requireNumber(
        value.counts.operationalExceptions ?? 0,
        'operationalExceptions',
      ),
      publishedAnnouncements: requireNumber(
        value.counts.publishedAnnouncements ?? 0,
        'publishedAnnouncements',
      ),
      pendingReports: requireNumber(value.counts.pendingReports ?? 0, 'pendingReports'),
    },
    recentAudit: value.recentAudit.map((item) => {
      if (!record(item)) {
        throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的审计项')
      }
      return {
        id: requireString(item.id, 'id'),
        action: requireString(item.action, 'action'),
        resourceType: requireString(item.resourceType, 'resourceType'),
        resourceId: requireString(item.resourceId, 'resourceId'),
        actorRole: requireString(item.actorRole, 'actorRole'),
        createdAt: requireString(item.createdAt, 'createdAt'),
      }
    }),
  }
}
