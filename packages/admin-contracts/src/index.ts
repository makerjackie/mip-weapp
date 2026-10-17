import type { AdminOperationAction } from './generated/admin-operation-contract.ts'

export const ADMIN_REQUEST_CONTRACT_VERSION = 1 as const

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

/**
 * 用户列表「身份」筛选的 Web 契约取值（MIW-124）。
 * NORMAL 语义=既非玩家也非嘉宾；上游 `mip.admin.users.list` 暂以 kind=PLAYER|GUEST 投影角色，
 * BFF 收到 `filters.identity=NORMAL` 时对当前页结果按该语义过滤，并不向上游转发该参数。
 * 服务端角色标识落地（Q-ADMIN-09）前，生产数据在该筛选下可能为空结果。
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
