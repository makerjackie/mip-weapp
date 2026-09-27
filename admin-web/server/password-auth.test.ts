import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pbkdf2Sync } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createPasswordAuth, normalizeLoginPhone, passwordAuthDiagnostic } from './password-auth.ts'
import { createAdminBff, canonicalJson, type D1DatabaseBinding } from './admin-bff.ts'
const principal = { appId: 'wx-test-auth', openId: 'test-bound-principal' }
const password = 'synthetic-password-2030'
function setup() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of ['0001_web_login_challenges.sql', '0002_web_login_rate_limits.sql', '0003_web_login_ip_rate_limits.sql', '0004_password_auth.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  const database: D1DatabaseBinding = { prepare(sql) {
    let values: unknown[] = []
    const statement = { bind(...input: unknown[]) { values = input; return statement },
      async first<T>() { return (sqlite.prepare(sql).get(...values as never[]) || null) as T | null },
      async run() {
        const before = Number(sqlite.prepare('SELECT total_changes() AS count').get()!.count)
        sqlite.prepare(sql).run(...values as never[])
        const after = Number(sqlite.prepare('SELECT total_changes() AS count').get()!.count)
        return { success: true, meta: { changes: after - before } }
      } }
    return statement
  } }
  let time = 100000000
  let allowed = true
  let phone = '+86 13000000000'
  const auth = createPasswordAuth({ database, secret: 'synthetic-server-pepper-not-a-production-secret', cryptoApi: globalThis.crypto, now: () => time,
    identity: async p => { if (!allowed || p.openId !== principal.openId) throw new Error('FORBIDDEN'); return { phone, userId: 'synthetic-user' } } })
  return { auth, database, sqlite, advance: () => { time += 11 * 60_000 }, disable: () => { allowed = false }, changePhone: () => { phone = '+86 13000000001' } }
}
describe('optional password authentication', () => {
  it('binds only the verified principal and stores salted hashes without raw phone/password', async () => {
    const { auth, sqlite } = setup()
    const session = await auth.issue(principal, 'WECHAT')
    await auth.set(session, { password }, 'test-ip')
    const row = sqlite.prepare('SELECT * FROM mip_admin_web_credentials').get()!
    assert.match(String(row.password_hash), /^pbkdf2-sha256\$600000\$/)
    assert.ok(!JSON.stringify(row).includes(password))
    assert.ok(!JSON.stringify(row).includes('13000000000'))
    const loggedIn = await auth.login({ phone: '13000000000', password }, 'test-ip')
    assert.equal(loggedIn.openId, principal.openId)
    assert.equal(await auth.validate(loggedIn), true)
    await auth.revoke(loggedIn)
    assert.equal(await auth.validate(loggedIn), false)
  })
  it('returns success despite audit-trigger changes and retains CAS conflict detection', async () => {
    const { auth, sqlite, database } = setup()
    const session = await auth.issue(principal, 'WECHAT')
    assert.deepEqual(await auth.set(session, { password }, 'ip'), { configured: true, requiresLogin: false })
    // D1 metadata may count both the credential row and its AFTER UPDATE audit insert.
    const metadata = await database.prepare('UPDATE mip_admin_web_credentials SET updated_at = updated_at + 1').run()
    assert.equal(metadata.meta?.changes, 2)
    assert.deepEqual(await auth.set(session, { password: 'changed-synthetic-password' }, 'ip'), { configured: true, requiresLogin: false })
    assert.equal(sqlite.prepare('SELECT version FROM mip_admin_web_credentials').get()!.version, 2)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mip_admin_web_credential_audit').get()!.count, 3)
    const stale = await database.prepare('UPDATE mip_admin_web_credentials SET version = version + 1 WHERE version = 1 RETURNING version').first()
    assert.equal(stale, null)
  })

  it('requires fresh WeChat proof initially and old password when not recently verified', async () => {
    const { auth, advance } = setup()
    const session = await auth.issue(principal, 'WECHAT')
    advance()
    await assert.rejects(auth.set(session, { password }, 'ip'), { code: 'REAUTH_REQUIRED' })
    const fresh = await auth.issue(principal, 'WECHAT')
    await auth.set(fresh, { password }, 'ip')
    const loggedIn = await auth.login({ phone: '13000000000', password }, 'ip')
    await assert.rejects(auth.set(loggedIn, { password: 'new-synthetic-password' }, 'ip'), { code: 'INVALID_CREDENTIALS' })
    await auth.set(loggedIn, { password: 'new-synthetic-password', currentPassword: password }, 'ip')
    assert.equal(await auth.validate(loggedIn), false)
    assert.equal(await auth.validate(fresh), true)
  })
  it('rechecks server permissions and verified phone before creating a password session', async () => {
    const first = setup(); await first.auth.set(await first.auth.issue(principal, 'WECHAT'), { password }, 'ip')
    first.changePhone()
    await assert.rejects(first.auth.login({ phone: '13000000000', password }, 'ip'), { code: 'INVALID_CREDENTIALS' })
    const second = setup(); await second.auth.set(await second.auth.issue(principal, 'WECHAT'), { password }, 'ip')
    second.disable()
    await assert.rejects(second.auth.login({ phone: '13000000000', password }, 'ip'))
  })
  it('atomically caps concurrent account attempts and fails closed on unavailable counters', async () => {
    const { auth, sqlite } = setup()
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => auth.login({ phone: '13000000000', password }, `ip-${i}`)))
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'RATE_LIMITED').length, 5)
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'INVALID_CREDENTIALS').length, 5)
    sqlite.exec('DROP TABLE mip_admin_web_password_limits')
    await assert.rejects(auth.login({ phone: '13000000001', password }, 'new-ip'))
  })
  it('uses compare-and-swap for concurrent password changes and audits without secrets', async () => {
    const { auth, sqlite } = setup()
    const session = await auth.issue(principal, 'WECHAT')
    await auth.set(session, { password }, 'ip')
    const changes = await Promise.allSettled([
      auth.set(session, { password: 'first-new-synthetic-password' }, 'ip'),
      auth.set(session, { password: 'second-new-synthetic-password' }, 'ip'),
    ])
    assert.equal(changes.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(changes.filter(r => r.status === 'rejected' && r.reason.code === 'REAUTH_REQUIRED').length, 1)
    const audit = sqlite.prepare('SELECT * FROM mip_admin_web_credential_audit').all()
    assert.equal(audit.length, 2)
    assert.ok(!JSON.stringify(audit).includes(password))
    assert.ok(!JSON.stringify(audit).includes('13000000000'))
  })
  it('resets only the account counter after successful login while the sixth failed login stays blocked', async () => {
    const { auth, sqlite } = setup()
    await auth.set(await auth.issue(principal, 'WECHAT'), { password }, 'test-ip')
    for (let i = 0; i < 7; i++) {
      const session = await auth.login({ phone: '13000000000', password }, 'test-ip')
      assert.equal(await auth.validate(session), true)
    }
    assert.equal(sqlite.prepare('SELECT MAX(hit_count) AS count FROM mip_admin_web_password_limits').get()!.count, 7)
    for (let i = 0; i < 5; i++) {
      await assert.rejects(auth.login({ phone: '13000000000', password: 'incorrect-synthetic-password' }, 'test-ip'), { code: 'INVALID_CREDENTIALS' })
    }
    await assert.rejects(auth.login({ phone: '13000000000', password: 'incorrect-synthetic-password' }, 'test-ip'), { code: 'RATE_LIMITED' })
    assert.equal(sqlite.prepare('SELECT MAX(hit_count) AS count FROM mip_admin_web_password_limits').get()!.count, 13)
  })

  it('normalizes supported phone input without interpreting arbitrary identities', () => {
    assert.equal(normalizeLoginPhone('13000000000'), '+8613000000000')
    assert.equal(normalizeLoginPhone('+86 13000000000'), '+8613000000000')
    assert.equal(normalizeLoginPhone({ userId: 'owner' }), '')
  })
})

it('BFF password endpoints enforce verified binding, CSRF, private output and revocation', async () => {
  const { database } = setup()
  const origin = 'https://admin.example'
  const secret = 'synthetic-server-pepper-not-a-production-secret'
  let authorized = true
  let kdfCalls = 0
  const bff = createAdminBff({ MIP_ADMIN_AUTH_DB: database, MIP_WEB_SESSION_SECRET: secret,
    MIP_ADMIN_WEB_LOGIN_HMAC_SECRET: secret, MIP_WEB_ALLOWED_APP_IDS: principal.appId,
    MIP_WEB_ALLOWED_ORIGIN: origin, MIP_ADMIN_UPSTREAM_URL: 'https://upstream.example', MIP_ADMIN_UPSTREAM_HMAC_SECRET: secret,
  }, { now: () => 100000000, generateLoginQrCode: async () => '', fetch: async (_url, init) => {
    const envelope = JSON.parse(String(init?.body))
    if (envelope.transport === 'MIP_WEB_PASSWORD_KDF_V1') {
      kdfCalls++
      assert.equal(envelope.principal, undefined)
      assert.equal(envelope.password, undefined)
      assert.match(envelope.pepperedPassword, /^[a-f0-9]{64}$/)
      assert.notEqual(envelope.pepperedPassword, password)
      const { signature, ...unsigned } = envelope
      const signingKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      assert.equal(signature, Buffer.from(await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(canonicalJson(unsigned)))).toString('hex'))
      return new Response(JSON.stringify({ ok: true, data: { derivedKey: pbkdf2Sync(envelope.pepperedPassword, envelope.salt, 600_000, 32, 'sha256').toString('hex') } }))
    }
    return new Response(JSON.stringify(authorized
      ? { ok: true, data: { phone: '+86 13000000000', userId: 'synthetic-user' } }
      : { ok: false, error: { code: 'FORBIDDEN', message: 'not authorized' } }))
  } })
  const send = (path: string, body?: unknown, cookie = '', source = origin) => bff.handle(new Request(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { origin: source, cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  const start = await send('/api/auth/challenge', {})
  const challengeCookie = start.headers.get('set-cookie')!.split(';')[0]
  const challenge = await start.json() as { code: string }
  const unsigned = { transport: 'MIP_WEB_LOGIN_CONFIRM_V1', timestamp: 100000000, nonce: 'a'.repeat(32), challengeCode: challenge.code, principal }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalJson(unsigned)))).toString('hex')
  assert.equal((await send('/api/internal/auth/challenge/confirm', { ...unsigned, signature })).status, 200)
  const exchange = await send('/api/auth/challenge/status', {}, challengeCookie)
  assert.equal(exchange.status, 200)
  const cookie = exchange.headers.get('set-cookie')!.split(';')[0]
  assert.equal((await send('/api/auth/password', { password, phone: '13000000001' }, cookie)).status, 400)
  assert.equal((await send('/api/auth/password', { password }, cookie, 'https://evil.example')).status, 403)
  assert.equal((await send('/api/auth/password', { password }, cookie)).status, 200)
  const status = await (await send('/api/auth/password', undefined, cookie)).json()
  assert.deepEqual(Object.keys(status as object).sort(), ['configured', 'maskedPhone', 'recentWechatAuth'])
  assert.ok(!JSON.stringify(status).includes('13000000000'))
  const login = await send('/api/auth/password/login', { phone: '13000000000', password })
  assert.equal(login.status, 200)
  const beforeUnknown = kdfCalls
  assert.equal((await send('/api/auth/password/login', { phone: '13000000001', password })).status, 401)
  assert.equal(kdfCalls, beforeUnknown + 1)
  const passwordCookie = login.headers.get('set-cookie')!.split(';')[0]
  const changed = await send('/api/auth/password', { password: 'replacement-synthetic-password', currentPassword: password }, passwordCookie)
  assert.deepEqual(await changed.json(), { configured: true, requiresLogin: true })
  assert.equal((await send('/api/auth/password', undefined, passwordCookie)).status, 401)
  authorized = false
  const denied = await send('/api/auth/password/login', { phone: '13000000000', password: 'replacement-synthetic-password' })
  assert.equal(denied.status, 401)
  assert.equal((await denied.json() as { error: { code: string } }).error.code, 'INVALID_CREDENTIALS')
})

it('logs only fixed stage and classification when the deployed KDF is unsupported', async () => {
  const { auth, database } = setup()
  const session = await auth.issue(principal, 'WECHAT')
  const diagnostics: unknown[] = []
  const cryptoApi = {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    subtle: new Proxy(crypto.subtle, { get(target, key) {
      if (key === 'deriveBits') return async () => { throw new Error('Pbkdf2 failed: iteration counts above 100000 are not supported; private-input-never-log') }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } }),
  } as Crypto
  const unavailableAuth = createPasswordAuth({ database, secret: 'synthetic-server-pepper-not-a-production-secret', cryptoApi,
    now: () => 100000000, identity: async () => ({ phone: '+86 13000000000', userId: 'synthetic-user' }),
    diagnostic: (stage, classification) => diagnostics.push({ stage, classification }),
  })
  await assert.rejects(unavailableAuth.set(session, { password }, 'ip'))
  assert.deepEqual(diagnostics, [{ stage: 'HASH_PASSWORD', classification: 'KDF_ITERATION_UNSUPPORTED' }])
  assert.equal(passwordAuthDiagnostic(new Error('D1_ERROR SQLITE_ERROR private SQL must never escape')), 'DATABASE_ERROR')
  assert.equal(passwordAuthDiagnostic(new Error('arbitrary private text')), 'UNEXPECTED_ERROR')
})

it('does not fall back to a local or weaker KDF if the trusted KDF service fails', async () => {
  const { database } = setup()
  const secret = 'synthetic-server-pepper-not-a-production-secret'
  const bff = createAdminBff({ MIP_ADMIN_AUTH_DB: database, MIP_WEB_SESSION_SECRET: secret,
    MIP_WEB_ALLOWED_APP_IDS: principal.appId, MIP_WEB_ALLOWED_ORIGIN: 'https://admin.example',
    MIP_ADMIN_UPSTREAM_URL: 'https://upstream.example', MIP_ADMIN_UPSTREAM_HMAC_SECRET: secret,
  }, { fetch: async () => new Response(JSON.stringify({ ok: true, data: { derivedKey: 'invalid' } })) })
  const result = await bff.handle(new Request('https://admin.example/api/auth/password/login', {
    method: 'POST', headers: { origin: 'https://admin.example', 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '13000000001', password }),
  }))
  assert.equal(result.status, 503)
  assert.deepEqual(await result.json(), { error: { code: 'AUTH_UNAVAILABLE', message: '登录服务暂时不可用' } })
})
