import {
  createAdminRequest,
  isAdminApiResponse,
  type AdminApiResponse,
  type AdminRequestInput,
  type AdminSession,
} from '../domain/contracts'

export class AdminApiClient {
  readonly baseUrl: string
  readonly demoMode: boolean

  constructor(baseUrl = import.meta.env.VITE_MIP_ADMIN_API_URL || '/api/admin') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.demoMode = import.meta.env.VITE_MIP_ADMIN_DEMO_MODE === 'true'
  }

  get configured() { return !this.demoMode && Boolean(this.baseUrl) }

  login(returnTo = window.location.pathname) {
    window.location.assign(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`)
  }

  async logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  }

  async request<T>(action: string, input: AdminRequestInput = {}): Promise<T> {
    if (!this.configured) throw new AdminApiClientError('API_NOT_CONFIGURED', '尚未配置管理 API')
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify(createAdminRequest(action, input)),
    })
    let payload: unknown
    try { payload = await response.json() } catch { throw new AdminApiClientError('INVALID_RESPONSE', '管理 API 返回格式无效') }
    if (!isAdminApiResponse<T>(payload)) throw new AdminApiClientError('INVALID_RESPONSE', '管理 API 返回格式无效')
    if (!payload.ok) throw new AdminApiClientError(payload.error?.code || 'SERVICE_UNAVAILABLE', payload.error?.message || '运营服务暂时不可用', payload.error?.retryable)
    if (!response.ok) throw new AdminApiClientError('HTTP_ERROR', `管理 API 请求失败（${response.status}）`, true)
    return payload.data as T
  }

  async getSession(): Promise<AdminSession> { return this.request<AdminSession>('mip.admin.session') }
}

export class AdminApiClientError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) {
    super(message)
    this.name = 'AdminApiClientError'
  }
}

export type LoadResult<T> = AdminApiResponse<T> & { source: 'api' | 'demo' | 'error' }
