import type { MipAdminGateway } from './types'
import { MipAdminError } from './error'

export type PaymentAttemptsAdminGateway = Pick<MipAdminGateway, 'listPaymentAttempts'>

export type AdminPaymentAttemptProvider = 'WECHAT_PAY' | 'TEST'
export type AdminPaymentAttemptStatus = 'CREATED' | 'PARAMETERS_ISSUED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CLOSED'
export type AdminPaymentAttemptPageSize = 10 | 20 | 50 | 100

export interface AdminPaymentAttemptFilters {
  query?: string
  provider?: AdminPaymentAttemptProvider | ''
  status?: AdminPaymentAttemptStatus | ''
  createdFrom?: string
  createdTo?: string
}

export interface AdminPaymentAttemptListInput {
  filters?: AdminPaymentAttemptFilters
  limit?: AdminPaymentAttemptPageSize
  cursor?: string | null
}

export interface AdminPaymentAttempt {
  id: string
  orderId: string
  orderNumberMasked: string
  nickname: string
  playerNumber: number | null
  provider: AdminPaymentAttemptProvider
  status: AdminPaymentAttemptStatus
  providerPaymentIdMasked: string | null
  requiresAttention: boolean
  orderType: 'MEMBERSHIP' | 'EVENT' | 'CONTENT'
  orderTitle: string
  amountCents: number
  currency: string
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminPaymentAttemptPage {
  items: AdminPaymentAttempt[]
  nextCursor: string | null
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的支付尝试记录')
}

function validDate(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function validMaskedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80 && value.includes('…')
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value)
}

function parseItem(value: unknown): AdminPaymentAttempt {
  if (!record(value)
    || Object.keys(value).some(key => ![
      'id',
      'orderId',
      'orderNumberMasked',
      'nickname',
      'playerNumber',
      'provider',
      'status',
      'providerPaymentIdMasked',
      'requiresAttention',
      'orderType',
      'orderTitle',
      'amountCents',
      'currency',
      'createdAt',
      'updatedAt',
    ].includes(key))
    || !validIdentifier(value.id)
    || !validIdentifier(value.orderId)
    || !validMaskedIdentifier(value.orderNumberMasked)
    || typeof value.nickname !== 'string' || value.nickname.length < 1 || value.nickname.length > 64
    || !(value.playerNumber === null || (Number.isSafeInteger(value.playerNumber) && Number(value.playerNumber) >= 1))
    || !['WECHAT_PAY', 'TEST'].includes(String(value.provider))
    || !['CREATED', 'PARAMETERS_ISSUED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CLOSED'].includes(String(value.status))
    || !(value.providerPaymentIdMasked === null || validMaskedIdentifier(value.providerPaymentIdMasked))
    || typeof value.requiresAttention !== 'boolean'
    || !['MEMBERSHIP', 'EVENT', 'CONTENT'].includes(String(value.orderType))
    || typeof value.orderTitle !== 'string' || value.orderTitle.length < 1 || value.orderTitle.length > 120
    || !Number.isSafeInteger(value.amountCents) || Number(value.amountCents) < 0
    || typeof value.currency !== 'string' || value.currency.length < 1 || value.currency.length > 8
    || !validDate(value.createdAt) || !validDate(value.updatedAt)) {
    invalid()
  }
  return value as unknown as AdminPaymentAttempt
}

export function parseAdminPaymentAttemptPage(value: unknown): AdminPaymentAttemptPage {
  if (!record(value)
    || Object.keys(value).some(key => !['items', 'nextCursor'].includes(key))
    || !Array.isArray(value.items)
    || !(value.nextCursor === null || (typeof value.nextCursor === 'string' && value.nextCursor.length <= 512))) {
    invalid()
  }
  return { items: value.items.map(parseItem), nextCursor: value.nextCursor as string | null }
}

type ListInput = NonNullable<Parameters<MipAdminGateway['listPaymentAttempts']>[0]>

interface PaymentAttemptsCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
}

export interface MipPaymentAttemptsAdmin {
  list: (
    input?: ListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listPaymentAttempts']>
}

export function createMipPaymentAttemptsAdmin(
  gateway: PaymentAttemptsAdminGateway,
  cache: PaymentAttemptsCache,
): MipPaymentAttemptsAdmin {
  return {
    list: (input = {}, force = false) => cache.query(
      `mip-admin:payment-attempts:${JSON.stringify(input)}`,
      () => gateway.listPaymentAttempts(input),
      { force },
    ),
  }
}
