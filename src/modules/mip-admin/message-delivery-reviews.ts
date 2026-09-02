import { MipAdminError } from './error'

export type AdminDeliveryReviewSourceType = 'CAMPAIGN_DISPATCH' | 'DELIVERY_TASK'
export type AdminDeliveryReviewWorkflowFilter = 'ACTIVE' | 'RESOLVED' | 'ALL'
export type AdminDeliveryReviewClassification
  = | 'PROCESSING_ACTIVE'
    | 'PROCESSING_STALLED'
    | 'MANUAL_REVIEW'
    | 'RETRYABLE_FAILURE'
    | 'TERMINAL_FAILURE'
    | 'SUCCEEDED'
    | 'PENDING'

export interface AdminDeliveryReviewResourceRef {
  type: AdminDeliveryReviewSourceType
  id: string
}

export interface AdminDeliveryReviewItem {
  resourceRef: AdminDeliveryReviewResourceRef
  classification: AdminDeliveryReviewClassification
  evidenceRevision: string
  sourceState: {
    status: string
    attempts: number
    availableAt: string | null
    leaseExpiresAt: string | null
    deliveredAt: string | null
    lastErrorCode: string | null
    lastOutcome: string
    retryDisposition: string
    occurredAt: string
  }
  evidence: {
    campaignRef?: { type: 'MESSAGE_CAMPAIGN', id: string }
    campaignName?: string
    campaignStatus?: string
    recipientCount?: number
    submittedCount?: number
    outboxCoveredCount?: number
    outboxCount?: number
    activeDispatchMatches?: boolean
    channel?: string
    reservedGrantCount?: number
    targetRef?: {
      type: 'EVENT' | 'ORDER' | 'OPPORTUNITY' | 'USER' | 'GROWTH'
      id: string
    } | null
  }
  workflow: {
    status: 'OPEN' | 'CLAIMED' | 'RESOLVED'
    reviewId: string | null
    version: number
    claim: null | {
      claimedByMe: boolean
      claimedAt: string
      expiresAt: string
    }
    resolution: null | {
      code: 'AUTO_CONVERGED' | 'TERMINAL_ACCEPTED' | 'UNKNOWN_NO_REPLAY'
      note: string | null
      evidenceReference: string | null
      resolvedAt: string
    }
    claimedByMe: boolean
  }
  actions: {
    canClaim: boolean
    canReconcile: boolean
    canResolve: boolean
  }
  reconcileEffect?: 'CONFIRMED' | 'RETRY_ARMED' | 'TERMINATED' | 'QUARANTINED' | 'UNCHANGED' | 'RETRYABLE_UNCHANGED'
  schedulerReconcileRequired?: boolean
}

export interface AdminDeliveryReviewPage {
  items: AdminDeliveryReviewItem[]
  nextCursor: string | null
}

export interface AdminDeliveryReviewListInput {
  sourceType?: AdminDeliveryReviewSourceType | ''
  workflowStatus?: AdminDeliveryReviewWorkflowFilter
  cursor?: string
  limit?: number
}

export interface AdminDeliveryReviewMutationInput {
  resourceRef: AdminDeliveryReviewResourceRef
  evidenceRevision: string
  reviewVersion: number
  idempotencyKey: string
}

export interface AdminDeliveryReviewResolveInput extends AdminDeliveryReviewMutationInput {
  resolutionCode: 'TERMINAL_ACCEPTED' | 'UNKNOWN_NO_REPLAY'
  note?: string
  evidenceReference?: string
}

export type AdminDeliveryReviewMutationAction = 'claim' | 'reconcile' | 'resolve'

export type AdminDeliveryReviewResolutionIntent = Pick<
  AdminDeliveryReviewResolveInput,
  'resolutionCode' | 'note' | 'evidenceReference'
>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sourceTypes = new Set(['CAMPAIGN_DISPATCH', 'DELIVERY_TASK'])
const classifications = new Set([
  'PROCESSING_ACTIVE',
  'PROCESSING_STALLED',
  'MANUAL_REVIEW',
  'RETRYABLE_FAILURE',
  'TERMINAL_FAILURE',
  'SUCCEEDED',
  'PENDING',
])
const workflowStatuses = new Set(['OPEN', 'CLAIMED', 'RESOLVED'])
const resolutionCodes = new Set(['AUTO_CONVERGED', 'TERMINAL_ACCEPTED', 'UNKNOWN_NO_REPLAY'])
const deliveryTargetTypes = new Set(['EVENT', 'ORDER', 'OPPORTUNITY', 'USER', 'GROWTH'])
const reconcileEffects = new Set([
  'CONFIRMED',
  'RETRY_ARMED',
  'TERMINATED',
  'QUARANTINED',
  'UNCHANGED',
  'RETRYABLE_UNCHANGED',
])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw new MipAdminError('INVALID_RESPONSE', '运营服务返回了无效的投递复核数据')
}

export function deliveryReviewMutationSignature(
  action: AdminDeliveryReviewMutationAction,
  item: AdminDeliveryReviewItem,
  resolution?: AdminDeliveryReviewResolutionIntent,
) {
  const fields: Array<string | number> = [
    action,
    item.resourceRef.type,
    item.resourceRef.id,
    item.evidenceRevision,
    item.workflow.version,
  ]
  if (action === 'resolve') {
    fields.push(
      resolution?.resolutionCode || '',
      resolution?.note?.trim() || '',
      resolution?.evidenceReference?.trim() || '',
    )
  }
  return JSON.stringify(fields)
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = new Set(allowed)
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.has(key))
}

function instant(value: unknown, nullable = true): value is string | null {
  return (nullable && value === null)
    || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function nullableText(value: unknown, maximum: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maximum)
}

function resourceRef(value: unknown): value is AdminDeliveryReviewResourceRef {
  return record(value)
    && onlyKeys(value, ['type', 'id'])
    && sourceTypes.has(String(value.type))
    && typeof value.id === 'string'
    && uuidPattern.test(value.id)
}

function parseSourceState(value: unknown): AdminDeliveryReviewItem['sourceState'] {
  if (!record(value)
    || !onlyKeys(value, [
      'status',
      'attempts',
      'availableAt',
      'leaseExpiresAt',
      'deliveredAt',
      'lastErrorCode',
      'lastOutcome',
      'retryDisposition',
      'occurredAt',
    ])
    || typeof value.status !== 'string'
    || value.status.length < 1
    || value.status.length > 32
    || !Number.isInteger(value.attempts)
    || Number(value.attempts) < 0
    || !instant(value.availableAt)
    || !instant(value.leaseExpiresAt)
    || !instant(value.deliveredAt)
    || !nullableText(value.lastErrorCode, 120)
    || typeof value.lastOutcome !== 'string'
    || typeof value.retryDisposition !== 'string'
    || !instant(value.occurredAt, false)) {
    invalid()
  }
  return value as unknown as AdminDeliveryReviewItem['sourceState']
}

function parseEvidence(value: unknown, type: AdminDeliveryReviewSourceType): AdminDeliveryReviewItem['evidence'] {
  if (!record(value)) {
    invalid()
  }
  if (type === 'CAMPAIGN_DISPATCH') {
    if (!onlyKeys(value, [
      'campaignRef',
      'campaignName',
      'campaignStatus',
      'recipientCount',
      'submittedCount',
      'outboxCoveredCount',
      'outboxCount',
      'activeDispatchMatches',
    ])
    || !record(value.campaignRef)
    || !onlyKeys(value.campaignRef, ['type', 'id'])
    || value.campaignRef.type !== 'MESSAGE_CAMPAIGN'
    || typeof value.campaignRef.id !== 'string'
    || !uuidPattern.test(value.campaignRef.id)
    || typeof value.campaignName !== 'string'
    || value.campaignName.length > 120
    || typeof value.campaignStatus !== 'string'
    || !['recipientCount', 'submittedCount', 'outboxCoveredCount', 'outboxCount']
      .every(key => Number.isInteger(value[key]) && Number(value[key]) >= 0)
      || typeof value.activeDispatchMatches !== 'boolean') {
      invalid()
    }
  }
  else if (!onlyKeys(value, ['channel', 'reservedGrantCount', 'targetRef'])
    || typeof value.channel !== 'string'
    || !Number.isInteger(value.reservedGrantCount)
    || Number(value.reservedGrantCount) < 0
    || !(value.targetRef === null || (
      record(value.targetRef)
      && onlyKeys(value.targetRef, ['type', 'id'])
      && deliveryTargetTypes.has(String(value.targetRef.type))
      && typeof value.targetRef.id === 'string'
      && uuidPattern.test(value.targetRef.id)
    ))) {
    invalid()
  }
  return value as AdminDeliveryReviewItem['evidence']
}

function parseWorkflow(value: unknown): AdminDeliveryReviewItem['workflow'] {
  if (!record(value)
    || !onlyKeys(value, ['status', 'reviewId', 'version', 'claim', 'resolution', 'claimedByMe'])
    || !workflowStatuses.has(String(value.status))
    || !(value.reviewId === null
      || (typeof value.reviewId === 'string' && uuidPattern.test(value.reviewId)))
    || !Number.isInteger(value.version)
    || Number(value.version) < 0
    || typeof value.claimedByMe !== 'boolean') {
    invalid()
  }
  if (value.status === 'CLAIMED') {
    if (typeof value.reviewId !== 'string'
      || Number(value.version) < 1
      || !record(value.claim)
      || !onlyKeys(value.claim, ['claimedByMe', 'claimedAt', 'expiresAt'])
      || typeof value.claim.claimedByMe !== 'boolean'
      || value.claimedByMe !== value.claim.claimedByMe
      || !instant(value.claim.claimedAt, false)
      || !instant(value.claim.expiresAt, false)
      || value.resolution !== null) {
      invalid()
    }
  }
  else if (value.claim !== null || value.claimedByMe) {
    invalid()
  }
  if (value.status === 'RESOLVED') {
    if (typeof value.reviewId !== 'string'
      || Number(value.version) < 1
      || !record(value.resolution)
      || !onlyKeys(value.resolution, ['code', 'note', 'evidenceReference', 'resolvedAt'])
      || !resolutionCodes.has(String(value.resolution.code))
      || !nullableText(value.resolution.note, 500)
      || !nullableText(value.resolution.evidenceReference, 300)
      || !instant(value.resolution.resolvedAt, false)
      || (value.resolution.code === 'UNKNOWN_NO_REPLAY'
        && (typeof value.resolution.note !== 'string' || value.resolution.note.trim().length === 0))) {
      invalid()
    }
  }
  else if (value.resolution !== null) {
    invalid()
  }
  return value as unknown as AdminDeliveryReviewItem['workflow']
}

export function parseDeliveryReview(value: unknown): AdminDeliveryReviewItem {
  if (!record(value)
    || !onlyKeys(value, [
      'resourceRef',
      'classification',
      'evidenceRevision',
      'sourceState',
      'evidence',
      'workflow',
      'actions',
      'reconcileEffect',
      'schedulerReconcileRequired',
    ])
    || !resourceRef(value.resourceRef)
    || !classifications.has(String(value.classification))
    || typeof value.evidenceRevision !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.evidenceRevision)
    || !record(value.actions)
    || !onlyKeys(value.actions, ['canClaim', 'canReconcile', 'canResolve'])
    || !['canClaim', 'canReconcile', 'canResolve'].every(
      key => typeof (value.actions as Record<string, unknown>)[key] === 'boolean',
    )
    || !(value.reconcileEffect === undefined || reconcileEffects.has(String(value.reconcileEffect)))
    || !(value.schedulerReconcileRequired === undefined || typeof value.schedulerReconcileRequired === 'boolean')) {
    invalid()
  }
  return {
    resourceRef: value.resourceRef,
    classification: value.classification as AdminDeliveryReviewClassification,
    evidenceRevision: value.evidenceRevision,
    sourceState: parseSourceState(value.sourceState),
    evidence: parseEvidence(value.evidence, value.resourceRef.type),
    workflow: parseWorkflow(value.workflow),
    actions: value.actions as AdminDeliveryReviewItem['actions'],
    ...(value.reconcileEffect === undefined
      ? {}
      : { reconcileEffect: value.reconcileEffect as AdminDeliveryReviewItem['reconcileEffect'] }),
    ...(value.schedulerReconcileRequired === undefined
      ? {}
      : { schedulerReconcileRequired: value.schedulerReconcileRequired as boolean }),
  }
}

export function parseDeliveryReviewPage(value: unknown): AdminDeliveryReviewPage {
  if (!record(value)
    || !onlyKeys(value, ['items', 'nextCursor'])
    || !Array.isArray(value.items)
    || !(value.nextCursor === null
      || (typeof value.nextCursor === 'string'
        && value.nextCursor.length > 0
        && value.nextCursor.length <= 512))) {
    invalid()
  }
  return {
    items: value.items.map(parseDeliveryReview),
    nextCursor: value.nextCursor,
  }
}
