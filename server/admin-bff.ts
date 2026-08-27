import type { AdminApiResponse, AdminRequest } from '../src/domain/contracts'

interface D1RunResult {
  success: boolean
  meta?: { changes?: number }
}

interface D1Statement {
  bind: (...values: unknown[]) => D1Statement
  first: <T>() => Promise<T | null>
  run: () => Promise<D1RunResult>
}

export interface D1DatabaseBinding {
  prepare: (query: string) => D1Statement
}

export interface AdminBffEnv {
  MIP_ADMIN_AUTH_DB?: D1DatabaseBinding
  MIP_ADMIN_UPSTREAM_URL?: string
  MIP_ADMIN_UPSTREAM_HMAC_SECRET?: string
  MIP_ADMIN_WEB_LOGIN_HMAC_SECRET?: string
  MIP_WEB_ALLOWED_APP_IDS?: string
  MIP_WEB_ALLOWED_ORIGIN?: string
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

interface ChallengeCookieClaims {
  v: 1
  id: string
  browserKey: string
  expiresAt: number
}

interface ChallengeRow {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'CONSUMED'
  app_id: string | null
  open_id: string | null
  display_name: string | null
  expires_at: number
}

interface AdminBffDependencies {
  fetch: typeof fetch
  crypto: Crypto
  now: () => number
}

const SESSION_COOKIE = 'mip_admin_session'
const CHALLENGE_COOKIE = 'mip_admin_login_challenge'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_BODY_BYTES = 32 * 1024
const WEB_BFF_TRANSPORT = 'MIP_WEB_BFF_V1'
const WEB_LOGIN_CONFIRM_TRANSPORT = 'MIP_WEB_LOGIN_CONFIRM_V1'
const WEB_LOGIN_MAX_CLOCK_SKEW_MS = 60_000
const CHALLENGE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ALLOWED_QUERY_ACTIONS = new Set([
  'mip.admin.session',
  'mip.admin.dashboard.overview.get',
  'mip.admin.users.list',
  'mip.admin.users.get',
  'mip.admin.users.influence.list',
  'mip.admin.events.list',
  'mip.admin.events.get',
  'mip.admin.events.insights.get',
  'mip.admin.events.roster',
  'mip.admin.events.rosterAll',
  'mip.admin.events.policy.get',
  'mip.admin.orders.list',
  'mip.admin.orders.get',
  'mip.admin.paymentAttempts.list',
  'mip.admin.memberships.get',
  'mip.admin.memberships.timeline',
  'mip.admin.benefits.ledger',
  'mip.admin.branches.list',
  'mip.admin.roles.list',
  'mip.admin.roles.candidates',
  'mip.admin.rolePolicies.list',
  'mip.admin.audit.list',
  'mip.admin.messageCampaigns.list',
  'mip.admin.messageCampaigns.get',
  'mip.admin.messageCampaigns.recipients',
  'mip.admin.messageTemplates.list',
  'mip.admin.messageTemplates.get',
  'mip.admin.messageDeliveryReviews.list',
  'mip.admin.messageDeliveryReviews.get',
  'mip.admin.messageDeliveryRecords.list',
  'mip.admin.knowledge.list',
  'mip.admin.knowledge.get',
  'mip.admin.knowledge.schedules.list',
])
const encoder = new TextEncoder()

export function createAdminBff(
  env: AdminBffEnv,
  dependencies: Partial<AdminBffDependencies> = {},
) {
  const fetchImpl = dependencies.fetch
  const deps: AdminBffDependencies = {
    fetch: (input, init) => fetchImpl ? fetchImpl(input, init) : globalThis.fetch(input, init),
    crypto: dependencies.crypto || globalThis.crypto,
    now: dependencies.now || Date.now,
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/api/auth/challenge') {
      return createLoginChallenge(request)
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/challenge/status') {
      return exchangeConfirmedChallenge(request)
    }
    if (request.method === 'POST' && url.pathname === '/api/internal/auth/challenge/confirm') {
      return confirmLoginChallenge(request)
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

  async function createLoginChallenge(request: Request): Promise<Response> {
    if (!hasTrustedOrigin(request, env)) return jsonError('FORBIDDEN', '请求来源无效', 403)
    const configError = challengeConfigError(env)
    if (configError) return jsonError('AUTH_NOT_CONFIGURED', configError, 503)

    const createdAt = deps.now()
    const expiresAt = createdAt + CHALLENGE_TTL_MS
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = randomToken(deps.crypto, 24)
      const browserKey = randomToken(deps.crypto, 24)
      const code = randomChallengeCode(deps.crypto)
      const codeHash = await hmacHex(env.MIP_WEB_SESSION_SECRET!, `code\0${code}`, deps.crypto)
      const browserKeyHash = await hmacHex(env.MIP_WEB_SESSION_SECRET!, `browser\0${browserKey}`, deps.crypto)
      try {
        const result = await env.MIP_ADMIN_AUTH_DB!.prepare(
          `INSERT INTO mip_admin_web_login_challenges
            (id, code_hash, browser_key_hash, status, created_at, expires_at)
           VALUES (?1, ?2, ?3, 'PENDING', ?4, ?5)`,
        ).bind(id, codeHash, browserKeyHash, createdAt, expiresAt).run()
        if (!result.success) continue
      }
      catch {
        continue
      }

      const claims: ChallengeCookieClaims = { v: 1, id, browserKey, expiresAt }
      const sealed = await seal(claims, env.MIP_WEB_SESSION_SECRET!, 'mip-admin-login-challenge-v1', deps.crypto)
      return json({
        state: 'PENDING',
        code,
        expiresAt: new Date(expiresAt).toISOString(),
        pollAfterMs: 1_500,
      }, 201, {
        'set-cookie': cookie(CHALLENGE_COOKIE, sealed, request, Math.floor(CHALLENGE_TTL_MS / 1000)),
      })
    }
    return jsonError('AUTH_UNAVAILABLE', '网页登录服务暂时不可用', 503)
  }

  async function exchangeConfirmedChallenge(request: Request): Promise<Response> {
    if (!hasTrustedOrigin(request, env)) return jsonError('FORBIDDEN', '请求来源无效', 403)
    const configError = challengeConfigError(env)
    if (configError) return jsonError('AUTH_NOT_CONFIGURED', configError, 503)
    const value = readCookie(request, CHALLENGE_COOKIE)
    const claims = value
      ? await unseal<ChallengeCookieClaims>(value, env.MIP_WEB_SESSION_SECRET!, 'mip-admin-login-challenge-v1', deps.crypto)
      : null
    if (!claims || claims.v !== 1 || claims.expiresAt < deps.now() || !identifier(claims.id, 128)) {
      return challengeExpired(request)
    }
    const browserKeyHash = await hmacHex(env.MIP_WEB_SESSION_SECRET!, `browser\0${claims.browserKey}`, deps.crypto)
    const row = await env.MIP_ADMIN_AUTH_DB!.prepare(
      `SELECT id, status, app_id, open_id, display_name, expires_at
         FROM mip_admin_web_login_challenges
        WHERE id = ?1 AND browser_key_hash = ?2`,
    ).bind(claims.id, browserKeyHash).first<ChallengeRow>()
    if (!row || row.expires_at < deps.now()) return challengeExpired(request)
    if (row.status === 'PENDING') {
      return json({ state: 'PENDING', expiresAt: new Date(row.expires_at).toISOString(), pollAfterMs: 1_500 })
    }
    if (row.status !== 'CONFIRMED' || !identifier(row.app_id, 64) || !identifier(row.open_id, 128)) {
      return challengeExpired(request)
    }

    const consumed = await env.MIP_ADMIN_AUTH_DB!.prepare(
      `UPDATE mip_admin_web_login_challenges
          SET status = 'CONSUMED', consumed_at = ?1
        WHERE id = ?2 AND browser_key_hash = ?3 AND status = 'CONFIRMED' AND consumed_at IS NULL`,
    ).bind(deps.now(), claims.id, browserKeyHash).run()
    if (!consumed.success || Number(consumed.meta?.changes || 0) !== 1) return challengeExpired(request)

    const session: SessionClaims = {
      v: 1,
      appId: row.app_id,
      openId: row.open_id,
      ...(row.display_name ? { displayName: row.display_name.slice(0, 80) } : {}),
      issuedAt: deps.now(),
      expiresAt: deps.now() + SESSION_TTL_MS,
    }
    const sealed = await seal(session, env.MIP_WEB_SESSION_SECRET!, 'mip-admin-session-v1', deps.crypto)
    const headers = new Headers({ 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
    headers.append('set-cookie', cookie(SESSION_COOKIE, sealed, request, Math.floor(SESSION_TTL_MS / 1000)))
    headers.append('set-cookie', expireCookie(CHALLENGE_COOKIE, request))
    return new Response(JSON.stringify({
      state: 'AUTHENTICATED',
      actor: row.display_name ? { name: row.display_name } : {},
      expiresAt: new Date(session.expiresAt).toISOString(),
    }), { status: 200, headers })
  }

  async function confirmLoginChallenge(request: Request): Promise<Response> {
    const configError = challengeConfigError(env)
    if (configError) return jsonError('AUTH_NOT_CONFIGURED', configError, 503)
    const envelope = await readJsonRecord(request)
    if (!envelope || !await verifyLoginConfirmation(envelope, env, deps)) {
      return jsonError('AUTH_REQUIRED', '确认请求未通过验证', 401)
    }
    const principal = envelope.principal as Record<string, unknown>
    const code = String(envelope.challengeCode)
    const codeHash = await hmacHex(env.MIP_WEB_SESSION_SECRET!, `code\0${code}`, deps.crypto)
    const confirmed = await env.MIP_ADMIN_AUTH_DB!.prepare(
      `UPDATE mip_admin_web_login_challenges
          SET status = 'CONFIRMED', app_id = ?1, open_id = ?2, display_name = ?3, confirmed_at = ?4
        WHERE code_hash = ?5 AND status = 'PENDING' AND expires_at >= ?4`,
    ).bind(
      principal.appId,
      principal.openId,
      typeof principal.displayName === 'string' ? principal.displayName.slice(0, 80) : null,
      deps.now(),
      codeHash,
    ).run()
    if (!confirmed.success || Number(confirmed.meta?.changes || 0) !== 1) {
      return jsonError('CHALLENGE_NOT_FOUND', '登录码无效或已过期', 404)
    }
    return json({ confirmed: true }, 200)
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
    catch (error) {
      console.error('[mip-admin-bff] upstream fetch failed', error instanceof Error ? error.message : 'unknown error')
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

async function verifyLoginConfirmation(
  value: Record<string, unknown>,
  env: AdminBffEnv,
  deps: AdminBffDependencies,
) {
  const allowedKeys = new Set(['transport', 'timestamp', 'nonce', 'challengeCode', 'principal', 'signature'])
  if (!hasExactKeys(value, allowedKeys)
    || value.transport !== WEB_LOGIN_CONFIRM_TRANSPORT
    || !Number.isSafeInteger(value.timestamp)
    || Math.abs(deps.now() - Number(value.timestamp)) > WEB_LOGIN_MAX_CLOCK_SKEW_MS
    || typeof value.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{24,128}$/.test(value.nonce)
    || typeof value.challengeCode !== 'string'
    || !/^[A-HJ-NP-Z2-9]{8}$/.test(value.challengeCode)
    || typeof value.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.signature)
    || !plainRecord(value.principal)) return false
  const principalKeys = Object.keys(value.principal)
  if (principalKeys.some(key => !['appId', 'openId', 'displayName'].includes(key))
    || !identifier(value.principal.appId, 64)
    || !identifier(value.principal.openId, 128)
    || (value.principal.displayName !== undefined
      && (typeof value.principal.displayName !== 'string' || value.principal.displayName.length > 80))
    || !allowedAppIds(env.MIP_WEB_ALLOWED_APP_IDS).has(value.principal.appId)) return false
  const { signature, ...unsigned } = value
  const expected = await hmacHex(env.MIP_ADMIN_WEB_LOGIN_HMAC_SECRET!, canonicalJson(unsigned), deps.crypto)
  return constantTimeHexEqual(signature, expected)
}

async function readAdminRequest(request: Request): Promise<AdminRequest | null> {
  const value = await readJsonRecord(request)
  if (!value) return null
  const keys = Object.keys(value)
  if (keys.some(key => !['action', 'contractVersion', 'idempotencyKey', 'input'].includes(key))) return null
  if (value.contractVersion !== 1 || typeof value.action !== 'string' || !plainRecord(value.input)) return null
  if ('idempotencyKey' in value && typeof value.idempotencyKey !== 'string') return null
  return value as unknown as AdminRequest
}

async function readJsonRecord(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_BODY_BYTES) return null
  const body = await request.text()
  if (encoder.encode(body).byteLength > MAX_BODY_BYTES) return null
  try {
    const value: unknown = JSON.parse(body)
    return plainRecord(value) ? value : null
  }
  catch { return null }
}

function hasTrustedOrigin(request: Request, env: AdminBffEnv) {
  const expected = env.MIP_WEB_ALLOWED_ORIGIN || new URL(request.url).origin
  return request.headers.get('origin') === expected
}

function challengeConfigError(env: AdminBffEnv) {
  if (!env.MIP_ADMIN_AUTH_DB || typeof env.MIP_ADMIN_AUTH_DB.prepare !== 'function') {
    return '网页登录数据库尚未配置'
  }
  if (!validSecret(env.MIP_WEB_SESSION_SECRET) || !validSecret(env.MIP_ADMIN_WEB_LOGIN_HMAC_SECRET)) {
    return '网页登录服务尚未配置'
  }
  if (allowedAppIds(env.MIP_WEB_ALLOWED_APP_IDS).size === 0) return '网页登录应用范围尚未配置'
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

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, expected: Set<string>) {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every(key => expected.has(key))
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

function constantTimeHexEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function randomToken(cryptoApi: Crypto, length: number) {
  return base64Url(cryptoApi.getRandomValues(new Uint8Array(length)))
}

function randomChallengeCode(cryptoApi: Crypto) {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(8))
  return [...bytes].map(byte => CHALLENGE_ALPHABET[byte % CHALLENGE_ALPHABET.length]).join('')
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

function challengeExpired(request: Request) {
  return jsonError('CHALLENGE_EXPIRED', '登录码无效或已过期', 410, {
    'set-cookie': expireCookie(CHALLENGE_COOKIE, request),
  })
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
