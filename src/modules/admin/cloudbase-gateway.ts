import type {
  AdminAnnouncement,
  AdminAnnouncementDraft,
  AdminEventDraft,
  AdminEventManager,
  AdminEventPhoto,
  AdminGateway,
  AdminManagedEvent,
  AdminMemberReport,
  AdminRegistrationStatus,
  AdminRoleItem,
  AdminRosterQuery,
  AuditItem,
  EventManagerRole,
  MemberReportStatus,
  OperationalException,
} from './types'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'
import {
  AdminDtoError,
  parseAdminAttendanceResult,
  parseAdminDashboard,
  parseAdminEventCancelResult,
  parseAdminEventList,
  parseAdminEventSaveResult,
  parseAdminEventStatusResult,
  parseAdminManagedEvent,
  parseAdminOrderItem,
  parseAdminProfileItem,
  parseAdminRosterDownloadResult,
  parseAdminRosterExportResult,
  parseAdminRosterPage,
  parseAdminSession,
} from './event-dto'

export {
  parseAdminAttendanceResult,
  parseAdminEventCancelResult,
  parseAdminEventItem,
  parseAdminEventList,
  parseAdminEventSaveResult,
  parseAdminEventStatusResult,
  parseAdminRosterDownloadResult,
  parseAdminRosterExportResult,
  parseAdminRosterItem,
  parseAdminRosterPage,
} from './event-dto'

interface Envelope {
  ok: boolean
  data?: unknown
  error?: { code?: string, message?: string }
}

export class AdminGatewayError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AdminGatewayError'
    this.code = code
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseOperationalException(value: unknown): OperationalException {
  if (!record(value)
    || typeof value.id !== 'string'
    || !['REFUND', 'MEDIA_CLEANUP', 'MEDIA_PROCESSING', 'MEDIA_FAILURE', 'NOTIFICATION'].includes(String(value.type))
    || !['LOW', 'MEDIUM', 'HIGH'].includes(String(value.severity))
    || typeof value.title !== 'string'
    || typeof value.summary !== 'string'
    || typeof value.status !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || typeof value.canRetry !== 'boolean'
    || typeof value.route !== 'string'
    || typeof value.version !== 'number') {
    throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效的异常记录')
  }
  return value as unknown as OperationalException
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function parseAnnouncement(value: unknown): AdminAnnouncement {
  if (!record(value)
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || typeof value.summary !== 'string'
    || typeof value.body !== 'string'
    || !['DRAFT', 'PUBLISHED', 'WITHDRAWN'].includes(String(value.status))
    || typeof value.isPinned !== 'boolean'
    || typeof value.version !== 'number') {
    throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效的公告')
  }
  return {
    id: value.id,
    title: value.title,
    summary: value.summary,
    body: value.body,
    status: value.status as AdminAnnouncement['status'],
    isPinned: value.isPinned,
    visibleFrom: nullableString(value.visibleFrom),
    visibleUntil: nullableString(value.visibleUntil),
    publishedAt: nullableString(value.publishedAt),
    version: value.version,
    updatedAt: nullableString(value.updatedAt),
  }
}

function parseMemberReport(value: unknown): AdminMemberReport {
  if (!record(value)
    || typeof value.id !== 'string'
    || typeof value.targetMemberId !== 'string'
    || typeof value.targetNickname !== 'string'
    || typeof value.targetAvatarUrl !== 'string'
    || !['HARASSMENT', 'SPAM', 'FRAUD', 'INAPPROPRIATE', 'PRIVACY', 'OTHER'].includes(String(value.category))
    || typeof value.description !== 'string'
    || !['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'].includes(String(value.status))
    || typeof value.priorReportCount !== 'number'
    || typeof value.resolutionReason !== 'string'
    || typeof value.version !== 'number') {
    throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效的举报记录')
  }
  return {
    id: value.id,
    targetMemberId: value.targetMemberId,
    targetNickname: value.targetNickname,
    targetAvatarUrl: value.targetAvatarUrl,
    category: value.category as AdminMemberReport['category'],
    description: value.description,
    status: value.status as AdminMemberReport['status'],
    priorReportCount: value.priorReportCount,
    resolutionAction: nullableString(value.resolutionAction),
    resolutionReason: value.resolutionReason,
    version: value.version,
    createdAt: nullableString(value.createdAt),
    handledAt: nullableString(value.handledAt),
  }
}

function toGatewayError(error: unknown): never {
  if (error instanceof AdminGatewayError) {
    throw error
  }
  if (error instanceof AdminDtoError) {
    throw new AdminGatewayError(error.code, error.message)
  }
  throw error
}

function unwrapEnvelope(value: unknown): unknown {
  if (!record(value) || typeof value.ok !== 'boolean') {
    throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效响应')
  }
  const envelope = value as unknown as Envelope
  if (!envelope.ok) {
    const code = typeof envelope.error?.code === 'string' && envelope.error.code
      ? envelope.error.code
      : 'INTERNAL_ERROR'
    throw new AdminGatewayError(code, envelope.error?.message || '运营服务请求失败')
  }
  return envelope.data
}

const retryableReadActions = new Set([
  'getSession',
  'listManagedEvents',
  'getDashboard',
  'listProfiles',
  'listAdminRoles',
  'listEvents',
  'listEventRegistrations',
  'listEventManagers',
  'listPendingEventPhotos',
  'listOrders',
  'listAudit',
  'listOperationalExceptions',
  'listAnnouncements',
  'getAnnouncement',
  'listMemberReports',
])

async function callAdmin(action: string, data: Record<string, unknown> = {}): Promise<unknown> {
  let response
  try {
    response = await retryTransport(async () => {
      const cloud = await requireCloudClient()
      return cloud.callFunction({ name: runtimeConfig.cloudbase.adminFunctionName, data: { action, ...data } })
    }, retryableReadActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 })
  }
  catch (error) {
    if (error instanceof AdminGatewayError) {
      throw error
    }
    throw new AdminGatewayError('TRANSPORT_UNAVAILABLE', '运营服务暂时不可用，请稍后重试')
  }
  return unwrapEnvelope(response.result)
}

async function callMembershipAdmin(action: string, data: Record<string, unknown> = {}): Promise<unknown> {
  try {
    const cloud = await requireCloudClient()
    const response = await cloud.callFunction({
      name: runtimeConfig.cloudbase.membershipFunctionName,
      data: { action, ...data },
    })
    return resolveCloudFileUrls(unwrapEnvelope(response.result))
  }
  catch (error) {
    if (error instanceof AdminGatewayError) {
      throw error
    }
    throw new AdminGatewayError('TRANSPORT_UNAVAILABLE', '活动素材服务暂时不可用，请稍后重试')
  }
}

export const cloudbaseAdminGateway: AdminGateway = {
  async getSession() {
    try {
      return parseAdminSession(await callAdmin('getSession'))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async listManagedEvents() {
    try {
      const rows = await callAdmin('listManagedEvents')
      if (!Array.isArray(rows)) {
        throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的活动管理列表')
      }
      return resolveCloudFileUrls(rows.map(parseAdminManagedEvent) as AdminManagedEvent[])
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async getDashboard() {
    try {
      return parseAdminDashboard(await callAdmin('getDashboard'))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async listProfiles(status) {
    try {
      const rows = await callAdmin('listProfiles', status ? { status } : {})
      if (!Array.isArray(rows)) {
        throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的资料列表')
      }
      const parsed = rows.map(parseAdminProfileItem)
      // Resolve cloud:// avatar file IDs to temporary HTTPS/local URLs for review UI.
      return await resolveCloudFileUrls(parsed)
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async listAdminRoles() {
    const rows = await callAdmin('listAdminRoles')
    if (!Array.isArray(rows)) {
      throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效的管理员列表')
    }
    return rows.map((value): AdminRoleItem => {
      if (!record(value)
        || typeof value.profileId !== 'string'
        || typeof value.nickname !== 'string'
        || !['owner', 'manager', 'reviewer', 'support'].includes(String(value.role))
        || !['ACTIVE', 'SUSPENDED'].includes(String(value.status))
        || !Array.isArray(value.capabilities)) {
        throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效的管理员资料')
      }
      return {
        profileId: value.profileId,
        nickname: value.nickname,
        city: typeof value.city === 'string' ? value.city : '',
        role: value.role as AdminRoleItem['role'],
        status: value.status as AdminRoleItem['status'],
        capabilities: value.capabilities.filter((item): item is AdminRoleItem['capabilities'][number] =>
          typeof item === 'string'
          && ['dashboard', 'profiles', 'events', 'orders', 'refunds', 'audit', 'roles', 'operations', 'announcements', 'reports'].includes(item),
        ),
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      }
    })
  },
  setAdminRole(profileId, role, active) {
    return callAdmin('setAdminRole', { profileId, role, active }) as Promise<{
      profileId: string
      nickname: string
      role: 'manager' | 'reviewer' | 'support'
      status: 'ACTIVE' | 'SUSPENDED'
    }>
  },
  reviewProfile: (profileId, decision) => callAdmin('reviewProfile', { profileId, decision }) as Promise<{ id: string, status: string }>,
  setProfileStatus: (profileId, status) => callAdmin('setProfileStatus', { profileId, status }) as Promise<{ id: string, status: string }>,
  async listEvents() {
    try {
      return parseAdminEventList(await resolveCloudFileUrls(await callAdmin('listEvents')))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async uploadEventCover(base64, eventId) {
    const result = await callMembershipAdmin('uploadEventCover', {
      base64,
      eventId: eventId || '',
    })
    if (!record(result)
      || typeof result.assetId !== 'string'
      || typeof result.coverUrl !== 'string') {
      throw new AdminGatewayError('INVALID_RESPONSE', '活动素材服务返回了无效响应')
    }
    return { assetId: result.assetId, coverUrl: result.coverUrl }
  },
  async saveEvent(event: AdminEventDraft) {
    try {
      return parseAdminEventSaveResult(await callAdmin('saveEvent', { event }))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async duplicateEvent(eventId) {
    try {
      return parseAdminEventSaveResult(await callAdmin('duplicateEvent', { eventId }))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async setEventStatus(eventId, status, expectedVersion) {
    try {
      return parseAdminEventStatusResult(await callAdmin('setEventStatus', {
        eventId,
        status,
        expectedVersion,
      }))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async cancelEvent(eventId, reason, expectedVersion) {
    try {
      return parseAdminEventCancelResult(await callAdmin('cancelEvent', {
        eventId,
        reason,
        expectedVersion,
      }))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async listEventRegistrations(input: AdminRosterQuery) {
    try {
      const page = parseAdminRosterPage(await callAdmin('listEventRegistrations', {
        eventId: input.eventId,
        status: input.status || 'ALL',
        query: input.query || '',
        cursor: input.cursor || '',
        limit: input.limit || 20,
      }))
      // Resolve avatar media at the adapter boundary before page state.
      return await resolveCloudFileUrls(page)
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async reviewEventRegistration(eventId, registrationId, decision, expectedVersion, reason = '') {
    try {
      const result = await callAdmin('reviewEventRegistration', {
        eventId,
        registrationId,
        decision,
        expectedVersion,
        reason,
      })
      if (!record(result)
        || typeof result.id !== 'string'
        || typeof result.eventId !== 'string'
        || typeof result.status !== 'string'
        || ![
          'PENDING_REVIEW',
          'WAITLISTED',
          'REGISTERED',
          'CANCELLATION_PENDING',
          'ATTENDED',
          'REJECTED',
          'CANCELLED',
        ].includes(result.status)
        || typeof result.version !== 'number') {
        throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的报名审核结果')
      }
      return {
        id: result.id,
        eventId: result.eventId,
        status: result.status as AdminRegistrationStatus,
        version: result.version,
        ticketCodeMasked: typeof result.ticketCodeMasked === 'string'
          ? result.ticketCodeMasked
          : undefined,
      }
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async checkInRegistration(eventId, registrationId, expectedVersion, options) {
    try {
      return parseAdminAttendanceResult(await callAdmin('checkInRegistration', {
        eventId,
        registrationId,
        expectedVersion,
        allowOverride: Boolean(options?.allowOverride),
        idempotencyKey: options?.idempotencyKey || '',
      }))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async undoCheckIn(eventId, registrationId, expectedVersion, reason, options) {
    try {
      return parseAdminAttendanceResult(await callAdmin('undoCheckIn', {
        eventId,
        registrationId,
        expectedVersion,
        reason,
        idempotencyKey: options?.idempotencyKey || '',
      }))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async createRosterExport(input) {
    try {
      return parseAdminRosterExportResult(await callAdmin('createRosterExport', {
        eventId: input.eventId,
        status: input.status || 'ALL',
        query: input.query || '',
      }))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async downloadRosterExport(eventId, downloadToken) {
    try {
      return parseAdminRosterDownloadResult(await callAdmin('downloadRosterExport', {
        eventId,
        downloadToken,
      }))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async listEventManagers(eventId) {
    const rows = await callAdmin('listEventManagers', { eventId })
    if (!Array.isArray(rows)) {
      throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效的活动管理员列表')
    }
    return resolveCloudFileUrls(rows as AdminEventManager[])
  },
  setEventManager(eventId, profileId, role: EventManagerRole, active) {
    return callAdmin('setEventManager', {
      eventId,
      profileId,
      role,
      active,
    }) as Promise<{ eventId: string, profileId: string, role: EventManagerRole, active: boolean }>
  },
  async listPendingEventPhotos(eventId) {
    const rows = await callAdmin('listPendingEventPhotos', { eventId })
    if (!Array.isArray(rows)) {
      throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效的活动照片列表')
    }
    return resolveCloudFileUrls(rows as AdminEventPhoto[])
  },
  reviewEventPhoto(eventId, photoId, decision, expectedVersion, reason = '') {
    return callAdmin('reviewEventPhoto', {
      eventId,
      photoId,
      decision,
      expectedVersion,
      reason,
    }) as Promise<{ id: string, status: 'PUBLISHED' | 'REJECTED', version: number }>
  },
  async checkInByQr(value) {
    try {
      return parseAdminAttendanceResult(await callAdmin('checkInByQr', { value }))
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  async listOrders() {
    try {
      const rows = await callAdmin('listOrders')
      if (!Array.isArray(rows)) {
        throw new AdminDtoError('INVALID_RESPONSE', '运营服务返回了无效的订单列表')
      }
      return rows.map(parseAdminOrderItem)
    }
    catch (error) {
      toGatewayError(error)
    }
  },
  requestRefund: (orderId, reason) => callAdmin('createRefund', { orderId, reason }) as Promise<{ refundId: string, status: string }>,
  async submitRefund(refundId) {
    if (!runtimeConfig.cloudbase.paymentFunctionName) {
      throw new AdminGatewayError('PAYMENT_NOT_CONFIGURED', '尚未配置微信支付函数')
    }
    const cloud = await requireCloudClient()
    let response
    try {
      response = await cloud.callFunction({
        name: runtimeConfig.cloudbase.paymentFunctionName,
        data: { action: 'submitRefund', refundId },
      })
    }
    catch {
      throw new AdminGatewayError('TRANSPORT_UNAVAILABLE', '退款服务暂时不可用，请稍后重试')
    }
    unwrapEnvelope(response.result)
  },
  async syncRefund(refundId) {
    if (!runtimeConfig.cloudbase.paymentFunctionName) {
      throw new AdminGatewayError('PAYMENT_NOT_CONFIGURED', '尚未配置微信支付函数')
    }
    const cloud = await requireCloudClient()
    let response
    try {
      response = await cloud.callFunction({
        name: runtimeConfig.cloudbase.paymentFunctionName,
        data: { action: 'syncRefund', refundId },
      })
    }
    catch {
      throw new AdminGatewayError('TRANSPORT_UNAVAILABLE', '退款状态查询失败，请稍后重试')
    }
    return unwrapEnvelope(response.result) as { status: 'REFUND_CREATED' | 'REFUNDED' | 'REFUND_FAILED' }
  },
  async confirmRefund(refundId) {
    if (!runtimeConfig.cloudbase.paymentFunctionName) {
      throw new AdminGatewayError('PAYMENT_NOT_CONFIGURED', '尚未配置微信支付函数')
    }
    const cloud = await requireCloudClient()
    let response
    try {
      response = await cloud.callFunction({
        name: runtimeConfig.cloudbase.paymentFunctionName,
        data: { action: 'confirmRefund', refundId },
      })
    }
    catch {
      throw new AdminGatewayError('TRANSPORT_UNAVAILABLE', '退款到账确认失败，请稍后重试')
    }
    return unwrapEnvelope(response.result) as { status: 'REFUNDED' }
  },
  listAudit: () => callAdmin('listAudit') as Promise<AuditItem[]>,
  async listOperationalExceptions() {
    const rows = await callAdmin('listOperationalExceptions')
    if (!Array.isArray(rows)) {
      throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效的异常列表')
    }
    return rows.map(parseOperationalException)
  },
  retryOperationalException(item) {
    return callAdmin('retryOperationalException', item)
  },
  async listAnnouncements(status, query = '') {
    const rows = await callAdmin('listAnnouncements', { status: status || '', query })
    if (!Array.isArray(rows)) {
      throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效的公告列表')
    }
    return rows.map(parseAnnouncement)
  },
  async getAnnouncement(announcementId) {
    return parseAnnouncement(await callAdmin('getAnnouncement', { announcementId }))
  },
  async saveAnnouncement(announcement: AdminAnnouncementDraft) {
    return parseAnnouncement(await callAdmin('saveAnnouncement', { announcement }))
  },
  async setAnnouncementState(announcementId, transition, expectedVersion) {
    return parseAnnouncement(await callAdmin('setAnnouncementState', {
      announcementId,
      transition,
      expectedVersion,
    }))
  },
  async listMemberReports(status?: MemberReportStatus) {
    const rows = await callAdmin('listMemberReports', { status: status || '' })
    if (!Array.isArray(rows)) {
      throw new AdminGatewayError('INVALID_RESPONSE', '运营服务返回了无效的举报列表')
    }
    return resolveCloudFileUrls(rows.map(parseMemberReport))
  },
  resolveMemberReport(reportId, decision, reason, expectedVersion) {
    return callAdmin('resolveMemberReport', {
      reportId,
      decision,
      reason,
      expectedVersion,
    }) as Promise<{
      id: string
      status: MemberReportStatus
      resolutionAction: string
      version: number
    }>
  },
}
