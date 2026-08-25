import type {
  MipTasksAction,
  MipTasksActionInputMap,
  MipTasksActionResultMap,
  MipTasksGateway,
  MipTasksRequest,
} from './types'
import { MIP_TASKS_CONTRACT_VERSION, MipTasksError } from './types'

interface TasksEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipTasksTransport {
  invoke: (request: MipTasksRequest) => Promise<unknown>
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
  async function call<A extends MipTasksAction>(
    action: A,
    input: MipTasksActionInputMap[A],
  ): Promise<MipTasksActionResultMap[A]> {
    return unwrap<MipTasksActionResultMap[A]>(await transport.invoke({
      contractVersion: MIP_TASKS_CONTRACT_VERSION,
      action,
      input,
    }))
  }
  return {
    listTasks: (cursor, limit) => call('listTasks', { cursor, limit }),
    getTask: taskId => call('getTask', { taskId }),
    completeTask: (taskId, attachmentAssetId) => call('completeTask', { taskId, attachmentAssetId }),
    getAdminSession: () => call('admin.getSession', {}),
    getAdminTask: taskId => call('admin.getTask', { taskId }),
    listAdminTasks: (filters, cursor, limit) => call('admin.listTasks', { filters, cursor, limit }),
    listEligibleLevels: () => call('admin.listEligibleLevels', {}),
    saveTask: input => call('admin.saveTask', input),
    publishTask: (taskId, expectedVersion) => call('admin.publishTask', { taskId, expectedVersion }),
    unpublishTask: (taskId, expectedVersion) => call('admin.unpublishTask', { taskId, expectedVersion }),
    deleteTask: (taskId, expectedVersion) => call('admin.deleteTask', { taskId, expectedVersion }),
    listAssignableMembers: (filters, cursor, limit) => call('admin.listAssignableMembers', {
      filters,
      cursor,
      limit,
    }),
    assignMembers: (taskId, expectedVersion, memberRefs) => call('admin.assignMembers', {
      taskId,
      expectedVersion,
      memberRefs,
    }),
    revokeMembers: (taskId, expectedVersion, memberRefs) => call('admin.revokeMembers', {
      taskId,
      expectedVersion,
      memberRefs,
    }),
    listCompletions: (filters, cursor, limit) => call('admin.listCompletions', {
      filters,
      cursor,
      limit,
    }),
    getCompletion: completionId => call('admin.getCompletion', { completionId }),
    exportCompletions: filters => call('admin.exportCompletions', { filters }),
  }
}
