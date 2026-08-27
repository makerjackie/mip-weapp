import type { AdminApiResponse, AdminRequest } from '../src/domain/contracts'

export interface AdminBffEnv {
  MIP_ADMIN_UPSTREAM_URL?: string
  MIP_ADMIN_UPSTREAM_HMAC_SECRET?: string
  MIP_WEB_ALLOWED_APP_IDS?: string
  MIP_WEB_ALLOWED_ORIGIN?: string
  MIP_WEB_IDENTITY_AUTHORIZE_URL?: string
  MIP_WEB_IDENTITY_CLIENT_ID?: string
  MIP_WEB_IDENTITY_CLIENT_SECRET?: string
  MIP_WEB_IDENTITY_EXCHANGE_URL?: string
  MIP_WEB_SESSION_SECRET?: string
}

interface SessionClaims {
  v: 1
  appId: string
  openId: string
  displayName?: string
  issuedAt: number
  expiresAt: number
}

interface StateClaims {
  v: 1
  state: string
  returnTo: string
  expiresAt: number
}

interface IdentityResponse {
  verified: true
  appId: string
  openId: string
  displayName?: string
}

interface AdminBffDependencies {
  fetch: typeof fetch
  crypto: Crypto
  now: () => number
}

const SESSION_COOKIE = 'mip_admin_session'
const STATE_COOKIE = 'mip_admin_oauth_state'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const STATE_TTL_MS = 10 * 60 * 1000
const MAX_BODY_BYTES = 32 * 1024
const WEB_BFF_TRANSPORT = 'MIP_WEB_BFF_V1'
const ALLOWED_QUERY_ACTIONS = new Set([
  'mip.admin.session',
  'mip.admin.dashboard.overview.get',
  'mip.admin.users.list',
])
const encoder = new TextEncoder()

export function createAdminBff(
  env: AdminBffEnv,
  dependencies: Partial<AdminBffDependencies> = {},
) {
  const deps: AdminBffDependencies = {
    fetch: dependencies.fetch || globalThis.fetch,
    crypto: dependencies.crypto || globalThis.crypto,
    now: dependencies.now || Date.now,
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/auth/login') {
      return startLogin(request, url)
    }
    if (request.method === 'GET' && url.pathname === '/api/auth/callback') {
      return finishLogin(request, url)
    }
    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      return readBrowserSession(request)
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      if (!hasTrustedOrigin(request, env)) return jsonError('FORBIDDEN', '请求来源无效', 403)
      return json({ authenticated: false }, 200, { 'set-cookie': expireCookie(SESSION_COOKIE, request) })
    }
    if (request.method === 'POST' && url.pathname === '/api/admin') {
      return forwardAdminQuery(request)
    }
    return jsonError('NOT_FOUND', '接口不存在', 404)
  }

  async function startLogin(request: Request, url: URL): Promise<Response> {
    const configError = authenticationConfigError(env)
    if (configError) return jsonError('AUTH_NOT_CONFIGURED', configError, 503)
    const returnTo = safeReturnTo(url.searchParams.get('returnTo'))
    const state = randomToken(deps.crypto, 24)
    const claims: StateClaims = { v: 1, state, returnTo, expiresAt: deps.now() + STATE_TTL_MS }
    const sealed = await seal(claims, env.MIP_WEB_SESSION_SECRET!, 'mip-admin-oauth-state-v1', deps.crypto)
    const authorizeUrl = new URL(env.MIP_WEB_IDENTITY_AUTHORIZE_URL!)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('client_id', env.MIP_WEB_IDENTITY_CLIENT_ID!)
    authorizeUrl.searchParams.set('redirect_uri', callbackUrl(request))
    authorizeUrl.searchParams.set('state', state)
    return new Response(null, {
      status: 302,
      headers: {
        location: authorizeUrl.toString(),
        'cache-control': 'no-store',
        'set-cookie': cookie(STATE_COOKIE, sealed, request, Math.floor(STATE_TTL_MS / 1000)),
      },
    })
  }

  async function finishLogin(request: Request, url: URL): Promise<Response> {
    const configError = authenticationConfigError(env)
    if (configError) return jsonError('AUTH_NOT_CONFIGURED', configError, 503)
    const code = url.searchParams.get('code') || ''
    const state = url.searchParams.get('state') || ''
    const sealedState = readCookie(request, STATE_COOKIE)
    const claims = sealedState
      ? await unseal<StateClaims>(sealedState, env.MIP_WEB_SESSION_SECRET!, 'mip-admin-oauth-state-v1', deps.crypto)
      : null
    if (!code || !state || !claims || claims.v !== 1 || claims.state !== state || claims.expiresAt < deps.now()) {
      return jsonError('AUTH_FAILED', '登录状态无效或已过期', 401, {
        'set-cookie': expireCookie(STATE_COOKIE, request),
      })
    }

    let response: Response
    try {
      response = await deps.fetch(env.MIP_WEB_IDENTITY_EXCHANGE_URL!, {
        method: 'POST',
        headers: {
          authorization: `Basic ${base64Bytes(encoder.encode(`${env.MIP_WEB_IDENTITY_CLIENT_ID}:${env.MIP_WEB_IDENTITY_CLIENT_SECRET}`))}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ code, redirectUri: callbackUrl(request) }),
        signal: AbortSignal.timeout(8_000),
      })
    }
    catch {
      return jsonError('AUTH_UNAVAILABLE', '登录服务暂时不可用', 503)
    }
    const identity = await safeJson(response)
    if (!response.ok || !validIdentity(identity, env.MIP_WEB_ALLOWED_APP_IDS)) {
      return jsonError('AUTH_FAILED', '登录身份未通过验证', 401)
    }

    const verified = identity as IdentityResponse
    const session: SessionClaims = {
      v: 1,
      appId: verified.appId,
      openId: verified.openId,
      ...(verified.displayName ? { displayName: verified.displayName.slice(0, 80) } : {}),
      issuedAt: deps.now(),
      expiresAt: deps.now() + SESSION_TTL_MS,
    }
    const sealedSession = await seal(session, env.MIP_WEB_SESSION_SECRET!, 'mip-admin-session-v1', deps.crypto)
    const headers = new Headers({
      location: new URL(claims.returnTo, request.url).toString(),
      'cache-control': 'no-store',
    })
    headers.append('set-cookie', cookie(SESSION_COOKIE, sealedSession, request, Math.floor(SESSION_TTL_MS / 1000)))
    headers.append('set-cookie', expireCookie(STATE_COOKIE, request))
    return new Response(null, { status: 302, headers })
  }

  async function readBrowserSession(request: Request): Promise<Response> {
    const session = await sessionFromRequest(request)
    if (!session) return json({ authenticated: false }, 200)
    return json({
      authenticated: true,
      actor: session.displayName ? { name: session.displayName } : {},
      expiresAt: new Date(session.expiresAt).toISOString(),
    }, 200)
  }

  async function forwardAdminQuery(request: Request): Promise<Response> {
    if (!hasTrustedOrigin(request, env)) return adminError('FORBIDDEN', '请求来源无效', 403)
    const configError = upstreamConfigError(env)
    if (configError) return adminError('SERVICE_UNAVAILABLE', configError, 503, true)
    const session = await sessionFromRequest(request)
    if (!session) return adminError('AUTH_REQUIRED', '请登录后继续', 401)
    const adminRequest = await readAdminRequest(request)
    if (!adminRequest) return adminError('VALIDATION_FAILED', '运营请求格式无效', 400)
    if (!ALLOWED_QUERY_ACTIONS.has(adminRequest.action)) {
      return adminError('FORBIDDEN', 'Web 管理端当前仅开放只读操作', 403)
    }

    const unsigned = {
      transport: WEB_BFF_TRANSPORT,
      timestamp: deps.now(),
      nonce: randomToken(deps.crypto, 24),
      principal: { appId: session.appId, openId: session.openId },
      request: adminRequest,
    }
    const signature = await hmacHex(env.MIP_ADMIN_UPSTREAM_HMAC_SECRET!, canonicalJson(unsigned), deps.crypto)
    let upstream: Response
    try {
      upstream = await deps.fetch(env.MIP_ADMIN_UPSTREAM_URL!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...unsigned, signature }),
        signal: AbortSignal.timeout(10_000),
      })
    }
    catch {
      return adminError('SERVICE_UNAVAILABLE', '运营服务暂时不可用', 503, true)
    }
    const payload = await safeJson(upstream)
    if (!isAdminResponse(payload)) {
      return adminError('SERVICE_UNAVAILABLE', '运营服务返回格式无效', 502, true)
    }
    return json(payload, upstream.ok ? 200 : upstream.status, { 'cache-control': 'no-store' })
  }

  async function sessionFromRequest(request: Request) {
    const value = readCookie(request, SESSION_COOKIE)
    if (!value || typeof env.MIP_WEB_SESSION_SECRET !== 'string') return null
    const claims = await unseal<SessionClaims>(value, env.MIP_WEB_SESSION_SECRET, 'mip-admin-session-v1', deps.crypto)
    if (!claims
      || claims.v !== 1
      || claims.expiresAt < deps.now()
      || !identifier(claims.appId, 64)
      || !identifier(claims.openId, 128)) return null
    return claims
  }

  return Object.freeze({ handle })
}

async function readAdminRequest(request: Request): Promise<AdminRequest | null> {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_BODY_BYTES) return null
  const body = await request.text()
  if (encoder.encode(body).byteLength > MAX_BODY_BYTES) return null
  let value: unknown
  try { value = JSON.parse(body) } catch { return null }
  if (!plainRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.some(key => !['action', 'contractVersion', 'idempotencyKey', 'input'].includes(key))) return null
  if (value.contractVersion !== 1 || typeof value.action !== 'string' || !plainRecord(value.input)) return null
  if ('idempotencyKey' in value && typeof value.idempotencyKey !== 'string') return null
  return value as unknown as AdminRequest
}

function hasTrustedOrigin(request: Request, env: AdminBffEnv) {
  const expected = env.MIP_WEB_ALLOWED_ORIGIN || new URL(request.url).origin
  return request.headers.get('origin') === expected
}

function authenticationConfigError(env: AdminBffEnv) {
  if (!validSecret(env.MIP_WEB_SESSION_SECRET)) return 'Web 会话服务尚未配置'
  if (!absoluteHttpsUrl(env.MIP_WEB_IDENTITY_AUTHORIZE_URL)
    || !absoluteHttpsUrl(env.MIP_WEB_IDENTITY_EXCHANGE_URL)
    || !env.MIP_WEB_IDENTITY_CLIENT_ID
    || !env.MIP_WEB_IDENTITY_CLIENT_SECRET
    || allowedAppIds(env.MIP_WEB_ALLOWED_APP_IDS).size === 0) {
    return 'Web 登录服务尚未配置'
  }
  return ''
}

function upstreamConfigError(env: AdminBffEnv) {
  if (!validSecret(env.MIP_WEB_SESSION_SECRET)
    || !validSecret(env.MIP_ADMIN_UPSTREAM_HMAC_SECRET)
    || !absoluteHttpsUrl(env.MIP_ADMIN_UPSTREAM_URL)) {
    return '运营数据服务尚未配置'
  }
  return ''
}

function validIdentity(value: unknown, allowlist: string | undefined): value is IdentityResponse {
  if (!plainRecord(value)
    || value.verified !== true
    || !identifier(value.appId, 64)
    || !identifier(value.openId, 128)
    || (value.displayName !== undefined && typeof value.displayName !== 'string')) return false
  return allowedAppIds(allowlist).has(value.appId)
}

function allowedAppIds(value: string | undefined) {
  return new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean))
}

function identifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9_-]+$/.test(value)
}

function validSecret(value: string | undefined) {
  return typeof value === 'string' && value.length >= 32
}

function absoluteHttpsUrl(value: string | undefined) {
  try { return Boolean(value && new URL(value).protocol === 'https:') } catch { return false }
}

function safeReturnTo(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function callbackUrl(request: Request) {
  return new URL('/api/auth/callback', request.url).toString()
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isAdminResponse(value: unknown): value is AdminApiResponse<unknown> {
  return plainRecord(value)
    && typeof value.ok === 'boolean'
    && (value.ok || plainRecord(value.error))
}

async function safeJson(response: Response): Promise<unknown> {
  try { return await response.json() } catch { return null }
}

async function seal(value: object, secret: string, purpose: string, cryptoApi: Crypto) {
  const key = await aesKey(secret, cryptoApi)
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(purpose) },
    key,
    encoder.encode(JSON.stringify(value)),
  )
  return `${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`
}

async function unseal<T>(value: string, secret: string, purpose: string, cryptoApi: Crypto): Promise<T | null> {
  try {
    const [ivValue, ciphertextValue, extra] = value.split('.')
    if (!ivValue || !ciphertextValue || extra) return null
    const key = await aesKey(secret, cryptoApi)
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(ivValue), additionalData: encoder.encode(purpose) },
      key,
      fromBase64Url(ciphertextValue),
    )
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  }
  catch { return null }
}

async function aesKey(secret: string, cryptoApi: Crypto) {
  const digest = await cryptoApi.subtle.digest('SHA-256', encoder.encode(secret))
  return cryptoApi.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function hmacHex(secret: string, value: string, cryptoApi: Crypto) {
  const key = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await cryptoApi.subtle.sign('HMAC', key, encoder.encode(value))
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (plainRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function randomToken(cryptoApi: Crypto, length: number) {
  return base64Url(cryptoApi.getRandomValues(new Uint8Array(length)))
}

function base64Url(value: Uint8Array) {
  return base64Bytes(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function base64Bytes(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
}

function readCookie(request: Request, name: string) {
  const prefix = `${name}=`
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const value = part.trim()
    if (value.startsWith(prefix)) return value.slice(prefix.length)
  }
  return ''
}

function cookie(name: string, value: string, request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${name}=${value}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

function expireCookie(name: string, request: Request) {
  return cookie(name, '', request, 0)
}

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

function jsonError(code: string, message: string, status: number, headers: HeadersInit = {}) {
  return json({ error: { code, message } }, status, headers)
}

function adminError(code: string, message: string, status: number, retryable = false) {
  return json({ ok: false, error: { code, message, retryable } }, status)
}
