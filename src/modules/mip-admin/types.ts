import type {
  AdminAnnouncement,
  AdminAnnouncementDraft,
  AdminAnnouncementFilters,
  AdminAnnouncementScope,
} from './announcements'
import type {
  AdminEventCommentMutationResult,
  AdminEventCommentReportMutationResult,
  AdminEventCommentSettings,
  AdminEventCommentState,
} from './event-comments'
import type {
  AdminMessageCampaign,
  AdminMessageCampaignCancelScheduleInput,
  AdminMessageCampaignDraft,
  AdminMessageCampaignPublication,
  AdminMessageCampaignScheduleInput,
  AdminMessageCampaignScope,
  AdminMessageCampaignStatus,
  AdminMessageRecipientCandidate,
} from './message-campaigns'
import type {
  AdminDeliveryReviewItem,
  AdminDeliveryReviewListInput,
  AdminDeliveryReviewMutationInput,
  AdminDeliveryReviewPage,
  AdminDeliveryReviewResolveInput,
  AdminDeliveryReviewResourceRef,
} from './message-delivery-reviews'
import type {
  AdminMessageTemplate,
  AdminMessageTemplateDraft,
  AdminMessageTemplateFilters,
} from './message-templates'
import type {
  AdminOperationalExceptionFilters,
  AdminOperationalExceptionPage,
} from './operational-exceptions'
import type {
  AdminOpportunityCommentSettings,
  AdminOpportunityCommentState,
} from './opportunity-comments'

export type AdminScopeType = 'PLATFORM' | 'BRANCH' | 'EVENT'
export type AdminRoleKey
  = | 'PLATFORM_OWNER'
    | 'PLATFORM_OPERATIONS'
    | 'PLATFORM_FINANCE'
    | 'BRANCH_ADMIN'
    | 'EVENT_OWNER'
    | 'EVENT_MANAGER'
    | 'EVENT_STAFF'

export type AdminCapability
  = | 'admin.dashboard'
    | 'users.read'
    | 'users.phone.read'
    | 'users.fields.edit'
    | 'users.access.manage'
    | 'exports.create'
    | 'events.read'
    | 'events.write'
    | 'events.roster.read'
    | 'events.registrations.manage'
    | 'events.checkin.manage'
    | 'events.checkin.undo'
    | 'events.team.manage'
    | 'events.album.manage'
    | 'events.feedback.read'
    | 'events.comments.manage'
    | 'announcements.manage'
    | 'messages.manage'
    | 'messages.delivery.review'
    | 'communications.publish'
    | 'branches.manage'
    | 'community.reports.manage'
    | 'opportunities.moderate'
    | 'opportunities.archive'
    | 'growth.read'
    | 'growth.configure'
    | 'growth.adjust'
    | 'tasks.manage'
    | 'banners.manage'
    | 'badges.manage'
    | 'game.manage'
    | 'knowledge.manage'
    | 'orders.read'
    | 'refunds.submit'
    | 'operations.exceptions.read'
    | 'roles.change'
    | 'audit.read'

export interface AdminCapabilityGrant {
  capability: AdminCapability
  scopeType: AdminScopeType
  scopeId: string | null
}

export interface AdminRoleBinding {
  roleKey: AdminRoleKey
  scopeType: AdminScopeType
  scopeId: string | null
}

export interface MipAdminSession {
  enabled: boolean
  capabilities: AdminCapabilityGrant[]
  roles: AdminRoleBinding[]
}

export interface AdminDashboard {
  session: MipAdminSession
  counts: {
    totalUsers: number
    newUsers7d: number
    activePlayers: number
    interactingPlayers30d: number
    playerInteractionRate30d: number
    totalEvents: number
    publishedEvents: number
    pendingRegistrations: number
    paidOrders: number
    pendingRefunds: number
    totalOpportunities: number
    publishedOpportunities: number
    publishedLifecycleOpportunities: number
    convertedOpportunities: number
    opportunityConversionRate: number
  }
}

export interface AdminMatchingSettings {
  scopeKey: string
  scopeType: 'PLATFORM' | 'BRANCH'
  scopeId?: string
  talentMinScore: number
  projectMinScore: number
  maximumCandidates: number
  externalProviderEnabled: boolean
  version: number
  updatedAt?: string | null
}

export interface AdminMatchingRequest {
  id: string
  sourceOpportunity: { id: string, title: string }
  requestedByType: 'USER' | 'ADMIN'
  provider: 'LOCAL' | 'EXTERNAL'
  fallbackReason?: string
  settingsVersion: number
  sourceVersion: number
  resultVersion: number
  resultCount: number
  createdAt: string | null
}

export interface AdminMatchingState {
  settings: AdminMatchingSettings
  requests: AdminMatchingRequest[]
}

export interface AdminUser {
  id: string
  status: 'ACTIVE' | 'BLOCKED' | 'CLOSED'
  kind: 'PLAYER' | 'GUEST'
  nickname: string
  headline: string
  introduction: string
  primaryBranchId: string | null
  branchName: string
  cityName: string
  phoneBound: boolean
  phoneNumber: string | null
  controls: Array<'ALLOWLIST' | 'BLOCKLIST'>
  levelId: string | null
  levelName: string
  experience: number
  visibility: Record<string, unknown>
  userVersion: number
  profileVersion: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminUserDetail extends AdminUser {
  companies: Array<{ name: string, role?: string }>
  organizations: Array<{ name: string, role?: string }>
  membership: null | {
    status: string
    startsAt: string | null
    endsAt: string | null
  }
  growth: {
    levelName: string
    experience: number
    contribution: number
    coin: number
  }
  counts: {
    registrations: number
    attended: number
    orders: number
    opportunities: number
    cooperationCards: number
    superCases: number
  }
  tags: Array<{
    id: string
    kind: string
    relation: string
    label: string
  }>
  roles: Array<{
    roleKey: AdminRoleKey
    scopeType: AdminScopeType
    scopeId: string | null
    grantedAt: string | null
  }>
  createdAt: string | null
  relatedRecords: {
    superCases: Array<{ id: string, title: string, summary: string, status: string, updatedAt: string | null }>
    opportunities: Array<{ id: string, title: string, status: AdminOpportunity['status'], updatedAt: string | null }>
    registrations: Array<{ id: string, eventId: string, title: string, status: AdminRosterStatus, createdAt: string | null }>
    orders: Array<{ id: string, orderType: AdminOrder['orderType'], title: string, status: AdminOrderStatus, amountCents: number, currency: string, merchantOrderNoMasked: string, createdAt: string | null }>
  }
}

export interface AdminEvent {
  id: string
  title: string
  summary: string
  scopeType: AdminScopeType
  branchId: string | null
  branchName: string
  status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'CANCELLED' | 'ENDED' | 'ARCHIVED'
  contentSafetyStatus: 'PENDING' | 'PASSED' | 'REJECTED' | 'ERROR'
  startsAt: string
  endsAt: string
  cityName: string
  accessType: 'FREE' | 'MEMBER_INCLUDED' | 'PAID'
  registrationPolicy: 'AUTO' | 'APPROVAL'
  albumEnabled: boolean
  albumSubmissionPolicy: 'AUTO' | 'REVIEW'
  capacity: number | null
  registrationCount: number
  attendedCount: number
  version: number
}

export interface AdminEventDetail {
  id: string
  scopeType: 'PLATFORM' | 'BRANCH'
  branchId: string | null
  title: string
  summary: string
  description: string
  contentMedia?: Array<{
    assetId: string
    imageUrl: string
    caption: string
  }>
  notices: string
  coverAssetId: string | null
  coverUrl: string
  eventTypeKey: string
  eventMode: 'OFFLINE' | 'ONLINE' | 'HYBRID'
  accessType: 'FREE' | 'MEMBER_INCLUDED' | 'PAID'
  registrationPolicy: 'AUTO' | 'APPROVAL'
  albumEnabled: boolean
  albumSubmissionPolicy: 'AUTO' | 'REVIEW'
  startsAt: string
  endsAt: string
  registrationDeadline: string | null
  cancellationDeadline: string | null
  venueName: string
  address: string
  cityName: string
  latitude: number | null
  longitude: number | null
  onlineUrl: string
  capacity: number | null
  waitlistEnabled: boolean
  priceCents: number
  registrationSchema: unknown[]
  status: AdminEvent['status']
  contentSafetyStatus: AdminEvent['contentSafetyStatus']
  version: number
}

export interface AdminEventPolicy {
  cancellationHoursBeforeStart: number
  version: number
}

export interface AdminEventInsights {
  eventId: string
  calculatedAt: string
  participation: {
    effectiveRegistrationCount: number
    checkedInCount: number
    checkInRateBasisPoints: number | null
    pendingReviewCount: number
    waitlistedCount: number
  }
  invitations: {
    attributedRegistrationCount: number
    distinctInviterCount: number
  }
  composition: {
    playerCount: number
    guestCount: number
  }
  hearts: {
    voterCount: number
    activeVoteCount: number
    mutualMatchCount: number
  }
  feedback: {
    access: 'RESTRICTED'
  } | {
    access: 'GRANTED'
    submissionCount: number
    eligibleCheckInCount: number
    submissionRateBasisPoints: number | null
    ratedCount: number
    averageRating: number | null
  }
  financials: {
    access: 'RESTRICTED'
  } | {
    access: 'GRANTED'
    currency: 'CNY'
    paidOrderCount: number
    grossAmountCents: number
    refundedAmountCents: number
    netAmountCents: number
  }
  traffic: {
    views: { availability: 'NOT_TRACKED', count: null }
    shares: { availability: 'NOT_TRACKED', count: null }
  }
}

export interface AdminEventReminderInput {
  eventId: string
  expectedVersion: number
  idempotencyKey: string
  sendWechatReminder: boolean
}

export interface AdminEventCloneInput {
  sourceEventId: string
  expectedVersion: number
  idempotencyKey: string
}

export interface AdminEventCloneResult {
  id: string
  status: 'DRAFT'
  version: 1
  startsAt: string
  idempotent: boolean
}

export interface AdminEventReminderPublication {
  publicationId: string
  recipientCount: number
  sendWechatReminder: boolean
  wechatDelivery: 'BEST_EFFORT' | 'NOT_REQUESTED'
  idempotent: boolean
}

export type AdminEventAlbumPhotoStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED'

export interface AdminEventAlbumPhoto {
  id: string
  caption: string
  imageUrl: string
  nickname: string
  avatarUrl: string
  status: AdminEventAlbumPhotoStatus
  moderationReason: string
  version: number
  createdAt: string
  reviewedAt: string | null
  publishedAt: string | null
}

export interface AdminEventAlbumReviewInput {
  eventId: string
  photoId: string
  decision: 'APPROVE' | 'REJECT'
  reason: string
  expectedVersion: number
}

export interface AdminBranchBlockers {
  activeMemberships: number
  activeBranchAdmins: number
  publishedEvents: number
  publishedOpportunities: number
}

export interface AdminBranch {
  id: string
  branchKey: string
  name: string
  cityName: string
  summary: string
  status: 'ACTIVE' | 'INACTIVE'
  version: number
  blockers: AdminBranchBlockers
}

export interface AdminBranchCreateInput {
  branchKey: string
  name: string
  cityName: string
  summary: string
}

export interface AdminBranchUpdateInput {
  branchId: string
  name: string
  cityName: string
  summary: string
  expectedVersion: number
}

export interface AdminBranchStatusInput {
  branchId: string
  status: 'ACTIVE' | 'INACTIVE'
  expectedVersion: number
}

export type AdminCommunityReportStatus = 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'
export type AdminCommunityReportCategory
  = | 'SPAM'
    | 'HARASSMENT'
    | 'FRAUD'
    | 'INAPPROPRIATE_CONTENT'
    | 'IMPERSONATION'
    | 'OTHER'

export interface AdminCommunityReportProfile {
  nickname: string
  headline: string
  cityName: string
}

export interface AdminCommunityReport {
  reportId: string
  category: AdminCommunityReportCategory
  description: string
  status: AdminCommunityReportStatus
  version: number
  reporter: AdminCommunityReportProfile
  target: AdminCommunityReportProfile
  resolutionReason: string
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
}

export interface AdminCommunityReportClaimInput {
  reportId: string
  expectedVersion: number
  reason: string
}

export interface AdminCommunityReportCloseInput extends AdminCommunityReportClaimInput {
  outcome: 'RESOLVED' | 'DISMISSED'
}

export interface AdminRosterItem {
  id: string
  nickname: string
  cityName: string
  status: AdminRosterStatus
  answers: Record<string, unknown>
  answerItems: AdminRosterAnswerItem[]
  phoneBound: boolean
  phoneNumber: string | null
  submittedAt: string
  registeredAt: string | null
  checkedInAt: string | null
  version: number
}

export interface AdminRosterAllItem extends AdminRosterItem {
  eventId: string
  eventTitle: string
  branchId: string | null
  branchName: string
}

export interface AdminRosterAllListInput {
  includePhone?: boolean
  filters?: AdminRosterFilters & { eventId?: string, branchId?: string, createdFrom?: string, createdTo?: string }
  cursor?: string
  limit?: number
}

export type AdminRosterStatus
  = | 'PENDING_REVIEW'
    | 'WAITLISTED'
    | 'PAYMENT_PENDING'
    | 'REGISTERED'
    | 'CANCELLATION_PENDING'
    | 'CANCELLED'
    | 'REJECTED'
    | 'ATTENDED'

export interface AdminRosterAnswerItem {
  key: string
  label: string
  value: string
}

export interface AdminRosterFilters {
  query?: string
  status?: AdminRosterStatus | ''
}

export interface AdminRosterListInput {
  eventId: string
  includePhone?: boolean
  filters?: AdminRosterFilters
  cursor?: string
  limit?: number
}

export interface AdminRoleItem {
  id: string
  userId: string
  nickname: string
  scopeType: AdminScopeType
  scopeId: string | null
  scopeName: string
  branchId: string | null
  roleKey: AdminRoleKey
  status: 'ACTIVE' | 'REVOKED'
  grantedAt: string | null
  revokedAt: string | null
}

export interface AdminRoleCandidate {
  id: string
  nickname: string
  cityName: string
}

export interface AdminRoleCapabilityPolicy {
  roleKey: Exclude<AdminRoleKey, 'PLATFORM_OWNER'>
  scopeType: AdminScopeType
  allowedCapabilities: AdminCapability[]
  capabilities: AdminCapability[]
  version: number
  source: 'DEFAULT' | 'CUSTOM'
  updatedAt: string | null
}

export interface AdminOpportunity {
  id: string
  title: string
  valueSummary: string
  scopeType: AdminScopeType
  branchId: string | null
  branchName: string
  cityName: string
  ownerNickname: string
  targetSummary: string
  description: string
  coverAssetId: string | null
  coverUrl: string
  roleKeys: string[]
  tags: string[]
  status: 'DRAFT' | 'PUBLISHED' | 'ENDED' | 'UNPUBLISHED' | 'ARCHIVED'
  contentSafetyStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ERROR'
  referralCount: number
  version: number
  publishedAt: string | null
  endedAt: string | null
  moderatedAt: string | null
  moderationReason: string
  archivedAt: string | null
  archiveReason: string
  updatedAt: string | null
  deadlineAt: string | null
  ownerUserId: string
  cityTagId: string | null
  tagIds: string[]
}

export interface AdminOpportunityTeamMember {
  userId: string
  nickname: string
  branchName: string
}

export interface AdminOpportunityHistoryItem {
  id: string
  action: string
  actorNickname: string
  metadata: Record<string, unknown>
  createdAt: string | null
}

export interface AdminOpportunityDetail extends AdminOpportunity {
  history: AdminOpportunityHistoryItem[]
  teamMembers: AdminOpportunityTeamMember[]
}

export interface AdminOpportunityEditorOptions {
  owners: Array<{ id: string, nickname: string, branchName: string }>
  branches: Array<{ id: string, name: string, cityName: string }>
  cities: Array<{ id: string, label: string }>
  tags: Array<{ id: string, kind: 'INDUSTRY' | 'ABILITY', label: string }>
  roles: Array<{ key: string, label: string }>
}

export interface AdminOrderSummary {
  currency: 'CNY'
  orderCount: number
  paidOrderCount: number
  eventGrossAmountCents: number
  membershipGrossAmountCents: number
  grossAmountCents: number
  refundedAmountCents: number
  netAmountCents: number
}

export interface AdminOrderPage extends AdminPage<AdminOrder> {
  summary: AdminOrderSummary
}

export interface AdminGrowthLevel {
  id: string
  levelKey: string
  name: string
  minimumExperience: number
  displayBadge: string
  sortOrder: number
  benefits: AdminGrowthBenefit[]
  legacyBenefits: string[]
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
}

export interface AdminGrowthBenefit {
  id: string
  name: string
  description: string
  sortOrder: number
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
}

export interface AdminGrowthRule {
  id: string
  ruleKey: string
  name: string
  metric: 'EXPERIENCE' | 'CONTRIBUTION'
  deltaValue: number
  dailyLimitValue: number | null
  sourceEventType: string
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
}

export interface AdminGrowthEntry {
  id: string
  userId: string
  nickname: string
  sourceEventId: string
  sourceEventType: string
  metric: 'EXPERIENCE' | 'CONTRIBUTION' | 'COIN'
  deltaValue: number
  balanceBefore: number
  balanceAfter: number
  adjustmentReason: string
  createdAt: string | null
}

export interface AdminBadge {
  id: string
  key: string
  name: string
  description: string
  iconName: string
  imageUrl: string
  placeholderShape: 'CIRCLE' | 'DIAMOND' | 'HEXAGON'
  sortOrder: number
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminBadgeAward {
  id: string
  userId: string
  nickname: string
  badgeId: string
  badgeName: string
  status: 'ACTIVE' | 'REVOKED'
  awardReason: string
  awardedAt: string | null
  revokeReason: string
  revokedAt: string | null
  equipped: boolean
  version: number
}

export type AdminOrderStatus
  = | 'CREATED'
    | 'PAYMENT_CREATED'
    | 'PAID'
    | 'FAILED'
    | 'CLOSED'
    | 'REFUND_PENDING'
    | 'PARTIALLY_REFUNDED'
    | 'REFUNDED'

export type AdminRefundStatus
  = | 'PENDING'
    | 'PROVIDER_CREATED'
    | 'PROCESSING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'CANCELLED'

export type AdminOrderRefundAction = 'SUBMIT_REFUND' | 'RETRY_REFUND'

export interface AdminOrderFilters {
  query?: string
  eventId?: string
  orderType?: AdminOrder['orderType'] | ''
  status?: AdminOrderStatus | ''
  refundStatus?: AdminRefundStatus | 'NONE' | ''
  createdFrom?: string
  createdTo?: string
}

export interface AdminOrderListInput {
  filters?: AdminOrderFilters
  cursor?: string
  limit?: number
}

export interface AdminOrder {
  id: string
  userId: string
  nickname: string
  orderType: 'MEMBERSHIP' | 'EVENT' | 'CONTENT'
  resourceId: string | null
  resourceType: 'MEMBERSHIP_PLAN' | 'EVENT' | 'KNOWLEDGE_CONTENT'
  resourceTitle: string
  resourceBranchName: string
  merchantOrderNoMasked: string
  providerTransactionIdMasked: string | null
  amountCents: number
  refundedAmountCents: number
  currency: string
  status: AdminOrderStatus
  refundStatus: AdminRefundStatus | null
  refundId: string | null
  availableRefundActions: AdminOrderRefundAction[]
  paidAt: string | null
  createdAt: string
  version: number
  entitlementStartsAt?: string | null
  entitlementEndsAt?: string | null
  entitlementStatus?: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'REFUNDED' | null
}

export interface AdminAuditItem {
  id: string
  actorUserId: string | null
  actorNickname: string
  scopeType: AdminScopeType | 'RESOURCE'
  scopeId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  effectiveRole: AdminRoleKey | null
  metadata: Record<string, unknown>
  createdAt: string | null
}

export interface AdminExportTicket {
  ticketId: string
  token: string
  status: 'PENDING'
  expiresAt: string
}

export type AdminExportStatusValue
  = | 'PENDING'
    | 'READY'
    | 'RESERVED'
    | 'CONSUMED'
    | 'EXPIRED'
    | 'REVOKED'
    | 'FAILED'

export interface AdminExportStatus {
  status: AdminExportStatusValue
  rowCount: number | null
  expiresAt: string
  fileName: string
  failureCode: string | null
  retryAfterMs?: number
}

export interface AdminExportReservation {
  status: 'RESERVED'
  tempUrl: string
  fileName: string
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  contentBytes: number
  contentSha256: string
  reservationExpiresAt: string
}

export interface AdminExportDownloadResult {
  ticketId: string
  fileName: string
  rowCount: number
}

export interface AdminPage<T> {
  items: T[]
  nextCursor?: string | null
}

export interface MipAdminGateway {
  getSession: () => Promise<MipAdminSession>
  getDashboard: () => Promise<AdminDashboard>
  listBranches: () => Promise<AdminPage<AdminBranch>>
  createBranch: (input: AdminBranchCreateInput) => Promise<AdminBranch>
  updateBranch: (input: AdminBranchUpdateInput) => Promise<AdminBranch>
  changeBranchStatus: (input: AdminBranchStatusInput) => Promise<AdminBranch>
  getAnnouncementScopes: () => Promise<AdminAnnouncementScope>
  listAnnouncements: (input?: AdminAnnouncementFilters) => Promise<AdminPage<AdminAnnouncement>>
  getAnnouncement: (announcementId: string) => Promise<AdminAnnouncement>
  saveAnnouncement: (input: AdminAnnouncementDraft) => Promise<AdminAnnouncement>
  publishAnnouncement: (announcementId: string, expectedVersion: number) => Promise<AdminAnnouncement>
  withdrawAnnouncement: (announcementId: string, expectedVersion: number, reason: string) => Promise<AdminAnnouncement>
  setAnnouncementPinned: (announcementId: string, pinned: boolean, expectedVersion: number) => Promise<AdminAnnouncement>
  getMessageCampaignScopes: () => Promise<AdminMessageCampaignScope>
  listMessageCampaigns: (input?: { status?: AdminMessageCampaignStatus | '', query?: string }) => Promise<AdminPage<AdminMessageCampaign>>
  getMessageCampaign: (campaignId: string) => Promise<AdminMessageCampaign>
  searchMessageRecipients: (input?: { branchId?: string | null, query?: string }) => Promise<AdminPage<AdminMessageRecipientCandidate>>
  saveMessageCampaign: (input: AdminMessageCampaignDraft) => Promise<AdminMessageCampaign>
  snapshotMessageCampaign: (campaignId: string, expectedVersion: number) => Promise<AdminMessageCampaign>
  publishMessageCampaign: (campaignId: string, expectedVersion: number, idempotencyKey: string) => Promise<AdminMessageCampaignPublication>
  scheduleMessageCampaign: (input: AdminMessageCampaignScheduleInput) => Promise<AdminMessageCampaign>
  cancelMessageCampaignSchedule: (input: AdminMessageCampaignCancelScheduleInput) => Promise<AdminMessageCampaign>
  withdrawMessageCampaign: (campaignId: string, expectedVersion: number, reason: string) => Promise<AdminMessageCampaign>
  listMessageDeliveryReviews: (input?: AdminDeliveryReviewListInput) => Promise<AdminDeliveryReviewPage>
  getMessageDeliveryReview: (resourceRef: AdminDeliveryReviewResourceRef) => Promise<AdminDeliveryReviewItem>
  claimMessageDeliveryReview: (input: AdminDeliveryReviewMutationInput) => Promise<AdminDeliveryReviewItem>
  reconcileMessageDeliveryReview: (input: AdminDeliveryReviewMutationInput) => Promise<AdminDeliveryReviewItem>
  resolveMessageDeliveryReview: (input: AdminDeliveryReviewResolveInput) => Promise<AdminDeliveryReviewItem>
  listMessageTemplates: (input?: AdminMessageTemplateFilters) => Promise<AdminPage<AdminMessageTemplate>>
  getMessageTemplate: (templateId: string) => Promise<AdminMessageTemplate>
  saveMessageTemplate: (input: AdminMessageTemplateDraft) => Promise<AdminMessageTemplate>
  activateMessageTemplate: (templateId: string, expectedVersion: number) => Promise<AdminMessageTemplate>
  archiveMessageTemplate: (templateId: string, expectedVersion: number) => Promise<AdminMessageTemplate>
  listCommunityReports: (status: AdminCommunityReportStatus) => Promise<AdminPage<AdminCommunityReport>>
  claimCommunityReport: (input: AdminCommunityReportClaimInput) => Promise<AdminCommunityReport>
  closeCommunityReport: (input: AdminCommunityReportCloseInput) => Promise<AdminCommunityReport>
  listUsers: (input?: Record<string, unknown>) => Promise<AdminPage<AdminUser>>
  getUser: (userId: string, includePhone?: boolean) => Promise<AdminUserDetail>
  updateUser: (input: Record<string, unknown>) => Promise<{ userId: string, version: number }>
  setUserControl: (input: Record<string, unknown>) => Promise<{ userId: string, controlType: string, active: boolean }>
  createExport: (input: Record<string, unknown>) => Promise<AdminExportTicket>
  prepareExport: (ticketId: string, token: string) => Promise<AdminExportStatus>
  getExportStatus: (ticketId: string, token: string) => Promise<AdminExportStatus>
  reserveExport: (ticketId: string, token: string) => Promise<AdminExportReservation>
  completeExport: (ticketId: string, token: string) => Promise<{ status: 'CONSUMED', consumedAt: string }>
  listEvents: (input?: Record<string, unknown>) => Promise<AdminPage<AdminEvent>>
  getEventPolicy: () => Promise<AdminEventPolicy>
  saveEventPolicy: (input: AdminEventPolicy) => Promise<AdminEventPolicy>
  getEvent: (eventId: string) => Promise<AdminEventDetail>
  getEventInsights: (eventId: string) => Promise<AdminEventInsights>
  saveEvent: (input: Record<string, unknown>) => Promise<{ id: string, version: number, status: string }>
  cloneEvent: (input: AdminEventCloneInput) => Promise<AdminEventCloneResult>
  changeEventStatus: (input: Record<string, unknown>) => Promise<{ id: string, version: number, status: string }>
  archiveEvent: (input: { eventId: string, expectedVersion: number, reason: string }) => Promise<{ id: string, version: number, status: 'ARCHIVED' }>
  publishEventReminder: (input: AdminEventReminderInput) => Promise<AdminEventReminderPublication>
  listEventAlbumPhotos: (eventId: string, status: AdminEventAlbumPhotoStatus) => Promise<AdminPage<AdminEventAlbumPhoto>>
  reviewEventAlbumPhoto: (input: AdminEventAlbumReviewInput) => Promise<AdminEventAlbumPhoto>
  getEventCommentAdminState: (eventId: string) => Promise<AdminEventCommentState>
  saveEventCommentSettings: (input: {
    eventId: string
    expectedVersion: number
    settings: Omit<AdminEventCommentSettings, 'version'>
  }) => Promise<AdminEventCommentSettings>
  moderateEventComment: (input: {
    eventId: string
    commentId: string
    expectedVersion: number
    action: 'PUBLISH' | 'HIDE'
    reason: string
  }) => Promise<AdminEventCommentMutationResult>
  claimEventCommentReport: (input: {
    eventId: string
    reportId: string
    expectedVersion: number
  }) => Promise<AdminEventCommentReportMutationResult>
  closeEventCommentReport: (input: {
    eventId: string
    reportId: string
    expectedVersion: number
    decision: 'RESOLVED' | 'DISMISSED'
    reason: string
  }) => Promise<AdminEventCommentReportMutationResult>
  listRoster: (input: AdminRosterListInput) => Promise<AdminPage<AdminRosterItem>>
  listRosterAll: (input: AdminRosterAllListInput) => Promise<AdminPage<AdminRosterAllItem>>
  reviewRegistration: (input: Record<string, unknown>) => Promise<{ id: string, status: string, version: number }>
  checkIn: (input: Record<string, unknown>) => Promise<{ id: string, status: string, version: number, idempotent: boolean }>
  undoCheckIn: (input: Record<string, unknown>) => Promise<{ id: string, status: 'REGISTERED', version: number }>
  listRoles: () => Promise<AdminPage<AdminRoleItem>>
  searchRoleCandidates: (eventId: string, query: string) => Promise<AdminPage<AdminRoleCandidate>>
  setRole: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  listRoleCapabilityPolicies: () => Promise<AdminPage<AdminRoleCapabilityPolicy>>
  updateRoleCapabilityPolicy: (input: {
    roleKey: AdminRoleCapabilityPolicy['roleKey']
    capabilities: AdminCapability[]
    expectedVersion: number
  }) => Promise<AdminRoleCapabilityPolicy>
  resetRoleCapabilityPolicy: (input: {
    roleKey: AdminRoleCapabilityPolicy['roleKey']
    expectedVersion: number
  }) => Promise<AdminRoleCapabilityPolicy>
  listOpportunities: (input?: Record<string, unknown>) => Promise<AdminPage<AdminOpportunity>>
  getOpportunity: (opportunityId: string) => Promise<AdminOpportunityDetail>
  getOpportunityEditorOptions: () => Promise<AdminOpportunityEditorOptions>
  saveOpportunity: (input: Record<string, unknown>) => Promise<{ id: string, status: string, version: number }>
  publishOpportunity: (input: { opportunityId: string, expectedVersion: number }) => Promise<{ id: string, status: 'PUBLISHED', version: number }>
  endOpportunity: (input: { opportunityId: string, expectedVersion: number }) => Promise<{ id: string, status: 'ENDED', version: number }>
  unpublishOpportunity: (input: Record<string, unknown>) => Promise<{ id: string, status: string, version: number }>
  archiveOpportunity: (input: Record<string, unknown>) => Promise<{ id: string, status: 'ARCHIVED', version: number, archivedAt: string }>
  getMatchingAdminState: (branchId?: string) => Promise<AdminMatchingState>
  saveMatchingSettings: (input: {
    branchId?: string
    expectedVersion: number
    settings: Omit<AdminMatchingSettings, 'scopeKey' | 'scopeType' | 'scopeId' | 'version' | 'updatedAt'>
  }) => Promise<AdminMatchingSettings>
  recalculateOpportunityMatching: (input: {
    opportunityId: string
    idempotencyKey: string
  }) => Promise<{ id: string, resultCount: number }>
  getOpportunityCommentAdminState: (opportunityId: string) => Promise<AdminOpportunityCommentState>
  saveOpportunityCommentSettings: (input: {
    opportunityId: string
    expectedVersion: number
    settings: Omit<AdminOpportunityCommentSettings, 'version'>
  }) => Promise<AdminOpportunityCommentSettings>
  moderateOpportunityComment: (input: {
    opportunityId: string
    commentId: string
    expectedVersion: number
    action: 'PUBLISH' | 'HIDE'
    reason: string
  }) => Promise<{ id: string, status: 'PUBLISHED' | 'HIDDEN', version: number }>
  closeOpportunityCommentReport: (input: {
    opportunityId: string
    reportId: string
    expectedVersion: number
    decision: 'RESOLVED' | 'DISMISSED'
    reason: string
  }) => Promise<{ id: string, status: 'RESOLVED' | 'DISMISSED', version: number }>
  listGrowthLevels: () => Promise<AdminPage<AdminGrowthLevel>>
  listGrowthBenefits: () => Promise<AdminPage<AdminGrowthBenefit>>
  saveGrowthBenefit: (input: Record<string, unknown>) => Promise<{ id: string, version: number }>
  saveGrowthLevel: (input: Record<string, unknown>) => Promise<{ id: string, version: number }>
  listGrowthRules: () => Promise<AdminPage<AdminGrowthRule>>
  saveGrowthRule: (input: Record<string, unknown>) => Promise<{ id: string, version: number }>
  listGrowthEntries: (input?: Record<string, unknown>) => Promise<AdminPage<AdminGrowthEntry>>
  adjustGrowth: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  listBadges: () => Promise<AdminPage<AdminBadge>>
  saveBadge: (input: Record<string, unknown>) => Promise<{ id: string, version: number }>
  listBadgeAwards: (input?: { query?: string, status?: 'ACTIVE' | 'REVOKED' | '' }) => Promise<AdminPage<AdminBadgeAward>>
  grantBadge: (input: { userId: string, badgeId: string, reason: string }) => Promise<Record<string, unknown>>
  revokeBadge: (input: { awardId: string, expectedVersion: number, reason: string }) => Promise<Record<string, unknown>>
  listOrders: (input?: AdminOrderListInput) => Promise<AdminOrderPage>
  submitRefund: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  retryRefund: (refundId: string) => Promise<Record<string, unknown>>
  listOperationalExceptions: (input?: AdminOperationalExceptionFilters) => Promise<AdminOperationalExceptionPage>
  listAudit: (input?: Record<string, unknown>) => Promise<AdminPage<AdminAuditItem>>
}

export class MipAdminError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly details: Record<string, unknown> | null

  constructor(code: string, message: string, retryable = false, details: Record<string, unknown> | null = null) {
    super(message)
    this.name = 'MipAdminError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}
