import type { AdminApiResponse, AdminRequest } from '../src/domain/contracts'
import {
  REVIEWED_ADMIN_MUTATION_ACTIONS,
  REVIEWED_ADMIN_MUTATION_SCHEMAS,
  WEB_ADMIN_QUERY_ACTIONS,
} from './admin-mutation-contract.ts'
import {
  ADMIN_MEDIA_UPLOAD_PATH,
  AdminMediaUploadRequestError,
  createAdminMediaUpstreamRequestInit,
  readAdminMediaUploadRequest,
} from './admin-media-upload.ts'

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
  MIP_ADMIN_WEB_LOGIN_QR_HMAC_SECRET?: string
  MIP_WEB_ALLOWED_APP_IDS?: string
  MIP_WEB_LOGIN_MINIPROGRAM_APP_ID?: string
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

interface LoginPrincipalLimitRow {
  failed_attempts: number
  locked_until: number
}

interface LoginIpLimitRow {
  window_started_at: number
  hit_count: number
}

interface VerifiedLoginConfirmation {
  challenge: {
    kind: 'CODE' | 'TOKEN'
    value: string
  }
  principal: {
    appId: string
    openId: string
    displayName?: string
  }
}

interface AdminBffDependencies {
  fetch: typeof fetch
  generateLoginQrCode: (challengeToken: string) => Promise<string>
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
const WEB_LOGIN_QR_TRANSPORT = 'MIP_WEB_LOGIN_QR_V1'
const WEB_LOGIN_MAX_CLOCK_SKEW_MS = 60_000
const MAX_LOGIN_QR_BYTES = 512 * 1024
const LOGIN_QR_UPSTREAM_TIMEOUT_MS = 10_000
const LOGIN_FAILURE_LIMIT = 5
const LOGIN_FAILURE_WINDOW_MS = 5 * 60 * 1000
const LOGIN_LOCK_MS = 5 * 60 * 1000
const LOGIN_CHALLENGE_IP_WINDOW_MS = 10 * 60 * 1000
const LOGIN_CHALLENGE_IP_MAX_PER_WINDOW = 30
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{12,128}$/
const encoder = new TextEncoder()

export function createAdminBff(
  env: AdminBffEnv,
  dependencies: Partial<AdminBffDependencies> = {},
) {
  const fetchImpl = dependencies.fetch
  const deps: AdminBffDependencies = {
    fetch: (input, init) => fetchImpl ? fetchImpl(input, init) : globalThis.fetch(input, init),
    generateLoginQrCode: dependencies.generateLoginQrCode || generateLoginQrCode,
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
    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      if (!hasTrustedOrigin(request, env)) return jsonError('FORBIDDEN', '请求来源无效', 403)
      const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      headers.append('set-cookie', expireCookie(SESSION_COOKIE, request))
      headers.append('set-cookie', expireCookie(CHALLENGE_COOKIE, request))
      return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers })
    }
    if (request.method === 'POST' && url.pathname === ADMIN_MEDIA_UPLOAD_PATH) {
      return forwardAdminMediaImage(request)
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

    let ipHit: LoginIpLimitRow | null = null
    try {
      await env.MIP_ADMIN_AUTH_DB!.prepare(
        'DELETE FROM mip_admin_web_login_ip_limits WHERE window_started_at < ?1',
      ).bind(createdAt - 2 * LOGIN_CHALLENGE_IP_WINDOW_MS).run()
      ipHit = await recordLoginChallengeHit(
        env.MIP_ADMIN_AUTH_DB!,
        await loginIpKey(request, env.MIP_WEB_SESSION_SECRET!, deps.crypto),
        createdAt,
      )
    }
    catch {
      // Missing or unhealthy IP counters must not block a legitimate login.
    }
    if (ipHit
      && ipHit.hit_count > LOGIN_CHALLENGE_IP_MAX_PER_WINDOW
      && ipHit.window_started_at > createdAt - LOGIN_CHALLENGE_IP_WINDOW_MS) {
      return loginRateLimited(ipHit.window_started_at + LOGIN_CHALLENGE_IP_WINDOW_MS, createdAt)
    }

    try {
      await env.MIP_ADMIN_AUTH_DB!.prepare(
        'DELETE FROM mip_admin_web_login_challenges WHERE expires_at < ?1',
      ).bind(createdAt).run()
    }
    catch {
      return jsonError('AUTH_UNAVAILABLE', '网页登录服务暂时不可用', 503)
    }
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
      let qrCodeDataUrl = ''
      try {
        qrCodeDataUrl = await deps.generateLoginQrCode(id)
      }
      catch {
        // The six-digit code remains available when QR generation is unavailable.
      }
      return json({
        state: 'PENDING',
        code,
        ...(qrCodeDataUrl ? { qrCodeDataUrl } : {}),
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
    let row: ChallengeRow | null
    try {
      row = await env.MIP_ADMIN_AUTH_DB!.prepare(
        `SELECT id, status, app_id, open_id, display_name, expires_at
           FROM mip_admin_web_login_challenges
          WHERE id = ?1 AND browser_key_hash = ?2`,
      ).bind(claims.id, browserKeyHash).first<ChallengeRow>()
    }
    catch {
      return jsonError('AUTH_UNAVAILABLE', '网页登录服务暂时不可用', 503)
    }
    if (!row || row.expires_at < deps.now()) return challengeExpired(request)
    if (row.status === 'PENDING') {
      return json({ state: 'PENDING', expiresAt: new Date(row.expires_at).toISOString(), pollAfterMs: 1_500 })
    }
    if (row.status !== 'CONFIRMED' || !identifier(row.app_id, 64) || !identifier(row.open_id, 128)) {
      return challengeExpired(request)
    }

    let consumed: D1RunResult
    try {
      consumed = await env.MIP_ADMIN_AUTH_DB!.prepare(
        `UPDATE mip_admin_web_login_challenges
            SET status = 'CONSUMED', consumed_at = ?1
          WHERE id = ?2 AND browser_key_hash = ?3 AND status = 'CONFIRMED' AND consumed_at IS NULL`,
      ).bind(deps.now(), claims.id, browserKeyHash).run()
    }
    catch {
      return jsonError('AUTH_UNAVAILABLE', '网页登录服务暂时不可用', 503)
    }
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
    if (!envelope) return jsonError('CONFIRMATION_INVALID', '确认请求格式无效', 400)
    const verification = await verifyLoginConfirmation(envelope, env, deps)
    if (verification === 'INVALID') {
      return jsonError('CONFIRMATION_INVALID', '确认请求格式无效', 400)
    }
    if (verification === 'SIGNATURE_INVALID') {
      return jsonError('CONFIRMATION_SIGNATURE_INVALID', '确认请求签名无效', 401)
    }
    const now = deps.now()
    const { challenge, principal } = verification
    const principalKey = await hmacHex(
      env.MIP_WEB_SESSION_SECRET!,
      `principal\0${principal.appId}\0${principal.openId}`,
      deps.crypto,
    )
    let currentLimit: LoginPrincipalLimitRow | null
    try {
      currentLimit = await env.MIP_ADMIN_AUTH_DB!.prepare(
        `SELECT failed_attempts, locked_until
           FROM mip_admin_web_login_principal_limits
          WHERE principal_key = ?1`,
      ).bind(principalKey).first<LoginPrincipalLimitRow>()
    }
    catch {
      return jsonError('AUTH_UNAVAILABLE', '网页登录服务暂时不可用', 503)
    }
    if (currentLimit && currentLimit.locked_until > now) {
      return loginRateLimited(currentLimit.locked_until, now)
    }
    const selector = challenge.kind === 'CODE'
      ? await hmacHex(env.MIP_WEB_SESSION_SECRET!, `code\0${challenge.value}`, deps.crypto)
      : challenge.value
    let confirmed: D1RunResult
    try {
      const confirmationSql = challenge.kind === 'CODE'
        ? `UPDATE mip_admin_web_login_challenges
            SET status = 'CONFIRMED', app_id = ?1, open_id = ?2, display_name = ?3, confirmed_at = ?4
          WHERE code_hash = ?5
            AND status = 'PENDING'
            AND expires_at >= ?4
            AND NOT EXISTS (
              SELECT 1
                FROM mip_admin_web_login_principal_limits
               WHERE principal_key = ?6 AND locked_until > ?4
            )`
        : `UPDATE mip_admin_web_login_challenges
            SET status = 'CONFIRMED', app_id = ?1, open_id = ?2, display_name = ?3, confirmed_at = ?4
          WHERE id = ?5
            AND status = 'PENDING'
            AND expires_at >= ?4
            AND NOT EXISTS (
              SELECT 1
                FROM mip_admin_web_login_principal_limits
               WHERE principal_key = ?6 AND locked_until > ?4
            )`
      confirmed = await env.MIP_ADMIN_AUTH_DB!.prepare(confirmationSql).bind(
        principal.appId,
        principal.openId,
        principal.displayName?.slice(0, 80) || null,
        now,
        selector,
        principalKey,
      ).run()
    }
    catch {
      return jsonError('AUTH_UNAVAILABLE', '网页登录服务暂时不可用', 503)
    }
    if (!confirmed.success || Number(confirmed.meta?.changes || 0) !== 1) {
      let failedLimit: LoginPrincipalLimitRow | null
      try {
        failedLimit = await recordFailedLoginAttempt(env.MIP_ADMIN_AUTH_DB!, principalKey, now)
      }
      catch {
        return jsonError('AUTH_UNAVAILABLE', '网页登录服务暂时不可用', 503)
      }
      if (failedLimit && failedLimit.locked_until > now) {
        return loginRateLimited(failedLimit.locked_until, now)
      }
      return jsonError('CHALLENGE_NOT_FOUND', '登录请求无效或已过期', 404)
    }
    try {
      await env.MIP_ADMIN_AUTH_DB!.prepare(
        'DELETE FROM mip_admin_web_login_principal_limits WHERE principal_key = ?1',
      ).bind(principalKey).run()
    }
    catch {
      // A stale failure counter can only make the next confirmation stricter; login stays single-use.
    }
    return json({ confirmed: true }, 200)
  }

  async function forwardAdminQuery(request: Request): Promise<Response> {
    if (!hasTrustedOrigin(request, env)) return adminError('FORBIDDEN', '请求来源无效', 403)
    const configError = upstreamConfigError(env)
    if (configError) return adminError('SERVICE_UNAVAILABLE', configError, 503, true)
    const session = await sessionFromRequest(request)
    if (!session) return adminError('AUTH_REQUIRED', '请登录后继续', 401)
    const adminRequest = await readAdminRequest(request)
    if (!adminRequest) return adminError('VALIDATION_FAILED', '运营请求格式无效', 400)
    const isQuery = WEB_ADMIN_QUERY_ACTIONS.has(adminRequest.action)
    const isMutation = REVIEWED_ADMIN_MUTATION_ACTIONS.has(adminRequest.action)
    if (!isQuery && !isMutation) {
      return adminError('FORBIDDEN', 'Web 管理端当前未开放该操作', 403)
    }
    if (isQuery && adminRequest.action.startsWith('mip.admin.banners.')
      && !validBannerQueryInput(adminRequest.action, adminRequest.input)) {
      return adminError('VALIDATION_FAILED', '运营请求包含未开放字段', 400)
    }
    if (isQuery && adminRequest.action.startsWith('mip.admin.game.')
      && !validGameQueryInput(adminRequest.action, adminRequest.input)) {
      return adminError('VALIDATION_FAILED', '运营请求包含未开放字段', 400)
    }
    if (isMutation && !validIdempotencyKey(adminRequest.idempotencyKey)) {
      return adminError('IDEMPOTENCY_KEY_REQUIRED', '写操作必须提供有效的业务幂等键', 400)
    }
    if (isMutation && !validMutationInput(adminRequest.action, adminRequest.input)) {
      return adminError('VALIDATION_FAILED', '运营请求包含未开放字段', 400)
    }
    if (adminRequest.action === 'mip.admin.exports.status'
      && !validExportLifecycleInput(adminRequest.input)) {
      return adminError('VALIDATION_FAILED', '运营请求包含未开放字段', 400)
    }

    return forwardTrustedAdminRequest(adminRequest, session, { retryable: isQuery })
  }

  async function generateLoginQrCode(challengeToken: string): Promise<string> {
    const appId = String(env.MIP_WEB_LOGIN_MINIPROGRAM_APP_ID || '').trim()
    if (!absoluteHttpsUrl(env.MIP_ADMIN_UPSTREAM_URL)
      || !validSecret(env.MIP_ADMIN_WEB_LOGIN_QR_HMAC_SECRET)
      || !identifier(appId, 64)
      || !allowedAppIds(env.MIP_WEB_ALLOWED_APP_IDS).has(appId)
      || !/^[A-Za-z0-9_-]{32}$/.test(challengeToken)) return ''
    const unsigned = {
      transport: WEB_LOGIN_QR_TRANSPORT,
      timestamp: deps.now(),
      nonce: randomToken(deps.crypto, 24),
      appId,
      challengeToken,
    }
    const signature = await hmacHex(
      env.MIP_ADMIN_WEB_LOGIN_QR_HMAC_SECRET!,
      canonicalJson(unsigned),
      deps.crypto,
    )
    let upstream: Response
    try {
      upstream = await deps.fetch(env.MIP_ADMIN_UPSTREAM_URL!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...unsigned, signature }),
        signal: AbortSignal.timeout(LOGIN_QR_UPSTREAM_TIMEOUT_MS),
      })
    }
    catch {
      console.error('[mip-admin-bff] login QR upstream fetch failed')
      return ''
    }
    const payload = await safeJson(upstream)
    const validPayload = validLoginQrCodePayload(payload)
    if (!upstream.ok || !validPayload) {
      console.error('[mip-admin-bff] login QR upstream response rejected', {
        status: upstream.status,
        validPayload,
        ...loginQrUpstreamShape(payload),
        ...loginQrUpstreamDiagnostic(payload),
      })
      return ''
    }
    return `data:${payload.data.contentType};base64,${payload.data.imageBase64}`
  }

  async function forwardAdminMediaImage(request: Request): Promise<Response> {
    if (!hasTrustedOrigin(request, env)) return adminError('FORBIDDEN', '请求来源无效', 403)
    const configError = upstreamConfigError(env)
    if (configError) return adminError('SERVICE_UNAVAILABLE', configError, 503)
    const session = await sessionFromRequest(request)
    if (!session) return adminError('AUTH_REQUIRED', '请登录后继续', 401)
    let media
    try {
      media = await readAdminMediaUploadRequest(request)
    }
    catch (error) {
      if (error instanceof AdminMediaUploadRequestError) {
        return adminError(error.code, error.message, error.status)
      }
      return adminError('VALIDATION_FAILED', '媒体上传请求无效', 400)
    }
    const adminRequest: AdminRequest = {
      contractVersion: 1,
      action: media.request.action,
      input: media.request.input,
      idempotencyKey: `web-media-${randomToken(deps.crypto, 24)}`,
    }
    return forwardTrustedAdminRequest(adminRequest, session, { media: true, retryable: false })
  }

  async function forwardTrustedAdminRequest(
    adminRequest: AdminRequest,
    session: SessionClaims,
    options: { media?: boolean; retryable: boolean },
  ): Promise<Response> {
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
      const init: RequestInit = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...unsigned, signature }),
      }
      upstream = await deps.fetch(
        env.MIP_ADMIN_UPSTREAM_URL!,
        options.media
          ? createAdminMediaUpstreamRequestInit(init)
          : { ...init, signal: AbortSignal.timeout(10_000) },
      )
    }
    catch (error) {
      console.error('[mip-admin-bff] upstream fetch failed', error instanceof Error ? error.message : 'unknown error')
      return adminError('SERVICE_UNAVAILABLE', '运营服务暂时不可用', 503, options.retryable)
    }
    const payload = await safeJson(upstream)
    if (!isAdminResponse(payload)) {
      return adminError('SERVICE_UNAVAILABLE', '运营服务返回格式无效', 502, options.retryable)
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
): Promise<VerifiedLoginConfirmation | 'INVALID' | 'SIGNATURE_INVALID'> {
  const sharedKeys = ['transport', 'timestamp', 'nonce', 'principal', 'signature']
  const keys = Object.keys(value)
  const hasCode = Object.hasOwn(value, 'challengeCode')
  const hasToken = Object.hasOwn(value, 'challengeToken')
  if (keys.length !== sharedKeys.length + 1
    || !sharedKeys.every(key => Object.hasOwn(value, key))
    || hasCode === hasToken
    || value.transport !== WEB_LOGIN_CONFIRM_TRANSPORT
    || !Number.isSafeInteger(value.timestamp)
    || Math.abs(deps.now() - Number(value.timestamp)) > WEB_LOGIN_MAX_CLOCK_SKEW_MS
    || typeof value.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{24,128}$/.test(value.nonce)
    || (hasCode && (typeof value.challengeCode !== 'string' || !/^\d{6}$/.test(value.challengeCode)))
    || (hasToken && (typeof value.challengeToken !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(value.challengeToken)))
    || !plainRecord(value.principal)) return 'INVALID'
  const principalKeys = Object.keys(value.principal)
  if (principalKeys.some(key => !['appId', 'openId', 'displayName'].includes(key))
    || !identifier(value.principal.appId, 64)
    || !identifier(value.principal.openId, 128)
    || (value.principal.displayName !== undefined
      && (typeof value.principal.displayName !== 'string' || value.principal.displayName.length > 80))
    || !allowedAppIds(env.MIP_WEB_ALLOWED_APP_IDS).has(value.principal.appId)) return 'INVALID'
  if (typeof value.signature !== 'string' || !/^[a-f0-9]{64}$/.test(value.signature)) {
    return 'SIGNATURE_INVALID'
  }
  const { signature, ...unsigned } = value
  const expected = await hmacHex(env.MIP_ADMIN_WEB_LOGIN_HMAC_SECRET!, canonicalJson(unsigned), deps.crypto)
  if (!constantTimeHexEqual(signature, expected)) return 'SIGNATURE_INVALID'
  return {
    challenge: hasCode
      ? { kind: 'CODE', value: value.challengeCode as string }
      : { kind: 'TOKEN', value: value.challengeToken as string },
    principal: {
      appId: value.principal.appId,
      openId: value.principal.openId,
      ...(value.principal.displayName ? { displayName: value.principal.displayName } : {}),
    },
  }
}

function validLoginQrCodePayload(value: unknown): value is {
  ok: true
  data: { contentType: 'image/png' | 'image/jpeg'; imageBase64: string }
} {
  if (!plainRecord(value) || value.ok !== true || !plainRecord(value.data)
    || !['image/png', 'image/jpeg'].includes(String(value.data.contentType || ''))
    || typeof value.data.imageBase64 !== 'string'
    || value.data.imageBase64.length < 4
    || value.data.imageBase64.length > Math.ceil(MAX_LOGIN_QR_BYTES / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data.imageBase64)) return false
  const decoded = decodeBase64(value.data.imageBase64)
  if (!decoded || decoded.byteLength > MAX_LOGIN_QR_BYTES) return false
  const png = decoded.byteLength >= 8
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((byte, index) => decoded[index] === byte)
  const jpeg = decoded.byteLength >= 3
    && decoded[0] === 0xff && decoded[1] === 0xd8 && decoded[2] === 0xff
  if ((value.data.contentType === 'image/png' && !png)
    || (value.data.contentType === 'image/jpeg' && !jpeg)) return false
  return Object.keys(value).length === 2
    && Object.keys(value.data).length === 2
}

function loginQrUpstreamDiagnostic(value: unknown) {
  if (!plainRecord(value) || !plainRecord(value.error)) return {}
  const diagnostic = plainRecord(value.error.diagnostic) ? value.error.diagnostic : null
  return {
    upstreamCode: safeDiagnosticLabel(value.error.code),
    ...(diagnostic ? {
      providerCode: safeDiagnosticLabel(diagnostic.code),
      providerReason: safeDiagnosticLabel(diagnostic.reason, 160),
    } : {}),
  }
}

function loginQrUpstreamShape(value: unknown) {
  if (!plainRecord(value)) {
    return { payloadType: Array.isArray(value) ? 'array' : typeof value }
  }
  const data = plainRecord(value.data) ? value.data : null
  return {
    payloadKeys: Object.keys(value).slice(0, 8).map(key => safeDiagnosticLabel(key)).join(','),
    ...(data ? {
      dataKeys: Object.keys(data).slice(0, 8).map(key => safeDiagnosticLabel(key)).join(','),
      contentType: safeDiagnosticLabel(data.contentType),
      imageBase64Length: typeof data.imageBase64 === 'string' ? data.imageBase64.length : 0,
    } : {}),
  }
}

function safeDiagnosticLabel(value: unknown, maximum = 64) {
  if (!['string', 'number'].includes(typeof value)) return ''
  return String(value).replace(/[^A-Za-z0-9_.: -]/g, '').trim().slice(0, maximum)
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const decoded = atob(value)
    return Uint8Array.from(decoded, character => character.charCodeAt(0))
  }
  catch {
    return null
  }
}

async function loginIpKey(request: Request, secret: string, cryptoApi: Crypto) {
  const ip = request.headers.get('cf-connecting-ip')?.trim() || ''
  const normalized = ip.length > 0 && ip.length <= 128 ? ip : 'unknown'
  return hmacHex(secret, `ip\0${normalized}`, cryptoApi)
}

async function recordLoginChallengeHit(
  database: D1DatabaseBinding,
  ipKey: string,
  now: number,
) {
  return database.prepare(
    `INSERT INTO mip_admin_web_login_ip_limits
      (ip_key, window_started_at, hit_count)
     VALUES (?1, ?2, 1)
     ON CONFLICT(ip_key) DO UPDATE SET
       hit_count = CASE
         WHEN window_started_at <= ?3 THEN 1
         ELSE hit_count + 1
       END,
       window_started_at = CASE
         WHEN window_started_at <= ?3 THEN ?2
         ELSE window_started_at
       END
     RETURNING window_started_at, hit_count`,
  ).bind(ipKey, now, now - LOGIN_CHALLENGE_IP_WINDOW_MS).first<LoginIpLimitRow>()
}

async function recordFailedLoginAttempt(
  database: D1DatabaseBinding,
  principalKey: string,
  now: number,
) {
  return database.prepare(
    `INSERT INTO mip_admin_web_login_principal_limits
      (principal_key, failed_attempts, window_started_at, locked_until, updated_at)
     VALUES (?1, 1, ?2, 0, ?2)
     ON CONFLICT(principal_key) DO UPDATE SET
       failed_attempts = CASE
         WHEN locked_until > ?2 THEN failed_attempts
         WHEN window_started_at <= ?3 THEN 1
         ELSE failed_attempts + 1
       END,
       window_started_at = CASE
         WHEN locked_until > ?2 THEN window_started_at
         WHEN window_started_at <= ?3 THEN ?2
         ELSE window_started_at
       END,
       locked_until = CASE
         WHEN locked_until > ?2 THEN locked_until
         WHEN (CASE WHEN window_started_at <= ?3 THEN 1 ELSE failed_attempts + 1 END) >= ?4 THEN ?5
         ELSE 0
       END,
       updated_at = ?2
     RETURNING failed_attempts, locked_until`,
  ).bind(
    principalKey,
    now,
    now - LOGIN_FAILURE_WINDOW_MS,
    LOGIN_FAILURE_LIMIT,
    now + LOGIN_LOCK_MS,
  ).first<LoginPrincipalLimitRow>()
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

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value)
}

function validMutationInput(action: string, input: AdminRequest['input']) {
  const schema = REVIEWED_ADMIN_MUTATION_SCHEMAS.get(action)
  if (!schema) return false
  const allowed = new Set([...schema.required, ...schema.optional])
  const keys = Object.keys(input)
  const hasSchema = keys.every(key => allowed.has(key))
    && [...schema.required].every(key => Object.hasOwn(input, key))
  if (!hasSchema) return false
  if (action === 'mip.admin.exports.create') return validExportCreateInput(input)
  if (['mip.admin.exports.prepare', 'mip.admin.exports.reserve', 'mip.admin.exports.complete'].includes(action)) {
    return validExportLifecycleInput(input)
  }
  if (action.startsWith('mip.admin.banners.')) return validBannerMutationInput(action, input)
  if (action.startsWith('mip.admin.game.')) return validGameMutationInput(action, input)
  return true
}

const GAME_RANKING_TYPES = ['TEAM_HALF_YEAR', 'TEAM_YEAR', 'INDIVIDUAL_SEASON', 'INDIVIDUAL_ALL_TIME']
const GAME_RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY']

function validGameQueryInput(action: string, input: AdminRequest['input']) {
  if (['mip.admin.game.session', 'mip.admin.game.seasons.list', 'mip.admin.game.blindBoxes.catalogs.list'].includes(action)) {
    return Object.keys(input).length === 0
  }
  if (action === 'mip.admin.game.rankings.list') {
    return hasRequiredAllowedKeys(input, ['seasonId', 'rankingType'], ['branchId', 'limit'])
      && uuid(input.seasonId)
      && GAME_RANKING_TYPES.includes(String(input.rankingType || ''))
      && (!Object.hasOwn(input, 'branchId') || uuid(input.branchId))
      && (!Object.hasOwn(input, 'limit') || boundedInteger(input.limit, 1, 100))
  }
  if (['mip.admin.game.teams.list', 'mip.admin.game.matches.list'].includes(action)) {
    return hasExactKeys(input, new Set(['seasonId'])) && uuid(input.seasonId)
  }
  if (action === 'mip.admin.game.members.assignable.list') {
    return hasRequiredAllowedKeys(input, ['seasonId', 'teamId', 'limit'], ['query', 'cursor'])
      && uuid(input.seasonId)
      && uuid(input.teamId)
      && (!Object.hasOwn(input, 'query') || (typeof input.query === 'string' && input.query.length <= 80))
      && boundedInteger(input.limit, 1, 100)
      && (!Object.hasOwn(input, 'cursor') || opaqueCursor(input.cursor))
  }
  return action === 'mip.admin.game.blindBoxes.cards.list'
    && hasExactKeys(input, new Set(['catalogId']))
    && uuid(input.catalogId)
}

function validGameMutationInput(action: string, input: AdminRequest['input']) {
  if (action === 'mip.admin.game.seasons.save') return validSeasonSaveInput(input)
  if (action === 'mip.admin.game.seasons.changeStatus') {
    return uuid(input.seasonId) && positiveVersion(input.expectedVersion)
      && ['ACTIVE', 'CLOSED'].includes(String(input.status || ''))
  }
  if (action === 'mip.admin.game.teams.save') return validTeamSaveInput(input)
  if (action === 'mip.admin.game.teams.changeStatus') {
    return uuid(input.seasonId) && uuid(input.teamId) && positiveVersion(input.expectedVersion)
      && ['ACTIVE', 'INACTIVE'].includes(String(input.status || ''))
  }
  if (action === 'mip.admin.game.teams.members.replace') return validTeamMembersInput(input)
  if (action === 'mip.admin.game.matches.save') return validMatchInput(input.match)
  if (action === 'mip.admin.game.matches.finalize') {
    return uuid(input.matchId) && positiveVersion(input.expectedVersion)
  }
  if (action === 'mip.admin.game.rankings.generate') {
    return uuid(input.seasonId) && GAME_RANKING_TYPES.includes(String(input.rankingType || ''))
  }
  if (action === 'mip.admin.game.blindBoxes.catalogs.save') return validCatalogSaveInput(input)
  if (action === 'mip.admin.game.blindBoxes.catalogs.changeStatus') {
    return uuid(input.catalogId) && positiveVersion(input.expectedVersion)
      && ['PUBLISHED', 'UNPUBLISHED'].includes(String(input.status || ''))
  }
  if (action === 'mip.admin.game.blindBoxes.cards.save') return validCardSaveInput(input)
  return action === 'mip.admin.game.blindBoxes.cards.changeStatus'
    && uuid(input.cardId)
    && positiveVersion(input.expectedVersion)
    && ['PUBLISHED', 'UNPUBLISHED'].includes(String(input.status || ''))
}

function validSeasonSaveInput(input: AdminRequest['input']) {
  if (!validOptionalVersionedId(input, 'seasonId') || !plainRecord(input.season)) return false
  const season = input.season
  if (!hasRequiredAllowedKeys(season, ['seasonKey', 'name', 'summary', 'rulesText', 'periodKind', 'startsAt', 'endsAt'], ['rules'])
    || !keyText(season.seasonKey)
    || !boundedRequiredText(season.name, 100)
    || !boundedText(season.summary, 500)
    || !boundedRequiredText(season.rulesText, 4000)
    || !['HALF_YEAR', 'YEAR', 'CUSTOM'].includes(String(season.periodKind || ''))
    || !validDateRange(season.startsAt, season.endsAt)) return false
  return !Object.hasOwn(season, 'rules') || validGameRules(season.rules)
}

function validGameRules(value: unknown) {
  if (!plainRecord(value)
    || !hasExactKeys(value, new Set(['scoreMetric', 'headquartersThresholds']))
    || value.scoreMetric !== 'EXPERIENCE'
    || !Array.isArray(value.headquartersThresholds)
    || value.headquartersThresholds.length < 1
    || value.headquartersThresholds.length > 8) return false
  let previous = -1
  for (const [index, item] of value.headquartersThresholds.entries()) {
    if (!plainRecord(item)
      || !hasExactKeys(item, new Set(['level', 'minimumExperience', 'label']))
      || item.level !== index + 1
      || !boundedInteger(item.minimumExperience, 0, Number.MAX_SAFE_INTEGER)
      || Number(item.minimumExperience) <= previous
      || !boundedRequiredText(item.label, 80)) return false
    previous = Number(item.minimumExperience)
  }
  return Number(value.headquartersThresholds[0]?.minimumExperience) === 0
}

function validTeamSaveInput(input: AdminRequest['input']) {
  if (!validOptionalVersionedId(input, 'teamId') || !plainRecord(input.team)) return false
  const team = input.team
  return hasRequiredAllowedKeys(team, ['seasonId', 'name', 'summary'], ['branchId', 'memberLimit'])
    && uuid(team.seasonId)
    && (!Object.hasOwn(team, 'branchId') || uuid(team.branchId))
    && boundedRequiredText(team.name, 100)
    && boundedText(team.summary, 500)
    && (!Object.hasOwn(team, 'memberLimit') || boundedInteger(team.memberLimit, 1, 100))
}

function validTeamMembersInput(input: AdminRequest['input']) {
  if (!uuid(input.seasonId) || !uuid(input.teamId) || !positiveVersion(input.expectedVersion)
    || !Array.isArray(input.members) || input.members.length > 100) return false
  const refs = new Set<string>()
  let captains = 0
  for (const member of input.members) {
    if (!plainRecord(member)
      || !hasExactKeys(member, new Set(['memberRef', 'role']))
      || !boundedRequiredText(member.memberRef, 200)
      || !['CAPTAIN', 'MEMBER'].includes(String(member.role || ''))
      || refs.has(member.memberRef)) return false
    refs.add(member.memberRef)
    if (member.role === 'CAPTAIN') captains += 1
  }
  return captains <= 1
}

function validMatchInput(value: unknown) {
  if (!plainRecord(value)
    || !hasExactKeys(value, new Set(['seasonId', 'weekStart', 'weekEnd', 'teamAId', 'teamBId']))
    || !uuid(value.seasonId)
    || !uuid(value.teamAId)
    || !uuid(value.teamBId)
    || value.teamAId === value.teamBId
    || !dateOnly(value.weekStart)
    || !dateOnly(value.weekEnd)) return false
  const duration = (Date.parse(`${value.weekEnd}T00:00:00Z`) - Date.parse(`${value.weekStart}T00:00:00Z`)) / 86_400_000
  return duration === 6
}

function validCatalogSaveInput(input: AdminRequest['input']) {
  if (!validOptionalVersionedId(input, 'catalogId') || !plainRecord(input.catalog)) return false
  const catalog = input.catalog
  return hasExactKeys(catalog, new Set([
    'catalogKey', 'name', 'summary', 'rulesText', 'redemptionRulesText',
    'drawCostCoin', 'dailyDrawLimit', 'pityThreshold', 'pityMinRarity',
  ]))
    && keyText(catalog.catalogKey)
    && boundedRequiredText(catalog.name, 100)
    && boundedText(catalog.summary, 500)
    && boundedRequiredText(catalog.rulesText, 4000)
    && boundedRequiredText(catalog.redemptionRulesText, 4000)
    && boundedInteger(catalog.drawCostCoin, 1, 100000)
    && boundedInteger(catalog.dailyDrawLimit, 1, 100)
    && boundedInteger(catalog.pityThreshold, 1, 100)
    && GAME_RARITIES.includes(String(catalog.pityMinRarity || ''))
}

function validCardSaveInput(input: AdminRequest['input']) {
  if (!validOptionalVersionedId(input, 'cardId') || !plainRecord(input.card)) return false
  const card = input.card
  return hasExactKeys(card, new Set([
    'catalogId', 'cardKey', 'name', 'summary', 'rarity', 'weight', 'stockTotal', 'displayOrder',
  ]))
    && uuid(card.catalogId)
    && keyText(card.cardKey)
    && boundedRequiredText(card.name, 100)
    && boundedText(card.summary, 500)
    && GAME_RARITIES.includes(String(card.rarity || ''))
    && boundedInteger(card.weight, 1, 1_000_000)
    && boundedInteger(card.stockTotal, 0, 100_000_000)
    && boundedInteger(card.displayOrder, 0, 1_000_000)
}

function validOptionalVersionedId(input: AdminRequest['input'], idKey: string) {
  const hasId = Object.hasOwn(input, idKey)
  const hasVersion = Object.hasOwn(input, 'expectedVersion')
  return hasId === hasVersion && (!hasId || (uuid(input[idKey]) && positiveVersion(input.expectedVersion)))
}

function hasRequiredAllowedKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]) {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return keys.every(key => allowed.has(key)) && required.every(key => Object.hasOwn(value, key))
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === 'string' && value.length <= maximum
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function keyText(value: unknown) {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{2,63}$/.test(value)
}

function validDateRange(startsAt: unknown, endsAt: unknown) {
  if (typeof startsAt !== 'string' || typeof endsAt !== 'string' || startsAt.length > 40 || endsAt.length > 40) return false
  const start = Date.parse(startsAt)
  const end = Date.parse(endsAt)
  return Number.isFinite(start) && Number.isFinite(end) && start < end
}

function dateOnly(value: unknown) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
}

function opaqueCursor(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value)
}

function validBannerQueryInput(action: string, input: AdminRequest['input']) {
  if (action === 'mip.admin.banners.session') return Object.keys(input).length === 0
  if (action === 'mip.admin.banners.get') {
    return hasExactKeys(input, new Set(['bannerId'])) && uuid(input.bannerId)
  }
  if (action !== 'mip.admin.banners.list') return false
  if (!Object.keys(input).length) return true
  if (!hasExactKeys(input, new Set(['filters'])) || !plainRecord(input.filters)) return false
  const filters = input.filters
  const keys = Object.keys(filters)
  if (!keys.every(key => ['query', 'status'].includes(key))) return false
  if (Object.hasOwn(filters, 'query')
    && (typeof filters.query !== 'string' || filters.query.length > 80)) return false
  return !Object.hasOwn(filters, 'status')
    || (typeof filters.status === 'string' && ['', 'ACTIVE', 'INACTIVE', 'DELETED'].includes(filters.status))
}

function validBannerMutationInput(action: string, input: AdminRequest['input']) {
  if (action === 'mip.admin.banners.save') {
    if (!plainRecord(input.banner)
      || !hasExactKeys(input.banner, new Set(['title', 'accessibilityLabel', 'imageAssetId', 'targetType', 'targetValue']))) return false
    const hasBannerId = Object.hasOwn(input, 'bannerId')
    const hasExpectedVersion = Object.hasOwn(input, 'expectedVersion')
    if (hasBannerId !== hasExpectedVersion
      || (hasBannerId && (!uuid(input.bannerId) || !positiveVersion(input.expectedVersion)))) return false
    const banner = input.banner
    return boundedRequiredText(banner.title, 100)
      && boundedRequiredText(banner.accessibilityLabel, 120)
      && uuid(banner.imageAssetId)
      && ['MINIPROGRAM_PATH', 'ARTICLE_URL'].includes(String(banner.targetType || ''))
      && validBannerTarget(String(banner.targetType || ''), banner.targetValue)
  }
  if (!uuid(input.bannerId) || !positiveVersion(input.expectedVersion)) return false
  if (action === 'mip.admin.banners.changeStatus') {
    return ['ACTIVE', 'INACTIVE'].includes(String(input.status || ''))
  }
  if (action === 'mip.admin.banners.move') {
    return ['UP', 'DOWN'].includes(String(input.direction || ''))
  }
  return action === 'mip.admin.banners.delete'
}

function validBannerTarget(targetType: string, value: unknown) {
  if (!boundedRequiredText(value, 1024)) return false
  const target = String(value).trim()
  if (targetType === 'MINIPROGRAM_PATH') {
    return target.startsWith('/') && !target.startsWith('//') && !target.includes('#') && !target.includes('\\')
  }
  try {
    const url = new URL(target)
    return url.protocol === 'https:' && url.hostname === 'mp.weixin.qq.com'
      && !url.username && !url.password && !url.port && !url.hash
      && (url.pathname === '/s' || url.pathname.startsWith('/s/'))
  }
  catch {
    return false
  }
}

function boundedRequiredText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
}

function uuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function positiveVersion(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 1
}

function validExportCreateInput(input: AdminRequest['input']) {
  const filters = input.filters
  if (!['USERS', 'ORDERS'].includes(String(input.exportType || ''))
    || typeof input.includesPhone !== 'boolean'
    || (input.exportType === 'ORDERS' && input.includesPhone !== false)
    || !plainRecord(filters)) return false
  const keys = Object.keys(filters)
  return keys.every(key => ['query', 'status'].includes(key))
    && keys.every(key => typeof filters[key] === 'string'
      && filters[key].trim().length > 0
      && filters[key].length <= (key === 'query' ? 80 : 40))
}

function validExportLifecycleInput(input: AdminRequest['input']) {
  return Object.keys(input).length === 2
    && typeof input.ticketId === 'string'
    && /^[A-Za-z0-9_-]{1,36}$/.test(input.ticketId)
    && typeof input.token === 'string'
    && /^[A-Za-z0-9_-]{32,96}$/.test(input.token)
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
  const range = 1_000_000
  const maximum = Math.floor(0x1_0000_0000 / range) * range
  let value = maximum
  while (value >= maximum) value = cryptoApi.getRandomValues(new Uint32Array(1))[0]
  return String(value % range).padStart(6, '0')
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
  return jsonError('CHALLENGE_EXPIRED', '登录请求无效或已过期', 410, {
    'set-cookie': expireCookie(CHALLENGE_COOKIE, request),
  })
}

function loginRateLimited(lockedUntil: number, now: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil - now) / 1000))
  return jsonError('CHALLENGE_RATE_LIMITED', '尝试次数过多，请稍后再试', 429, {
    'retry-after': String(retryAfterSeconds),
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
