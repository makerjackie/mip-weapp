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
    | 'memberships.read'
    | 'memberships.adjust'
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
    | 'events.catalog.manage'
    | 'events.recaps.manage'
    | 'announcements.manage'
    | 'messages.manage'
    | 'messages.delivery.review'
    | 'communications.publish'
    | 'branches.manage'
    | 'community.reports.manage'
    | 'userContent.moderate'
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

export type AdminEventStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'CANCELLED' | 'ENDED' | 'ARCHIVED'
export type AdminEventAccessType = 'FREE' | 'MEMBER_INCLUDED' | 'PAID'
export type AdminEventSortDirection = 'ASC' | 'DESC'

export interface AdminEventListFilters {
  query?: string
  status?: AdminEventStatus | ''
  startsFrom?: string
  startsTo?: string
  cityOrBranch?: string
  branchId?: string
  eventTypeKey?: string
  accessType?: AdminEventAccessType | ''
  priceMinCents?: number
  priceMaxCents?: number
}

export interface AdminEventListInput {
  filters?: AdminEventListFilters
  sort?: {
    field: 'startsAt'
    direction: AdminEventSortDirection
  }
  cursor?: string
  limit?: number
}

export interface AdminEvent {
  id: string
  title: string
  summary: string
  scopeType: AdminScopeType
  branchId: string | null
  branchName: string
  status: AdminEventStatus
  contentSafetyStatus: 'PENDING' | 'PASSED' | 'REJECTED' | 'ERROR'
  startsAt: string
  endsAt: string
  cityName: string
  eventTypeKey: string
  accessType: AdminEventAccessType
  priceCents: number
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

export interface AdminRosterAnswerItem {
  key: string
  label: string
  value: string
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

export interface AdminPage<T> {
  items: T[]
  nextCursor?: string | null
}

export interface AdminWebLoginConfirmation {
  confirmed: true
}

export interface MipAdminGateway {
  getSession: () => Promise<MipAdminSession>
  confirmWebLogin: (challengeCode: string) => Promise<AdminWebLoginConfirmation>
  listEvents: (input?: AdminEventListInput) => Promise<AdminPage<AdminEvent>>
  getEvent: (eventId: string) => Promise<AdminEventDetail>
  listRoster: (input: AdminRosterListInput) => Promise<AdminPage<AdminRosterItem>>
  checkIn: (input: Record<string, unknown>) => Promise<{ id: string, status: string, version: number, idempotent: boolean }>
  undoCheckIn: (input: Record<string, unknown>) => Promise<{ id: string, status: 'REGISTERED', version: number }>
}

export { MipAdminError } from './error'
