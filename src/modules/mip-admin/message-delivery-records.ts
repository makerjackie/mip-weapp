import { MipAdminError } from './types'

export type AdminMessageDeliveryRecordChannel
  = 'WECHAT_SUBSCRIPTION' | 'WECHAT_CUSTOMER_SERVICE' | 'WECHAT_SERVICE_ACCOUNT'
export type AdminMessageDeliveryRecordStatus
  = 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'CANCELLED'

export interface AdminMessageDeliveryRecord {
  recordKey: string
  channel: AdminMessageDeliveryRecordChannel
  status: AdminMessageDeliveryRecordStatus
  attempts: number
  lastErrorCode: string | null
  availableAt: string | null
  deliveredAt: string | null
  createdAt: string | null
  updatedAt: string | null
  occurredAt: string
  title: string
  eventTitle: string | null
  campaignName: string | null
  nickname: string
  playerNumber: number | null
  branchName: string
}

export interface AdminMessageDeliveryRecordListInput {
  query?: string
  channel?: AdminMessageDeliveryRecordChannel | ''
  status?: AdminMessageDeliveryRecordStatus | ''
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

export interface AdminMessageDeliveryRecordPage {
  items: AdminMessageDeliveryRecord[]
  nextCursor: string | null
}

const channels = new Set<string>(['WECHAT_SUBSCRIPTION', 'WECHAT_CUSTOMER_SERVICE', 'WECHAT_SERVICE_ACCOUNT'])
const statuses = new Set<string>(['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'CANCELLED'])
const hexKey = /^[0-9a-f]{20}$/i

export function localDayBoundary(dateText: string, dayOffset = 0) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText)
  if (!parts) return undefined
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + dayOffset)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

export function parseMessageDeliveryRecordPage(value: unknown): AdminMessageDeliveryRecordPage {
  if (!record(value)
    || !exactKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || value.items.length > 100
    || !(value.nextCursor === null || (typeof value.nextCursor === 'string' && value.nextCursor.length <= 512))) {
    invalid()
  }
  return {
    items: value.items.map(parseMessageDeliveryRecord),
    nextCursor: value.nextCursor,
  }
}

function parseMessageDeliveryRecord(value: unknown): AdminMessageDeliveryRecord {
  if (!record(value)
    || Object.keys(value).some(key => ![
      'recordKey',
      'channel',
      'status',
      'attempts',
      'lastErrorCode',
      'availableAt',
      'deliveredAt',
      'createdAt',
      'updatedAt',
      'occurredAt',
      'title',
      'eventTitle',
      'campaignName',
      'nickname',
      'playerNumber',
      'branchName',
    ].includes(key))
    || typeof value.recordKey !== 'string' || !hexKey.test(value.recordKey)
    || typeof value.channel !== 'string' || !channels.has(value.channel)
    || typeof value.status !== 'string' || !statuses.has(value.status)
    || !Number.isInteger(value.attempts) || value.attempts < 0 || value.attempts > 5
    || !nullableString(value.lastErrorCode, 64)
    || !nullableDate(value.availableAt) || !nullableDate(value.deliveredAt)
    || !nullableDate(value.createdAt) || !nullableDate(value.updatedAt)
    || typeof value.occurredAt !== 'string' || !validDate(value.occurredAt)
    || typeof value.title !== 'string' || value.title.length > 100
    || !nullableString(value.eventTitle, 255) || !nullableString(value.campaignName, 100)
    || typeof value.nickname !== 'string' || value.nickname.length > 64
    || !(value.playerNumber === null || (Number.isInteger(value.playerNumber) && value.playerNumber >= 1))
    || typeof value.branchName !== 'string' || value.branchName.length > 80) {
    invalid()
  }
  return value as unknown as AdminMessageDeliveryRecord
}

function nullableString(value: unknown, max: number) {
  return value === null || (typeof value === 'string' && value.length <= max)
}

function nullableDate(value: unknown) {
  return value === null || (typeof value === 'string' && validDate(value))
}

function validDate(value: string) {
  return Number.isFinite(Date.parse(value))
}

function record(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key))
}

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的消息投递记录')
}
