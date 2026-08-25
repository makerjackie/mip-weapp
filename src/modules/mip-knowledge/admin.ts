import type { AdminTransport } from '../mip-admin/transport'
import { cloudbaseAdminTransport } from '../mip-admin/cloudbase-transport'
import { createAdminRequest } from '../mip-admin/request-contract'

export type KnowledgeAdminSection = 'CONTENTS' | 'SOURCES' | 'CATEGORIES' | 'COMMENTS' | 'REPORTS' | 'RUNS'

function requestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function createMipKnowledgeAdminModule(transport: AdminTransport) {
  const invoke = <T>(action: string, input: Record<string, unknown> = {}) => (
    transport.request<T>(createAdminRequest(action, input))
  )
  return {
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
}

export const mipKnowledgeAdminModule = createMipKnowledgeAdminModule(cloudbaseAdminTransport)
