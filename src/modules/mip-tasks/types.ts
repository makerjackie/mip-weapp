export type TaskCardStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'DELETED'
export type UserTaskStatus = 'AVAILABLE' | 'COMPLETED' | 'ENDED'
export type TaskAssignmentMode = 'ALL' | 'SELECTED'
export type TaskAssignmentStatus = 'ACTIVE' | 'REVOKED' | 'NONE'
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

export interface AdminTaskCard {
  id: string
  name: string
  content: string
  rewardExperience: number
  attachmentRequired: boolean
  assignmentMode: TaskAssignmentMode
  assignmentCount: number
  eligibleLevels: TaskEligibleLevel[]
  endsAt: string
  template?: TaskTemplateMedia
  status: TaskCardStatus
  version: number
  completionCount: number
  publishedAt: string
  updatedAt: string
}

export interface AdminTaskCompletion {
  id: string
  taskId: string
  taskName: string
  taskContent: string
  nickname: string
  rewardExperience: number
  resultStatus: TaskCompletionResult
  resultMessage: string
  completedAt: string
  attachment?: {
    url: string
    contentType: string
    bytes: number
  }
}

export interface TaskPage<T> {
  items: T[]
  nextCursor?: string
}

export interface AdminTaskDraft {
  name: string
  content: string
  rewardExperience: number
  attachmentRequired: boolean
  assignmentMode: TaskAssignmentMode
  endsAt?: string
  templateAssetId?: string
  eligibleLevelIds?: string[]
}

export interface TaskEligibleLevel {
  id: string
  levelKey: string
  name: string
  minimumExperience: number
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
}

export interface AssignableTaskMember {
  memberRef: string
  nickname: string
  branchName: string
  assignmentStatus: TaskAssignmentStatus
  assignedAt: string
  revokedAt: string
}

export interface TaskAssignmentResult {
  taskId: string
  requestedCount: number
  changedCount: number
}

export interface AdminTaskFilters {
  status?: TaskCardStatus | ''
  query?: string
}

export interface AdminCompletionFilters {
  taskId?: string
  query?: string
  resultStatus?: TaskCompletionResult | ''
  completedFrom?: string
  completedUntil?: string
}

export interface TaskExportResult {
  fileName: string
  contentBase64: string
  rowCount: number
}

export interface TaskAdminSession {
  capability: 'tasks.manage'
  roleKey: 'PLATFORM_OWNER' | 'PLATFORM_OPERATIONS'
}

export interface MipTasksGateway {
  listTasks: (cursor?: string, limit?: number) => Promise<TaskPage<UserTaskCard>>
  getTask: (taskId: string) => Promise<UserTaskCard>
  completeTask: (taskId: string, attachmentAssetId?: string) => Promise<TaskCompletion>
  getAdminSession: () => Promise<TaskAdminSession>
  getAdminTask: (taskId: string) => Promise<AdminTaskCard>
  listAdminTasks: (filters?: AdminTaskFilters, cursor?: string, limit?: number) => Promise<TaskPage<AdminTaskCard>>
  listEligibleLevels: () => Promise<TaskEligibleLevel[]>
  saveTask: (input: { taskId?: string, expectedVersion?: number, task: AdminTaskDraft }) => Promise<AdminTaskCard>
  publishTask: (taskId: string, expectedVersion: number) => Promise<AdminTaskCard>
  unpublishTask: (taskId: string, expectedVersion: number) => Promise<AdminTaskCard>
  deleteTask: (taskId: string, expectedVersion: number) => Promise<AdminTaskCard>
  listAssignableMembers: (filters: { taskId: string, query?: string }, cursor?: string, limit?: number) => Promise<TaskPage<AssignableTaskMember>>
  assignMembers: (taskId: string, expectedVersion: number, memberRefs: string[]) => Promise<TaskAssignmentResult>
  revokeMembers: (taskId: string, expectedVersion: number, memberRefs: string[]) => Promise<TaskAssignmentResult>
  listCompletions: (filters?: AdminCompletionFilters, cursor?: string, limit?: number) => Promise<TaskPage<AdminTaskCompletion>>
  getCompletion: (completionId: string) => Promise<AdminTaskCompletion>
  exportCompletions: (filters?: AdminCompletionFilters) => Promise<TaskExportResult>
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
