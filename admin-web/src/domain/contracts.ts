export const ADMIN_REQUEST_CONTRACT_VERSION = 1 as const

export type AdminRequestInput = Record<string, unknown>

export interface AdminRequest<TInput extends AdminRequestInput = AdminRequestInput> {
  contractVersion: typeof ADMIN_REQUEST_CONTRACT_VERSION
  action: string
  input: TInput
  idempotencyKey?: string
}

export interface AdminApiError {
  code: string
  message: string
  retryable?: boolean
}

export interface AdminApiResponse<T> {
  ok: boolean
  data?: T
  error?: AdminApiError
}

export interface AdminSession {
  enabled?: boolean
  capabilities?: Array<{ capability: string; scopeType?: string; scopeId?: string | null }>
  actor?: { id?: string; name?: string; phone?: string }
}

export function createAdminRequest(action: string, input: AdminRequestInput = {}): AdminRequest {
  const { idempotencyKey, ...businessInput } = input
  const request: AdminRequest = {
    contractVersion: ADMIN_REQUEST_CONTRACT_VERSION,
    action,
    input: businessInput,
  }
  return typeof idempotencyKey === 'string' ? { ...request, idempotencyKey } : request
}

export function isAdminApiResponse<T>(value: unknown): value is AdminApiResponse<T> {
  return Boolean(value && typeof value === 'object' && 'ok' in value)
}
