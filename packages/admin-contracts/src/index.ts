export const ADMIN_REQUEST_CONTRACT_VERSION = 1 as const

export type AdminRequestInput = Record<string, unknown>

export interface AdminRequest<TInput extends AdminRequestInput = AdminRequestInput> {
  contractVersion: typeof ADMIN_REQUEST_CONTRACT_VERSION
  action: string
  input: TInput
  idempotencyKey?: string
}

export function createAdminRequest(
  action: string,
  input: AdminRequestInput = {},
): AdminRequest {
  const { idempotencyKey, ...businessInput } = input
  if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string') {
    throw new TypeError('Admin request idempotencyKey must be a string')
  }
  const request: AdminRequest = {
    contractVersion: ADMIN_REQUEST_CONTRACT_VERSION,
    action,
    input: businessInput,
  }
  return idempotencyKey === undefined
    ? request
    : { ...request, idempotencyKey }
}
