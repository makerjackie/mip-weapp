import type { AdminOperationAction } from '../mip-admin/request-contract'
import type { AdminTransport } from '../mip-admin/transport'
import { cloudbaseAdminTransport } from '../mip-admin/cloudbase-transport'
import { createAdminRequest } from '../mip-admin/request-contract'

export type KnowledgeAdminListSection = 'CONTENTS' | 'SOURCES' | 'CATEGORIES' | 'COMMENTS' | 'REPORTS' | 'RUNS'
export type KnowledgeAdminSection = KnowledgeAdminListSection | 'SCHEDULES'
export type KnowledgeScheduleStatus = 'ACTIVE' | 'PAUSED'

export interface KnowledgeSchedule {
  id: string
  source: {
    id: string
    name: string
    sourceType: 'JSON_FEED' | 'RSS'
    status: string
  }
  category: {
    id: string
    name: string
    status: string
  }
  dailyTime: string
  timeZone: string
  status: KnowledgeScheduleStatus
  nextRunAt: string
  attemptCount: number
  lastRunId: string
  lastStartedAt: string | null
  lastCompletedAt: string | null
  lastErrorCode: string
  version: number
}

export interface KnowledgeScheduleSaveInput {
  scheduleId?: string
  expectedVersion: number
  sourceId: string
  categoryId: string
  timeOfDay: string
  timeZone: string
  status: KnowledgeScheduleStatus
  idempotencyKey: string
}

export interface KnowledgeScheduleSaveResult {
  id: string
  dailyTime: string
  timeZone: string
  status: KnowledgeScheduleStatus
  nextRunAt: string
  version: number
  idempotent: boolean
}

function requestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function createMipKnowledgeAdminModule(transport: AdminTransport) {
  const invoke = <T>(action: AdminOperationAction, input: Record<string, unknown> = {}) => (
    transport.request<T>(createAdminRequest(action, input))
  )
  return {
    list(section: KnowledgeAdminListSection, input: Record<string, unknown> = {}) {
      return invoke<{ section: KnowledgeAdminListSection, items: Array<Record<string, unknown>>, nextCursor: null }>(
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
    listSchedules(input: { status?: KnowledgeScheduleStatus, limit?: number } = {}) {
      return invoke<{ items: KnowledgeSchedule[], nextCursor: null }>(
        'mip.admin.knowledge.schedules.list',
        input,
      )
    },
    saveSchedule(input: KnowledgeScheduleSaveInput) {
      return invoke<KnowledgeScheduleSaveResult>('mip.admin.knowledge.schedules.save', {
        ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
        expectedVersion: input.expectedVersion,
        sourceId: input.sourceId,
        categoryId: input.categoryId,
        dailyTime: input.timeOfDay,
        timeZone: input.timeZone,
        status: input.status,
        idempotencyKey: input.idempotencyKey,
      })
    },
  }
}

export const mipKnowledgeAdminModule = createMipKnowledgeAdminModule(cloudbaseAdminTransport)
