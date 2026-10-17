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
