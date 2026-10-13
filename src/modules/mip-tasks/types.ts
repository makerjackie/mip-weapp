export type UserTaskStatus = 'AVAILABLE' | 'COMPLETED' | 'ENDED' | 'PENDING_REVIEW' | 'NOT_STARTED'
export type TaskCompletionResult = 'SUCCESS' | 'FAILED' | 'PENDING'
/** 任务卡点击动作（后台按任务配置；未配置 = 整卡不可点）。 */
export type UserTaskActionType = 'PAGE_JUMP' | 'SHARE'

export interface UserTaskCard {
  id: string
  name: string
  content: string
  rewardExperience: number
  attachmentRequired: boolean
  endsAt: string
  hasTemplate: boolean
  /** 点击动作类型（后台配置；缺省 = 未配置、整卡不可点）。 */
  actionType?: UserTaskActionType
  /** PAGE_JUMP 的目标页路径（存储口径同 runtime-pages.json：不带前导 /、禁 query）。 */
  actionTarget?: string
  version: number
  status: UserTaskStatus
  submissionStatus?: string
  reviewRemark?: string
  starLevel?: number
  periodStartAt?: string
  periodEndAt?: string
  weeklyDeliverAt?: string
  completion?: {
    id: string
    completedAt: string
    rewardExperience: number
  }
  template?: TaskTemplateMedia
  /** 任务目的面板正文（figma: 任务目的 Frame 3770） */
  purpose?: string
  /** 完成标准面板正文（figma: 完成标准 Frame 3771） */
  completionStandard?: string
  /** 完成条件面板中的黄色提示行（figma: 请上传***大小的doc. png. jpg） */
  attachmentHint?: string
  /** 玩家视角已上传附件的展示信息（文件名后端未存储，暂为设计占位） */
  attachment?: {
    name: string
    uploadedAt: string
  }
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
  submissionStatus?: string
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
  listTasks: { cursor?: string, limit?: number, filter?: 'pending' | 'ended' }
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
  listTasks: (cursor?: string, limit?: number, filter?: 'pending' | 'ended') => Promise<TaskPage<UserTaskCard>>
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
