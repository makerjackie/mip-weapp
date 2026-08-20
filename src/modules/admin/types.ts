export type AdminRole = 'owner' | 'manager' | 'reviewer' | 'support'
export type AdminCapability
  = | 'dashboard'
    | 'profiles'
    | 'events'
    | 'orders'
    | 'refunds'
    | 'audit'
    | 'roles'
    | 'operations'
    | 'announcements'
    | 'reports'

/** Central activity type; pages must not recombine memberFree/priceCents themselves. */
export type ActivityType = 'PUBLIC_FREE' | 'MEMBER_INCLUDED' | 'PAID'
export type RegistrationMode = 'AUTO' | 'APPROVAL'
export type EventMode = 'OFFLINE' | 'ONLINE' | 'HYBRID'
export type AdminRegistrationQuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'PHONE' | 'ID_CARD' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'BOOLEAN'

export interface AdminRegistrationQuestion {
  id: string
  label: string
  description: string
  type: AdminRegistrationQuestionType
  required: boolean
  options: string[]
  profileField: string | null
  privacy: 'ORGANIZER_ONLY' | 'PUBLIC_WITH_CONSENT'
  sortOrder?: number
}

export interface AdminSession {
  enabled: boolean
  role: AdminRole | null
  capabilities: AdminCapability[]
  eventManagerEnabled: boolean
}

export interface AdminManagedEvent {
  id: string
  title: string
  startsAt: string
  endsAt: string
  location: string
  coverUrl: string
  status: AdminEventItem['status']
  managerRole: 'GLOBAL' | EventManagerRole
  registrationCount: number
  canEdit: boolean
  canManageTeam: boolean
  canRoster: boolean
  canViewSensitiveRoster: boolean
  canExportRoster: boolean
  canCheckIn: boolean
  canAlbum: boolean
}

export interface AdminDashboard {
  session: AdminSession
  counts: {
    totalUsers: number
    newUsers7d: number
    activeMembers: number
    upcomingRegistrations: number
    pendingProfiles: number
    publishedEvents: number
    paidOrders: number
    pendingRefunds: number
    operationalExceptions: number
    publishedAnnouncements: number
    pendingReports: number
  }
  recentAudit: AuditItem[]
}

export interface AdminProfileItem {
  id: string
  nickname: string
  city: string
  headline: string
  tags: string[]
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'DELETED'
  updatedAt: string
  /** Permanent cloud:// file ID (or empty); client media adapter resolves temp/local URLs. */
  avatarUrl: string
}

export interface AdminRoleItem {
  profileId: string
  nickname: string
  city: string
  role: AdminRole
  status: 'ACTIVE' | 'SUSPENDED'
  capabilities: AdminCapability[]
  createdAt: string
}

export interface AdminEventItem {
  id: string
  title: string
  description: string
  notices: string
  registrationSchema: AdminRegistrationQuestion[]
  formVersion: number
  registrationMode: RegistrationMode
  waitlistEnabled: boolean
  albumEnabled: boolean
  albumRequiresReview: boolean
  eventMode: EventMode
  startsAt: string
  endsAt: string
  registrationDeadline: string | null
  venueName: string
  address: string
  location: string
  latitude: number | null
  longitude: number | null
  onlineUrl: string
  capacity: number | null
  cancellationPolicy: string
  coverAssetId: string | null
  coverUrl: string
  version: number
  memberFree: boolean
  priceCents: number
  activityType: ActivityType
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED'
  cancelledAt: string | null
  cancellationReason: string | null
  canDuplicate?: boolean
  canManageTeam?: boolean
}

export interface AdminEventSaveResult {
  id: string
  version: number
}

export interface AdminEventStatusResult {
  id: string
  status: Exclude<AdminEventItem['status'], 'CANCELLED'>
  version: number
}

export interface AdminEventCancelResult {
  id: string
  status: 'CANCELLED'
  version: number
  cancelledAt: string | null
  cancellationReason: string
  affectedCount: number
  refundIds: string[]
  refundSubmitFailedCount?: number
}

export type AdminRosterStatusFilter
  = | 'ALL'
    | 'PENDING_REVIEW'
    | 'WAITLISTED'
    | 'REGISTERED'
    | 'CANCELLATION_PENDING'
    | 'ATTENDED'
    | 'REJECTED'
    | 'CANCELLED'
export type AdminRegistrationStatus = Exclude<AdminRosterStatusFilter, 'ALL'>

export interface AdminRosterEventSummary {
  id: string
  title: string
  startsAt: string
  status: AdminEventItem['status']
  registrationCount: number
  pendingReviewCount: number
  waitlistedCount: number
  cancellationPendingCount: number
  attendedCount: number
  rejectedCount: number
  cancelledCount: number
  totalCount: number
}

/** Roster DTO: no openid or full ticket code; phone is event-operations scoped. */
export interface AdminRosterItem {
  id: string
  nickname: string
  avatarUrl: string
  city: string
  status: AdminRegistrationStatus
  ticketCodeMasked: string
  registeredAt: string
  attendedAt: string | null
  phoneBound: boolean
  phoneNumber: string | null
  answers: Array<{ label: string, value: string }>
  reviewReason: string | null
  version: number
}

export interface AdminRosterPage {
  event: AdminRosterEventSummary
  items: AdminRosterItem[]
  nextCursor: string | null
  canViewSensitiveRoster: boolean
  canExportRoster: boolean
  canReviewRegistration: boolean
  canCheckIn: boolean
  canUndoCheckIn: boolean
  canOverrideCheckIn: boolean
}

export interface AdminRosterQuery {
  eventId: string
  status?: AdminRosterStatusFilter
  query?: string
  cursor?: string | null
  limit?: number
}

export interface AdminAttendanceResult {
  id: string
  eventId: string
  status: AdminRegistrationStatus
  version: number
  attendedAt: string | null
  idempotent?: boolean
  override?: boolean
}

export interface AdminRosterExportResult {
  downloadToken: string
  fileName: string
  rowCount: number
  expiresAt: string
  contentType: string
}

export interface AdminRosterDownloadResult {
  fileName: string
  contentType: string
  contentBase64: string
}

/** Authoring payload. Server derives memberFree/priceCents from activityType. */
export interface AdminEventDraft {
  id?: string
  title: string
  description: string
  notices: string
  registrationSchema: AdminRegistrationQuestion[]
  registrationMode?: RegistrationMode
  waitlistEnabled?: boolean
  albumEnabled: boolean
  albumRequiresReview: boolean
  eventMode?: EventMode
  startsAt: string
  endsAt: string
  registrationDeadline?: string | null
  venueName: string
  address: string
  location?: string
  latitude?: number | null
  longitude?: number | null
  onlineUrl?: string
  capacity: number | null
  cancellationPolicy: string
  /**
   * Cover semantics for existing media IDs only in this slice:
   * omitted = keep, null = clear, UUID = replace. Upload UI is not complete.
   */
  coverAssetId?: string | null
  /** Required on update for optimistic locking. */
  version?: number
  activityType: ActivityType
  priceCents?: number
}

export type EventManagerRole = 'EVENT_OWNER' | 'EVENT_MANAGER' | 'EVENT_STAFF'

export interface AdminEventManager {
  profileId: string
  nickname: string
  city: string
  organization: string
  roleTitle: string
  avatarUrl: string
  role: EventManagerRole
  createdAt: string
}

export interface AdminEventPhoto {
  id: string
  caption: string
  status: 'PENDING_REVIEW'
  version: number
  nickname: string
  imageUrl: string
  createdAt: string
}

export interface AdminOrderItem {
  id: string
  planName: string
  amountCents: number
  status: string
  createdAt: string
  paidAt: string | null
  canRefund: boolean
  /** Present when canRefund is false; aligned with server refund gate. */
  refundBlockReason: string | null
  canConfirmRefund: boolean
  refundId: string | null
}

export interface AuditItem {
  id: string
  action: string
  resourceType: string
  resourceId: string
  actorRole: string
  createdAt: string
}

export interface OperationalException {
  id: string
  type: 'REFUND' | 'MEDIA_CLEANUP' | 'MEDIA_PROCESSING' | 'MEDIA_FAILURE' | 'NOTIFICATION'
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  title: string
  summary: string
  status: string
  createdAt: string
  updatedAt: string
  canRetry: boolean
  route: string
  version: number
}

export type AdminAnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN'

export interface AdminAnnouncement {
  id: string
  title: string
  summary: string
  body: string
  status: AdminAnnouncementStatus
  isPinned: boolean
  visibleFrom: string | null
  visibleUntil: string | null
  publishedAt: string | null
  version: number
  updatedAt: string | null
}

export interface AdminAnnouncementDraft {
  id?: string
  title: string
  summary: string
  body: string
  visibleFrom?: string | null
  visibleUntil?: string | null
  version?: number
}

export type MemberReportStatus = 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'

export interface AdminMemberReport {
  id: string
  targetMemberId: string
  targetNickname: string
  targetAvatarUrl: string
  category: 'HARASSMENT' | 'SPAM' | 'FRAUD' | 'INAPPROPRIATE' | 'PRIVACY' | 'OTHER'
  description: string
  status: MemberReportStatus
  priorReportCount: number
  resolutionAction: string | null
  resolutionReason: string
  version: number
  createdAt: string | null
  handledAt: string | null
}

export interface AdminGateway {
  getSession: () => Promise<AdminSession>
  listManagedEvents: () => Promise<AdminManagedEvent[]>
  getDashboard: () => Promise<AdminDashboard>
  listProfiles: (status?: string) => Promise<AdminProfileItem[]>
  listAdminRoles: () => Promise<AdminRoleItem[]>
  setAdminRole: (
    profileId: string,
    role: Exclude<AdminRole, 'owner'>,
    active: boolean,
  ) => Promise<{ profileId: string, nickname: string, role: Exclude<AdminRole, 'owner'>, status: 'ACTIVE' | 'SUSPENDED' }>
  reviewProfile: (profileId: string, decision: 'approve' | 'reject') => Promise<{ id: string, status: string }>
  setProfileStatus: (profileId: string, status: 'APPROVED' | 'SUSPENDED') => Promise<{ id: string, status: string }>
  listEvents: () => Promise<AdminEventItem[]>
  saveEvent: (event: AdminEventDraft) => Promise<AdminEventSaveResult>
  duplicateEvent: (eventId: string) => Promise<AdminEventSaveResult>
  uploadEventCover: (
    base64: string,
    eventId?: string,
  ) => Promise<{ assetId: string, coverUrl: string }>
  setEventStatus: (
    eventId: string,
    status: Exclude<AdminEventItem['status'], 'CANCELLED'>,
    expectedVersion: number,
  ) => Promise<AdminEventStatusResult>
  cancelEvent: (eventId: string, reason: string, expectedVersion: number) => Promise<AdminEventCancelResult>
  listEventRegistrations: (input: AdminRosterQuery) => Promise<AdminRosterPage>
  reviewEventRegistration: (
    eventId: string,
    registrationId: string,
    decision: 'approve' | 'reject',
    expectedVersion: number,
    reason?: string,
  ) => Promise<{
    id: string
    eventId: string
    status: AdminRegistrationStatus
    version: number
    ticketCodeMasked?: string
  }>
  checkInRegistration: (
    eventId: string,
    registrationId: string,
    expectedVersion: number,
    options?: { allowOverride?: boolean, idempotencyKey?: string },
  ) => Promise<AdminAttendanceResult>
  undoCheckIn: (
    eventId: string,
    registrationId: string,
    expectedVersion: number,
    reason: string | { category: string, text?: string },
    options?: { idempotencyKey?: string },
  ) => Promise<AdminAttendanceResult>
  createRosterExport: (input: Pick<AdminRosterQuery, 'eventId' | 'status' | 'query'>) => Promise<AdminRosterExportResult>
  downloadRosterExport: (eventId: string, downloadToken: string) => Promise<AdminRosterDownloadResult>
  listEventManagers: (eventId: string) => Promise<AdminEventManager[]>
  setEventManager: (
    eventId: string,
    profileId: string,
    role: EventManagerRole,
    active: boolean,
  ) => Promise<{ eventId: string, profileId: string, role: EventManagerRole, active: boolean }>
  listPendingEventPhotos: (eventId: string) => Promise<AdminEventPhoto[]>
  reviewEventPhoto: (
    eventId: string,
    photoId: string,
    decision: 'approve' | 'reject',
    expectedVersion: number,
    reason?: string,
  ) => Promise<{ id: string, status: 'PUBLISHED' | 'REJECTED', version: number }>
  checkInByQr: (value: string) => Promise<AdminAttendanceResult>
  listOrders: () => Promise<AdminOrderItem[]>
  requestRefund: (orderId: string, reason: string) => Promise<{ refundId: string, status: string }>
  submitRefund: (refundId: string) => Promise<void>
  syncRefund: (refundId: string) => Promise<{ status: 'REFUND_CREATED' | 'REFUNDED' | 'REFUND_FAILED' }>
  confirmRefund: (refundId: string) => Promise<{ status: 'REFUNDED' }>
  listAudit: () => Promise<AuditItem[]>
  listOperationalExceptions: () => Promise<OperationalException[]>
  retryOperationalException: (
    item: Pick<OperationalException, 'id' | 'type' | 'version'>,
  ) => Promise<unknown>
  listAnnouncements: (
    status?: AdminAnnouncementStatus,
    query?: string,
  ) => Promise<AdminAnnouncement[]>
  getAnnouncement: (announcementId: string) => Promise<AdminAnnouncement>
  saveAnnouncement: (announcement: AdminAnnouncementDraft) => Promise<AdminAnnouncement>
  setAnnouncementState: (
    announcementId: string,
    transition: 'PUBLISH' | 'WITHDRAW' | 'PIN' | 'UNPIN',
    expectedVersion: number,
  ) => Promise<AdminAnnouncement>
  listMemberReports: (status?: MemberReportStatus) => Promise<AdminMemberReport[]>
  resolveMemberReport: (
    reportId: string,
    decision: 'DISMISS' | 'HIDE_PROFILE',
    reason: string,
    expectedVersion: number,
  ) => Promise<{ id: string, status: MemberReportStatus, resolutionAction: string, version: number }>
}
