import type { OrderId } from '../src/modules/mip'
import type { MipKnowledgeGateway } from '../src/modules/mip-knowledge/gateway'
import { describe, expect, it, vi } from 'vitest'
import { createMipKnowledgeModule } from '../src/modules/mip-knowledge/module'

function createGateway(overrides: Partial<MipKnowledgeGateway> = {}): MipKnowledgeGateway {
  return {
    listCategories: vi.fn().mockResolvedValue([]),
    listContents: vi.fn().mockResolvedValue({ items: [] }),
    getContent: vi.fn(),
    listComments: vi.fn(),
    createComment: vi.fn(),
    deleteComment: vi.fn(),
    reportComment: vi.fn(),
    createCheckout: vi.fn(),
    ...overrides,
  }
}

describe('MIP knowledge module', () => {
  it('owns replay-safe comment and report intents without exposing transport actions', async () => {
    const gateway = createGateway({
      createComment: vi.fn().mockResolvedValue({ id: 'comment-1', status: 'PENDING', version: 1 }),
      deleteComment: vi.fn().mockResolvedValue({ id: 'comment-1', status: 'DELETED', version: 2 }),
      reportComment: vi.fn().mockResolvedValue({ reportId: 'report-1', status: 'PENDING' }),
    })
    const module = createMipKnowledgeModule(
      gateway,
      { payOrder: vi.fn() },
      { paymentEnabled: true, createRequestId: prefix => `${prefix}-request` },
    )

    await module.createComment('content-1', '正文', 'parent-1')
    await module.deleteComment('comment-1', 1)
    await module.reportComment('comment-1', 'SPAM', '说明')

    expect(gateway.createComment).toHaveBeenCalledWith({
      contentId: 'content-1',
      body: '正文',
      parentCommentId: 'parent-1',
      idempotencyKey: 'knowledge-comment-request',
    })
    expect(gateway.deleteComment).toHaveBeenCalledWith({
      commentId: 'comment-1',
      expectedVersion: 1,
      idempotencyKey: 'knowledge-comment-delete-request',
    })
    expect(gateway.reportComment).toHaveBeenCalledWith({
      commentId: 'comment-1',
      category: 'SPAM',
      description: '说明',
      requestId: 'knowledge-comment-report-request',
      idempotencyKey: 'knowledge-comment-report-request',
    })
  })

  it('submits only the content intent and pays the server-created order', async () => {
    const orderId = 'order-1' as OrderId
    const gateway = createGateway({
      createCheckout: vi.fn().mockResolvedValue({ id: orderId }),
    })
    const payOrder = vi.fn().mockResolvedValue({ kind: 'CANCELLED' })
    const module = createMipKnowledgeModule(
      gateway,
      { payOrder },
      { paymentEnabled: true, createRequestId: prefix => `${prefix}-request` },
    )

    await expect(module.purchase('content-1')).resolves.toEqual({
      contentId: 'content-1',
      payment: { kind: 'CANCELLED' },
    })
    expect(gateway.createCheckout).toHaveBeenCalledWith({
      contentId: 'content-1',
      idempotencyKey: 'knowledge-checkout-request',
    })
    expect(payOrder).toHaveBeenCalledWith(orderId)
  })

  it('stops before checkout when payment is disabled', async () => {
    const gateway = createGateway()
    const payOrder = vi.fn()
    const module = createMipKnowledgeModule(gateway, { payOrder }, { paymentEnabled: false })

    await expect(module.purchase('content-1')).rejects.toThrow('PAYMENT_UNAVAILABLE')
    expect(gateway.createCheckout).not.toHaveBeenCalled()
    expect(payOrder).not.toHaveBeenCalled()
  })
})
