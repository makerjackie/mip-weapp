export {
  ADMIN_REQUEST_CONTRACT_VERSION,
  createAdminRequest,
  type AdminOperationAction,
  type AdminRequest,
  type AdminRequestInput,
} from '@mip/admin-contracts'

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

export function isAdminApiResponse<T>(value: unknown): value is AdminApiResponse<T> {
  return Boolean(value && typeof value === 'object' && 'ok' in value)
}
