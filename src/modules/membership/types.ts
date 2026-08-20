export interface MembershipPlan {
  id: string
  name: string
  description: string
  priceCents: number
  durationDays: number
  benefits: string[]
  testOnly: boolean
}

export type PaymentMode = 'disabled' | 'test' | 'live'

export interface MembershipStatus {
  active: boolean
  level: 'guest' | 'member'
  expiresAt: string | null
}

export interface MemberProfile {
  nickname: string
  avatarUrl: string
  city: string
  headline: string
  bio: string
  organization: string
  roleTitle: string
  industry: string
  tags: string[]
  interests: string[]
  skills: string[]
  phoneBound: boolean
  completion: number
  onboardingComplete: boolean
}

export interface EditableMemberProfile {
  nickname: string
  city: string
  headline: string
  bio: string
  organization: string
  roleTitle: string
  industry: string
  tags: string[]
  interests: string[]
  skills: string[]
}

export interface RecommendationSummary {
  id: string
  nickname: string
  city: string
  headline: string
  bio: string
  organization: string
  roleTitle: string
  industry: string
  avatarUrl: string
  tags: string[]
  interests: string[]
  skills: string[]
  detailLocked: boolean
}

export type MemberFeedFilter = 'recommended' | 'same-city' | 'new'

export interface MemberDetail extends RecommendationSummary {
  joinedAt: string | null
  followersCount: number
  followingCount: number
  isFollowing: boolean
  isSelf: boolean
}

export interface EventParticipantSummary extends RecommendationSummary {
  registeredAt: string
}

export interface EventParticipantsPage {
  eventId: string
  eventTitle: string
  totalRegistrationCount: number
  visibleParticipantCount: number
  roleFilters: string[]
  items: EventParticipantSummary[]
  nextCursor: string | null
}

export type EventLifecycleState = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED'
export type RegistrationLifecycleState
  = | 'PENDING_REVIEW'
    | 'WAITLISTED'
    | 'REGISTERED'
    | 'CANCELLATION_PENDING'
    | 'CANCELLED'
    | 'REJECTED'
    | 'ATTENDED'
export type CancelledByType = 'MEMBER' | 'EVENT' | 'SYSTEM'
export type ActivityType = 'PUBLIC_FREE' | 'MEMBER_INCLUDED' | 'PAID'
export type RegistrationMode = 'AUTO' | 'APPROVAL'
export type EventMode = 'OFFLINE' | 'ONLINE' | 'HYBRID'
export type RegistrationQuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'PHONE' | 'ID_CARD' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'BOOLEAN'

export interface RegistrationQuestion {
  id: string
  label: string
  description: string
  type: RegistrationQuestionType
  required: boolean
  options: string[]
  profileField: string | null
  privacy: 'ORGANIZER_ONLY' | 'PUBLIC_WITH_CONSENT'
  sortOrder: number
  prefillValue?: string | number | boolean | string[] | null
}

export type RegistrationAnswers = Record<string, string | number | boolean | string[] | null>

export interface EventAlbumPreview {
  id: string
  imageUrl: string
  caption: string
  nickname: string
  avatarUrl: string
}

export interface EventSummary {
  id: string
  title: string
  startsAt: string
  location: string
  priceCents: number
  memberFree: boolean
  activityType: ActivityType
  registered: boolean
  registrationState: RegistrationLifecycleState | null
  coverUrl: string
  capacity: number | null
  registrationCount: number
  registrationOpen: boolean
  registrationMode: RegistrationMode
  waitlistEnabled: boolean
  eventMode: EventMode
  eventState: EventLifecycleState
}

export type EventFeedView = 'upcoming' | 'mine'

export interface EventFeed {
  membershipActive: boolean
  phoneBound: boolean
  events: EventSummary[]
}

export interface EventOrganizer {
  id: string
  nickname: string
  headline: string
  avatarUrl: string
}

export interface EventDetail extends EventSummary {
  summary: string
  description: string
  notices: string
  organizer: EventOrganizer | null
  venueName: string
  address: string
  latitude: number | null
  longitude: number | null
  onlineUrl: string
  endsAt: string | null
  registrationDeadline: string | null
  cancellationPolicy: string
  formVersion: number
  registrationForm: RegistrationQuestion[]
  registrationAnswers: RegistrationAnswers
  registrationSharesProfile: boolean
  registrationVersion: number | null
  waitlistPosition: number | null
  reviewReason: string | null
  changes: Array<{
    version: number
    type: 'CONTENT' | 'SCHEDULE' | 'VENUE' | 'REGISTRATION' | 'STATUS'
    summary: string
    createdAt: string
  }>
  albumEnabled: boolean
  albumPreview: EventAlbumPreview[]
  participantPreview: EventParticipantSummary[]
  visibleParticipantCount: number
  posterUrl: string
  canManage: boolean
  managerRole: string | null
  membershipActive: boolean
  phoneBound: boolean
  registrationState: RegistrationLifecycleState | null
  cancelledByType: CancelledByType | null
  cancellationReason: string | null
  cancelledAt: string | null
  canCancel: boolean
  canEditRegistration: boolean
  canRegister: boolean
}

export interface MembershipOverview {
  plans: MembershipPlan[]
  membership: MembershipStatus
  profile: MemberProfile
  recommendations: RecommendationSummary[]
  events: EventSummary[]
  unreadNotificationCount: number
  announcements: AnnouncementSummary[]
}

export interface AnnouncementSummary {
  id: string
  title: string
  summary: string
  isPinned: boolean
  publishedAt: string
}

export interface AnnouncementDetail extends AnnouncementSummary {
  body: string
}

export interface BlockedMember {
  id: string
  nickname: string
  city: string
  headline: string
  avatarUrl: string
  blockedAt: string
}

export type MemberReportCategory
  = | 'HARASSMENT'
    | 'SPAM'
    | 'FRAUD'
    | 'INAPPROPRIATE'
    | 'PRIVACY'
    | 'OTHER'

export type NotificationTemplateKey
  = | 'registration'
    | 'event_update'
    | 'event_reminder'
    | 'event_cancel'
    | 'refund'

export interface NotificationSubscriptionResult {
  templateKey: NotificationTemplateKey
  status: 'ACCEPTED' | 'REJECTED' | 'BANNED' | 'FILTERED'
}

export interface MemberNotification {
  id: string
  kind: 'REGISTRATION_RESULT' | 'EVENT_UPDATE' | 'EVENT_REMINDER' | 'EVENT_CANCEL' | 'REFUND_RESULT'
  title: string
  summary: string
  pagePath: string
  status: 'UNREAD' | 'READ'
  createdAt: string
}

export type MembershipOrderStatus = 'PENDING' | 'PAYMENT_CREATED' | 'PAID' | 'CLOSED' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'FAILED'

export interface MembershipOrder {
  id: string
  orderType: 'MEMBERSHIP' | 'EVENT'
  status: MembershipOrderStatus
  planId: string
  planName: string
  description: string
  durationDays: number | null
  amountCents: number
  createdAt: string
  paidAt: string | null
  entitlementStart: string | null
  entitlementEnd: string | null
  refundStatus: 'REFUND_PENDING' | 'REFUND_CREATED' | 'REFUNDED' | 'REFUND_FAILED' | null
  refundId: string | null
}

export interface RegistrationHistoryItem {
  id: string
  eventId: string
  title: string
  startsAt: string
  location: string
  status: RegistrationLifecycleState
  eventState: EventLifecycleState
  registrationState: RegistrationLifecycleState
  cancelledByType: CancelledByType | null
  cancellationReason: string | null
  cancelledAt: string | null
  /** Masked ticket only; full ticket codes never reach the client. */
  ticketCodeMasked: string
  canCancel: boolean
}

export interface Checkout {
  orderId: string
}

export type RegistrationOutcome
  = | {
    kind: 'REGISTERED'
    eventId: string
    id: string
    status: RegistrationLifecycleState
    version?: number
    ticketCodeMasked?: string
    idempotent?: boolean
  }
  | {
    kind: 'PAYMENT_REQUIRED'
    eventId: string
    orderId: string
    expiresAt: string | null
    idempotent?: boolean
  }

export interface RegistrationCancellationOutcome {
  eventId: string
  id: string
  status: 'CANCELLED' | 'CANCELLATION_PENDING'
  version?: number
  refundId: string | null
  refundStatus: string | null
  idempotent?: boolean
}

export interface CheckInPass {
  eventId: string
  registrationId: string
  status: RegistrationLifecycleState
  value: string
  expiresAt: string
}

export interface EventAlbumPhoto extends EventAlbumPreview {
  status: 'PENDING_REVIEW' | 'PUBLISHED'
  mine: boolean
  createdAt: string
}

export interface EventAlbumPage {
  items: EventAlbumPhoto[]
  nextCursor: string | null
}

export interface WechatPaymentParameters {
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'MD5' | 'HMAC-SHA256' | 'RSA'
  paySign: string
}

export type PurchaseOutcome
  = | { status: 'paid', order: MembershipOrder }
    | { status: 'pending', order: MembershipOrder }
    | { status: 'cancelled' }

export interface MembershipGateway {
  getOverview: () => Promise<MembershipOverview>
  listMembers: (filter: MemberFeedFilter) => Promise<RecommendationSummary[]>
  listEvents: (view: EventFeedView, query?: string) => Promise<EventFeed>
  createCheckout: (planId: string, idempotencyKey: string) => Promise<Checkout>
  createPayment: (orderId: string) => Promise<WechatPaymentParameters>
  syncPayment: (orderId: string) => Promise<{ status: 'PAYMENT_CREATED' | 'PAID' }>
  syncRefund: (refundId: string) => Promise<{ status: 'REFUND_CREATED' | 'REFUNDED' | 'REFUND_FAILED' }>
  submitRefund: (refundId: string) => Promise<{ status: 'REFUND_CREATED' | 'REFUNDED' }>
  getOrder: (orderId: string) => Promise<MembershipOrder>
  bindPhone: (code: string) => Promise<MemberProfile>
  uploadAvatar: (base64: string) => Promise<MemberProfile>
  updateProfile: (profile: EditableMemberProfile) => Promise<MemberProfile>
  registerEvent: (
    eventId: string,
    formVersion: number,
    answers: RegistrationAnswers,
    shareProfile: boolean,
    idempotencyKey: string,
  ) => Promise<RegistrationOutcome>
  cancelRegistration: (eventId: string, reason?: string) => Promise<RegistrationCancellationOutcome>
  updateRegistration: (
    eventId: string,
    formVersion: number,
    answers: RegistrationAnswers,
    shareProfile: boolean,
    expectedVersion: number,
  ) => Promise<{
    id: string
    eventId: string
    status: RegistrationLifecycleState
    version: number
  }>
  getMember: (memberId: string) => Promise<MemberDetail>
  setFollow: (memberId: string, following: boolean) => Promise<{ memberId: string, following: boolean }>
  listConnections: (direction: 'following' | 'followers') => Promise<RecommendationSummary[]>
  listAnnouncements: () => Promise<AnnouncementSummary[]>
  getAnnouncement: (announcementId: string) => Promise<AnnouncementDetail>
  setMemberBlock: (memberId: string, blocked: boolean) => Promise<{ memberId: string, blocked: boolean }>
  listBlockedMembers: () => Promise<BlockedMember[]>
  reportMember: (
    memberId: string,
    category: MemberReportCategory,
    description: string,
    idempotencyKey: string,
  ) => Promise<{ id: string, status: 'PENDING', idempotent: boolean }>
  getEvent: (eventId: string) => Promise<EventDetail>
  listEventParticipants: (
    eventId: string,
    cursor?: string,
    role?: string,
  ) => Promise<EventParticipantsPage>
  listEventAlbum: (eventId: string, cursor?: string) => Promise<EventAlbumPage>
  uploadEventPhoto: (
    eventId: string,
    base64: string,
    caption: string,
  ) => Promise<{ id: string, status: 'PENDING_REVIEW' | 'PUBLISHED' }>
  deleteEventPhoto: (photoId: string) => Promise<{ id: string, status: 'REMOVED' }>
  issueCheckInPass: (eventId: string) => Promise<CheckInPass>
  listOrders: () => Promise<MembershipOrder[]>
  listRegistrations: () => Promise<RegistrationHistoryItem[]>
  listNotifications: () => Promise<MemberNotification[]>
  markNotificationsRead: (input: { all?: boolean, ids?: string[] }) => Promise<{ updated: number }>
  recordNotificationSubscriptions: (
    eventId: string,
    results: NotificationSubscriptionResult[],
  ) => Promise<{ configured: number, saved: number, accepted: number }>
  requestAccountDeletion: (confirmation: string) => Promise<{ status: 'DELETED' }>
}

export interface PaymentAdapter {
  request: (parameters: WechatPaymentParameters) => Promise<'accepted' | 'cancelled'>
}
