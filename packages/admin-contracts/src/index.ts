import type { AdminOperationAction } from './generated/admin-operation-contract.ts'

export const ADMIN_REQUEST_CONTRACT_VERSION = 1 as const

export {
  ADMIN_AUDIT_EVENT_TYPES,
  type AdminAuditEventType,
  type AdminLoginAuditRecord,
} from './audit-records.ts'

export {
  ADMIN_OPERATION_CONTRACT,
  ADMIN_WEB_OPERATION_CONTRACT,
  type AdminMutationAction,
  type AdminOperation,
  type AdminOperationAction,
  type AdminOperationContract,
  type AdminOperationKind,
  type AdminQueryAction,
  type AdminWebAllowedOperation,
  type AdminWebMutationAction,
  type AdminWebOperation,
  type AdminWebOperationAction,
  type AdminWebOperationContract,
  type AdminWebQueryAction,
} from './generated/admin-operation-contract.ts'

export type AdminRequestInput = Record<string, unknown>

// MIW-123：概览按月玩家趋势契约。服务端尚未产出该字段，先以中立契约 + demo fixture 前进，待联调。
export interface AdminOverviewPlayerTrendMonth {
  /** 自然月，格式 YYYY-MM。 */
  month: string
  /** 当月新增玩家（按首次购买计）。 */
  newPlayers: number
  /** 当月首年续费人数。 */
  firstRenewal: number
  /** 当月次年续费人数。 */
  nextRenewal: number
}

export interface AdminOverviewPlayerTrend {
  available: boolean
  months: AdminOverviewPlayerTrendMonth[]
}

/**
 * 旧 Web 客户端的身份筛选兼容值。当前列表、详情与导出使用服务端 kind=NORMAL|GUEST|PLAYER。
 * NORMAL 为无有效权益、无有效签到的已登录普通用户；GUEST 为有效签到过的非玩家。
 * BFF 将 filters.identity=NORMAL 翻译为 kind=NORMAL，由数据库在分页前筛选。
 */
export const ADMIN_USERS_IDENTITY_FILTER_VALUES = ['NORMAL'] as const
export type AdminUsersIdentityFilter = (typeof ADMIN_USERS_IDENTITY_FILTER_VALUES)[number]

/**
 * 用户列表「玩家权益状态」到期分档的 Web 展示枚举（MIW-124）。
 * 上游仍只接受 CURRENT/FORMER/NEVER；模块层将 ACTIVE/EXPIRING_THIS_MONTH/NEXT_MONTH 映射为
 * CURRENT 并在当前页结果内细分，EXPIRED 映射为 FORMER。
 */
export const ADMIN_USERS_PLAYER_STATUS_FILTER_VALUES = ['EXPIRING_THIS_MONTH', 'NEXT_MONTH', 'ACTIVE', 'EXPIRED'] as const
export type AdminUsersPlayerStatusFilter = (typeof ADMIN_USERS_PLAYER_STATUS_FILTER_VALUES)[number]

export interface AdminRequest<
  TInput extends AdminRequestInput = AdminRequestInput,
  TAction extends AdminOperationAction = AdminOperationAction,
> {
  contractVersion: typeof ADMIN_REQUEST_CONTRACT_VERSION
  action: TAction
  input: TInput
  idempotencyKey?: string
}

export function createAdminRequest<TAction extends AdminOperationAction>(
  action: TAction,
  input: AdminRequestInput = {},
): AdminRequest<AdminRequestInput, TAction> {
  const { idempotencyKey, ...businessInput } = input
  if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string') {
    throw new TypeError('Admin request idempotencyKey must be a string')
  }
  const request: AdminRequest<AdminRequestInput, TAction> = {
    contractVersion: ADMIN_REQUEST_CONTRACT_VERSION,
    action,
    input: businessInput,
  }
  return idempotencyKey === undefined
    ? request
    : { ...request, idempotencyKey }
}
