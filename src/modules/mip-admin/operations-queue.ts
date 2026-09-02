import type {
  AdminDeliveryReviewItem,
  AdminDeliveryReviewResourceRef,
} from './message-delivery-reviews'
import type {
  AdminOperationalException,
  AdminOperationalExceptionTarget,
} from './operational-exceptions'
import { MipAdminError } from './error'

export const adminOperationsQueueStates = ['PENDING', 'PROCESSING', 'MANUAL_REVIEW'] as const
export type AdminOperationsQueueState = typeof adminOperationsQueueStates[number]

export interface AdminOperationsQueueItem {
  id: string
  state: AdminOperationsQueueState
  source: 'EXCEPTION' | 'DELIVERY_REVIEW'
  sourceType: string
  title: string
  summary: string
  occurredAt: string
  reasonCode: string | null
  target: AdminOperationalExceptionTarget | null
  reviewRef: AdminDeliveryReviewResourceRef | null
}

export interface AdminOperationsQueuePage {
  items: AdminOperationsQueueItem[]
  nextCursor: string | null
}

const stateSet = new Set<string>(adminOperationsQueueStates)
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function stateForException(item: AdminOperationalException): AdminOperationsQueueState {
  return item.status === 'STALLED' ? 'PROCESSING' : 'MANUAL_REVIEW'
}

function stateForReview(item: AdminDeliveryReviewItem): AdminOperationsQueueState | null {
  if (item.workflow.status === 'RESOLVED') {
    return null
  }
  if (item.classification === 'PROCESSING_ACTIVE' || item.classification === 'PROCESSING_STALLED') {
    return 'PROCESSING'
  }
  if (item.classification === 'PENDING' || item.classification === 'RETRYABLE_FAILURE') {
    return 'PENDING'
  }
  return 'MANUAL_REVIEW'
}

function targetForReview(item: AdminDeliveryReviewItem): AdminOperationalExceptionTarget | null {
  const target = item.evidence.targetRef
  if (!target || !uuidPattern.test(target.id)) {
    return null
  }
  const routes: Record<string, string> = {
    EVENT: `/packages/admin/event-console/index?eventId=${target.id}`,
    ORDER: '/packages/admin/orders/index',
    OPPORTUNITY: '/packages/admin/opportunities/index',
    USER: '/packages/admin/profiles/index',
    GROWTH: '/packages/admin/growth-entries/index',
  }
  const route = routes[target.type]
  return route ? { type: target.type as AdminOperationalExceptionTarget['type'], id: target.id, route } : null
}

export function deriveOperationsQueue(
  exceptions: AdminOperationalException[],
  reviews: AdminDeliveryReviewItem[],
): AdminOperationsQueuePage {
  const items: AdminOperationsQueueItem[] = exceptions.map(item => ({
    id: item.id,
    state: stateForException(item),
    source: 'EXCEPTION',
    sourceType: item.source,
    title: item.title,
    summary: item.summary,
    occurredAt: item.occurredAt,
    reasonCode: item.reasonCode,
    target: item.target,
    reviewRef: null,
  }))
  for (const item of reviews) {
    const state = stateForReview(item)
    if (!state) {
      continue
    }
    items.push({
      id: `DELIVERY_REVIEW:${item.resourceRef.type}:${item.resourceRef.id}`,
      state,
      source: 'DELIVERY_REVIEW',
      sourceType: item.resourceRef.type,
      title: item.resourceRef.type === 'CAMPAIGN_DISPATCH' ? '消息活动待复核' : '通知投递待复核',
      summary: item.classification === 'MANUAL_REVIEW'
        ? '投递结果需要人工核对，当前不自动重放。'
        : '消息投递状态尚未完成，需要继续处理。',
      occurredAt: item.sourceState.occurredAt,
      reasonCode: item.sourceState.lastErrorCode,
      target: targetForReview(item),
      reviewRef: item.resourceRef,
    })
  }
  items.sort((left, right) => (
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
    || right.id.localeCompare(left.id)
  ))
  return { items, nextCursor: null }
}

function validQueueId(value: unknown) {
  if (typeof value !== 'string') {
    return false
  }
  const parts = value.split(':')
  return parts.length === 2
    ? ['OUTBOX', 'REFUND', 'PAYMENT', 'MEDIA', 'DELIVERY', 'AI'].includes(parts[0]) && uuidPattern.test(parts[1])
    : parts.length === 3 && parts[0] === 'DELIVERY_REVIEW'
      && ['CAMPAIGN_DISPATCH', 'DELIVERY_TASK'].includes(parts[1])
      && uuidPattern.test(parts[2])
}

function parseTarget(value: unknown): value is AdminOperationalExceptionTarget | null {
  if (value === null) {
    return true
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const target = value as Record<string, unknown>
  if (Object.keys(target).length !== 3 || Object.keys(target).some(key => !['type', 'id', 'route'].includes(key))
    || typeof target.type !== 'string' || typeof target.id !== 'string' || !uuidPattern.test(target.id)
    || typeof target.route !== 'string') {
    return false
  }
  const routes: Record<string, string> = {
    EVENT: `/packages/admin/event-console/index?eventId=${target.id}`,
    ORDER: '/packages/admin/orders/index',
    REFUND: '/packages/admin/orders/index',
    PAYMENT: '/packages/admin/orders/index',
    OPPORTUNITY: '/packages/admin/opportunities/index',
    USER: '/packages/admin/profiles/index',
    GROWTH: '/packages/admin/growth-entries/index',
  }
  return routes[target.type] === target.route
}

function parseReviewRef(value: unknown): value is AdminDeliveryReviewResourceRef | null {
  if (value === null) {
    return true
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const ref = value as Record<string, unknown>
  return Object.keys(ref).length === 2 && Object.keys(ref).every(key => ['type', 'id'].includes(key))
    && (ref.type === 'CAMPAIGN_DISPATCH' || ref.type === 'DELIVERY_TASK')
    && typeof ref.id === 'string' && uuidPattern.test(ref.id)
}

function invalidResponse(): MipAdminError {
  return new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的待办队列')
}

function parseItem(value: unknown): AdminOperationsQueueItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse()
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => ![
    'id',
    'state',
    'source',
    'sourceType',
    'title',
    'summary',
    'occurredAt',
    'reasonCode',
    'target',
    'reviewRef',
  ].includes(key))
  || typeof record.id !== 'string'
  || !stateSet.has(String(record.state))
  || !['EXCEPTION', 'DELIVERY_REVIEW'].includes(String(record.source))
  || typeof record.sourceType !== 'string'
  || typeof record.title !== 'string' || record.title.length < 1 || record.title.length > 80
  || typeof record.summary !== 'string' || record.summary.length < 1 || record.summary.length > 240
  || typeof record.occurredAt !== 'string' || !Number.isFinite(Date.parse(record.occurredAt))
  || !(record.reasonCode === null || typeof record.reasonCode === 'string')
  || !validQueueId(record.id)
  || (record.source === 'EXCEPTION' && (!['OUTBOX', 'REFUND', 'PAYMENT', 'MEDIA', 'DELIVERY', 'AI'].includes(record.sourceType as string) || record.reviewRef !== null))
  || (record.source === 'DELIVERY_REVIEW' && (!['CAMPAIGN_DISPATCH', 'DELIVERY_TASK'].includes(record.sourceType as string) || record.reviewRef === null))
  || !parseTarget(record.target)
  || !parseReviewRef(record.reviewRef)) {
    throw invalidResponse()
  }
  return record as unknown as AdminOperationsQueueItem
}

export function parseOperationsQueuePage(value: unknown): AdminOperationsQueuePage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse()
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.items) || !(record.nextCursor === null || typeof record.nextCursor === 'string')
    || Object.keys(record).some(key => !['items', 'nextCursor'].includes(key))) {
    throw invalidResponse()
  }
  return { items: record.items.map(parseItem), nextCursor: record.nextCursor as string | null }
}
