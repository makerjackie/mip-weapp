import { MipAdminError } from './types'

export const ADMIN_MEMBERSHIP_DURATION_MONTHS = [1, 3, 6, 12] as const

export type AdminMembershipDurationMonths = typeof ADMIN_MEMBERSHIP_DURATION_MONTHS[number]
export type AdminMembershipState = 'ACTIVE' | 'SCHEDULED' | 'INACTIVE'
export type AdminMembershipEntitlementStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'REFUNDED'
export type AdminMembershipSourceType = 'ORDER' | 'ADMIN_ADJUSTMENT'

export interface AdminMembershipAdjustment {
  id: string
  durationMonths: AdminMembershipDurationMonths
  reason: string
  actorNickname: string
  createdAt: string
  expectedChainVersion: number
  resultChainVersion: number
}

export interface AdminMembershipEntitlement {
  id: string
  sourceType: AdminMembershipSourceType
  status: AdminMembershipEntitlementStatus
  startsAt: string
  endsAt: string
  currentlyActive: boolean
  orderId: string | null
  adjustment: AdminMembershipAdjustment | null
}

export interface AdminMembershipDetail {
  user: {
    id: string
    nickname: string
    status: 'ACTIVE' | 'BLOCKED' | 'CLOSED'
  }
  chainVersion: number
  membership: {
    status: AdminMembershipState
    active: boolean
    currentEndsAt: string | null
    nextStartsAt: string | null
  }
  entitlements: AdminMembershipEntitlement[]
}

export interface AdminMembershipGrantInput {
  userId: string
  durationMonths: AdminMembershipDurationMonths
  reason: string
  expectedChainVersion: number
  idempotencyKey: string
}

export type AdminMembershipGrantDraft = Omit<AdminMembershipGrantInput, 'idempotencyKey'>

export interface AdminMembershipGrantResult {
  adjustmentId: string
  resultChainVersion: number
  startsAt: string
  endsAt: string
  idempotent: boolean
}

export interface AdminMembershipGrantIntent {
  fingerprint: string
  idempotencyKey: string
}

export type AdminMembershipEntitlementView = AdminMembershipEntitlement & {
  sourceText: '购买' | '人工开通'
  statusText: string
  startsText: string
  endsText: string
  adjustment: null | (AdminMembershipAdjustment & { createdText: string })
}

export interface AdminMembershipDetailView extends Omit<AdminMembershipDetail, 'user' | 'membership' | 'entitlements'> {
  user: AdminMembershipDetail['user'] & { statusText: string }
  membership: AdminMembershipDetail['membership'] & {
    statusText: string
    currentEndsText: string
    nextStartsText: string
  }
  entitlements: AdminMembershipEntitlementView[]
}

const userStatuses = new Set(['ACTIVE', 'BLOCKED', 'CLOSED'])
const membershipStates = new Set(['ACTIVE', 'SCHEDULED', 'INACTIVE'])
const entitlementStatuses = new Set(['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED'])
const sourceTypes = new Set(['ORDER', 'ADMIN_ADJUSTMENT'])
const durationMonths = new Set<number>(ADMIN_MEMBERSHIP_DURATION_MONTHS)
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const idempotencyKeyPattern = /^[\w.:-]{1,128}$/

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validNullableDate(value: unknown): value is string | null {
  return value === null || validDate(value)
}

function invalidMembershipResponse(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的会员数据')
}

function parseAdjustment(value: unknown): AdminMembershipAdjustment {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'id',
      'durationMonths',
      'reason',
      'actorNickname',
      'createdAt',
      'expectedChainVersion',
      'resultChainVersion',
    ])
    || !validId(value.id)
    || !Number.isInteger(value.durationMonths)
    || !durationMonths.has(Number(value.durationMonths))
    || typeof value.reason !== 'string'
    || value.reason.trim().length < 1
    || value.reason.length > 300
    || typeof value.actorNickname !== 'string'
    || value.actorNickname.trim().length < 1
    || value.actorNickname.length > 64
    || !validDate(value.createdAt)
    || !Number.isInteger(value.expectedChainVersion)
    || Number(value.expectedChainVersion) < 1
    || !Number.isInteger(value.resultChainVersion)
    || Number(value.resultChainVersion) !== Number(value.expectedChainVersion) + 1) {
    invalidMembershipResponse()
  }
  return value as unknown as AdminMembershipAdjustment
}

function parseEntitlement(value: unknown): AdminMembershipEntitlement {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'id',
      'sourceType',
      'status',
      'startsAt',
      'endsAt',
      'currentlyActive',
      'orderId',
      'adjustment',
    ])
    || !validId(value.id)
    || !sourceTypes.has(String(value.sourceType))
    || !entitlementStatuses.has(String(value.status))
    || !validDate(value.startsAt)
    || !validDate(value.endsAt)
    || Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    || typeof value.currentlyActive !== 'boolean') {
    invalidMembershipResponse()
  }
  const sourceType = value.sourceType as AdminMembershipSourceType
  if (sourceType === 'ORDER') {
    if (!validId(value.orderId) || value.adjustment !== null) {
      invalidMembershipResponse()
    }
  }
  else if (value.orderId !== null) {
    invalidMembershipResponse()
  }
  return {
    ...value,
    adjustment: sourceType === 'ADMIN_ADJUSTMENT'
      ? parseAdjustment(value.adjustment)
      : null,
  } as AdminMembershipEntitlement
}

export function parseAdminMembershipDetail(value: unknown): AdminMembershipDetail {
  if (!record(value)
    || !hasOnlyKeys(value, ['user', 'chainVersion', 'membership', 'entitlements'])
    || !record(value.user)
    || !hasOnlyKeys(value.user, ['id', 'nickname', 'status'])
    || !validId(value.user.id)
    || typeof value.user.nickname !== 'string'
    || value.user.nickname.trim().length < 1
    || value.user.nickname.length > 64
    || !userStatuses.has(String(value.user.status))
    || !Number.isInteger(value.chainVersion)
    || Number(value.chainVersion) < 1
    || !record(value.membership)
    || !hasOnlyKeys(value.membership, ['status', 'active', 'currentEndsAt', 'nextStartsAt'])
    || !membershipStates.has(String(value.membership.status))
    || typeof value.membership.active !== 'boolean'
    || !validNullableDate(value.membership.currentEndsAt)
    || !validNullableDate(value.membership.nextStartsAt)
    || !Array.isArray(value.entitlements)) {
    invalidMembershipResponse()
  }
  const membership = value.membership as unknown as AdminMembershipDetail['membership']
  if (membership.active !== (membership.status === 'ACTIVE')
    || (membership.status === 'ACTIVE' && membership.currentEndsAt === null)
    || (membership.status !== 'ACTIVE' && membership.currentEndsAt !== null)
    || (membership.status === 'SCHEDULED' && membership.nextStartsAt === null)
    || (membership.status === 'INACTIVE' && membership.nextStartsAt !== null)) {
    invalidMembershipResponse()
  }
  return {
    user: value.user as unknown as AdminMembershipDetail['user'],
    chainVersion: Number(value.chainVersion),
    membership,
    entitlements: value.entitlements.map(parseEntitlement),
  }
}

export function createAdminMembershipGetRequest(userId: string) {
  const normalized = userId.trim().toLowerCase()
  if (!validId(normalized)) {
    throw new TypeError('Invalid admin membership user ID')
  }
  return { userId: normalized }
}

export function createAdminMembershipGrantRequest(input: AdminMembershipGrantInput): AdminMembershipGrantInput {
  const userId = input.userId.trim().toLowerCase()
  const reason = input.reason.trim()
  const idempotencyKey = input.idempotencyKey.trim()
  if (!validId(userId)
    || !durationMonths.has(input.durationMonths)
    || reason.length < 1
    || reason.length > 300
    || !Number.isInteger(input.expectedChainVersion)
    || input.expectedChainVersion < 1
    || !idempotencyKeyPattern.test(idempotencyKey)) {
    throw new TypeError('Invalid admin membership grant input')
  }
  return { ...input, userId, reason, idempotencyKey }
}

export function parseAdminMembershipGrantResult(
  value: unknown,
  input: Pick<AdminMembershipGrantInput, 'expectedChainVersion'>,
): AdminMembershipGrantResult {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'adjustmentId',
      'resultChainVersion',
      'startsAt',
      'endsAt',
      'idempotent',
    ])
    || !validId(value.adjustmentId)
    || !Number.isInteger(value.resultChainVersion)
    || Number(value.resultChainVersion) !== input.expectedChainVersion + 1
    || !validDate(value.startsAt)
    || !validDate(value.endsAt)
    || Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    || typeof value.idempotent !== 'boolean') {
    invalidMembershipResponse()
  }
  return value as unknown as AdminMembershipGrantResult
}

export function createAdminMembershipIntentKey(
  now = Date.now(),
  random = Math.random(),
) {
  const entropy = Math.floor(Math.max(0, Math.min(0.999999999, random)) * 1_000_000_000)
    .toString(36)
    .padStart(6, '0')
  return `admin-membership-grant-${now.toString(36)}-${entropy}`
}

export function retainAdminMembershipGrantIntent(
  current: AdminMembershipGrantIntent | null,
  draft: AdminMembershipGrantDraft,
  createKey = () => createAdminMembershipIntentKey(),
): AdminMembershipGrantIntent {
  const fingerprint = JSON.stringify({
    userId: draft.userId.trim().toLowerCase(),
    durationMonths: draft.durationMonths,
    reason: draft.reason.trim(),
    expectedChainVersion: draft.expectedChainVersion,
  })
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, idempotencyKey: createKey() }
}

const userStatusText: Record<AdminMembershipDetail['user']['status'], string> = {
  ACTIVE: '正常',
  BLOCKED: '已限制',
  CLOSED: '已关闭',
}

const membershipStatusText: Record<AdminMembershipState, string> = {
  ACTIVE: '有效',
  SCHEDULED: '待生效',
  INACTIVE: '无有效会员',
}

const entitlementStatusText: Record<AdminMembershipEntitlementStatus, string> = {
  PENDING: '待生效',
  ACTIVE: '有效',
  EXPIRED: '已过期',
  REVOKED: '已撤销',
  REFUNDED: '已退款',
}

export function createAdminMembershipDetailView(
  detail: AdminMembershipDetail,
  formatDateTime: (value: string) => string,
): AdminMembershipDetailView {
  return {
    ...detail,
    user: { ...detail.user, statusText: userStatusText[detail.user.status] },
    membership: {
      ...detail.membership,
      statusText: membershipStatusText[detail.membership.status],
      currentEndsText: detail.membership.currentEndsAt
        ? formatDateTime(detail.membership.currentEndsAt)
        : '无',
      nextStartsText: detail.membership.nextStartsAt
        ? formatDateTime(detail.membership.nextStartsAt)
        : '无',
    },
    entitlements: detail.entitlements.map(item => ({
      ...item,
      sourceText: item.sourceType === 'ORDER' ? '购买' : '人工开通',
      statusText: entitlementStatusText[item.status],
      startsText: formatDateTime(item.startsAt),
      endsText: formatDateTime(item.endsAt),
      adjustment: item.adjustment
        ? { ...item.adjustment, createdText: formatDateTime(item.adjustment.createdAt) }
        : null,
    })),
  }
}
