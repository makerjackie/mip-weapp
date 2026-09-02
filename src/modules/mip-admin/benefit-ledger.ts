import type { MipAdminGateway } from './types'
import { MipAdminError } from './error'

export type BenefitLedgerAdminGateway = Pick<MipAdminGateway, 'listUnifiedBenefitLedger'>

export type AdminUnifiedBenefitType = 'MEMBERSHIP' | 'GROWTH'
export type AdminUnifiedBenefitPageSize = 10 | 20 | 50 | 100

export interface AdminUnifiedBenefitLedgerFilters {
  benefitType?: AdminUnifiedBenefitType | ''
  query?: string
  createdFrom?: string
  createdTo?: string
}

export interface AdminUnifiedBenefitLedgerInput {
  filters?: AdminUnifiedBenefitLedgerFilters
  limit?: AdminUnifiedBenefitPageSize
  cursor?: string | null
}

export interface AdminUnifiedBenefitLedgerItem {
  benefitType: AdminUnifiedBenefitType
  nickname: string
  playerNumber: number | null
  benefitName: string
  status: string
  startsAt: string | null
  endsAt: string | null
  occurredAt: string | null
  sourceType: 'ORDER' | 'ADMIN_ADJUSTMENT' | 'GROWTH_ENTRY' | 'GROWTH_BENEFIT'
  metric: 'EXPERIENCE' | 'CONTRIBUTION' | 'COIN' | null
  deltaValue: number | null
  order: {
    status: string
    orderType: 'MEMBERSHIP'
    amountCents: number
    paidAt: string | null
  } | null
}

export interface AdminUnifiedBenefitLedgerPage {
  items: AdminUnifiedBenefitLedgerItem[]
  nextCursor: string | null
}

type BenefitLedgerListInput = NonNullable<Parameters<MipAdminGateway['listUnifiedBenefitLedger']>[0]>

export interface MipBenefitLedgerAdmin {
  list: (
    input?: BenefitLedgerListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listUnifiedBenefitLedger']>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的统一权益流水')
}

function validDate(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function parseItem(value: unknown): AdminUnifiedBenefitLedgerItem {
  if (!record(value)
    || !hasOnlyKeys(value, ['benefitType', 'nickname', 'playerNumber', 'benefitName', 'status', 'startsAt', 'endsAt', 'occurredAt', 'sourceType', 'metric', 'deltaValue', 'order'])
    || !['benefitType', 'nickname', 'playerNumber', 'benefitName', 'status', 'startsAt', 'endsAt', 'occurredAt', 'sourceType', 'metric', 'deltaValue', 'order'].every(key => Object.hasOwn(value, key))
    || !['MEMBERSHIP', 'GROWTH'].includes(String(value.benefitType))
    || typeof value.nickname !== 'string'
    || value.nickname.length < 1 || value.nickname.length > 64
    || !(value.playerNumber === null || (Number.isSafeInteger(value.playerNumber) && Number(value.playerNumber) >= 1))
    || typeof value.benefitName !== 'string' || value.benefitName.length < 1 || value.benefitName.length > 120
    || typeof value.status !== 'string' || value.status.length < 1 || value.status.length > 24
    || !validDate(value.startsAt) || !validDate(value.endsAt) || !validDate(value.occurredAt)
    || !['ORDER', 'ADMIN_ADJUSTMENT', 'GROWTH_ENTRY', 'GROWTH_BENEFIT'].includes(String(value.sourceType))
    || !(value.metric === null || ['EXPERIENCE', 'CONTRIBUTION', 'COIN'].includes(String(value.metric)))
    || !(value.deltaValue === null || Number.isSafeInteger(value.deltaValue))
    || !(value.order === null || record(value.order))) {
    invalid()
  }
  if (value.order !== null
    && (!hasOnlyKeys(value.order, ['status', 'orderType', 'amountCents', 'paidAt'])
      || !['status', 'orderType', 'amountCents', 'paidAt'].every(key => Object.hasOwn(value.order as object, key))
      || typeof (value.order as Record<string, unknown>).status !== 'string'
      || (value.order as Record<string, unknown>).orderType !== 'MEMBERSHIP'
      || typeof (value.order as Record<string, unknown>).amountCents !== 'number'
      || !Number.isSafeInteger((value.order as Record<string, unknown>).amountCents)
      || Number((value.order as Record<string, unknown>).amountCents) < 0
      || !validDate((value.order as Record<string, unknown>).paidAt))) {
    invalid()
  }
  return value as unknown as AdminUnifiedBenefitLedgerItem
}

export function parseAdminUnifiedBenefitLedgerPage(value: unknown): AdminUnifiedBenefitLedgerPage {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor'])
    || !Object.hasOwn(value, 'items')
    || !Object.hasOwn(value, 'nextCursor')
    || !Array.isArray(value.items)
    || value.items.length > 100
    || !(value.nextCursor === null || (typeof value.nextCursor === 'string' && value.nextCursor.length <= 512))) {
    invalid()
  }
  return { items: value.items.map(parseItem), nextCursor: value.nextCursor }
}

interface BenefitLedgerCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
}

export function createMipBenefitLedgerAdmin(
  gateway: BenefitLedgerAdminGateway,
  cache: BenefitLedgerCache,
): MipBenefitLedgerAdmin {
  return {
    list: (input = {}, force = false) => cache.query(
      `mip-admin:benefit-ledger:${JSON.stringify(input)}`,
      () => gateway.listUnifiedBenefitLedger(input),
      { force },
    ),
  }
}
