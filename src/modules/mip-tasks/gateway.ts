import type {
  AdminCompletionFilters,
  AdminTaskCard,
  AdminTaskCompletion,
  AdminTaskDraft,
  AssignableTaskMember,
  MipTasksGateway,
  TaskAdminSession,
  TaskAssignmentResult,
  TaskCompletion,
  TaskEligibleLevel,
  TaskExportResult,
  TaskPage,
  UserTaskCard,
} from './types'
import { MipTasksError } from './types'

interface TasksEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipTasksTransport {
  invoke: (action: string, data?: Record<string, unknown>) => Promise<unknown>
}

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || typeof (value as TasksEnvelope<T>).ok !== 'boolean') {
    throw new MipTasksError('SERVICE_UNAVAILABLE', '任务服务返回了无效响应', true)
  }
  const envelope = value as TasksEnvelope<T>
  if (!envelope.ok || envelope.data === undefined) {
    throw new MipTasksError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '任务服务请求失败',
      envelope.error?.retryable === true,
    )
  }
  return envelope.data
}

export function createMipTasksGateway(transport: MipTasksTransport): MipTasksGateway {
  async function call<T>(action: string, data: Record<string, unknown> = {}) {
    return unwrap<T>(await transport.invoke(action, data))
  }
  return {
    listTasks: (cursor, limit) => call<TaskPage<UserTaskCard>>('listTasks', { cursor, limit }),
    getTask: taskId => call<UserTaskCard>('getTask', { taskId }),
    completeTask: (taskId, attachmentAssetId) => call<TaskCompletion>('completeTask', { taskId, attachmentAssetId }),
    getAdminSession: () => call<TaskAdminSession>('admin.getSession'),
    getAdminTask: taskId => call<AdminTaskCard>('admin.getTask', { taskId }),
    listAdminTasks: (filters, cursor, limit) => call<TaskPage<AdminTaskCard>>('admin.listTasks', { filters, cursor, limit }),
    listEligibleLevels: () => call<TaskEligibleLevel[]>('admin.listEligibleLevels'),
    saveTask: (input: { taskId?: string, expectedVersion?: number, task: AdminTaskDraft }) => call<AdminTaskCard>('admin.saveTask', input),
    publishTask: (taskId, expectedVersion) => call<AdminTaskCard>('admin.publishTask', { taskId, expectedVersion }),
    unpublishTask: (taskId, expectedVersion) => call<AdminTaskCard>('admin.unpublishTask', { taskId, expectedVersion }),
    deleteTask: (taskId, expectedVersion) => call<AdminTaskCard>('admin.deleteTask', { taskId, expectedVersion }),
    listAssignableMembers: (filters, cursor, limit) => call<TaskPage<AssignableTaskMember>>('admin.listAssignableMembers', { filters, cursor, limit }),
    assignMembers: (taskId, expectedVersion, memberRefs) => call<TaskAssignmentResult>('admin.assignMembers', { taskId, expectedVersion, memberRefs }),
    revokeMembers: (taskId, expectedVersion, memberRefs) => call<TaskAssignmentResult>('admin.revokeMembers', { taskId, expectedVersion, memberRefs }),
    listCompletions: (filters?: AdminCompletionFilters, cursor?: string, limit?: number) => call<TaskPage<AdminTaskCompletion>>('admin.listCompletions', { filters, cursor, limit }),
    getCompletion: completionId => call<AdminTaskCompletion>('admin.getCompletion', { completionId }),
    exportCompletions: (filters?: AdminCompletionFilters) => call<TaskExportResult>('admin.exportCompletions', { filters }),
  }
}
