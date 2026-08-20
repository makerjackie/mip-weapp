import type { QueryOptions } from '@weapp/shared/cache'
import type {
  AdminAnnouncement,
  AdminAnnouncementDraft,
  AdminAttendanceResult,
  AdminDashboard,
  AdminEventCancelResult,
  AdminEventDraft,
  AdminEventItem,
  AdminEventManager,
  AdminEventPhoto,
  AdminManagedEvent,
  AdminMemberReport,
  AdminOrderItem,
  AdminProfileItem,
  AdminRoleItem,
  AdminRosterExportResult,
  AdminRosterPage,
  AdminRosterQuery,
  AdminSession,
  AuditItem,
  EventManagerRole,
  MemberReportStatus,
  OperationalException,
} from './types'
import { createQueryCache } from '@weapp/shared/cache'
import { membershipModule } from '../membership/client'
import { cloudbaseAdminGateway } from './cloudbase-gateway'

const cache = createQueryCache(20_000)

async function loadOrders() {
  const orders = await cloudbaseAdminGateway.listOrders()
  const pendingRefunds = orders
    .filter(item => item.status === 'REFUND_PENDING' && item.refundId)
    .slice(0, 5)
  if (!pendingRefunds.length) {
    return orders
  }
  const results = await Promise.allSettled(
    pendingRefunds.map(item => cloudbaseAdminGateway.syncRefund(item.refundId as string)),
  )
  return results.some(result => result.status === 'fulfilled' && result.value.status !== 'REFUND_CREATED')
    ? cloudbaseAdminGateway.listOrders()
    : orders
}

function rosterCacheKey(input: AdminRosterQuery) {
  return [
    'roster',
    input.eventId,
    input.status || 'ALL',
    input.query || '',
    input.cursor || '',
    String(input.limit || 20),
  ].join(':')
}

function invalidateAdminEventCaches() {
  cache.invalidate('events')
  cache.invalidate('dashboard')
  cache.invalidate('audit')
  cache.invalidate('roster')
  // Case-local bridge: admin mutations must also drop member overview/events/detail/registrations.
  membershipModule.invalidateEventCaches()
}

function invalidateRosterCaches(eventId?: string) {
  cache.invalidate(eventId ? `roster:${eventId}` : 'roster')
  cache.invalidate('events')
  cache.invalidate('dashboard')
  cache.invalidate('audit')
  membershipModule.invalidateEventCaches()
}

export const adminModule = {
  getSession(options?: QueryOptions) {
    return cache.query<AdminSession>('session', cloudbaseAdminGateway.getSession, options)
  },
  peekSession() {
    return cache.peek<AdminSession>('session')
  },
  listManagedEvents(options?: QueryOptions) {
    return cache.query<AdminManagedEvent[]>('managed-events', cloudbaseAdminGateway.listManagedEvents, options)
  },
  peekManagedEvents() {
    return cache.peek<AdminManagedEvent[]>('managed-events')
  },
  getDashboard(options?: QueryOptions) {
    return cache.query<AdminDashboard>('dashboard', cloudbaseAdminGateway.getDashboard, options)
  },
  peekDashboard() {
    return cache.peek<AdminDashboard>('dashboard')
  },
  listProfiles(status?: string, options?: QueryOptions) {
    return cache.query<AdminProfileItem[]>(`profiles:${status || 'all'}`, () => cloudbaseAdminGateway.listProfiles(status), options)
  },
  peekProfiles(status?: string) {
    return cache.peek<AdminProfileItem[]>(`profiles:${status || 'all'}`)
  },
  listAdminRoles(options?: QueryOptions) {
    return cache.query<AdminRoleItem[]>('admin-roles', cloudbaseAdminGateway.listAdminRoles, options)
  },
  peekAdminRoles() {
    return cache.peek<AdminRoleItem[]>('admin-roles')
  },
  async setAdminRole(profileId: string, role: 'manager' | 'reviewer' | 'support', active: boolean) {
    const result = await cloudbaseAdminGateway.setAdminRole(profileId, role, active)
    cache.invalidate('admin-roles')
    cache.invalidate('audit')
    return result
  },
  async reviewProfile(profileId: string, decision: 'approve' | 'reject') {
    const result = await cloudbaseAdminGateway.reviewProfile(profileId, decision)
    cache.invalidate('profiles')
    cache.invalidate('dashboard')
    cache.invalidate('audit')
    return result
  },
  async setProfileStatus(profileId: string, status: 'APPROVED' | 'SUSPENDED') {
    const result = await cloudbaseAdminGateway.setProfileStatus(profileId, status)
    cache.invalidate('profiles')
    cache.invalidate('dashboard')
    cache.invalidate('audit')
    return result
  },
  listEvents(options?: QueryOptions) {
    return cache.query<AdminEventItem[]>('events', cloudbaseAdminGateway.listEvents, options)
  },
  peekEvents() {
    return cache.peek<AdminEventItem[]>('events')
  },
  async saveEvent(event: AdminEventDraft) {
    const result = await cloudbaseAdminGateway.saveEvent(event)
    invalidateAdminEventCaches()
    return result
  },
  async duplicateEvent(eventId: string) {
    const result = await cloudbaseAdminGateway.duplicateEvent(eventId)
    invalidateAdminEventCaches()
    return result
  },
  uploadEventCover(base64: string, eventId = '') {
    return cloudbaseAdminGateway.uploadEventCover(base64, eventId)
  },
  async setEventStatus(
    eventId: string,
    status: Exclude<AdminEventItem['status'], 'CANCELLED'>,
    expectedVersion: number,
  ) {
    const result = await cloudbaseAdminGateway.setEventStatus(eventId, status, expectedVersion)
    invalidateAdminEventCaches()
    return result
  },
  async cancelEvent(eventId: string, reason: string, expectedVersion: number): Promise<AdminEventCancelResult> {
    const result = await cloudbaseAdminGateway.cancelEvent(eventId, reason, expectedVersion)
    const submissions = await Promise.allSettled(
      result.refundIds.map(refundId => cloudbaseAdminGateway.submitRefund(refundId)),
    )
    invalidateAdminEventCaches()
    return {
      ...result,
      refundSubmitFailedCount: submissions.filter(item => item.status === 'rejected').length,
    }
  },
  listEventRegistrations(input: AdminRosterQuery, options?: QueryOptions) {
    return cache.query<AdminRosterPage>(
      rosterCacheKey(input),
      () => cloudbaseAdminGateway.listEventRegistrations(input),
      options,
    )
  },
  peekEventRegistrations(input: AdminRosterQuery) {
    return cache.peek<AdminRosterPage>(rosterCacheKey(input))
  },
  async reviewEventRegistration(
    eventId: string,
    registrationId: string,
    decision: 'approve' | 'reject',
    expectedVersion: number,
    reason = '',
  ) {
    const result = await cloudbaseAdminGateway.reviewEventRegistration(
      eventId,
      registrationId,
      decision,
      expectedVersion,
      reason,
    )
    invalidateRosterCaches(eventId)
    return result
  },
  async checkInRegistration(
    eventId: string,
    registrationId: string,
    expectedVersion: number,
    options?: { allowOverride?: boolean, idempotencyKey?: string },
  ): Promise<AdminAttendanceResult> {
    const result = await cloudbaseAdminGateway.checkInRegistration(
      eventId,
      registrationId,
      expectedVersion,
      options,
    )
    invalidateRosterCaches(eventId)
    return result
  },
  async undoCheckIn(
    eventId: string,
    registrationId: string,
    expectedVersion: number,
    reason: string | { category: string, text?: string },
    options?: { idempotencyKey?: string },
  ): Promise<AdminAttendanceResult> {
    const result = await cloudbaseAdminGateway.undoCheckIn(
      eventId,
      registrationId,
      expectedVersion,
      reason,
      options,
    )
    invalidateRosterCaches(eventId)
    return result
  },
  async createRosterExport(
    input: Pick<AdminRosterQuery, 'eventId' | 'status' | 'query'>,
  ): Promise<AdminRosterExportResult> {
    const result = await cloudbaseAdminGateway.createRosterExport(input)
    cache.invalidate('audit')
    return result
  },
  downloadRosterExport(eventId: string, downloadToken: string) {
    return cloudbaseAdminGateway.downloadRosterExport(eventId, downloadToken)
  },
  listEventManagers(eventId: string, options?: QueryOptions) {
    return cache.query<AdminEventManager[]>(
      `event-managers:${eventId}`,
      () => cloudbaseAdminGateway.listEventManagers(eventId),
      options,
    )
  },
  async setEventManager(
    eventId: string,
    profileId: string,
    role: EventManagerRole,
    active: boolean,
  ) {
    const result = await cloudbaseAdminGateway.setEventManager(eventId, profileId, role, active)
    cache.invalidate(`event-managers:${eventId}`)
    cache.invalidate('managed-events')
    cache.invalidate('audit')
    return result
  },
  listPendingEventPhotos(eventId: string, options?: QueryOptions) {
    return cache.query<AdminEventPhoto[]>(
      `event-photos:${eventId}`,
      () => cloudbaseAdminGateway.listPendingEventPhotos(eventId),
      options,
    )
  },
  async reviewEventPhoto(
    eventId: string,
    photoId: string,
    decision: 'approve' | 'reject',
    expectedVersion: number,
    reason = '',
  ) {
    const result = await cloudbaseAdminGateway.reviewEventPhoto(
      eventId,
      photoId,
      decision,
      expectedVersion,
      reason,
    )
    cache.invalidate(`event-photos:${eventId}`)
    cache.invalidate('audit')
    membershipModule.invalidateEventCaches()
    return result
  },
  async checkInByQr(value: string) {
    const result = await cloudbaseAdminGateway.checkInByQr(value)
    invalidateRosterCaches(result.eventId)
    return result
  },
  listOrders(options?: QueryOptions) {
    return cache.query<AdminOrderItem[]>('orders', loadOrders, options)
  },
  peekOrders() {
    return cache.peek<AdminOrderItem[]>('orders')
  },
  listAudit(options?: QueryOptions) {
    return cache.query<AuditItem[]>('audit', cloudbaseAdminGateway.listAudit, options)
  },
  peekAudit() {
    return cache.peek<AuditItem[]>('audit')
  },
  listOperationalExceptions(options?: QueryOptions) {
    return cache.query<OperationalException[]>(
      'operational-exceptions',
      cloudbaseAdminGateway.listOperationalExceptions,
      options,
    )
  },
  peekOperationalExceptions() {
    return cache.peek<OperationalException[]>('operational-exceptions')
  },
  async retryOperationalException(item: OperationalException) {
    const result = await cloudbaseAdminGateway.retryOperationalException(item)
    cache.invalidate('operational-exceptions')
    cache.invalidate('dashboard')
    cache.invalidate('audit')
    return result
  },
  listAnnouncements(
    status?: AdminAnnouncement['status'],
    query = '',
    options?: QueryOptions,
  ) {
    return cache.query<AdminAnnouncement[]>(
      `announcements:${status || 'ALL'}:${query.trim()}`,
      () => cloudbaseAdminGateway.listAnnouncements(status, query),
      options,
    )
  },
  peekAnnouncements(status?: AdminAnnouncement['status'], query = '') {
    return cache.peek<AdminAnnouncement[]>(
      `announcements:${status || 'ALL'}:${query.trim()}`,
    )
  },
  getAnnouncement(announcementId: string, options?: QueryOptions) {
    return cache.query<AdminAnnouncement>(
      `announcement:${announcementId}`,
      () => cloudbaseAdminGateway.getAnnouncement(announcementId),
      options,
    )
  },
  async saveAnnouncement(announcement: AdminAnnouncementDraft) {
    const result = await cloudbaseAdminGateway.saveAnnouncement(announcement)
    cache.invalidate('announcements')
    cache.invalidate(`announcement:${result.id}`)
    cache.invalidate('dashboard')
    cache.invalidate('audit')
    return result
  },
  async setAnnouncementState(
    announcementId: string,
    transition: 'PUBLISH' | 'WITHDRAW' | 'PIN' | 'UNPIN',
    expectedVersion: number,
  ) {
    const result = await cloudbaseAdminGateway.setAnnouncementState(
      announcementId,
      transition,
      expectedVersion,
    )
    cache.invalidate('announcements')
    cache.invalidate(`announcement:${announcementId}`)
    cache.invalidate('dashboard')
    cache.invalidate('audit')
    return result
  },
  listMemberReports(status?: MemberReportStatus, options?: QueryOptions) {
    return cache.query<AdminMemberReport[]>(
      `member-reports:${status || 'ALL'}`,
      () => cloudbaseAdminGateway.listMemberReports(status),
      options,
    )
  },
  peekMemberReports(status?: MemberReportStatus) {
    return cache.peek<AdminMemberReport[]>(`member-reports:${status || 'ALL'}`)
  },
  async resolveMemberReport(
    reportId: string,
    decision: 'DISMISS' | 'HIDE_PROFILE',
    reason: string,
    expectedVersion: number,
  ) {
    const result = await cloudbaseAdminGateway.resolveMemberReport(
      reportId,
      decision,
      reason,
      expectedVersion,
    )
    cache.invalidate('member-reports')
    cache.invalidate('profiles')
    cache.invalidate('dashboard')
    cache.invalidate('audit')
    return result
  },
  async refundOrder(orderId: string, reason: string) {
    const request = await cloudbaseAdminGateway.requestRefund(orderId, reason)
    await cloudbaseAdminGateway.submitRefund(request.refundId)
    cache.invalidate('orders')
    cache.invalidate('dashboard')
    cache.invalidate('audit')
    return request
  },
  async confirmRefund(refundId: string) {
    const result = await cloudbaseAdminGateway.confirmRefund(refundId)
    cache.invalidate('orders')
    cache.invalidate('dashboard')
    cache.invalidate('audit')
    return result
  },
}
