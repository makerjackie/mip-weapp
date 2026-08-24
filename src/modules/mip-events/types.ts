import type { BranchId, EventId, OrderId } from '../mip'

export type EventScopeType = 'PLATFORM' | 'BRANCH'
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'CANCELLED' | 'ENDED'
export type EventAccessType = 'FREE' | 'MEMBER_INCLUDED' | 'PAID'
export type EventRegistrationPolicy = 'AUTO' | 'APPROVAL'
export type EventAlbumSubmissionPolicy = 'AUTO' | 'REVIEW'
export type EventAlbumPhotoStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED'
export type EventMode = 'OFFLINE' | 'ONLINE' | 'HYBRID'
export type CheckInCredentialMode = 'STATIC' | 'ROTATING'
export type RegistrationStatus
  = | 'PENDING_REVIEW'
    | 'WAITLISTED'
    | 'PAYMENT_PENDING'
    | 'REGISTERED'
    | 'CANCELLATION_PENDING'
    | 'CANCELLED'
    | 'REJECTED'
    | 'ATTENDED'

export type EventListView = 'UPCOMING' | 'PAST' | 'MINE'
export type EventDateFilter = 'RECENT' | 'ENDED' | 'TODAY' | 'CUSTOM'

export interface EventFeedQuery {
  view: EventListView
  dateFilter: EventDateFilter
  branchId?: BranchId
  cityName?: string
  date?: string
  dateFrom?: string
  dateTo?: string
  query?: string
  cursor?: string
  limit?: number
}

export interface EventParticipantPreview {
  participantRef: string
  nickname: string
  avatarUrl?: string
}

export interface PublicEventParticipant {
  profileRef: string
  nickname?: string
  avatarUrl?: string
  userKind?: 'PLAYER' | 'GUEST'
  identityStatus?: string
  headline?: string
  introduction?: string
  primaryIndustry?: { label: string }
  primaryBranch?: { name: string, cityName: string }
}

export interface PublicEventParticipantQuery {
  keyword?: string
  userKind?: 'PLAYER' | 'GUEST'
  cursor?: string
  limit?: number
}

export interface EventOrganizer {
  profileRef: string
  nickname?: string
  avatarUrl?: string
  headline?: string
}

export interface EventInvitationAttribution {
  sourceType: 'PLATFORM' | 'USER'
  displayName: string
  avatarUrl?: string
}

export interface PublicEventParticipantPage {
  items: PublicEventParticipant[]
  nextCursor?: string
}

export interface MipEventListItem {
  id: EventId
  scopeType: EventScopeType
  branchId?: BranchId
  branchName?: string
  title: string
  summary: string
  coverUrl?: string
  eventTypeLabel: string
  mode: EventMode
  accessType: EventAccessType
  startsAt: string
  endsAt: string
  cityName?: string
  venueName?: string
  status: 'PUBLISHED' | 'CANCELLED' | 'ENDED'
  capacity?: number
  registrationCount: number
  participantPreview: EventParticipantPreview[]
  registrationStatus?: RegistrationStatus
  albumEnabled: boolean
}

export interface EventFeedResult {
  items: MipEventListItem[]
  cities?: string[]
  nextCursor?: string
}

export interface EventChangeSummary {
  version: number
  summary: string
  createdAt: string
}

export interface MipEventDetail extends MipEventListItem {
  organizer?: EventOrganizer
  invitationAttribution?: EventInvitationAttribution
  description: string
  contentMedia?: Array<{
    imageUrl: string
    caption: string
  }>
  notices?: string
  address?: string
  latitude?: number
  longitude?: number
  onlineAccessAvailable: boolean
  onlineUrl?: string
  registrationPolicy: EventRegistrationPolicy
  registrationOpensAt?: string
  registrationDeadline?: string
  cancellationDeadline?: string
  priceCents: number
  currency: 'CNY'
  formVersion: number
  registrationSchema: RegistrationField[]
  changes: EventChangeSummary[]
  canRegister: boolean
  canCancel: boolean
  canCheckIn: boolean
  canInteract: boolean
  albumSubmissionPolicy: EventAlbumSubmissionPolicy
}

export interface EventAlbumPhoto {
  id: string
  imageUrl: string
  caption: string
  status: EventAlbumPhotoStatus
  version: number
  mine: boolean
  moderationReason?: string
  nickname?: string
  avatarUrl?: string
  createdAt: string
}

export interface EventAlbumPage {
  eventId: EventId
  albumEnabled: boolean
  submissionPolicy: EventAlbumSubmissionPolicy
  items: EventAlbumPhoto[]
  nextCursor?: string
}

export interface MyEventAlbumSubmissions {
  eventId: EventId
  albumEnabled: boolean
  submissionPolicy: EventAlbumSubmissionPolicy
  canSubmit: boolean
  items: EventAlbumPhoto[]
}

export interface EventAlbumSubmission {
  id: string
  status: EventAlbumPhotoStatus
  version: number
  idempotent: boolean
}

export interface RegistrationField {
  key: string
  label: string
  type: 'TEXT' | 'TEXTAREA' | 'SELECT' | 'BOOLEAN'
  required: boolean
  options?: string[]
  maxLength?: number
}

export interface RegistrationIntent {
  eventId: EventId
  formVersion: number
  answers: Record<string, string | boolean>
  shareProfile: boolean
  invitationToken?: string
  idempotencyKey?: string
}

export interface MyEventRegistration {
  status: RegistrationStatus
  version: number
  formVersion: number
  answers: Record<string, string | boolean>
  shareProfile: boolean
  canEdit: boolean
}

export interface RegistrationUpdateIntent {
  eventId: EventId
  formVersion: number
  expectedVersion: number
  answers: Record<string, string | boolean>
  shareProfile: boolean
  idempotencyKey?: string
}

export type RegistrationOutcome
  = | {
    kind: 'REGISTERED' | 'PENDING_REVIEW' | 'WAITLISTED'
    registrationId: string
    status: RegistrationStatus
    waitlistPosition?: number
  }
  | {
    kind: 'PAYMENT_REQUIRED'
    registrationId: string
    status: 'PAYMENT_PENDING'
    orderId: OrderId
    amountCents: number
    currency: 'CNY'
    holdExpiresAt: string
    paymentAvailable: boolean
  }

export interface RegistrationSummary {
  registrationId: string
  event: MipEventListItem
  status: RegistrationStatus
  orderId?: OrderId
  waitlistPosition?: number
  checkedInAt?: string
  updatedAt: string
  canEdit: boolean
}

export interface RegistrationCancellation {
  registrationId: string
  status: 'CANCELLED' | 'CANCELLATION_PENDING'
  refundRequired: boolean
  refundId?: string
  paymentAvailable: boolean
}

export interface CheckInOutcome {
  eventId: EventId
  registrationId: string
  status: 'ATTENDED'
  checkedInAt: string
  idempotent: boolean
}

export interface CheckInScene {
  eventId: EventId
  scanToken: string
  validFrom: string
  validUntil: string
}

export interface CheckInPosterCredential extends CheckInScene {
  credentialId: string
  mode: CheckInCredentialMode
  assetId: string
  codeUrl: string
}

export interface InvitationSceneResolution {
  eventId: EventId
  invitationToken: string
  validUntil: string
}

export interface EventInvitationCode {
  invitationId: string
  eventId: EventId
  scene: string
  validUntil: string
  assetId: string
  codeUrl: string
}

export interface HeartCandidate {
  participantRef: string
  nickname: string
  avatarUrl?: string
  headline?: string
  selected: boolean
}

export interface HeartState {
  targetRef?: string
  target?: HeartCandidate
  received: HeartCandidate[]
  version: number
  updatedAt?: string
}

export type HeartHistoryKind = 'SENT' | 'RECEIVED'

export interface HeartHistoryItem {
  event: {
    id: EventId
    title: string
    startsAt: string
    endsAt: string
  }
  person: {
    profileRef: string
    nickname: string
    avatarUrl?: string
    headline?: string
  }
  updatedAt: string
}

export interface HeartHistoryPage {
  kind: HeartHistoryKind
  items: HeartHistoryItem[]
  nextCursor?: string
}

export interface EventFeedbackDraft {
  rating?: number
  body: string
  version?: number
}

export interface EventFeedback extends EventFeedbackDraft {
  id: string
  version: number
  submittedAt: string
  updatedAt: string
}

export interface AdminEventFeedback {
  id: string
  nickname: string
  rating?: number
  body: string
  version: number
  submittedAt: string
  updatedAt: string
}

export interface AdminEventFeedbackQuery {
  rating?: 1 | 2 | 3 | 4 | 5
  cursor?: string
  limit?: number
}

export interface AdminEventFeedbackPage {
  items: AdminEventFeedback[]
  nextCursor?: string
}

export interface MipEventsGateway {
  listEvents: (query: EventFeedQuery) => Promise<EventFeedResult>
  getEvent: (eventId: EventId) => Promise<MipEventDetail>
  listPublicParticipants: (eventId: EventId, query?: PublicEventParticipantQuery) => Promise<PublicEventParticipantPage>
  listEventAlbum: (eventId: EventId, cursor?: string, limit?: number) => Promise<EventAlbumPage>
  listMyEventAlbumSubmissions: (eventId: EventId) => Promise<MyEventAlbumSubmissions>
  submitEventAlbumPhoto: (eventId: EventId, mediaAssetId: string, caption: string) => Promise<EventAlbumSubmission>
  withdrawEventAlbumPhoto: (photoId: string, expectedVersion: number) => Promise<{ id: string, status: 'WITHDRAWN', version: number }>
  listMyRegistrations: (cursor?: string) => Promise<{ items: RegistrationSummary[], nextCursor?: string }>
  getMyRegistration: (eventId: EventId) => Promise<MyEventRegistration | null>
  register: (input: RegistrationIntent) => Promise<RegistrationOutcome>
  updateRegistration: (input: RegistrationUpdateIntent) => Promise<MyEventRegistration>
  cancelRegistration: (eventId: EventId, expectedVersion?: number) => Promise<RegistrationCancellation>
  checkIn: (scanToken: string, idempotencyKey: string) => Promise<CheckInOutcome>
  resolveCheckInScene: (scene: string) => Promise<CheckInScene>
  resolveInvitationScene: (scene: string) => Promise<InvitationSceneResolution>
  createCheckInPoster: (eventId: EventId, mode?: CheckInCredentialMode) => Promise<CheckInPosterCredential>
  createInvitationCode: (eventId: EventId) => Promise<EventInvitationCode>
  listHeartCandidates: (eventId: EventId) => Promise<HeartCandidate[]>
  listHeartHistory: (kind: HeartHistoryKind, cursor?: string, limit?: number) => Promise<HeartHistoryPage>
  getHeart: (eventId: EventId) => Promise<HeartState>
  setHeart: (eventId: EventId, targetRef: string | null, expectedVersion?: number) => Promise<HeartState>
  getFeedback: (eventId: EventId) => Promise<EventFeedback | null>
  saveFeedback: (eventId: EventId, draft: EventFeedbackDraft) => Promise<EventFeedback>
  listAdminFeedback: (eventId: EventId, query?: AdminEventFeedbackQuery) => Promise<AdminEventFeedbackPage>
  createInvitation: (eventId: EventId) => Promise<{ token: string }>
}

export class MipEventsError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(
    code: string,
    message: string,
    retryable = false,
  ) {
    super(message)
    this.name = 'MipEventsError'
    this.code = code
    this.retryable = retryable
  }
}
