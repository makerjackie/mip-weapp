import type { AdminDeliveryReviewItem } from '../src/modules/mip-admin/message-delivery-reviews'
import type { AdminOperationalException } from '../src/modules/mip-admin/operational-exceptions'
import { describe, expect, it } from 'vitest'
import { deriveOperationsQueue, parseOperationsQueuePage } from '../src/modules/mip-admin/operations-queue'

const id = '00000000-0000-4000-8000-000000000001'
const id2 = '00000000-0000-4000-8000-000000000002'

function exception(status: AdminOperationalException['status']): AdminOperationalException {
  return {
    id: `OUTBOX:${id}`,
    source: 'OUTBOX',
    status,
    title: '业务事件处理失败',
    summary: '一项业务事件未完成后续处理。',
    occurredAt: '2030-01-01T00:00:00.000Z',
    reasonCode: null,
    target: null,
  }
}

function review(classification: AdminDeliveryReviewItem['classification'], resourceId = id): AdminDeliveryReviewItem {
  return {
    resourceRef: { type: 'DELIVERY_TASK', id: resourceId },
    classification,
    evidenceRevision: 'a'.repeat(64),
    sourceState: {
      status: 'PROCESSING',
      attempts: 1,
      availableAt: null,
      leaseExpiresAt: null,
      deliveredAt: null,
      lastErrorCode: null,
      lastOutcome: 'UNKNOWN',
      retryDisposition: 'MANUAL_REVIEW',
      occurredAt: '2030-01-02T00:00:00.000Z',
    },
    evidence: { channel: 'WECHAT_SUBSCRIPTION', reservedGrantCount: 0, targetRef: null },
    workflow: {
      status: 'OPEN',
      reviewId: null,
      version: 0,
      claim: null,
      resolution: null,
      claimedByMe: false,
    },
    actions: { canClaim: true, canReconcile: false, canResolve: false },
  }
}

describe('operations queue', () => {
  it('derives state from existing facts without creating a second status', () => {
    const page = deriveOperationsQueue(
      [exception('STALLED'), exception('FAILED')],
      [review('PROCESSING_ACTIVE'), review('MANUAL_REVIEW', id2), { ...review('SUCCEEDED'), workflow: { ...review('SUCCEEDED').workflow, status: 'RESOLVED' } }],
    )

    expect(page.items.map(item => item.state)).toEqual([
      'MANUAL_REVIEW',
      'PROCESSING',
      'PROCESSING',
      'MANUAL_REVIEW',
    ])
    expect(page.items.every(item => item.reviewRef || item.source === 'EXCEPTION')).toBe(true)
  })

  it('keeps the queue DTO strict and does not expose user contact fields', () => {
    const page = deriveOperationsQueue([exception('FAILED')], [])
    expect(parseOperationsQueuePage(page)).toEqual(page)
    expect(() => parseOperationsQueuePage({ ...page, extra: true })).toThrow('无效的待办队列')
  })
})
