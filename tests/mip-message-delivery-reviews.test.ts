import type { AdminRequest } from '../src/modules/mip-admin/request-contract'
import type { AdminTransport } from '../src/modules/mip-admin/transport'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import {
  deliveryReviewMutationSignature,
  parseDeliveryReview,
  parseDeliveryReviewPage,
} from '../src/modules/mip-admin/message-delivery-reviews'
import { MipAdminError } from '../src/modules/mip-admin/types'

vi.mock('../src/platform/cloudbase/client', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const taskId = '20000000-0000-4000-8000-000000000001'
const evidenceRevision = 'a'.repeat(64)

function reviewItem() {
  return {
    resourceRef: { type: 'DELIVERY_TASK', id: taskId },
    classification: 'MANUAL_REVIEW',
    evidenceRevision,
    sourceState: {
      status: 'CANCELLED',
      attempts: 1,
      availableAt: '2030-08-25T10:00:00.000Z',
      leaseExpiresAt: null,
      deliveredAt: null,
      lastErrorCode: 'DELIVERY_OUTCOME_UNKNOWN',
      lastOutcome: 'UNKNOWN',
      retryDisposition: 'MANUAL_REVIEW',
      occurredAt: '2030-08-25T10:00:00.000Z',
    },
    evidence: {
      channel: 'WECHAT_SUBSCRIPTION',
      reservedGrantCount: 0,
      targetRef: null,
    },
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

describe('MIP message delivery review client contract', () => {
  it('parses only the neutral evidence contract and rejects recipient or payload leakage', () => {
    expect(parseDeliveryReview(reviewItem()).resourceRef.id).toBe(taskId)
    expect(parseDeliveryReviewPage({ items: [reviewItem()], nextCursor: null }).items).toHaveLength(1)
    expect(() => parseDeliveryReview({ ...reviewItem(), openId: 'sensitive' })).toThrow(MipAdminError)
    expect(() => parseDeliveryReview({
      ...reviewItem(),
      evidence: { ...reviewItem().evidence, payload: { touser: 'sensitive' } },
    })).toThrow(MipAdminError)
  })

  it('fails closed on impossible workflow, cursor and delivery target combinations', () => {
    const claimed = {
      ...reviewItem(),
      workflow: {
        status: 'CLAIMED',
        reviewId: taskId,
        version: 1,
        claim: {
          claimedByMe: true,
          claimedAt: '2030-08-25T10:00:00.000Z',
          expiresAt: '2030-08-25T10:15:00.000Z',
        },
        resolution: null,
        claimedByMe: false,
      },
    }
    expect(() => parseDeliveryReview(claimed)).toThrow(MipAdminError)
    expect(() => parseDeliveryReview({
      ...reviewItem(),
      workflow: {
        status: 'RESOLVED',
        reviewId: null,
        version: 0,
        claim: null,
        resolution: {
          code: 'UNKNOWN_NO_REPLAY',
          note: '   ',
          evidenceReference: null,
          resolvedAt: '2030-08-25T10:00:00.000Z',
        },
        claimedByMe: true,
      },
    })).toThrow(MipAdminError)
    expect(() => parseDeliveryReview({
      ...reviewItem(),
      evidence: {
        ...reviewItem().evidence,
        targetRef: { type: 'ARBITRARY', id: taskId },
      },
    })).toThrow(MipAdminError)
    expect(() => parseDeliveryReviewPage({ items: [], nextCursor: '' })).toThrow(MipAdminError)
    expect(() => parseDeliveryReviewPage({ items: [], nextCursor: 'x'.repeat(513) })).toThrow(MipAdminError)
  })

  it('uses five v1 actions and lifts mutation idempotency into the neutral envelope', async () => {
    const requests: AdminRequest[] = []
    const transport: AdminTransport = {
      request: vi.fn(async (request: AdminRequest) => {
        requests.push(request)
        return request.action.endsWith('.list')
          ? { items: [reviewItem()], nextCursor: null }
          : reviewItem()
      }) as AdminTransport['request'],
    }
    const gateway = createMipAdminGateway(transport)
    await gateway.listMessageDeliveryReviews({ workflowStatus: 'ACTIVE', limit: 20 })
    await gateway.getMessageDeliveryReview(reviewItem().resourceRef)
    const mutation = {
      resourceRef: reviewItem().resourceRef,
      evidenceRevision,
      reviewVersion: 0,
      idempotencyKey: 'delivery-review-request-001',
    }
    await gateway.claimMessageDeliveryReview(mutation)
    await gateway.reconcileMessageDeliveryReview(mutation)
    await gateway.resolveMessageDeliveryReview({
      ...mutation,
      resolutionCode: 'UNKNOWN_NO_REPLAY',
      note: '已核对外部记录，不重放',
    })
    expect(requests.map(request => request.action)).toEqual([
      'mip.admin.messageDeliveryReviews.list',
      'mip.admin.messageDeliveryReviews.get',
      'mip.admin.messageDeliveryReviews.claim',
      'mip.admin.messageDeliveryReviews.reconcile',
      'mip.admin.messageDeliveryReviews.resolve',
    ])
    for (const request of requests.slice(2)) {
      expect(request.contractVersion).toBe(1)
      expect(request.idempotencyKey).toBe('delivery-review-request-001')
      expect(request.input).not.toHaveProperty('idempotencyKey')
    }
  })

  it('reuses resolve idempotency only for the same normalized payload', () => {
    const item = parseDeliveryReview(reviewItem())
    const original = deliveryReviewMutationSignature('resolve', item, {
      resolutionCode: 'UNKNOWN_NO_REPLAY',
      note: '  已核对外部记录，不重放  ',
      evidenceReference: '  provider-case-001  ',
    })
    expect(deliveryReviewMutationSignature('resolve', item, {
      resolutionCode: 'UNKNOWN_NO_REPLAY',
      note: '已核对外部记录，不重放',
      evidenceReference: 'provider-case-001',
    })).toBe(original)
    expect(deliveryReviewMutationSignature('resolve', item, {
      resolutionCode: 'UNKNOWN_NO_REPLAY',
      note: '核对结果有变化',
      evidenceReference: 'provider-case-001',
    })).not.toBe(original)
    expect(deliveryReviewMutationSignature('claim', item)).toBe(
      deliveryReviewMutationSignature('claim', item),
    )
  })

  it('locks migration 041 and grants runtime only the three required table privileges', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const migration = fs.readFileSync(
      path.join(root, 'database/mysql/mip/041_message_delivery_reviews.sql'),
      'utf8',
    )
    const rollback = fs.readFileSync(
      path.join(root, 'database/mysql/mip/rollback/041_message_delivery_reviews.sql'),
      'utf8',
    )
    const lock = JSON.parse(fs.readFileSync(
      path.join(root, 'database/mysql/mip/migrations.lock.json'),
      'utf8',
    ))
    const grants = fs.readFileSync(path.join(root, 'scripts/lib/mysql-privilege-assert.mjs'), 'utf8')
    const entry = lock.migrations.find((item: { name: string }) => item.name === 'mip_message_delivery_reviews')
    expect(entry?.version).toBe('20260824410000')
    expect(entry?.createsTables).toEqual(['mip_message_delivery_reviews'])
    expect(migration).toContain('workflow_status IN')
    expect(migration).toContain('resolution_code <> \'UNKNOWN_NO_REPLAY\'')
    expect(migration).toContain('UNIQUE KEY mip_message_delivery_reviews_source_uk')
    expect(rollback).toContain('SELECT 1 FROM mip_message_delivery_reviews LIMIT 1')
    expect(grants).toContain('mip_message_delivery_reviews: Object.freeze([\'SELECT\', \'INSERT\', \'UPDATE\'])')
  })
})
