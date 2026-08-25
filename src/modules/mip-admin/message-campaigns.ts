import { MipAdminError } from './types'

export type AdminMessageCampaignStatus = 'DRAFT' | 'READY' | 'PUBLISHED' | 'WITHDRAWN'
export type AdminMessageCampaignSafetyStatus = 'PENDING' | 'PASSED' | 'REJECTED' | 'ERROR'

export interface AdminMessageCampaignScope {
  platform: boolean
  branches: Array<{ id: string, name: string }>
}

export interface AdminMessageRecipientCandidate {
  profileRef: string
  nickname: string
  headline: string
  branchName: string
}

export interface AdminMessageDeliveryStageStats {
  pendingCount: number
  processingCount: number
  retryingCount: number
  deliveredCount: number
  terminalCount: number
}

export interface AdminMessageCampaign {
  id: string
  scopeType: 'PLATFORM' | 'BRANCH'
  branchId: string | null
  branchName: string
  audienceType: 'ALL' | 'EXPLICIT'
  recipientRefs: string[]
  name: string
  title: string
  body?: string
  status: AdminMessageCampaignStatus
  contentSafetyStatus: AdminMessageCampaignSafetyStatus
  recipientCount: number
  deliveryStats: {
    submittedCount: number
    inboxReadyCount: number
    failedCount: number
    outboxStats: AdminMessageDeliveryStageStats
    externalTaskStats: AdminMessageDeliveryStageStats
  }
  snapshotAt: string | null
  publishedAt: string | null
  withdrawnAt: string | null
  withdrawalReason?: string
  version: number
  updatedAt: string | null
}

export interface AdminMessageCampaignDraft {
  campaignId?: string
  expectedVersion?: number
  scopeType: 'PLATFORM' | 'BRANCH'
  branchId: string | null
  audienceType: 'ALL' | 'EXPLICIT'
  recipientRefs: string[]
  name: string
  title: string
  body: string
}

export interface AdminMessageCampaignPublication {
  campaignId: string
  status: 'PUBLISHED' | 'WITHDRAWN'
  recipientCount: number
  queuedCount: number
  wechatDelivery: 'NOT_CONFIGURED'
  version: number
  idempotent: boolean
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const profileRefPattern = /^p1\.[\w-]{16}\.[\w-]{48}\.[\w-]{22}$/
const statuses = new Set(['DRAFT', 'READY', 'PUBLISHED', 'WITHDRAWN'])
const safetyStatuses = new Set(['PENDING', 'PASSED', 'REJECTED', 'ERROR'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的消息活动数据')
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function nullableDate(value: unknown) {
  if (value === null) {
    return null
  }
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined
}

function parseDeliveryStageStats(value: unknown): AdminMessageDeliveryStageStats {
  if (value === undefined) {
    return {
      pendingCount: 0,
      processingCount: 0,
      retryingCount: 0,
      deliveredCount: 0,
      terminalCount: 0,
    }
  }
  if (!record(value)
    || !hasOnlyKeys(value, [
      'pendingCount',
      'processingCount',
      'retryingCount',
      'deliveredCount',
      'terminalCount',
    ])
    || !Number.isInteger(value.pendingCount) || Number(value.pendingCount) < 0
    || !Number.isInteger(value.processingCount) || Number(value.processingCount) < 0
    || !Number.isInteger(value.retryingCount) || Number(value.retryingCount) < 0
    || !Number.isInteger(value.deliveredCount) || Number(value.deliveredCount) < 0
    || !Number.isInteger(value.terminalCount) || Number(value.terminalCount) < 0) {
    invalid()
  }
  return value as unknown as AdminMessageDeliveryStageStats
}

export function parseMessageCampaignScopes(value: unknown): AdminMessageCampaignScope {
  if (!record(value) || !hasOnlyKeys(value, ['platform', 'branches'])
    || typeof value.platform !== 'boolean' || !Array.isArray(value.branches)) {
    invalid()
  }
  const branches = value.branches.map((branch) => {
    if (!record(branch) || !hasOnlyKeys(branch, ['id', 'name'])
      || typeof branch.id !== 'string' || !uuidPattern.test(branch.id)
      || typeof branch.name !== 'string' || !branch.name || branch.name.length > 80) {
      invalid()
    }
    return { id: branch.id, name: branch.name }
  })
  return { platform: value.platform, branches }
}

export function parseMessageCampaign(value: unknown): AdminMessageCampaign {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'id',
      'scopeType',
      'branchId',
      'branchName',
      'audienceType',
      'recipientRefs',
      'name',
      'title',
      'body',
      'status',
      'contentSafetyStatus',
      'recipientCount',
      'deliveryStats',
      'snapshotAt',
      'publishedAt',
      'withdrawnAt',
      'withdrawalReason',
      'version',
      'updatedAt',
    ])
    || typeof value.id !== 'string' || !uuidPattern.test(value.id)
    || !['PLATFORM', 'BRANCH'].includes(String(value.scopeType))
    || !(value.branchId === null || (typeof value.branchId === 'string' && uuidPattern.test(value.branchId)))
    || typeof value.branchName !== 'string'
    || !['ALL', 'EXPLICIT'].includes(String(value.audienceType))
    || !Array.isArray(value.recipientRefs) || value.recipientRefs.some(item => typeof item !== 'string' || !profileRefPattern.test(item))
    || typeof value.name !== 'string' || !value.name || value.name.length > 100
    || typeof value.title !== 'string' || !value.title || value.title.length > 100
    || !(value.body === undefined || (typeof value.body === 'string' && value.body.length > 0 && value.body.length <= 500))
    || !statuses.has(String(value.status))
    || !safetyStatuses.has(String(value.contentSafetyStatus))
    || !Number.isInteger(value.recipientCount) || Number(value.recipientCount) < 0 || Number(value.recipientCount) > 1000
    || !record(value.deliveryStats)
    || !hasOnlyKeys(value.deliveryStats, [
      'submittedCount',
      'inboxReadyCount',
      'failedCount',
      'outboxStats',
      'externalTaskStats',
    ])
    || !Number.isInteger(value.deliveryStats.submittedCount) || Number(value.deliveryStats.submittedCount) < 0
    || !Number.isInteger(value.deliveryStats.inboxReadyCount) || Number(value.deliveryStats.inboxReadyCount) < 0
    || !Number.isInteger(value.deliveryStats.failedCount) || Number(value.deliveryStats.failedCount) < 0
    || nullableDate(value.snapshotAt) === undefined
    || nullableDate(value.publishedAt) === undefined
    || nullableDate(value.withdrawnAt) === undefined
    || !(value.withdrawalReason === undefined || typeof value.withdrawalReason === 'string')
    || !Number.isInteger(value.version) || Number(value.version) < 1
    || nullableDate(value.updatedAt) === undefined) {
    invalid()
  }
  if ((value.scopeType === 'PLATFORM') !== (value.branchId === null)) {
    invalid()
  }
  const deliveryStats = value.deliveryStats as Record<string, unknown>
  return {
    ...(value as unknown as AdminMessageCampaign),
    deliveryStats: {
      submittedCount: Number(deliveryStats.submittedCount),
      inboxReadyCount: Number(deliveryStats.inboxReadyCount),
      failedCount: Number(deliveryStats.failedCount),
      outboxStats: parseDeliveryStageStats(deliveryStats.outboxStats),
      externalTaskStats: parseDeliveryStageStats(deliveryStats.externalTaskStats),
    },
  }
}

export function parseMessageCampaignPage(value: unknown) {
  if (!record(value) || !hasOnlyKeys(value, ['items', 'nextCursor']) || !Array.isArray(value.items)
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')) {
    invalid()
  }
  return { items: value.items.map(parseMessageCampaign), nextCursor: value.nextCursor }
}

export function parseMessageRecipientPage(value: unknown) {
  if (!record(value) || !hasOnlyKeys(value, ['items', 'nextCursor']) || !Array.isArray(value.items)
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')) {
    invalid()
  }
  const items = value.items.map((item) => {
    if (!record(item) || !hasOnlyKeys(item, ['profileRef', 'nickname', 'headline', 'branchName'])
      || typeof item.profileRef !== 'string' || !profileRefPattern.test(item.profileRef)
      || typeof item.nickname !== 'string' || !item.nickname || item.nickname.length > 64
      || typeof item.headline !== 'string' || item.headline.length > 160
      || typeof item.branchName !== 'string' || item.branchName.length > 80) {
      invalid()
    }
    return item as unknown as AdminMessageRecipientCandidate
  })
  return { items, nextCursor: value.nextCursor }
}

export function parseMessageCampaignPublication(value: unknown): AdminMessageCampaignPublication {
  if (!record(value)
    || !hasOnlyKeys(value, [
      'campaignId',
      'status',
      'recipientCount',
      'queuedCount',
      'wechatDelivery',
      'version',
      'idempotent',
    ])
    || typeof value.campaignId !== 'string' || !uuidPattern.test(value.campaignId)
    || !['PUBLISHED', 'WITHDRAWN'].includes(String(value.status))
    || !Number.isInteger(value.recipientCount) || Number(value.recipientCount) < 1 || Number(value.recipientCount) > 1000
    || value.queuedCount !== value.recipientCount
    || value.wechatDelivery !== 'NOT_CONFIGURED'
    || !Number.isInteger(value.version) || Number(value.version) < 2
    || typeof value.idempotent !== 'boolean') {
    invalid()
  }
  return value as unknown as AdminMessageCampaignPublication
}
