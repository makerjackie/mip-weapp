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

  private async authRequest(path: string): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetchWithTimeout(path, {
        method: 'POST',
        credentials: 'same-origin',
      }, AUTH_REQUEST_TIMEOUT_MS)
    }
    catch (error) {
      throw connectionError(error, 'AUTH_UNAVAILABLE', '网页登录服务连接失败，请稍后重试')
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
        headers: { 'content-type': 'application/json' },
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
