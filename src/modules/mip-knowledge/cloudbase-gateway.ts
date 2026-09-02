import type { CaseCloudClient } from '../../platform/cloudbase/client'
import type { OrderId } from '../mip'
import type {
  KnowledgeCheckoutIntent,
  KnowledgeCommentDeletionIntent,
  KnowledgeCommentIntent,
  KnowledgeCommentReportIntent,
  KnowledgeContentQuery,
  MipKnowledgeGateway,
} from './gateway'
import type {
  KnowledgeCategory,
  KnowledgeComment,
  KnowledgeCommentPage,
  KnowledgeContentDetail,
  KnowledgeContentSummary,
} from './types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string }
}

export interface CloudbaseMipKnowledgeGatewayOptions {
  communityFunctionName: string
  commerceFunctionName: string
  requireCloudClient: () => Promise<CaseCloudClient>
  resolveMedia: <T>(value: T) => Promise<T>
}

export function createCloudbaseMipKnowledgeGateway(
  options: CloudbaseMipKnowledgeGatewayOptions,
): MipKnowledgeGateway {
  async function call<T>(functionName: string, action: string, data: Record<string, unknown> = {}) {
    const cloud = await options.requireCloudClient()
    const response = await cloud.callFunction({ name: functionName, data: { action, ...data } })
    const envelope = response.result as Envelope<T>
    if (!envelope || typeof envelope.ok !== 'boolean') {
      throw new Error('内容服务返回了无效响应')
    }
    if (!envelope.ok) {
      throw new Error(envelope.error?.message || '内容服务暂时不可用')
    }
    return options.resolveMedia(envelope.data as T)
  }

  return Object.freeze({
    async listCategories() {
      const value = await call<{ items: KnowledgeCategory[] }>(
        options.communityFunctionName,
        'listKnowledgeCategories',
      )
      return Array.isArray(value.items) ? value.items : []
    },

    listContents(query: KnowledgeContentQuery = {}) {
      return call<{ items: KnowledgeContentSummary[], nextCursor?: string }>(
        options.communityFunctionName,
        'listKnowledgeContents',
        { ...query },
      )
    },

    getContent(contentId: string) {
      return call<KnowledgeContentDetail>(options.communityFunctionName, 'getKnowledgeContent', {
        contentId,
      })
    },

    listComments(contentId: string, cursor?: string) {
      return call<KnowledgeCommentPage>(options.communityFunctionName, 'listKnowledgeComments', {
        contentId,
        cursor,
        limit: 20,
      })
    },

    createComment(intent: KnowledgeCommentIntent) {
      return call<{ id: string, status: KnowledgeComment['status'], version: number }>(
        options.communityFunctionName,
        'createKnowledgeComment',
        { ...intent },
      )
    },

    deleteComment(intent: KnowledgeCommentDeletionIntent) {
      return call<{ id: string, status: 'DELETED', version: number }>(
        options.communityFunctionName,
        'deleteKnowledgeComment',
        { ...intent },
      )
    },

    reportComment(intent: KnowledgeCommentReportIntent) {
      return call<{ reportId: string, status: 'PENDING' }>(
        options.communityFunctionName,
        'reportKnowledgeComment',
        { ...intent },
      )
    },

    createCheckout(intent: KnowledgeCheckoutIntent) {
      return call<{ id: OrderId }>(options.commerceFunctionName, 'createKnowledgeCheckout', { ...intent })
    },
  })
}
