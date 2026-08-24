import type { OrderId } from '../mip'
import type {
  KnowledgeCategory,
  KnowledgeComment,
  KnowledgeCommentPage,
  KnowledgeContentDetail,
  KnowledgeContentSummary,
  KnowledgeContentType,
  KnowledgePurchaseOutcome,
} from './types'
import { runtimeConfig } from '../../config/runtime'
import { mipCommerceModule } from '../mip-commerce/client'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string }
}

async function call<T>(functionName: string, action: string, data: Record<string, unknown> = {}) {
  const cloud = await requireCloudClient()
  const response = await cloud.callFunction({ name: functionName, data: { action, ...data } })
  const envelope = response.result as Envelope<T>
  if (!envelope || typeof envelope.ok !== 'boolean') {
    throw new Error('内容服务返回了无效响应')
  }
  if (!envelope.ok) {
    throw new Error(envelope.error?.message || '内容服务暂时不可用')
  }
  return resolveCloudFileUrls(envelope.data as T)
}

function requestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export const mipKnowledgeModule = {
  paymentEnabled: runtimeConfig.paymentMode !== 'disabled',

  async listCategories() {
    const value = await call<{ items: KnowledgeCategory[] }>(
      runtimeConfig.cloudbase.communityFunctionName,
      'listKnowledgeCategories',
    )
    return Array.isArray(value.items) ? value.items : []
  },

  async listContents(input: {
    categoryId?: string
    contentType?: KnowledgeContentType | ''
    accessType?: '' | 'FREE' | 'MEMBER' | 'MEMBER_OR_PAID'
    query?: string
    cursor?: string
    limit?: number
  } = {}) {
    return call<{ items: KnowledgeContentSummary[], nextCursor?: string }>(
      runtimeConfig.cloudbase.communityFunctionName,
      'listKnowledgeContents',
      input,
    )
  },

  getContent(contentId: string) {
    return call<KnowledgeContentDetail>(runtimeConfig.cloudbase.communityFunctionName, 'getKnowledgeContent', {
      contentId,
    })
  },

  listComments(contentId: string, cursor?: string) {
    return call<KnowledgeCommentPage>(runtimeConfig.cloudbase.communityFunctionName, 'listKnowledgeComments', {
      contentId,
      cursor,
      limit: 20,
    })
  },

  createComment(contentId: string, body: string, parentCommentId?: string) {
    return call<{ id: string, status: KnowledgeComment['status'], version: number }>(
      runtimeConfig.cloudbase.communityFunctionName,
      'createKnowledgeComment',
      { contentId, body, parentCommentId, idempotencyKey: requestId('knowledge-comment') },
    )
  },

  deleteComment(commentId: string, expectedVersion: number) {
    return call<{ id: string, status: 'DELETED', version: number }>(
      runtimeConfig.cloudbase.communityFunctionName,
      'deleteKnowledgeComment',
      { commentId, expectedVersion, idempotencyKey: requestId('knowledge-comment-delete') },
    )
  },

  reportComment(commentId: string, category: string, description = '') {
    const reportRequestId = requestId('knowledge-comment-report')
    return call<{ reportId: string, status: 'PENDING' }>(
      runtimeConfig.cloudbase.communityFunctionName,
      'reportKnowledgeComment',
      {
        commentId,
        category,
        description,
        requestId: reportRequestId,
        idempotencyKey: reportRequestId,
      },
    )
  },

  async purchase(contentId: string): Promise<KnowledgePurchaseOutcome> {
    if (!this.paymentEnabled) {
      throw new Error('PAYMENT_UNAVAILABLE')
    }
    const order = await call<{ id: string }>(
      runtimeConfig.cloudbase.commerceFunctionName,
      'createKnowledgeCheckout',
      { contentId, idempotencyKey: requestId('knowledge-checkout') },
    )
    return { contentId, payment: await mipCommerceModule.payOrder(order.id as OrderId) }
  },
}
