import type {
  MipTasksAction,
  MipTasksActionInputMap,
  MipTasksActionResultMap,
  MipTasksGateway,
  MipTasksRequest,
} from './types'
import { parseTaskCompletion, parseUserTaskDetail, parseUserTaskPage } from './dto'
import { MIP_TASKS_CONTRACT_VERSION, MipTasksError } from './types'

interface TasksEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipTasksTransport {
  invoke: (request: MipTasksRequest) => Promise<unknown>
}

function validError(value: unknown): value is { code: string, message: string, retryable: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const error = value as Record<string, unknown>
  return Object.keys(error).sort().join(',') === 'code,message,retryable'
    && typeof error.code === 'string'
    && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    && typeof error.message === 'string'
    && error.message.length > 0
    && error.message.length <= 200
    && typeof error.retryable === 'boolean'
}

function invalidResponse(): never {
  throw new MipTasksError('SERVICE_UNAVAILABLE', '任务服务返回了无效响应', true)
}

function unwrap<T>(value: unknown, parse: (data: unknown) => T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidResponse()
  }
  const envelope = value as TasksEnvelope<unknown>
  const keys = Object.keys(envelope)
  if (envelope.ok === true) {
    if (keys.length !== 2 || !keys.includes('data') || envelope.data === undefined) {
      invalidResponse()
    }
    return parse(envelope.data)
  }
  if (envelope.ok === false) {
    if (keys.length !== 2 || !keys.includes('error') || !validError(envelope.error)) {
      invalidResponse()
    }
    throw new MipTasksError(
      envelope.error.code,
      envelope.error.message,
      envelope.error.retryable,
    )
  }
  return invalidResponse()
}

export function createMipTasksGateway(transport: MipTasksTransport): MipTasksGateway {
  async function call<A extends MipTasksAction>(
    action: A,
    input: MipTasksActionInputMap[A],
  ): Promise<MipTasksActionResultMap[A]> {
    const response = await transport.invoke({
      contractVersion: MIP_TASKS_CONTRACT_VERSION,
      action,
      input,
    })
    const parsers: Partial<Record<MipTasksAction, (value: unknown) => unknown>> = {
      listTasks: parseUserTaskPage,
      getTask: parseUserTaskDetail,
      completeTask: parseTaskCompletion,
    }
    const parse = parsers[action] || ((value: unknown) => value)
    return unwrap(response, parse) as MipTasksActionResultMap[A]
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
