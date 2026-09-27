import { authStatement, type AdminAuthDatabase } from './auth-database.ts'

export interface PasswordPrincipal { appId: string; openId: string }
export interface PasswordSession extends PasswordPrincipal {
  sid: string; issuedAt: number; expiresAt: number; method: 'WECHAT' | 'PASSWORD'; credentialVersion?: number
}
interface Credential { principal_key: string; phone_key: string; app_id: string; open_id: string; user_id: string; password_hash: string; version: number }
export class PasswordAuthError extends Error {
  code: string
  status: number
  constructor(code: string, status: number, message: string) { super(message); this.code = code; this.status = status }
}
const fail = () => new PasswordAuthError('INVALID_CREDENTIALS', 401, '手机号或密码不正确')
const unavailable = () => new PasswordAuthError('AUTH_UNAVAILABLE', 503, '登录服务暂时不可用')
const encoder = new TextEncoder()
export function normalizeLoginPhone(value: unknown): string {
  if (typeof value !== 'string') return ''
  const compact = value.replace(/[\s()-]/g, '')
  if (/^1\d{10}$/.test(compact)) return `+86${compact}`
  return /^\+[1-9]\d{7,19}$/.test(compact) ? compact : ''
}
export type PasswordAuthStage = 'RATE_LIMIT_IP' | 'RATE_LIMIT_ACCOUNT' | 'IDENTITY' | 'CREDENTIAL_READ' | 'VERIFY_PASSWORD' | 'HASH_PASSWORD' | 'CREDENTIAL_WRITE'
export function passwordAuthDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/iteration/i.test(message) && /not supported|maximum|limit|above/i.test(message)) return 'KDF_ITERATION_UNSUPPORTED'
  if (/D1_|SQLITE|database|no such table/i.test(message)) return 'DATABASE_ERROR'
  if (/cpu|resource.*limit/i.test(message)) return 'RUNTIME_RESOURCE_LIMIT'
  if (error instanceof PasswordAuthError) return error.code === 'AUTH_UNAVAILABLE' ? 'UPSTREAM_UNAVAILABLE' : 'AUTH_REJECTED'
  if (error instanceof Error && ['OperationError', 'NotSupportedError', 'DataError'].includes(error.name)) return 'CRYPTO_ERROR'
  return 'UNEXPECTED_ERROR'
}
export function createPasswordAuth({ database, secret, cryptoApi, now, identity, deriveKey, diagnostic = () => {} }: {
  database: AdminAuthDatabase; secret: string; cryptoApi: Crypto; now: () => number
  identity: (principal: PasswordPrincipal) => Promise<{ phone: string; userId: string }>
  diagnostic?: (stage: PasswordAuthStage, classification: string) => void
  deriveKey?: (pepperedPassword: string, salt: string) => Promise<string>
}) {
  async function keyed(value: string) {
    const key = await cryptoApi.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return hex(new Uint8Array(await cryptoApi.subtle.sign('HMAC', key, encoder.encode(`password-auth-v1\0${value}`))))
  }
  const principalKey = (p: PasswordPrincipal) => keyed(`principal\0${p.appId}\0${p.openId}`)
  const phoneKey = (phone: string) => keyed(`phone\0${phone}`)
  async function hash(password: string, salt = hex(cryptoApi.getRandomValues(new Uint8Array(16)))) {
    const peppered = await keyed(`password\0${password}`)
    if (deriveKey) {
      const derived = await deriveKey(peppered, salt)
      if (!/^[a-f0-9]{64}$/.test(derived)) throw unavailable()
      return `pbkdf2-sha256$600000$${salt}$${derived}`
    }
    const key = await cryptoApi.subtle.importKey('raw', encoder.encode(peppered), 'PBKDF2', false, ['deriveBits'])
    const bits = await cryptoApi.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 600_000 }, key, 256)
    return `pbkdf2-sha256$600000$${salt}$${hex(new Uint8Array(bits))}`
  }
  async function matches(password: string, stored: string) {
    const parts = stored.split('$')
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '600000' || !/^[a-f0-9]{32}$/.test(parts[2]) || !/^[a-f0-9]{64}$/.test(parts[3])) return false
    const candidate = await hash(password, parts[2])
    let diff = candidate.length ^ stored.length
    for (let i = 0; i < stored.length; i++) diff |= candidate.charCodeAt(i) ^ stored.charCodeAt(i)
    return diff === 0
  }
  async function hit(key: string, maximum: number) {
    const row = await authStatement(database, 'hitPasswordLimit').bind(await keyed(key), now(), now() - 15 * 60_000).first<{ hit_count: number }>()
    if (!row) throw unavailable()
    if (row.hit_count > maximum) throw new PasswordAuthError('RATE_LIMITED', 429, '尝试次数过多，请稍后再试')
  }
  async function checkedIdentity(principal: PasswordPrincipal) {
    let result
    try { result = await identity(principal) }
    catch (error) {
      if (error instanceof PasswordAuthError && error.code === 'AUTH_UNAVAILABLE') throw error
      throw fail()
    }
    const phone = normalizeLoginPhone(result.phone)
    if (!phone || typeof result.userId !== 'string' || !result.userId) throw fail()
    return { phone, userId: result.userId }
  }
  async function credential(principal: PasswordPrincipal) {
    return authStatement(database, 'credentialByPrincipal').bind(await principalKey(principal)).first<Credential>()
  }
  async function issue(principal: PasswordPrincipal, method: 'WECHAT' | 'PASSWORD', version?: number): Promise<PasswordSession> {
    await authStatement(database, 'purgeSessions').bind(now()).run()
    await authStatement(database, 'purgePasswordLimits').bind(now() - 24 * 60 * 60_000).run()
    const session: PasswordSession = { ...principal, method, sid: hex(cryptoApi.getRandomValues(new Uint8Array(32))), issuedAt: now(), expiresAt: now() + 8 * 60 * 60_000, ...(version ? { credentialVersion: version } : {}) }
    const saved = await authStatement(database, 'insertSession')
      .bind(session.sid, await principalKey(principal), method, version ?? null, session.expiresAt).run()
    if (!saved.success) throw unavailable()
    return session
  }
  async function validate(session: PasswordSession) {
    if (!/^[a-f0-9]{64}$/.test(session.sid || '') || !Number.isSafeInteger(session.issuedAt) || !Number.isSafeInteger(session.expiresAt) || session.issuedAt > now() || session.expiresAt <= now()) return false
    const row = await authStatement(database, 'findSession').bind(session.sid).first<{ principal_key: string; method: string; credential_version: number | null; expires_at: number; revoked_at: number | null }>()
    if (!row || row.revoked_at !== null || row.expires_at <= now() || row.principal_key !== await principalKey(session) || row.method !== session.method) return false
    if (row.method === 'PASSWORD') {
      const current = await credential(session)
      return Boolean(current && current.version === row.credential_version && current.version === session.credentialVersion)
    }
    return true
  }
  async function revoke(session: PasswordSession) {
    const result = await authStatement(database, 'revokeSession').bind(now(), session.sid).run()
    if (!result.success) throw unavailable()
  }
  const recent = (session: PasswordSession) => session.method === 'WECHAT' && now() - session.issuedAt <= 10 * 60_000
  async function status(session: PasswordSession) {
    const who = await checkedIdentity(session)
    const current = await credential(session)
    return { configured: Boolean(current), maskedPhone: `${who.phone.slice(0, 5)}****${who.phone.slice(-4)}`, recentWechatAuth: recent(session) }
  }
  async function set(session: PasswordSession, input: { password?: unknown; currentPassword?: unknown }, ip: string) {
    let stage: PasswordAuthStage = 'RATE_LIMIT_IP'
    try {
      if (!validPassword(input.password)) throw new PasswordAuthError('VALIDATION_FAILED', 400, '密码需为10至128个字符')
      await hit(`set-ip\0${ip}`, 30)
      stage = 'RATE_LIMIT_ACCOUNT'
      await hit(`set-principal\0${await principalKey(session)}`, 5)
      stage = 'IDENTITY'
      const who = await checkedIdentity(session)
      stage = 'CREDENTIAL_READ'
      const current = await credential(session)
      if (!recent(session)) {
        if (!current) throw new PasswordAuthError('REAUTH_REQUIRED', 403, '请重新用小程序确认登录')
        stage = 'VERIFY_PASSWORD'
        if (!validPassword(input.currentPassword) || !await matches(input.currentPassword, current.password_hash)) throw fail()
      }
      const key = await principalKey(session)
      stage = 'HASH_PASSWORD'
      const newHash = await hash(input.password)
      const index = await phoneKey(who.phone)
      stage = 'CREDENTIAL_WRITE'
      const saved = current
        ? await authStatement(database, 'updateCredential')
          .bind(index, who.userId, newHash, now(), key, current.version).first<{ version: number }>()
        : await authStatement(database, 'insertCredential')
          .bind(key, index, session.appId, session.openId, who.userId, newHash, now()).first<{ version: number }>()
      // Storage returns the CAS target version; audit writes must not inflate the changed-row count.
      if (!saved || saved.version !== (current?.version ?? 0) + 1) throw new PasswordAuthError('REAUTH_REQUIRED', 409, '凭证已变化，请重新登录后再试')
      // Version comparison revokes old password sessions atomically with the credential update.
      return { configured: true, requiresLogin: session.method === 'PASSWORD' }
    } catch (error) {
      if (!(error instanceof PasswordAuthError) || error.code === 'AUTH_UNAVAILABLE') diagnostic(stage, passwordAuthDiagnostic(error))
      throw error
    }
  }
  async function login(input: { phone?: unknown; password?: unknown }, ip: string) {
    await hit(`login-ip\0${ip}`, 30)
    const phone = normalizeLoginPhone(input.phone)
    await hit(`login-phone\0${phone || 'invalid'}`, 5)
    if (!phone || !validPassword(input.password)) throw fail()
    const row = await authStatement(database, 'credentialByPhone').bind(await phoneKey(phone)).first<Credential>()
    // Unknown accounts perform the same expensive KDF and use the same public error.
    const ok = await matches(input.password, row?.password_hash || `pbkdf2-sha256$600000$${'0'.repeat(32)}$${'0'.repeat(64)}`)
    if (!row || !ok) throw fail()
    const principal = { appId: row.app_id, openId: row.open_id }
    const who = await checkedIdentity(principal)
    if (who.phone !== phone || who.userId !== row.user_id) throw fail()
    const session = await issue(principal, 'PASSWORD', row.version)
    // A fully authorized login resets only this account's failures, never the IP throttle.
    const cleared = await authStatement(database, 'clearPasswordLimit')
      .bind(await keyed(`login-phone\0${phone}`)).run()
    if (!cleared.success) throw unavailable()
    return session
  }
  return { issue, validate, revoke, status, set, login }
}
function validPassword(value: unknown): value is string { return typeof value === 'string' && value.length >= 10 && value.length <= 128 }
function hex(value: Uint8Array) { return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('') }
