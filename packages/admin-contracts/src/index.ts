import type { AdminOperationAction } from './generated/admin-operation-contract.ts'

export const ADMIN_REQUEST_CONTRACT_VERSION = 1 as const

export {
  ADMIN_OPERATION_CONTRACT,
  type AdminMutationAction,
  type AdminOperation,
  type AdminOperationAction,
  type AdminOperationContract,
  type AdminOperationKind,
  type AdminQueryAction,
} from './generated/admin-operation-contract.ts'

export type AdminRequestInput = Record<string, unknown>

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
