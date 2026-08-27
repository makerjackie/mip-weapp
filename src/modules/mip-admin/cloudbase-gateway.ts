import type { AdminTransport } from './transport'
import type {
  AdminBranch,
  AdminCapability,
  AdminCommunityReport,
  AdminEvent,
  AdminEventAlbumPhoto,
  AdminEventAlbumPhotoStatus,
  AdminEventCloneResult,
  AdminEventPolicy,
  AdminEventReminderPublication,
  AdminExportReservation,
  AdminExportStatus,
  AdminExportTicket,
  AdminRoleCandidate,
  AdminRoleCapabilityPolicy,
  AdminRoleItem,
  AdminUserPrimaryBranchChangeResult,
  AdminWebLoginConfirmation,
  MipAdminGateway,
} from './types'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import {
  parseAdminAnnouncementDetail,
  parseAdminAnnouncementPage,
  parseAdminAnnouncementScopes,
} from './announcements'
import { parseAdminUnifiedBenefitLedgerPage } from './benefit-ledger'
import { cloudbaseAdminTransport } from './cloudbase-transport'
import {
  parseDashboardOverview,
} from './dashboard-overview'
import {
  createAdminEventCatalogArchiveRequest,
  createAdminEventCatalogListRequest,
  createAdminEventCatalogSaveRequest,
  createAdminEventCatalogStatusRequest,
  createAdminEventVideoRecapArchiveRequest,
  createAdminEventVideoRecapListRequest,
  createAdminEventVideoRecapSaveRequest,
  createAdminEventVideoRecapStatusRequest,
  parseAdminEventCatalogItem,
  parseAdminEventCatalogPage,
  parseAdminEventVideoRecap,
  parseAdminEventVideoRecapPage,
} from './event-catalogs'
import {
  parseEventCommentMutationResult,
  parseEventCommentReportClaimResult,
  parseEventCommentReportCloseResult,
  parseEventCommentSettings,
  parseEventCommentState,
} from './event-comments'
import { parseAdminEventInsights } from './event-insights'
import {
  createAdminEventTagAssignmentsGetRequest,
  createAdminEventTagAssignmentsReplaceRequest,
  parseAdminEventTagAssignmentReplaceResult,
  parseAdminEventTagAssignments,
} from './event-tag-assignments'
import {
  createAdminMembershipGetRequest,
  createAdminMembershipGrantRequest,
  createAdminMembershipTimelineRequest,
  parseAdminMembershipDetail,
  parseAdminMembershipGrantResult,
  parseAdminMembershipTimelinePage,
} from './memberships'
import {
  parseMessageCampaign,
  parseMessageCampaignPage,
  parseMessageCampaignPublication,
  parseMessageCampaignScopes,
  parseMessageRecipientPage,
} from './message-campaigns'
import { parseMessageDeliveryRecordPage } from './message-delivery-records'
import {
  parseDeliveryReview,
  parseDeliveryReviewPage,
} from './message-delivery-reviews'
import {
  parseMessageTemplate,
  parseMessageTemplatePage,
} from './message-templates'
import { parseOperationalExceptionPage } from './operational-exceptions'
import { parseOperationsQueuePage } from './operations-queue'
import { parseAdminOpportunityDetail, parseAdminOpportunityPage } from './opportunities'
import {
  parseOpportunityCommentSettings,
  parseOpportunityCommentState,
} from './opportunity-comments'
import { parseAdminOrderDetail, parseAdminOrderPage, parseAdminRosterPage } from './order-roster'
import { parseAdminPaymentAttemptPage } from './payment-attempts'
import { createAdminRequest } from './request-contract'
import { MipAdminError } from './types'
import {
  parseAdminUserContentArchiveMutation,
  parseAdminUserContentDetail,
  parseAdminUserContentMutation,
  parseAdminUserContentPage,
  parseAdminUserContentSaveMutation,
} from './user-content'
import {
  createAdminUserInfluenceRequest,
  parseAdminUserInfluencePage,
} from './user-influence'
import {
  createAdminUserListRequest,
  parseAdminUserDetail,
  parseAdminUserPage,
} from './user-records'

const exportStatuses = new Set(['PENDING', 'READY', 'RESERVED', 'CONSUMED', 'EXPIRED', 'REVOKED', 'FAILED'])
const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const communityReportCategories = new Set(['SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER'])
const communityReportStatuses = new Set(['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'])
const eventAlbumPhotoStatuses = new Set(['PENDING', 'PUBLISHED', 'REJECTED'])
const eventStatuses = new Set(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED', 'ARCHIVED'])
const eventAccessTypes = new Set(['FREE', 'MEMBER_INCLUDED', 'PAID'])
const eventContentSafetyStatuses = new Set(['PENDING', 'PASSED', 'REJECTED', 'ERROR'])
const adminRoleKeys = new Set([
  'PLATFORM_OWNER',
  'PLATFORM_OPERATIONS',
  'PLATFORM_FINANCE',
  'BRANCH_ADMIN',
  'EVENT_OWNER',
  'EVENT_MANAGER',
  'EVENT_STAFF',
])
const adminScopeTypes = new Set(['PLATFORM', 'BRANCH', 'EVENT'])
const adminCapabilities = new Set<AdminCapability>([
  'admin.dashboard',
  'branches.manage',
  'users.read',
  'users.phone.read',
  'users.fields.edit',
  'users.access.manage',
  'memberships.read',
  'memberships.adjust',
  'exports.create',
  'events.read',
  'events.write',
  'events.roster.read',
  'events.registrations.manage',
  'events.checkin.manage',
  'events.checkin.undo',
  'events.team.manage',
  'events.album.manage',
  'events.feedback.read',
  'events.comments.manage',
  'events.catalog.manage',
  'events.recaps.manage',
  'announcements.manage',
  'messages.manage',
  'messages.delivery.review',
  'communications.publish',
  'community.reports.manage',
  'userContent.moderate',
  'opportunities.moderate',
  'opportunities.archive',
  'growth.read',
  'growth.configure',
  'growth.adjust',
  'tasks.manage',
  'banners.manage',
  'badges.manage',
  'game.manage',
  'knowledge.manage',
  'orders.read',
  'refunds.submit',
  'operations.exceptions.read',
  'roles.change',
  'audit.read',
])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function invalidEventCommentResponse(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动评论数据')
}

function invalidEventListResponse(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动列表')
}

function invalidUserPrimaryBranchResponse(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的用户分会变更结果')
}

function parseWebLoginConfirmation(value: unknown): AdminWebLoginConfirmation {
  if (!record(value)
    || !hasOnlyKeys(value, ['confirmed'])
    || value.confirmed !== true) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的网页登录确认结果')
  }
  return { confirmed: true }
}

function parseUserPrimaryBranchChange(value: unknown): AdminUserPrimaryBranchChangeResult {
  if (!record(value)
    || !hasOnlyKeys(value, ['userId', 'primaryBranchId', 'version'])
    || typeof value.userId !== 'string'
    || !/^[\w-]{1,36}$/.test(value.userId)
    || typeof value.primaryBranchId !== 'string'
    || !/^[\w-]{1,36}$/.test(value.primaryBranchId)
    || !Number.isInteger(value.version)
    || Number(value.version) < 2) {
    invalidUserPrimaryBranchResponse()
  }
  return value as unknown as AdminUserPrimaryBranchChangeResult
}

function parseAdminEvent(value: unknown): AdminEvent {
  const keys = [
    'id',
    'title',
    'summary',
    'scopeType',
    'branchId',
    'branchName',
    'status',
    'contentSafetyStatus',
    'startsAt',
    'endsAt',
    'cityName',
    'eventTypeKey',
    'accessType',
    'priceCents',
    'registrationPolicy',
    'albumEnabled',
    'albumSubmissionPolicy',
    'capacity',
    'registrationCount',
    'attendedCount',
    'version',
  ]
  if (!record(value)
    || !hasOnlyKeys(value, keys)
    || typeof value.id !== 'string'
    || !/^[\w-]{1,36}$/.test(value.id)
    || typeof value.title !== 'string'
    || value.title.length < 1
    || value.title.length > 120
    || typeof value.summary !== 'string'
    || value.summary.length > 300
    || !['PLATFORM', 'BRANCH'].includes(String(value.scopeType))
    || !(value.branchId === null
      || (typeof value.branchId === 'string' && /^[\w-]{1,36}$/.test(value.branchId)))
    || typeof value.branchName !== 'string'
    || value.branchName.length > 80
    || !eventStatuses.has(String(value.status))
    || !eventContentSafetyStatuses.has(String(value.contentSafetyStatus))
    || typeof value.startsAt !== 'string'
    || !Number.isFinite(Date.parse(value.startsAt))
    || typeof value.endsAt !== 'string'
    || !Number.isFinite(Date.parse(value.endsAt))
    || typeof value.cityName !== 'string'
    || value.cityName.length > 80
    || typeof value.eventTypeKey !== 'string'
    || !/^[\w.:-]{1,64}$/.test(value.eventTypeKey)
    || !eventAccessTypes.has(String(value.accessType))
    || !Number.isSafeInteger(value.priceCents)
    || Number(value.priceCents) < 0
    || !['AUTO', 'APPROVAL'].includes(String(value.registrationPolicy))
    || typeof value.albumEnabled !== 'boolean'
    || !['AUTO', 'REVIEW'].includes(String(value.albumSubmissionPolicy))
    || !(value.capacity === null || (Number.isInteger(value.capacity) && Number(value.capacity) > 0))
    || !Number.isInteger(value.registrationCount)
    || Number(value.registrationCount) < 0
    || !Number.isInteger(value.attendedCount)
    || Number(value.attendedCount) < 0
    || !Number.isInteger(value.version)
    || Number(value.version) < 1) {
    invalidEventListResponse()
  }
  if ((value.scopeType === 'PLATFORM' && value.branchId !== null)
    || (value.scopeType === 'BRANCH' && value.branchId === null)
    || Date.parse(value.endsAt as string) <= Date.parse(value.startsAt as string)
    || Number(value.attendedCount) > Number(value.registrationCount)
    || (value.accessType === 'PAID' && Number(value.priceCents) < 1)
    || (value.accessType !== 'PAID' && Number(value.priceCents) !== 0)) {
    invalidEventListResponse()
  }
  return value as unknown as AdminEvent
}

function parseAdminEventPage(value: unknown) {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === null
      || (typeof value.nextCursor === 'string' && value.nextCursor.length <= 512))) {
    invalidEventListResponse()
  }
  return {
    items: value.items.map(parseAdminEvent),
    nextCursor: value.nextCursor as string | null,
  }
}

function parseEventPolicy(value: unknown): AdminEventPolicy {
  if (!record(value)) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动规则')
  }
  const cancellationHoursBeforeStart = Number(value.cancellationHoursBeforeStart)
  const version = Number(value.version)
  if (!Number.isInteger(cancellationHoursBeforeStart)
    || cancellationHoursBeforeStart < 0
    || cancellationHoursBeforeStart > 720
    || !Number.isInteger(version)
    || version < 0) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动规则')
  }
  return { cancellationHoursBeforeStart, version }
}

function parseExportTicket(value: unknown): AdminExportTicket {
  if (!record(value)
    || typeof value.ticketId !== 'string'
    || !/^[\w-]{1,36}$/.test(value.ticketId)
    || typeof value.token !== 'string'
    || !/^[\w-]{32,96}$/.test(value.token)
    || value.status !== 'PENDING'
    || typeof value.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(value.expiresAt))) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的导出票据')
  }
  return value as unknown as AdminExportTicket
}

function parseExportStatus(value: unknown): AdminExportStatus {
  if (!record(value)
    || !exportStatuses.has(String(value.status))
    || !(value.rowCount === null || (Number.isInteger(value.rowCount) && Number(value.rowCount) >= 0))
    || typeof value.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(value.expiresAt))
    || typeof value.fileName !== 'string'
    || !/^mip-[a-z-]+-[0-9TZ]+\.xlsx$/.test(value.fileName)
    || !(value.failureCode === null || typeof value.failureCode === 'string')) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的导出状态')
  }
  return value as unknown as AdminExportStatus
}

function parseExportReservation(value: unknown): AdminExportReservation {
  if (!record(value)
    || value.status !== 'RESERVED'
    || typeof value.tempUrl !== 'string'
    || !/^https:\/\//.test(value.tempUrl)
    || typeof value.fileName !== 'string'
    || !/^mip-[a-z-]+-[0-9TZ]+\.xlsx$/.test(value.fileName)
    || value.contentType !== xlsxType
    || !Number.isInteger(value.contentBytes)
    || Number(value.contentBytes) <= 0
    || Number(value.contentBytes) > 10_485_760
    || typeof value.contentSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.contentSha256)
    || typeof value.reservationExpiresAt !== 'string'
    || !Number.isFinite(Date.parse(value.reservationExpiresAt))
    || Object.hasOwn(value, 'objectKey')
    || Object.hasOwn(value, 'fileId')) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的导出下载信息')
  }
  return value as unknown as AdminExportReservation
}

function parseEventReminderPublication(value: unknown): AdminEventReminderPublication {
  if (!record(value)
    || typeof value.publicationId !== 'string'
    || !uuidPattern.test(value.publicationId)
    || !Number.isInteger(value.recipientCount)
    || Number(value.recipientCount) < 0
    || Number(value.recipientCount) > 500
    || typeof value.sendWechatReminder !== 'boolean'
    || !['BEST_EFFORT', 'NOT_REQUESTED'].includes(String(value.wechatDelivery))
    || typeof value.idempotent !== 'boolean') {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动提醒结果')
  }
  return value as unknown as AdminEventReminderPublication
}

function parseEventClone(value: unknown): AdminEventCloneResult {
  if (!record(value)
    || typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || value.status !== 'DRAFT'
    || value.version !== 1
    || typeof value.startsAt !== 'string'
    || !Number.isFinite(Date.parse(value.startsAt))
    || typeof value.idempotent !== 'boolean') {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动复制结果')
  }
  return value as unknown as AdminEventCloneResult
}

function parseBranch(value: unknown): AdminBranch {
  if (!record(value)
    || typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || typeof value.branchKey !== 'string'
    || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.branchKey)
    || typeof value.name !== 'string'
    || value.name.length < 1
    || value.name.length > 80
    || typeof value.cityName !== 'string'
    || value.cityName.length < 1
    || value.cityName.length > 80
    || typeof value.summary !== 'string'
    || value.summary.length > 500
    || !['ACTIVE', 'INACTIVE'].includes(String(value.status))
    || !Number.isInteger(value.version)
    || Number(value.version) < 1
    || !Number.isInteger(value.currentPlayerCount)
    || Number(value.currentPlayerCount) < 0
    || !Array.isArray(value.branchAdminNames)
    || value.branchAdminNames.length > 100
    || value.branchAdminNames.some(name => typeof name !== 'string' || name.length === 0 || name.length > 64)
    || !record(value.blockers)) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的分会信息')
  }
  for (const key of ['activeMemberships', 'activeBranchAdmins', 'publishedEvents', 'publishedOpportunities']) {
    const count = value.blockers[key]
    if (!Number.isInteger(count) || Number(count) < 0) {
      throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的分会信息')
    }
  }
  return value as unknown as AdminBranch
}

function parseBranchPage(value: unknown) {
  if (!record(value)
    || !Array.isArray(value.items)
    || !(value.nextCursor === undefined || value.nextCursor === null || typeof value.nextCursor === 'string')) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的分会列表')
  }
  return {
    items: value.items.map(parseBranch),
    nextCursor: value.nextCursor === undefined ? null : value.nextCursor,
  }
}

function parseAdminRole(value: unknown): AdminRoleItem {
  if (!record(value)
    || typeof value.id !== 'string'
    || value.id.length < 1
    || value.id.length > 36
    || typeof value.userId !== 'string'
    || value.userId.length < 1
    || value.userId.length > 36
    || typeof value.nickname !== 'string'
    || value.nickname.length < 1
    || value.nickname.length > 64
    || !adminScopeTypes.has(String(value.scopeType))
    || !adminRoleKeys.has(String(value.roleKey))
    || typeof value.scopeName !== 'string'
    || value.scopeName.length < 1
    || value.scopeName.length > 120
    || !['ACTIVE', 'REVOKED'].includes(String(value.status))
    || !(value.grantedAt === null || (typeof value.grantedAt === 'string' && Number.isFinite(Date.parse(value.grantedAt))))
    || !(value.revokedAt === null || (typeof value.revokedAt === 'string' && Number.isFinite(Date.parse(value.revokedAt))))) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的角色信息')
  }
  const scopeType = String(value.scopeType)
  const scopeIdValid = scopeType === 'PLATFORM'
    ? value.scopeId === null
    : typeof value.scopeId === 'string' && value.scopeId.length > 0 && value.scopeId.length <= 36
  const branchIdValid = scopeType === 'PLATFORM'
    ? value.branchId === null
    : scopeType === 'BRANCH'
      ? value.branchId === value.scopeId
      : value.branchId === null || (typeof value.branchId === 'string' && value.branchId.length > 0 && value.branchId.length <= 36)
  if (!scopeIdValid || !branchIdValid) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的角色范围')
  }
  return {
    id: value.id as string,
    userId: value.userId as string,
    nickname: value.nickname as string,
    scopeType: value.scopeType as AdminRoleItem['scopeType'],
    scopeId: value.scopeId as string | null,
    scopeName: value.scopeName as string,
    branchId: value.branchId as string | null,
    roleKey: value.roleKey as AdminRoleItem['roleKey'],
    status: value.status as AdminRoleItem['status'],
    grantedAt: value.grantedAt as string | null,
    revokedAt: value.revokedAt as string | null,
  }
}

function parseAdminRolePage(value: unknown) {
  if (!record(value)
    || !Array.isArray(value.items)
    || !(value.nextCursor === undefined || value.nextCursor === null || typeof value.nextCursor === 'string')) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的角色列表')
  }
  return {
    items: value.items.map(parseAdminRole),
    nextCursor: value.nextCursor === undefined ? null : value.nextCursor,
  }
}

function parseAdminRoleCandidate(value: unknown): AdminRoleCandidate {
  if (!record(value)
    || typeof value.id !== 'string'
    || value.id.length < 1
    || value.id.length > 36
    || typeof value.nickname !== 'string'
    || value.nickname.length < 1
    || value.nickname.length > 64
    || typeof value.cityName !== 'string'
    || value.cityName.length > 80) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的角色候选人')
  }
  return {
    id: value.id,
    nickname: value.nickname,
    cityName: value.cityName,
  } as AdminRoleCandidate
}

function parseAdminRoleCandidatePage(value: unknown) {
  if (!record(value) || !Array.isArray(value.items)) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的角色候选人列表')
  }
  return { items: value.items.map(parseAdminRoleCandidate), nextCursor: null }
}

function parseAdminRoleCapabilityPolicy(value: unknown): AdminRoleCapabilityPolicy {
  if (!record(value)) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的权限模板')
  }
  const allowedCapabilities = value.allowedCapabilities
  const capabilities = value.capabilities
  if (value.roleKey === 'PLATFORM_OWNER'
    || !adminRoleKeys.has(String(value.roleKey))
    || !adminScopeTypes.has(String(value.scopeType))
    || !Array.isArray(allowedCapabilities)
    || !Array.isArray(capabilities)
    || allowedCapabilities.some(item => !adminCapabilities.has(item as AdminCapability))
    || capabilities.some(item => !adminCapabilities.has(item as AdminCapability))
    || new Set(allowedCapabilities).size !== allowedCapabilities.length
    || new Set(capabilities).size !== capabilities.length
    || capabilities.some(item => !allowedCapabilities.includes(item))
    || !Number.isInteger(value.version)
    || Number(value.version) < 0
    || !['DEFAULT', 'CUSTOM'].includes(String(value.source))
    || !(value.updatedAt === null
      || (typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))))) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的权限模板')
  }
  return value as unknown as AdminRoleCapabilityPolicy
}

function parseAdminRoleCapabilityPolicyPage(value: unknown) {
  if (!record(value) || !Array.isArray(value.items)) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的权限模板列表')
  }
  return { items: value.items.map(parseAdminRoleCapabilityPolicy), nextCursor: null }
}

function parseCommunityReportProfile(value: unknown) {
  if (!record(value)
    || !hasOnlyKeys(value, ['nickname', 'headline', 'cityName'])
    || typeof value.nickname !== 'string'
    || value.nickname.length < 1
    || value.nickname.length > 64
    || typeof value.headline !== 'string'
    || value.headline.length > 160
    || typeof value.cityName !== 'string'
    || value.cityName.length > 80) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的举报资料摘要')
  }
  return value as unknown as AdminCommunityReport['reporter']
}

function parseCommunityReport(value: unknown): AdminCommunityReport {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'reportId',
      'category',
      'description',
      'status',
      'version',
      'reporter',
      'target',
      'resolutionReason',
      'createdAt',
      'updatedAt',
      'reviewedAt',
    ])
    || typeof value.reportId !== 'string'
    || !uuidPattern.test(value.reportId)
    || !communityReportCategories.has(String(value.category))
    || typeof value.description !== 'string'
    || value.description.length > 300
    || !communityReportStatuses.has(String(value.status))
    || !Number.isInteger(value.version)
    || Number(value.version) < 1
    || typeof value.resolutionReason !== 'string'
    || value.resolutionReason.length > 300
    || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.updatedAt))
    || !(value.reviewedAt === null || (typeof value.reviewedAt === 'string' && Number.isFinite(Date.parse(value.reviewedAt))))) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的举报记录')
  }
  return {
    ...(value as unknown as Omit<AdminCommunityReport, 'reporter' | 'target'>),
    reporter: parseCommunityReportProfile(value.reporter),
    target: parseCommunityReportProfile(value.target),
  }
}

function parseCommunityReportPage(value: unknown) {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的举报列表')
  }
  return {
    items: value.items.map(parseCommunityReport),
    nextCursor: value.nextCursor,
  }
}

function parseEventAlbumPhoto(value: unknown): AdminEventAlbumPhoto {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'id',
      'caption',
      'imageUrl',
      'nickname',
      'avatarUrl',
      'status',
      'moderationReason',
      'version',
      'createdAt',
      'reviewedAt',
      'publishedAt',
    ])
    || typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || typeof value.caption !== 'string'
    || value.caption.length > 300
    || typeof value.imageUrl !== 'string'
    || typeof value.nickname !== 'string'
    || value.nickname.length < 1
    || value.nickname.length > 64
    || typeof value.avatarUrl !== 'string'
    || !eventAlbumPhotoStatuses.has(String(value.status))
    || typeof value.moderationReason !== 'string'
    || value.moderationReason.length > 300
    || !Number.isInteger(value.version)
    || Number(value.version) < 1
    || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
    || !(value.reviewedAt === null
      || (typeof value.reviewedAt === 'string' && Number.isFinite(Date.parse(value.reviewedAt))))
    || !(value.publishedAt === null
      || (typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt))))) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的相册照片')
  }
  return value as unknown as AdminEventAlbumPhoto
}

function parseEventAlbumPage(value: unknown) {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')) {
    throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的相册列表')
  }
  return { items: value.items.map(parseEventAlbumPhoto), nextCursor: value.nextCursor }
}

export function createMipAdminGateway(transport: AdminTransport): MipAdminGateway {
  const call = <T>(action: string, data: Record<string, unknown> = {}) => (
    transport.request<T>(createAdminRequest(action, data))
  )
  return {
    getSession: () => call('mip.admin.session'),
    confirmWebLogin: async challengeCode => parseWebLoginConfirmation(
      await call('mip.admin.webLogin.confirm', { challengeCode }),
    ),
    getDashboard: () => call('mip.admin.dashboard'),
    getDashboardOverview: async input => parseDashboardOverview(
      await call('mip.admin.dashboard.overview.get', { ...(input || {}) }),
    ),
    listBranches: async () => parseBranchPage(await call('mip.admin.branches.list')),
    createBranch: async input => parseBranch(await call('mip.admin.branches.create', { ...input })),
    updateBranch: async input => parseBranch(await call('mip.admin.branches.update', { ...input })),
    changeBranchStatus: async input => parseBranch(await call('mip.admin.branches.changeStatus', { ...input })),
    getAnnouncementScopes: async () => parseAdminAnnouncementScopes(
      await call('mip.admin.announcements.scopes'),
    ),
    listAnnouncements: async input => parseAdminAnnouncementPage(
      await call('mip.admin.announcements.list', { ...(input || {}) }),
    ),
    getAnnouncement: async announcementId => parseAdminAnnouncementDetail(
      await call('mip.admin.announcements.get', { announcementId }),
    ),
    saveAnnouncement: async input => parseAdminAnnouncementDetail(
      await call('mip.admin.announcements.save', { ...input }),
    ),
    publishAnnouncement: async (announcementId, expectedVersion) => parseAdminAnnouncementDetail(
      await call('mip.admin.announcements.publish', { announcementId, expectedVersion }),
    ),
    withdrawAnnouncement: async (announcementId, expectedVersion, reason) => parseAdminAnnouncementDetail(
      await call('mip.admin.announcements.withdraw', { announcementId, expectedVersion, reason }),
    ),
    setAnnouncementPinned: async (announcementId, pinned, expectedVersion) => parseAdminAnnouncementDetail(
      await call('mip.admin.announcements.pin', { announcementId, pinned, expectedVersion }),
    ),
    getMessageCampaignScopes: async () => parseMessageCampaignScopes(
      await call('mip.admin.messageCampaigns.scopes'),
    ),
    listMessageCampaigns: async input => parseMessageCampaignPage(
      await call('mip.admin.messageCampaigns.list', { ...(input || {}) }),
    ),
    getMessageCampaign: async campaignId => parseMessageCampaign(
      await call('mip.admin.messageCampaigns.get', { campaignId }),
    ),
    searchMessageRecipients: async input => parseMessageRecipientPage(
      await call('mip.admin.messageCampaigns.recipients', { ...(input || {}) }),
    ),
    saveMessageCampaign: async input => parseMessageCampaign(
      await call('mip.admin.messageCampaigns.save', { ...input }),
    ),
    snapshotMessageCampaign: async (campaignId, expectedVersion) => parseMessageCampaign(
      await call('mip.admin.messageCampaigns.snapshot', { campaignId, expectedVersion }),
    ),
    publishMessageCampaign: async (campaignId, expectedVersion, idempotencyKey) => parseMessageCampaignPublication(
      await call('mip.admin.messageCampaigns.publish', { campaignId, expectedVersion, idempotencyKey }),
    ),
    scheduleMessageCampaign: async input => parseMessageCampaign(
      await call('mip.admin.messageCampaigns.schedule', { ...input }),
    ),
    cancelMessageCampaignSchedule: async input => parseMessageCampaign(
      await call('mip.admin.messageCampaigns.cancelSchedule', { ...input }),
    ),
    withdrawMessageCampaign: async (campaignId, expectedVersion, reason) => parseMessageCampaign(
      await call('mip.admin.messageCampaigns.withdraw', { campaignId, expectedVersion, reason }),
    ),
    listMessageDeliveryReviews: async input => parseDeliveryReviewPage(
      await call('mip.admin.messageDeliveryReviews.list', { ...(input || {}) }),
    ),
    listMessageDeliveryRecords: async input => parseMessageDeliveryRecordPage(
      await call('mip.admin.messageDeliveryRecords.list', { ...(input || {}) }),
    ),
    getMessageDeliveryReview: async resourceRef => parseDeliveryReview(
      await call('mip.admin.messageDeliveryReviews.get', { resourceRef }),
    ),
    claimMessageDeliveryReview: async input => parseDeliveryReview(
      await call('mip.admin.messageDeliveryReviews.claim', { ...input }),
    ),
    reconcileMessageDeliveryReview: async input => parseDeliveryReview(
      await call('mip.admin.messageDeliveryReviews.reconcile', { ...input }),
    ),
    resolveMessageDeliveryReview: async input => parseDeliveryReview(
      await call('mip.admin.messageDeliveryReviews.resolve', { ...input }),
    ),
    listMessageTemplates: async input => parseMessageTemplatePage(
      await call('mip.admin.messageTemplates.list', { ...(input || {}) }),
    ),
    getMessageTemplate: async templateId => parseMessageTemplate(
      await call('mip.admin.messageTemplates.get', { templateId }),
    ),
    saveMessageTemplate: async input => parseMessageTemplate(
      await call('mip.admin.messageTemplates.save', { ...input }),
    ),
    activateMessageTemplate: async (templateId, expectedVersion) => parseMessageTemplate(
      await call('mip.admin.messageTemplates.activate', { templateId, expectedVersion }),
    ),
    archiveMessageTemplate: async (templateId, expectedVersion) => parseMessageTemplate(
      await call('mip.admin.messageTemplates.archive', { templateId, expectedVersion }),
    ),
    listCommunityReports: async status => parseCommunityReportPage(
      await call('mip.admin.communityReports.list', { status }),
    ),
    claimCommunityReport: async input => parseCommunityReport(
      await call('mip.admin.communityReports.claim', { ...input }),
    ),
    closeCommunityReport: async input => parseCommunityReport(
      await call('mip.admin.communityReports.close', { ...input }),
    ),
    listUsers: async (input) => {
      const request = createAdminUserListRequest(input)
      return parseAdminUserPage(
        await call('mip.admin.users.list', request),
        request.includePhone === true,
      )
    },
    getUser: async (userId, includePhone = false) => parseAdminUserDetail(
      await call('mip.admin.users.get', { userId, includePhone }),
      includePhone,
    ),
    getMembership: async (userId) => {
      const request = createAdminMembershipGetRequest(userId)
      return parseAdminMembershipDetail(
        await call('mip.admin.memberships.get', request),
      )
    },
    listMembershipTimeline: async (input) => {
      const request = createAdminMembershipTimelineRequest(input)
      return parseAdminMembershipTimelinePage(
        await call('mip.admin.memberships.timeline', request),
      )
    },
    grantMembership: async (input) => {
      const request = createAdminMembershipGrantRequest(input)
      return parseAdminMembershipGrantResult(
        await call('mip.admin.memberships.grant', { ...request }),
        request,
      )
    },
    listUserInfluence: async (input) => {
      const request = createAdminUserInfluenceRequest(input)
      return parseAdminUserInfluencePage(
        await call('mip.admin.users.influence.list', { ...request }),
        request,
      )
    },
    listUserContent: async input => parseAdminUserContentPage(
      await call('mip.admin.userContent.list', { ...(input || {}) }),
    ),
    getUserContent: async (kind, contentId) => resolveCloudFileUrls(
      parseAdminUserContentDetail(
        await call('mip.admin.userContent.get', { kind, contentId }),
      ),
    ),
    unpublishUserContent: async input => parseAdminUserContentMutation(
      await call('mip.admin.userContent.unpublish', { ...input }),
      input,
    ),
    saveUserContent: async input => parseAdminUserContentSaveMutation(
      await call('mip.admin.userContent.save', { ...input }),
      input,
    ),
    archiveUserContent: async input => parseAdminUserContentArchiveMutation(
      await call('mip.admin.userContent.archive', { ...input }),
      input,
    ),
    updateUser: input => call('mip.admin.users.update', input),
    changeUserPrimaryBranch: async (input) => {
      const result = parseUserPrimaryBranchChange(
        await call('mip.admin.users.changePrimaryBranch', { ...input }),
      )
      if (result.userId !== input.userId
        || result.primaryBranchId !== input.targetBranchId
        || result.version !== input.expectedVersion + 1) {
        invalidUserPrimaryBranchResponse()
      }
      return result
    },
    setUserControl: input => call('mip.admin.users.setControl', input),
    createExport: async input => parseExportTicket(await call('mip.admin.exports.create', input)),
    prepareExport: async (ticketId, token) => parseExportStatus(await call('mip.admin.exports.prepare', { ticketId, token })),
    getExportStatus: async (ticketId, token) => parseExportStatus(await call('mip.admin.exports.status', { ticketId, token })),
    reserveExport: async (ticketId, token) => parseExportReservation(await call('mip.admin.exports.reserve', { ticketId, token })),
    completeExport: async (ticketId, token) => {
      const value = await call<Record<string, unknown>>('mip.admin.exports.complete', { ticketId, token })
      if (!record(value) || value.status !== 'CONSUMED' || typeof value.consumedAt !== 'string') {
        throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的导出消费状态')
      }
      return { status: 'CONSUMED' as const, consumedAt: value.consumedAt }
    },
    listEvents: async input => parseAdminEventPage(
      await call('mip.admin.events.list', { ...(input || {}) }),
    ),
    listEventCatalogs: async input => parseAdminEventCatalogPage(
      await call('mip.admin.events.catalog.list', { ...createAdminEventCatalogListRequest(input) }),
    ),
    saveEventCatalog: async input => parseAdminEventCatalogItem(
      await call('mip.admin.events.catalog.save', createAdminEventCatalogSaveRequest(input)),
    ),
    changeEventCatalogStatus: async input => parseAdminEventCatalogItem(
      await call('mip.admin.events.catalog.changeStatus', createAdminEventCatalogStatusRequest(input)),
    ),
    archiveEventCatalog: async input => parseAdminEventCatalogItem(
      await call('mip.admin.events.catalog.archive', createAdminEventCatalogArchiveRequest(input)),
    ),
    getEventTagAssignments: async eventId => parseAdminEventTagAssignments(
      await call(
        'mip.admin.events.tags.get',
        createAdminEventTagAssignmentsGetRequest(eventId),
      ),
    ),
    replaceEventTagAssignments: async input => parseAdminEventTagAssignmentReplaceResult(
      await call(
        'mip.admin.events.tags.replace',
        createAdminEventTagAssignmentsReplaceRequest(input),
      ),
    ),
    listEventVideoRecaps: async input => parseAdminEventVideoRecapPage(
      await call('mip.admin.events.recaps.list', { ...createAdminEventVideoRecapListRequest(input) }),
    ),
    getEventVideoRecap: async recapId => parseAdminEventVideoRecap(
      await call('mip.admin.events.recaps.get', { recapId }),
    ),
    saveEventVideoRecap: async input => parseAdminEventVideoRecap(
      await call('mip.admin.events.recaps.save', createAdminEventVideoRecapSaveRequest(input)),
    ),
    changeEventVideoRecapStatus: async input => parseAdminEventVideoRecap(
      await call('mip.admin.events.recaps.changeStatus', createAdminEventVideoRecapStatusRequest(input)),
    ),
    archiveEventVideoRecap: async input => parseAdminEventVideoRecap(
      await call('mip.admin.events.recaps.archive', createAdminEventVideoRecapArchiveRequest(input)),
    ),
    getEventPolicy: async () => parseEventPolicy(await call('mip.admin.events.policy.get')),
    saveEventPolicy: async input => parseEventPolicy(await call('mip.admin.events.policy.save', {
      cancellationHoursBeforeStart: input.cancellationHoursBeforeStart,
      expectedVersion: input.version,
    })),
    getEvent: async eventId => resolveCloudFileUrls(
      await call('mip.admin.events.get', { eventId }),
    ),
    getEventInsights: async (eventId) => {
      const insights = parseAdminEventInsights(
        await call('mip.admin.events.insights.get', { eventId }),
      )
      if (insights.eventId !== eventId) {
        throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的活动数据洞察')
      }
      return insights
    },
    listEventAlbumPhotos: async (eventId: string, status: AdminEventAlbumPhotoStatus) => {
      const page = parseEventAlbumPage(await call('mip.admin.events.album.list', { eventId, status }))
      return resolveCloudFileUrls(page)
    },
    reviewEventAlbumPhoto: async (input) => {
      const photo = parseEventAlbumPhoto(await call('mip.admin.events.album.review', { ...input }))
      return resolveCloudFileUrls(photo)
    },
    getEventCommentAdminState: async (eventId) => {
      const state = parseEventCommentState(
        await call('mip.admin.events.comments.get', { eventId }),
      )
      if (state.event.id !== eventId) {
        invalidEventCommentResponse()
      }
      return state
    },
    saveEventCommentSettings: async (input) => {
      const settings = parseEventCommentSettings(
        await call('mip.admin.events.comments.settings.save', { ...input }),
      )
      if (settings.version !== input.expectedVersion + 1
        || settings.commentsEnabled !== input.settings.commentsEnabled
        || settings.moderationMode !== input.settings.moderationMode) {
        invalidEventCommentResponse()
      }
      return settings
    },
    moderateEventComment: async (input) => {
      const result = parseEventCommentMutationResult(
        await call('mip.admin.events.comments.moderate', { ...input }),
      )
      const expectedStatus = input.action === 'PUBLISH' ? 'PUBLISHED' : 'HIDDEN'
      if (result.id !== input.commentId || result.status !== expectedStatus
        || result.version !== input.expectedVersion + 1) {
        invalidEventCommentResponse()
      }
      return result
    },
    claimEventCommentReport: async (input) => {
      const result = parseEventCommentReportClaimResult(
        await call('mip.admin.events.comments.reports.claim', { ...input }),
      )
      if (result.id !== input.reportId || result.version !== input.expectedVersion + 1) {
        invalidEventCommentResponse()
      }
      return result
    },
    closeEventCommentReport: async (input) => {
      const result = parseEventCommentReportCloseResult(
        await call('mip.admin.events.comments.reports.close', { ...input }),
      )
      if (result.id !== input.reportId || result.status !== input.decision
        || result.version !== input.expectedVersion + 1) {
        invalidEventCommentResponse()
      }
      return result
    },
    saveEvent: input => call('mip.admin.events.save', input),
    cloneEvent: async input => parseEventClone(await call('mip.admin.events.clone', { ...input })),
    changeEventStatus: input => call('mip.admin.events.changeStatus', input),
    archiveEvent: input => call('mip.admin.events.archive', input),
    publishEventReminder: async input => parseEventReminderPublication(
      await call('mip.admin.communications.publishEventReminder', { ...input }),
    ),
    listRoster: async input => parseAdminRosterPage(await call('mip.admin.events.roster', { ...input })),
    listRosterAll: input => call('mip.admin.events.rosterAll', { ...input }),
    reviewRegistration: input => call('mip.admin.events.registrations.review', input),
    checkIn: input => call('mip.admin.events.checkIn', input),
    undoCheckIn: input => call('mip.admin.events.undoCheckIn', input),
    listRoles: async () => parseAdminRolePage(await call('mip.admin.roles.list')),
    searchRoleCandidates: async (eventId, query) => parseAdminRoleCandidatePage(
      await call('mip.admin.roles.candidates', { eventId, query }),
    ),
    setRole: input => call('mip.admin.roles.set', input),
    listRoleCapabilityPolicies: async () => parseAdminRoleCapabilityPolicyPage(
      await call('mip.admin.rolePolicies.list'),
    ),
    updateRoleCapabilityPolicy: async input => parseAdminRoleCapabilityPolicy(
      await call('mip.admin.rolePolicies.update', { ...input }),
    ),
    resetRoleCapabilityPolicy: async input => parseAdminRoleCapabilityPolicy(
      await call('mip.admin.rolePolicies.update', { ...input, reset: true }),
    ),
    listOpportunities: async input => parseAdminOpportunityPage(await call('mip.admin.opportunities.list', input || {})),
    getOpportunity: async opportunityId => resolveCloudFileUrls(
      parseAdminOpportunityDetail(await call('mip.admin.opportunities.get', { opportunityId })),
    ),
    getOpportunityEditorOptions: () => call('mip.admin.opportunities.options'),
    saveOpportunity: input => call('mip.admin.opportunities.save', input),
    publishOpportunity: input => call('mip.admin.opportunities.publish', input),
    endOpportunity: input => call('mip.admin.opportunities.end', input),
    unpublishOpportunity: input => call('mip.admin.opportunities.unpublish', input),
    archiveOpportunity: input => call('mip.admin.opportunities.archive', input),
    getOpportunityCommentAdminState: async opportunityId => parseOpportunityCommentState(
      await call('mip.admin.opportunityComments.get', { opportunityId }),
    ),
    saveOpportunityCommentSettings: async input => parseOpportunityCommentSettings(
      await call('mip.admin.opportunityComments.settings.save', { ...input }),
    ),
    moderateOpportunityComment: input => call('mip.admin.opportunityComments.moderate', { ...input }),
    closeOpportunityCommentReport: input => call('mip.admin.opportunityComments.reports.close', { ...input }),
    getMatchingAdminState: branchId => call('mip.admin.matching.get', { branchId }),
    saveMatchingSettings: input => call('mip.admin.matching.settings.save', { ...input }),
    recalculateOpportunityMatching: input => call('mip.admin.matching.recalculate', { ...input }),
    listGrowthLevels: () => call('mip.admin.growth.levels'),
    listGrowthBenefits: () => call('mip.admin.growth.benefits'),
    saveGrowthBenefit: input => call('mip.admin.growth.saveBenefit', input),
    saveGrowthLevel: input => call('mip.admin.growth.saveLevel', input),
    listGrowthRules: () => call('mip.admin.growth.rules'),
    saveGrowthRule: input => call('mip.admin.growth.saveRule', input),
    listGrowthEntries: input => call('mip.admin.growth.entries', input || {}),
    listGrowthLevelTransitions: input => call('mip.admin.growth.levelTransitions', input || {}),
    listUnifiedBenefitLedger: async input => parseAdminUnifiedBenefitLedgerPage(
      await call('mip.admin.benefits.ledger', { ...(input || {}) }),
    ),
    adjustGrowth: input => call('mip.admin.growth.adjust', input),
    listBadges: () => call('mip.admin.badges.list'),
    saveBadge: input => call('mip.admin.badges.save', input),
    listBadgeAwards: input => call('mip.admin.badges.awards', input || {}),
    grantBadge: input => call('mip.admin.badges.grant', input),
    revokeBadge: input => call('mip.admin.badges.revoke', input),
    listOrders: async input => parseAdminOrderPage(await call('mip.admin.orders.list', { ...(input || {}) })),
    listPaymentAttempts: async input => parseAdminPaymentAttemptPage(
      await call('mip.admin.paymentAttempts.list', { ...(input || {}) }),
    ),
    getOrder: async orderId => parseAdminOrderDetail(await call('mip.admin.orders.get', { orderId })),
    submitRefund: input => call('mip.admin.refunds.submit', input),
    retryRefund: refundId => call('mip.admin.refunds.retry', { refundId }),
    listOperationalExceptions: async input => parseOperationalExceptionPage(
      await call('mip.admin.exceptions.list', { ...(input || {}) }),
    ),
    listOperationsQueue: async input => parseOperationsQueuePage(
      await call('mip.admin.operations.queue.list', { ...(input || {}) }),
    ),
    listAudit: input => call('mip.admin.audit.list', input || {}),
  }
}

export const cloudbaseMipAdminGateway = createMipAdminGateway(cloudbaseAdminTransport)
