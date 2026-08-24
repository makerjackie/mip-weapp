import { MipAdminError } from './types'

export const adminOperationalExceptionTypes = [
  'OUTBOX',
  'REFUND',
  'PAYMENT',
  'MEDIA',
  'DELIVERY',
  'AI',
] as const

export const adminOperationalExceptionStatuses = [
  'FAILED',
  'STALLED',
  'REJECTED',
  'EXPIRED',
  'CLEANUP_PENDING',
] as const

export type AdminOperationalExceptionType = typeof adminOperationalExceptionTypes[number]
export type AdminOperationalExceptionStatus = typeof adminOperationalExceptionStatuses[number]

export interface AdminOperationalExceptionTarget {
  type: 'EVENT' | 'ORDER' | 'REFUND' | 'PAYMENT' | 'OPPORTUNITY' | 'USER' | 'GROWTH'
  id: string
  route: string
}

export interface AdminOperationalException {
  id: string
  source: AdminOperationalExceptionType
  status: AdminOperationalExceptionStatus
  title: string
  summary: string
  occurredAt: string
  reasonCode: string | null
  target: AdminOperationalExceptionTarget | null
}

export interface AdminOperationalExceptionPage {
  items: AdminOperationalException[]
  nextCursor: null
  availableTypes: AdminOperationalExceptionType[]
}

export interface AdminOperationalExceptionFilters {
  type?: AdminOperationalExceptionType | ''
  status?: AdminOperationalExceptionStatus | ''
  limit?: number
}

const typeSet = new Set<string>(adminOperationalExceptionTypes)
const statusSet = new Set<string>(adminOperationalExceptionStatuses)
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function invalidResponse() {
  return new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的异常列表')
}

function parseTarget(value: unknown): AdminOperationalExceptionTarget | null {
  if (value === null) {
    return null
  }
  if (!record(value)
    || !hasOnlyKeys(value, ['type', 'id', 'route'])
    || typeof value.type !== 'string'
    || typeof value.id !== 'string'
    || !uuidPattern.test(value.id)
    || typeof value.route !== 'string') {
    throw invalidResponse()
  }
  const expectedRoutes: Record<string, string> = {
    EVENT: `/packages/admin/event-console/index?eventId=${value.id}`,
    ORDER: '/packages/admin/orders/index',
    REFUND: '/packages/admin/orders/index',
    PAYMENT: '/packages/admin/orders/index',
    OPPORTUNITY: '/packages/admin/opportunities/index',
    USER: '/packages/admin/profiles/index',
    GROWTH: '/packages/admin/growth-entries/index',
  }
  if (expectedRoutes[value.type] !== value.route) {
    throw invalidResponse()
  }
  return value as unknown as AdminOperationalExceptionTarget
}

function parseItem(value: unknown): AdminOperationalException {
  const idMatch = typeof (value as { id?: unknown })?.id === 'string'
    ? (value as { id: string }).id.match(/^(OUTBOX|REFUND|PAYMENT|MEDIA|DELIVERY|AI):(.+)$/)
    : null
  if (!record(value)
    || !hasOnlyKeys(value, ['id', 'source', 'status', 'title', 'summary', 'occurredAt', 'reasonCode', 'target'])
    || !idMatch
    || !uuidPattern.test(idMatch[2])
    || !typeSet.has(String(value.source))
    || idMatch[1] !== value.source
    || !statusSet.has(String(value.status))
    || typeof value.title !== 'string'
    || value.title.length < 1
    || value.title.length > 80
    || typeof value.summary !== 'string'
    || value.summary.length < 1
    || value.summary.length > 200
    || typeof value.occurredAt !== 'string'
    || !Number.isFinite(Date.parse(value.occurredAt))
    || !(value.reasonCode === null || typeof value.reasonCode === 'string')) {
    throw invalidResponse()
  }
  return {
    ...(value as unknown as Omit<AdminOperationalException, 'target'>),
    target: parseTarget(value.target),
  }
}

export function parseOperationalExceptionPage(value: unknown): AdminOperationalExceptionPage {
  if (!record(value)
    || !hasOnlyKeys(value, ['items', 'nextCursor', 'availableTypes'])
    || !Array.isArray(value.items)
    || value.nextCursor !== null
    || !Array.isArray(value.availableTypes)
    || value.availableTypes.some(item => typeof item !== 'string' || !typeSet.has(item))
    || new Set(value.availableTypes).size !== value.availableTypes.length) {
    throw invalidResponse()
  }
  return {
    items: value.items.map(parseItem),
    nextCursor: null,
    availableTypes: value.availableTypes as AdminOperationalExceptionType[],
  }
}
