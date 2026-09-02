import type { OrderId } from '../mip'
import type {
  KnowledgeCategory,
  KnowledgeComment,
  KnowledgeCommentPage,
  KnowledgeContentDetail,
  KnowledgeContentSummary,
  KnowledgeContentType,
} from './types'

export interface KnowledgeContentQuery {
  categoryId?: string
  contentType?: KnowledgeContentType | ''
  accessType?: '' | 'FREE' | 'MEMBER' | 'MEMBER_OR_PAID'
  query?: string
  cursor?: string
  limit?: number
}

export interface KnowledgeCommentIntent {
  contentId: string
  body: string
  parentCommentId?: string
  idempotencyKey: string
}

export interface KnowledgeCommentDeletionIntent {
  commentId: string
  expectedVersion: number
  idempotencyKey: string
}

export interface KnowledgeCommentReportIntent {
  commentId: string
  category: string
  description: string
  requestId: string
  idempotencyKey: string
}

export interface KnowledgeCheckoutIntent {
  contentId: string
  idempotencyKey: string
}

export interface MipKnowledgeGateway {
  listCategories: () => Promise<KnowledgeCategory[]>
  listContents: (query?: KnowledgeContentQuery) => Promise<{
    items: KnowledgeContentSummary[]
    nextCursor?: string
  }>
  getContent: (contentId: string) => Promise<KnowledgeContentDetail>
  listComments: (contentId: string, cursor?: string) => Promise<KnowledgeCommentPage>
  createComment: (intent: KnowledgeCommentIntent) => Promise<{
    id: string
    status: KnowledgeComment['status']
    version: number
  }>
  deleteComment: (intent: KnowledgeCommentDeletionIntent) => Promise<{
    id: string
    status: 'DELETED'
    version: number
  }>
  reportComment: (intent: KnowledgeCommentReportIntent) => Promise<{
    reportId: string
    status: 'PENDING'
  }>
  createCheckout: (intent: KnowledgeCheckoutIntent) => Promise<{ id: OrderId }>
}
