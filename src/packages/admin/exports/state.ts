import type {
  ExportProgress,
  PendingAdminExportStatus,
} from '../../../modules/mip-admin'
import { MipAdminError } from '../../../modules/mip-admin'

export type PendingExportViewState
  = | 'none'
    | 'checking'
    | 'resumable'
    | 'retry'
    | 'conflict'
    | 'terminal'

export interface PendingExportPresentation {
  pendingState: PendingExportViewState
  pendingStatus: PendingAdminExportStatus['status'] | ''
  pendingMessage: string
  pendingFileName: string
  pendingRowCount: number
}

export const emptyPendingExportPresentation: PendingExportPresentation = {
  pendingState: 'none',
  pendingStatus: '',
  pendingMessage: '',
  pendingFileName: '',
  pendingRowCount: 0,
}

export function pendingExportProgressPresentation(progress: ExportProgress): PendingExportPresentation {
  const messages: Record<ExportProgress, string> = {
    creating: '正在创建导出任务',
    checking: '正在确认导出状态',
    preparing: '正在准备导出文件',
    downloading: '正在下载导出文件',
    opening: '正在打开导出文件',
  }
  return {
    ...emptyPendingExportPresentation,
    pendingState: 'checking',
    pendingMessage: messages[progress],
  }
}

export function pendingExportStatusPresentation(
  pending: PendingAdminExportStatus | null,
): PendingExportPresentation {
  if (!pending) {
    return { ...emptyPendingExportPresentation }
  }
  const common = {
    pendingStatus: pending.status,
    pendingFileName: pending.fileName,
    pendingRowCount: pending.rowCount || 0,
  }
  if (pending.status === 'PENDING') {
    return {
      ...common,
      pendingState: 'resumable',
      pendingMessage: '有一个导出任务尚未完成，可以继续处理。',
    }
  }
  if (pending.status === 'READY') {
    return {
      ...common,
      pendingState: 'resumable',
      pendingMessage: '导出文件已准备完成，可以继续下载。',
    }
  }
  if (pending.status === 'RESERVED') {
    return {
      ...common,
      pendingState: 'retry',
      pendingMessage: '上次下载尚未结束，可以稍后重试。',
    }
  }
  const terminalMessages = {
    CONSUMED: '上次导出已完成。',
    EXPIRED: '上次导出已过期，请重新创建。',
    REVOKED: '上次导出文件不可用，请重新创建。',
    FAILED: '上次导出失败，请重新创建。',
  }
  return {
    ...common,
    pendingState: 'terminal',
    pendingMessage: terminalMessages[pending.status],
  }
}

export function pendingExportFailurePresentation(error: unknown): PendingExportPresentation {
  if (error instanceof MipAdminError && error.code === 'CONFLICT') {
    return {
      ...emptyPendingExportPresentation,
      pendingState: 'conflict',
      pendingMessage: '导出状态已变化，请重新确认后继续。',
    }
  }
  if (error instanceof MipAdminError && error.retryable) {
    return {
      ...emptyPendingExportPresentation,
      pendingState: 'retry',
      pendingMessage: error.message || '导出服务暂时不可用，请稍后重试。',
    }
  }
  return {
    ...emptyPendingExportPresentation,
    pendingState: 'terminal',
    pendingMessage: error instanceof Error ? error.message : '导出任务无法恢复。',
  }
}
