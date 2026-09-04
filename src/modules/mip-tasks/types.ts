export type UserTaskStatus = 'AVAILABLE' | 'COMPLETED' | 'ENDED'
export type TaskCompletionResult = 'SUCCESS' | 'FAILED'

export interface UserTaskCard {
  id: string
  name: string
  content: string
  rewardExperience: number
  attachmentRequired: boolean
  endsAt: string
  hasTemplate: boolean
  version: number
  status: UserTaskStatus
  completion?: {
    id: string
    completedAt: string
    rewardExperience: number
  }
  template?: TaskTemplateMedia
}

export interface TaskTemplateMedia {
  assetId: string
  url: string
  contentType: string
  bytes: number
}

export interface TaskCompletion {
  id: string
  taskId: string
  taskName: string
  rewardExperience: number
  resultStatus: TaskCompletionResult
  completedAt: string
  alreadyCompleted: boolean
  balanceAfter?: number | null
}

export interface TaskPage<T> {
  items: T[]
  nextCursor?: string
}

export const MIP_TASKS_CONTRACT_VERSION = 1 as const

export interface MipTasksActionInputMap {
  listTasks: { cursor?: string, limit?: number }
  getTask: { taskId: string }
  completeTask: { taskId: string, attachmentAssetId?: string }
}

export interface MipTasksActionResultMap {
  listTasks: TaskPage<UserTaskCard>
  getTask: UserTaskCard
  completeTask: TaskCompletion
}

export type MipTasksAction = keyof MipTasksActionInputMap

export interface MipTasksRequest<A extends MipTasksAction = MipTasksAction> {
  contractVersion: typeof MIP_TASKS_CONTRACT_VERSION
  action: A
  input: MipTasksActionInputMap[A]
}

export interface MipTasksGateway {
  listTasks: (cursor?: string, limit?: number) => Promise<TaskPage<UserTaskCard>>
  getTask: (taskId: string) => Promise<UserTaskCard>
  completeTask: (taskId: string, attachmentAssetId?: string) => Promise<TaskCompletion>
}

export class MipTasksError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'MipTasksError'
    this.code = code
    this.retryable = retryable
  }
}
