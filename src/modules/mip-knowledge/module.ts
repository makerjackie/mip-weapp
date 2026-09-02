import type { OrderId } from '../mip'
import type { ClientPaymentOutcome } from '../mip-commerce'
import type { MipKnowledgeGateway } from './gateway'
import type { KnowledgePurchaseOutcome } from './types'

export interface MipKnowledgePaymentPort {
  payOrder: (orderId: OrderId) => Promise<ClientPaymentOutcome>
}

export interface MipKnowledgeModuleOptions {
  paymentEnabled: boolean
  createRequestId?: (prefix: string) => string
}

function defaultRequestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function createMipKnowledgeModule(
  gateway: MipKnowledgeGateway,
  payment: MipKnowledgePaymentPort,
  options: MipKnowledgeModuleOptions,
) {
  const createRequestId = options.createRequestId || defaultRequestId

  return Object.freeze({
    paymentEnabled: options.paymentEnabled,

    listCategories: gateway.listCategories,
    listContents: gateway.listContents,
    getContent: gateway.getContent,
    listComments: gateway.listComments,

    createComment(contentId: string, body: string, parentCommentId?: string) {
      return gateway.createComment({
        contentId,
        body,
        parentCommentId,
        idempotencyKey: createRequestId('knowledge-comment'),
      })
    },

    deleteComment(commentId: string, expectedVersion: number) {
      return gateway.deleteComment({
        commentId,
        expectedVersion,
        idempotencyKey: createRequestId('knowledge-comment-delete'),
      })
    },

    reportComment(commentId: string, category: string, description = '') {
      const reportRequestId = createRequestId('knowledge-comment-report')
      return gateway.reportComment({
        commentId,
        category,
        description,
        requestId: reportRequestId,
        idempotencyKey: reportRequestId,
      })
    },

    async purchase(contentId: string): Promise<KnowledgePurchaseOutcome> {
      if (!options.paymentEnabled) {
        throw new Error('PAYMENT_UNAVAILABLE')
      }
      const order = await gateway.createCheckout({
        contentId,
        idempotencyKey: createRequestId('knowledge-checkout'),
      })
      return { contentId, payment: await payment.payOrder(order.id) }
    },
  })
}

export type MipKnowledgeModule = ReturnType<typeof createMipKnowledgeModule>
