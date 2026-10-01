import {
  createAdminRequest,
  isAdminApiResponse,
  type AdminOperationAction,
  type AdminRequestInput,
  type AdminSession,
} from '../domain/contracts.ts'
import {
  parseAdminMediaUploadResult,
  prepareAdminMediaUpload,
  type AdminMediaFile,
  type AdminMediaPurpose,
  type AdminMediaUploadResult,
} from '../modules/admin-media-upload.ts'

export interface AdminLoginChallenge {
  state: 'PENDING'
  code: string
  qrCodeDataUrl?: string
  expiresAt: string
  pollAfterMs: number
}

export interface AdminPasswordStatus {
  configured: boolean
  maskedPhone: string
  recentWechatAuth: boolean
}

export type AdminLoginChallengeStatus = {
  state: 'PENDING'
  expiresAt: string
  pollAfterMs: number
} | {
  state: 'AUTHENTICATED'
  actor: { name?: string }
  expiresAt: string
}

const runtimeEnvironment = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>
}).env

const AUTH_REQUEST_TIMEOUT_MS = 15_000
const ADMIN_REQUEST_TIMEOUT_MS = 15_000
const MEDIA_UPLOAD_TIMEOUT_MS = 70_000

export class AdminApiClient {
  readonly baseUrl: string
  readonly demoMode: boolean

  constructor(baseUrl = runtimeEnvironment?.VITE_MIP_ADMIN_API_URL || '/api/admin') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.demoMode = runtimeEnvironment?.VITE_MIP_ADMIN_DEMO_MODE === 'true'
  }

  get configured() { return !this.demoMode && Boolean(this.baseUrl) }

  async beginLogin(): Promise<AdminLoginChallenge> {
    const payload = await this.authRequest('/api/auth/challenge')
    if (payload.state !== 'PENDING'
      || typeof payload.code !== 'string'
      || (payload.qrCodeDataUrl !== undefined && !validLoginQrCodeDataUrl(payload.qrCodeDataUrl))
      || typeof payload.expiresAt !== 'string'
      || typeof payload.pollAfterMs !== 'number') {
      throw new AdminApiClientError('INVALID_RESPONSE', '网页登录服务返回格式无效')
    }
    return payload as unknown as AdminLoginChallenge
  }

  async pollLogin(): Promise<AdminLoginChallengeStatus> {
    const payload = await this.authRequest('/api/auth/challenge/status')
    if (payload.state === 'PENDING'
      && typeof payload.expiresAt === 'string'
      && typeof payload.pollAfterMs === 'number') {
      return payload as unknown as AdminLoginChallengeStatus
    }
    if (payload.state === 'AUTHENTICATED'
      && typeof payload.expiresAt === 'string'
      && payload.actor !== null
      && typeof payload.actor === 'object') {
      return payload as unknown as AdminLoginChallengeStatus
    }
    throw new AdminApiClientError('INVALID_RESPONSE', '网页登录服务返回格式无效')
  }

  async logout() {
    await this.authRequest('/api/auth/logout')
  }

  async loginWithPassword(phone: string, password: string, isCurrent = () => true): Promise<void> {
    this.assertPasswordAvailable()
    // Only replay explicit temporary service failures, never ambiguous network
    // failures, incorrect credentials, rate limits, or password changes.
    for (let attempt = 0; ; attempt++) {
      if (!isCurrent()) return
      try {
        const payload = await this.authRequest('/api/auth/password/login', { phone, password })
        if (payload.authenticated !== true) throw new AdminApiClientError('INVALID_RESPONSE', '密码登录服务返回格式无效')
        return
      }
      catch (error) {
        if (!(error instanceof AdminApiClientError) || error.code !== 'AUTH_STARTING') throw error
        if (attempt >= 2) throw new AdminApiClientError('AUTH_UNAVAILABLE', '登录服务仍未就绪，请稍后重试', true)
        await new Promise(resolve => globalThis.setTimeout(resolve, [2_000, 5_000][attempt]))
      }
    }
  }

  async getPasswordStatus(): Promise<AdminPasswordStatus> {
    this.assertPasswordAvailable()
    const payload = await this.authRequest('/api/auth/password', undefined, 'GET')
    if (typeof payload.configured !== 'boolean' || typeof payload.maskedPhone !== 'string' || typeof payload.recentWechatAuth !== 'boolean') {
      throw new AdminApiClientError('INVALID_RESPONSE', '密码设置服务返回格式无效')
    }
    return payload as unknown as AdminPasswordStatus
  }

  async setPassword(password: string, currentPassword?: string): Promise<{ configured: true; requiresLogin: boolean }> {
    this.assertPasswordAvailable()
    const payload = await this.authRequest('/api/auth/password', { password, ...(currentPassword ? { currentPassword } : {}) })
    if (payload.configured !== true || typeof payload.requiresLogin !== 'boolean') throw new AdminApiClientError('INVALID_RESPONSE', '密码设置服务返回格式无效')
    return { configured: true, requiresLogin: payload.requiresLogin }
  }

  private assertPasswordAvailable() {
    if (this.demoMode) throw new AdminApiClientError('DEMO_READ_ONLY', '演示模式不能登录或修改密码')
  }

  private async authRequest(path: string, body?: Record<string, string>, method = 'POST'): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetchWithTimeout(path, {
        method,
        credentials: 'same-origin',
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      }, path === '/api/auth/password/login' ? 30_000 : AUTH_REQUEST_TIMEOUT_MS)
    }
    catch (error) {
      throw connectionError(error, 'AUTH_UNAVAILABLE', '网页登录服务连接失败，请稍后重试')
    }
    if (path.startsWith('/api/auth/password') && [404, 405].includes(response.status)) {
      throw new AdminApiClientError('AUTH_UNAVAILABLE', '密码登录服务尚未部署，请使用小程序登录')
    }
    // Gateways can return an HTML 502/503/504 while the service starts.
    if (path === '/api/auth/password/login' && [502, 503, 504].includes(response.status)) {
      const failure = await response.clone().json().catch(() => null)
      const code = failure?.error?.code
      if (!code || ['AUTH_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'UPSTREAM_TIMEOUT'].includes(code)) {
        throw new AdminApiClientError('AUTH_STARTING', '正在连接登录服务，请稍候', true)
      }
    }
    let payload: unknown
    try { payload = await response.json() } catch {
      throw new AdminApiClientError('INVALID_RESPONSE', '网页登录服务返回格式无效')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminApiClientError('INVALID_RESPONSE', '网页登录服务返回格式无效')
    }
    const record = payload as Record<string, unknown>
    const error = record.error
    if (!response.ok) {
      const detail = error && typeof error === 'object' ? error as Record<string, unknown> : {}
      throw new AdminApiClientError(
        typeof detail.code === 'string' ? detail.code : 'AUTH_UNAVAILABLE',
        typeof detail.message === 'string' ? detail.message : '网页登录服务暂时不可用',
        response.status >= 500,
      )
    }
    return record
  }

  async request<T>(action: AdminOperationAction, input: AdminRequestInput = {}): Promise<T> {
    if (!this.configured) throw new AdminApiClientError('API_NOT_CONFIGURED', '尚未配置管理 API')
    let response: Response
    try {
      response = await fetchWithTimeout(this.baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify(createAdminRequest(action, input)),
      }, ADMIN_REQUEST_TIMEOUT_MS)
    }
    catch (error) {
      throw connectionError(error, 'SERVICE_UNAVAILABLE', '运营服务连接失败，请稍后重试')
    }
    let payload: unknown
    try { payload = await response.json() } catch { throw new AdminApiClientError('INVALID_RESPONSE', '管理 API 返回格式无效') }
    if (!isAdminApiResponse<T>(payload)) throw new AdminApiClientError('INVALID_RESPONSE', '管理 API 返回格式无效')
    if (!payload.ok) throw new AdminApiClientError(payload.error?.code || 'SERVICE_UNAVAILABLE', payload.error?.message || '运营服务暂时不可用', payload.error?.retryable)
    if (!response.ok) throw new AdminApiClientError('HTTP_ERROR', `管理 API 请求失败（${response.status}）`, true)
    return payload.data as T
  }

  async uploadImage(file: AdminMediaFile, purpose: AdminMediaPurpose): Promise<AdminMediaUploadResult> {
    if (!this.configured) throw new AdminApiClientError('API_NOT_CONFIGURED', '尚未配置管理 API')
    const prepared = await prepareAdminMediaUpload(file, purpose)
    let response: Response
    try {
      response = await fetchWithTimeout('/api/media/image', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        credentials: 'same-origin',
        body: JSON.stringify(prepared),
      }, MEDIA_UPLOAD_TIMEOUT_MS)
    }
    catch (error) {
      throw connectionError(error, 'UPLOAD_FAILED', '图片上传服务连接失败，请稍后重试')
    }
    let payload: unknown
    try { payload = await response.json() }
    catch { throw new AdminApiClientError('INVALID_RESPONSE', '图片上传服务返回格式无效') }
    if (!isAdminApiResponse(payload)) {
      throw new AdminApiClientError('INVALID_RESPONSE', '图片上传服务返回格式无效')
    }
    if (!payload.ok) {
      throw new AdminApiClientError(
        payload.error?.code || 'UPLOAD_FAILED',
        payload.error?.message || '图片上传失败',
        payload.error?.retryable,
      )
    }
    if (!response.ok) throw new AdminApiClientError('HTTP_ERROR', `图片上传请求失败（${response.status}）`, true)
    try { return parseAdminMediaUploadResult(payload) }
    catch { throw new AdminApiClientError('INVALID_RESPONSE', '图片上传服务返回格式无效') }
  }

  async getSession(): Promise<AdminSession> { return this.request<AdminSession>('mip.admin.session') }
}

function validLoginQrCodeDataUrl(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 700_000
    && /^data:image\/(?:png|jpeg);base64,(?:iVBOR|\/9j\/)[A-Za-z0-9+/]*={0,2}$/.test(value)
}

export class AdminApiClientError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'AdminApiClientError'
    this.code = code
    this.retryable = retryable
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  }
  finally {
    globalThis.clearTimeout(timeout)
  }
}

function connectionError(error: unknown, networkCode: string, networkMessage: string) {
  const errorName = error && typeof error === 'object' && 'name' in error
    ? String(error.name)
    : ''
  const timedOut = errorName === 'AbortError' || errorName === 'TimeoutError'
  return new AdminApiClientError(
    timedOut ? 'TIMEOUT' : networkCode,
    timedOut ? '请求超时，请重试' : networkMessage,
    true,
  )
}
