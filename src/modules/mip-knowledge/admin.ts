import { runtimeConfig } from '../../config/runtime'
import { MipAdminError } from '../mip-admin'
import { createAdminRequest } from '../mip-admin/request-contract'
import { requireCloudClient } from '../platform/cloudbase'

export type KnowledgeAdminSection = 'CONTENTS' | 'SOURCES' | 'CATEGORIES' | 'COMMENTS' | 'REPORTS' | 'RUNS'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

async function invoke<T>(action: string, input: Record<string, unknown> = {}) {
  const cloud = await requireCloudClient()
  const response = await cloud.callFunction({
    name: runtimeConfig.cloudbase.adminFunctionName,
    data: createAdminRequest(action, input),
  })
  const envelope = response.result as Envelope<T>
  if (!envelope || typeof envelope.ok !== 'boolean') {
    throw new Error('知识管理服务返回了无效响应')
  }
  if (!envelope.ok) {
    throw new MipAdminError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '知识管理服务暂时不可用',
      envelope.error?.retryable === true,
    )
  }
  return envelope.data as T
}

function requestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export const mipKnowledgeAdminModule = {
  list(section: KnowledgeAdminSection, input: Record<string, unknown> = {}) {
    return invoke<{ section: KnowledgeAdminSection, items: Array<Record<string, unknown>>, nextCursor: null }>(
      'mip.admin.knowledge.list',
      { section, ...input },
    )
  },
  getContent(contentId: string) {
    return invoke<Record<string, unknown>>('mip.admin.knowledge.get', { contentId })
  },
  saveSource(input: Record<string, unknown>) {
    return invoke('mip.admin.knowledge.sources.save', input)
  },
  saveCategory(input: Record<string, unknown>) {
    return invoke('mip.admin.knowledge.categories.save', input)
  },
  saveContent(input: Record<string, unknown>) {
    return invoke<{ id: string, version: number }>('mip.admin.knowledge.contents.save', input)
  },
  reviewContent(contentId: string, expectedVersion: number, decision: string, reason = '') {
    return invoke<{ id: string, status: string, version: number }>('mip.admin.knowledge.contents.review', {
      contentId,
      expectedVersion,
      decision,
      reason,
    })
  },
  saveProduct(input: Record<string, unknown>) {
    return invoke('mip.admin.knowledge.products.save', input)
  },
  moderateComment(commentId: string, expectedVersion: number, decision: 'PUBLISH' | 'HIDE', reason: string) {
    return invoke('mip.admin.knowledge.comments.moderate', { commentId, expectedVersion, decision, reason })
  },
  closeReport(reportId: string, expectedVersion: number, status: 'RESOLVED' | 'DISMISSED', reason: string) {
    return invoke('mip.admin.knowledge.reports.close', { reportId, expectedVersion, status, reason })
  },
  runIngestion(sourceId: string, categoryId: string) {
    return invoke('mip.admin.knowledge.ingestion.run', {
      sourceId,
      categoryId,
      idempotencyKey: requestId('knowledge-ingestion'),
    })
  },
}
