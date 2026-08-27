import {
  createAdminRequest,
  isAdminApiResponse,
  type AdminApiResponse,
  type AdminRequestInput,
  type AdminSession,
} from '../domain/contracts'

export class AdminApiClient {
  readonly baseUrl: string
  readonly authUrl: string
  private token: string

  constructor(baseUrl = import.meta.env.VITE_MIP_ADMIN_API_URL || '', token = import.meta.env.VITE_MIP_ADMIN_TOKEN || '') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.authUrl = (import.meta.env.VITE_MIP_ADMIN_AUTH_URL || `${this.baseUrl}/auth/session`).replace(/\/$/, '')
    this.token = token
  }

  get configured() { return Boolean(this.baseUrl) }
  get hasToken() { return Boolean(this.token) }
  setToken(token: string) { this.token = token.trim() }

  async exchangeLoginCode(code: string, redirectUri = window.location.origin): Promise<{ accessToken: string; expiresAt?: string }> {
    if (!this.authUrl) throw new AdminApiClientError('AUTH_NOT_CONFIGURED', '尚未配置登录服务')
    const response = await fetch(this.authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
    })
    let payload: unknown
    try { payload = await response.json() } catch { throw new AdminApiClientError('INVALID_RESPONSE', '登录服务返回格式无效') }
    if (!response.ok || !payload || typeof payload !== 'object') throw new AdminApiClientError('AUTH_FAILED', '登录失败，请稍后重试', true)
    const value = payload as Record<string, unknown>
    if (typeof value.accessToken !== 'string' || !value.accessToken) throw new AdminApiClientError('AUTH_FAILED', '登录服务未返回有效会话', true)
    this.setToken(value.accessToken)
    return { accessToken: value.accessToken, expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : undefined }
  }

  async request<T>(action: string, input: AdminRequestInput = {}): Promise<T> {
    if (!this.configured) throw new AdminApiClientError('API_NOT_CONFIGURED', '尚未配置管理 API')
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(createAdminRequest(action, input)),
    })
    let payload: unknown
    try { payload = await response.json() } catch { throw new AdminApiClientError('INVALID_RESPONSE', '管理 API 返回格式无效') }
    if (!response.ok) throw new AdminApiClientError('HTTP_ERROR', `管理 API 请求失败（${response.status}）`, true)
    if (!isAdminApiResponse<T>(payload)) throw new AdminApiClientError('INVALID_RESPONSE', '管理 API 返回格式无效')
    if (!payload.ok) throw new AdminApiClientError(payload.error?.code || 'SERVICE_UNAVAILABLE', payload.error?.message || '运营服务暂时不可用', payload.error?.retryable)
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
