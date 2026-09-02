import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canonicalJson,
  createAdminBff,
  type AdminBffEnv,
  type D1DatabaseBinding,
} from './admin-bff.ts'
import { REVIEWED_ADMIN_MUTATIONS, WEB_ADMIN_QUERY_ACTIONS } from './admin-mutation-contract.ts'
import {
  ADMIN_MEDIA_MAX_REQUEST_BYTES,
  ADMIN_MEDIA_UPLOAD_ACTION,
} from './admin-media-upload.ts'

const NOW = Date.UTC(2030, 0, 1)
const ORIGIN = 'https://mipmini.01mvp.com'
const SESSION_SECRET = 'session-encryption-secret-that-is-long-enough-for-tests'
const LOGIN_SECRET = 'login-confirm-secret-that-is-long-enough-for-tests'
const EXPORT_TOKEN = 'a'.repeat(43)
const MEDIA_ASSET_ID = '10000000-0000-4000-8000-000000000001'
const REVIEWED_QUERY_ACTIONS = [...WEB_ADMIN_QUERY_ACTIONS]
const REVIEWED_MUTATION_ACTIONS = REVIEWED_ADMIN_MUTATIONS.map(item => item.action)
const CORE_MUTATION_INPUTS: Record<string, Record<string, unknown>> = {
  'mip.admin.memberships.grant': { userId: 'user-a', durationMonths: 12, expectedChainVersion: 1, reason: '测试补录' },
  'mip.admin.events.clone': { sourceEventId: 'event-a', expectedVersion: 1 },
  'mip.admin.events.changeStatus': { eventId: 'event-a', expectedVersion: 1, status: 'PUBLISHED' },
  'mip.admin.events.archive': { eventId: 'event-a', expectedVersion: 1, reason: '测试归档' },
  'mip.admin.communications.publishEventReminder': { eventId: 'event-a', expectedVersion: 1, sendWechatReminder: false },
  'mip.admin.refunds.submit': { orderId: 'order-a', reason: '测试退款' },
  'mip.admin.exports.create': { exportType: 'USERS', includesPhone: false, filters: {} },
  'mip.admin.exports.prepare': { ticketId: 'ticket-a', token: EXPORT_TOKEN },
  'mip.admin.exports.reserve': { ticketId: 'ticket-a', token: EXPORT_TOKEN },
  'mip.admin.exports.complete': { ticketId: 'ticket-a', token: EXPORT_TOKEN },
  'mip.admin.banners.save': {
    banner: {
      title: '活动首页 Banner',
      accessibilityLabel: '查看本周活动',
      imageAssetId: '20000000-0000-4000-8000-000000000002',
      targetType: 'MINIPROGRAM_PATH',
      targetValue: '/pages/events/index',
    },
  },
  'mip.admin.banners.changeStatus': {
    bannerId: '10000000-0000-4000-8000-000000000001', expectedVersion: 1, status: 'ACTIVE',
  },
  'mip.admin.banners.move': {
    bannerId: '10000000-0000-4000-8000-000000000001', expectedVersion: 1, direction: 'UP',
  },
  'mip.admin.banners.delete': {
    bannerId: '10000000-0000-4000-8000-000000000001', expectedVersion: 1,
  },
  'mip.admin.game.seasons.save': {
    season: {
      seasonKey: 'season_2030', name: '2030 上半年赛季', summary: '', rulesText: '按经验值排行',
      rules: { scoreMetric: 'EXPERIENCE', headquartersThresholds: [{ level: 1, minimumExperience: 0, label: '一级大本营' }] },
      periodKind: 'HALF_YEAR', startsAt: '2030-01-01T00:00:00.000Z', endsAt: '2030-06-30T23:59:59.000Z',
    },
  },
  'mip.admin.game.seasons.changeStatus': {
    seasonId: '30000000-0000-4000-8000-000000000001', expectedVersion: 1, status: 'ACTIVE',
  },
  'mip.admin.game.teams.save': {
    team: { seasonId: '30000000-0000-4000-8000-000000000001', name: '深圳一队', summary: '', memberLimit: 20 },
  },
  'mip.admin.game.teams.changeStatus': {
    seasonId: '30000000-0000-4000-8000-000000000001', teamId: '30000000-0000-4000-8000-000000000002', expectedVersion: 1, status: 'INACTIVE',
  },
  'mip.admin.game.teams.members.replace': {
    seasonId: '30000000-0000-4000-8000-000000000001', teamId: '30000000-0000-4000-8000-000000000002', expectedVersion: 1,
    members: [{ memberRef: 'profile-owner', role: 'CAPTAIN' }],
  },
  'mip.admin.game.matches.save': {
    match: {
      seasonId: '30000000-0000-4000-8000-000000000001', weekStart: '2030-01-03', weekEnd: '2030-01-09',
      teamAId: '30000000-0000-4000-8000-000000000002', teamBId: '30000000-0000-4000-8000-000000000003',
    },
  },
  'mip.admin.game.matches.finalize': {
    matchId: '30000000-0000-4000-8000-000000000004', expectedVersion: 1,
  },
  'mip.admin.game.rankings.generate': {
    seasonId: '30000000-0000-4000-8000-000000000001', rankingType: 'TEAM_HALF_YEAR',
  },
  'mip.admin.game.blindBoxes.catalogs.save': {
    catalog: {
      catalogKey: 'mip_cards', name: 'MIP 卡片', summary: '', rulesText: '消耗游戏币抽取', redemptionRulesText: '按运营规则兑换',
      drawCostCoin: 10, dailyDrawLimit: 20, pityThreshold: 10, pityMinRarity: 'RARE',
    },
  },
  'mip.admin.game.blindBoxes.catalogs.changeStatus': {
    catalogId: '30000000-0000-4000-8000-000000000005', expectedVersion: 1, status: 'PUBLISHED',
  },
  'mip.admin.game.blindBoxes.cards.save': {
    card: {
      catalogId: '30000000-0000-4000-8000-000000000005', cardKey: 'growth_card', name: '成长卡', summary: '',
      rarity: 'COMMON', weight: 100, stockTotal: 1000, displayOrder: 0,
    },
  },
  'mip.admin.game.blindBoxes.cards.changeStatus': {
    cardId: '30000000-0000-4000-8000-000000000006', expectedVersion: 1, status: 'PUBLISHED',
  },
}

function reviewedQueryInput(action: string) {
  if (action === 'mip.admin.banners.list') return { filters: { query: '活动', status: 'INACTIVE' } }
  if (action === 'mip.admin.banners.get') return { bannerId: '10000000-0000-4000-8000-000000000001' }
  if (action === 'mip.admin.game.rankings.list') return { seasonId: '30000000-0000-4000-8000-000000000001', rankingType: 'TEAM_HALF_YEAR', limit: 100 }
  if (['mip.admin.game.teams.list', 'mip.admin.game.matches.list'].includes(action)) return { seasonId: '30000000-0000-4000-8000-000000000001' }
  if (action === 'mip.admin.game.members.assignable.list') return {
    seasonId: '30000000-0000-4000-8000-000000000001', teamId: '30000000-0000-4000-8000-000000000002', query: '', limit: 30,
  }
  if (action === 'mip.admin.game.blindBoxes.cards.list') return { catalogId: '30000000-0000-4000-8000-000000000005' }
  return action === 'mip.admin.exports.status'
    ? { ticketId: 'ticket-a', token: EXPORT_TOKEN }
    : {}
}

function reviewedMutationInput(action: string) {
  if (CORE_MUTATION_INPUTS[action]) return CORE_MUTATION_INPUTS[action]
  const schema = REVIEWED_ADMIN_MUTATIONS.find(item => item.action === action)!
  return Object.fromEntries(schema.required.map(key => [key, fixtureValue(key)]))
}

function fixtureValue(key: string): unknown {
  if (key === 'active' || key === 'pinned' || key === 'commentsEnabled') return true
  if (key === 'recipientRefs' || key === 'tagIds' || key === 'capabilities') return []
  if (key === 'draft' || key === 'fields') return {}
  if (key.toLowerCase().includes('version')) return 1
  if (key === 'deltaValue' || key === 'sortOrder' || key === 'cancellationHoursBeforeStart') return 1
  return `${key}-fixture`
}

interface Row {
  id: string
  code_hash: string
  browser_key_hash: string
  status: 'PENDING' | 'CONFIRMED' | 'CONSUMED'
  app_id: string | null
  open_id: string | null
  display_name: string | null
  created_at: number
  expires_at: number
  confirmed_at: number | null
  consumed_at: number | null
}

interface LimitRow {
  failed_attempts: number
  window_started_at: number
  locked_until: number
  updated_at: number
}

class MemoryD1 implements D1DatabaseBinding {
  readonly rows = new Map<string, Row>()
  readonly limits = new Map<string, LimitRow>()

  prepare(query: string) {
    let values: unknown[] = []
    const statement = {
      bind: (...input: unknown[]) => {
        values = input
        return statement
      },
      first: async <T>() => {
        if (query.includes('FROM mip_admin_web_login_challenges')) {
          const row = this.rows.get(String(values[0]))
          if (!row || row.browser_key_hash !== values[1]) return null
          return { ...row } as T
        }
        if (query.includes('FROM mip_admin_web_login_principal_limits')) {
          const row = this.limits.get(String(values[0]))
          return row ? { ...row } as T : null
        }
        if (query.includes('INSERT INTO mip_admin_web_login_principal_limits')) {
          const [principalKey, now, windowBoundary, failureLimit, lockedUntil] = values.map(NumberOrString)
          const existing = this.limits.get(String(principalKey))
          if (!existing) {
            const row = { failed_attempts: 1, window_started_at: Number(now), locked_until: 0, updated_at: Number(now) }
            this.limits.set(String(principalKey), row)
            return { ...row } as T
          }
          if (existing.locked_until <= Number(now)) {
            const resetWindow = existing.window_started_at <= Number(windowBoundary)
            existing.failed_attempts = resetWindow ? 1 : existing.failed_attempts + 1
            existing.window_started_at = resetWindow ? Number(now) : existing.window_started_at
            existing.locked_until = existing.failed_attempts >= Number(failureLimit) ? Number(lockedUntil) : 0
          }
          existing.updated_at = Number(now)
          return { ...existing } as T
        }
        throw new Error('QUERY_UNSUPPORTED')
      },
      run: async () => {
        if (query.includes('DELETE FROM mip_admin_web_login_challenges')) {
          for (const [id, row] of this.rows) {
            if (row.expires_at < Number(values[0])) this.rows.delete(id)
          }
          return { success: true }
        }
        if (query.includes('DELETE FROM mip_admin_web_login_principal_limits')) {
          this.limits.delete(String(values[0]))
          return { success: true }
        }
        if (query.includes('INSERT INTO mip_admin_web_login_challenges')) {
          const [id, codeHash, browserKeyHash, createdAt, expiresAt] = values
          if ([...this.rows.values()].some(row => row.code_hash === codeHash && row.status === 'PENDING')) {
            throw new Error('UNIQUE')
          }
          this.rows.set(String(id), {
            id: String(id), code_hash: String(codeHash), browser_key_hash: String(browserKeyHash),
            status: 'PENDING', app_id: null, open_id: null, display_name: null,
            created_at: Number(createdAt), expires_at: Number(expiresAt), confirmed_at: null, consumed_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (query.includes("SET status = 'CONFIRMED'")) {
          const [appId, openId, displayName, confirmedAt, codeHash, principalKey] = values
          const row = [...this.rows.values()].find(item => item.code_hash === codeHash)
          const limit = this.limits.get(String(principalKey))
          if (!row || row.status !== 'PENDING' || row.expires_at < Number(confirmedAt)
            || (limit && limit.locked_until > Number(confirmedAt))) {
            return { success: true, meta: { changes: 0 } }
          }
          Object.assign(row, {
            status: 'CONFIRMED', app_id: String(appId), open_id: String(openId),
            display_name: displayName === null ? null : String(displayName), confirmed_at: Number(confirmedAt),
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (query.includes("SET status = 'CONSUMED'")) {
          const [consumedAt, id, browserKeyHash] = values
          const row = this.rows.get(String(id))
          if (!row || row.browser_key_hash !== browserKeyHash || row.status !== 'CONFIRMED') {
            return { success: true, meta: { changes: 0 } }
          }
          row.status = 'CONSUMED'
          row.consumed_at = Number(consumedAt)
          return { success: true, meta: { changes: 1 } }
        }
        throw new Error('QUERY_UNSUPPORTED')
      },
    }
    return statement
  }
}

function NumberOrString(value: unknown) {
  return typeof value === 'number' ? value : String(value)
}

const env = (database = new MemoryD1()): AdminBffEnv => ({
  MIP_ADMIN_AUTH_DB: database,
  MIP_ADMIN_UPSTREAM_URL: 'https://cloud.example.test/mip-admin-api',
  MIP_ADMIN_UPSTREAM_HMAC_SECRET: 'upstream-hmac-secret-that-is-long-enough-for-tests',
  MIP_ADMIN_WEB_LOGIN_HMAC_SECRET: LOGIN_SECRET,
  MIP_WEB_ALLOWED_APP_IDS: 'wx-mip-app',
  MIP_WEB_ALLOWED_ORIGIN: ORIGIN,
  MIP_WEB_SESSION_SECRET: SESSION_SECRET,
})
type FetchCall = [RequestInfo | URL, RequestInit | undefined]
type FetchMock = typeof fetch & { calls: FetchCall[] }

function fetchQueue(...responses: Response[]): FetchMock {
  const calls: FetchCall[] = []
  const implementation = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([input, init])
    const response = responses.shift()
    if (!response) throw new Error('UNEXPECTED_FETCH')
    return response
  }
  return Object.assign(implementation, { calls }) as FetchMock
}

function cookieValue(response: Response, name: string) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || '']
  const match = values.join(',').match(new RegExp(`${name}=([^;,]+)`))
  if (!match) throw new Error(`COOKIE_NOT_FOUND:${name}`)
  return `${name}=${match[1]}`
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function loginConfirmationBody(
  challengeCode: string,
  options: {
    now?: number
    nonce?: string
    principal?: { appId: string; openId: string; displayName?: string }
    secret?: string
  } = {},
) {
  const unsigned = {
    transport: 'MIP_WEB_LOGIN_CONFIRM_V1',
    timestamp: options.now ?? NOW,
    nonce: options.nonce || '0123456789abcdefghijklmn',
    challengeCode,
    principal: options.principal || { appId: 'wx-mip-app', openId: 'trusted-admin-openid', displayName: '运营成员' },
  }
  const signature = await hmacHex(options.secret || LOGIN_SECRET, canonicalJson(unsigned))
  return { ...unsigned, signature }
}

async function confirmedLogin(fetchMock: FetchMock, database = new MemoryD1()) {
  const bff = createAdminBff(env(database), { fetch: fetchMock, now: () => NOW })
  const start = await bff.handle(new Request(`${ORIGIN}/api/auth/challenge`, {
    method: 'POST', headers: { origin: ORIGIN },
  }))
  const challengeCookie = cookieValue(start, 'mip_admin_login_challenge')
  const challenge = await start.clone().json() as { code: string }
  const confirm = await bff.handle(new Request(`${ORIGIN}/api/internal/auth/challenge/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await loginConfirmationBody(challenge.code)),
  }))
  const exchange = await bff.handle(new Request(`${ORIGIN}/api/auth/challenge/status`, {
    method: 'POST', headers: { cookie: challengeCookie, origin: ORIGIN },
  }))
  return { bff, challengeCookie, confirm, exchange, sessionCookie: cookieValue(exchange, 'mip_admin_session') }
}

function mediaPngBase64() {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  bytes.set([0, 0, 0, 96, 0, 0, 0, 64], 16)
  return Buffer.from(bytes).toString('base64')
}

function mediaUploadRequest(sessionCookie: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/media/image`, {
    method: 'POST',
    headers: {
      cookie: sessionCookie,
      origin: ORIGIN,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('Admin Web BFF', () => {
  it('forwards the dedicated media upload with trusted principal and a server idempotency key', async () => {
    const imageUrl = 'cloud://env.mip/mip/live/app/banners/asset.png'
    const fetchMock = fetchQueue(new Response(JSON.stringify({
      ok: true,
      data: { assetId: MEDIA_ASSET_ID, imageUrl, width: 96, height: 64 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)
    const body = {
      action: ADMIN_MEDIA_UPLOAD_ACTION,
      input: { purpose: 'BANNER', imageBase64: mediaPngBase64() },
    }

    const response = await bff.handle(mediaUploadRequest(sessionCookie, body))

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      ok: true,
      data: { assetId: MEDIA_ASSET_ID, imageUrl, width: 96, height: 64 },
    })
    assert.equal(fetchMock.calls.length, 1)
    const upstream = JSON.parse(String(fetchMock.calls[0][1]?.body))
    assert.deepEqual(upstream.principal, { appId: 'wx-mip-app', openId: 'trusted-admin-openid' })
    assert.equal(upstream.request.contractVersion, 1)
    assert.equal(upstream.request.action, ADMIN_MEDIA_UPLOAD_ACTION)
    assert.deepEqual(upstream.request.input, body.input)
    assert.match(upstream.request.idempotencyKey, /^web-media-[A-Za-z0-9_-]{32}$/)
    assert.match(upstream.nonce, /^[A-Za-z0-9_-]{32}$/)
    assert.match(upstream.signature, /^[a-f0-9]{64}$/)
    assert.equal(fetchMock.calls[0][1]?.signal instanceof AbortSignal, true)
    assert.equal(JSON.stringify(upstream).includes(SESSION_SECRET), false)
  })

  it('rejects unauthorized, cross-origin, oversized, forged, and non-image media requests before upstream', async () => {
    const fetchMock = fetchQueue()
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)
    const valid = {
      action: ADMIN_MEDIA_UPLOAD_ACTION,
      input: { purpose: 'BANNER', imageBase64: mediaPngBase64() },
    }
    const requests = [
      mediaUploadRequest('', valid),
      new Request(`${ORIGIN}/api/media/image`, {
        method: 'POST',
        headers: { cookie: sessionCookie, origin: 'https://attacker.example', 'content-type': 'application/json' },
        body: JSON.stringify(valid),
      }),
      mediaUploadRequest(sessionCookie, { ...valid, action: 'mip.admin.media.deleteAll' }),
      mediaUploadRequest(sessionCookie, {
        action: ADMIN_MEDIA_UPLOAD_ACTION,
        input: { ...valid.input, capability: 'banners.manage' },
      }),
      mediaUploadRequest(sessionCookie, valid, {
        'content-length': String(ADMIN_MEDIA_MAX_REQUEST_BYTES + 1),
      }),
      mediaUploadRequest(sessionCookie, {
        action: ADMIN_MEDIA_UPLOAD_ACTION,
        input: { purpose: 'BANNER', imageBase64: Buffer.from('plain text').toString('base64') },
      }),
    ]
    const statuses = []
    for (const request of requests) statuses.push((await bff.handle(request)).status)

    assert.deepEqual(statuses, [401, 403, 400, 400, 413, 400])
    assert.equal(fetchMock.calls.length, 0)
  })

  it('keeps the regular admin route at 32 KB after enabling the dedicated media endpoint', async () => {
    const fetchMock = fetchQueue()
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)
    const response = await bff.handle(new Request(`${ORIGIN}/api/admin`, {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: 1,
        action: 'mip.admin.users.list',
        input: { query: 'x'.repeat(33 * 1024) },
      }),
    }))

    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'VALIDATION_FAILED')
    assert.equal(fetchMock.calls.length, 0)
  })

  it('exchanges a mini-program-confirmed one-time code and forwards a signed read-only request', async () => {
    const fetchMock = fetchQueue(new Response(JSON.stringify({ ok: true, data: { people: {} } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const { bff, confirm, exchange, sessionCookie } = await confirmedLogin(fetchMock)

    assert.equal(confirm.status, 200)
    assert.equal(exchange.status, 200)
    assert.equal((await exchange.clone().json()).state, 'AUTHENTICATED')
    const response = await bff.handle(new Request(`${ORIGIN}/api/admin`, {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion: 1, action: 'mip.admin.dashboard.overview.get', input: {} }),
    }))

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, data: { people: {} } })
    const upstreamBody = JSON.parse(fetchMock.calls[0][1]?.body as string)
    assert.deepEqual(upstreamBody.principal, { appId: 'wx-mip-app', openId: 'trusted-admin-openid' })
    assert.equal(upstreamBody.request.action, 'mip.admin.dashboard.overview.get')
    assert.match(upstreamBody.signature, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(upstreamBody).includes(SESSION_SECRET), false)
    assert.equal(JSON.stringify(upstreamBody).includes(LOGIN_SECRET), false)
  })

  it('keeps the challenge pending until a trusted mini-program administrator confirms it', async () => {
    const bff = createAdminBff(env(), { now: () => NOW })
    const start = await bff.handle(new Request(`${ORIGIN}/api/auth/challenge`, {
      method: 'POST', headers: { origin: ORIGIN },
    }))
    const pending = await bff.handle(new Request(`${ORIGIN}/api/auth/challenge/status`, {
      method: 'POST', headers: { cookie: cookieValue(start, 'mip_admin_login_challenge'), origin: ORIGIN },
    }))

    assert.equal(start.status, 201)
    assert.match((await start.clone().json()).code, /^\d{6}$/)
    assert.deepEqual(await pending.json(), {
      state: 'PENDING', expiresAt: new Date(NOW + 5 * 60 * 1000).toISOString(), pollAfterMs: 1_500,
    })
  })

  it('distinguishes malformed and forged confirmations and makes a challenge single-use', async () => {
    const bff = createAdminBff(env(), { now: () => NOW })
    const start = await bff.handle(new Request(`${ORIGIN}/api/auth/challenge`, {
      method: 'POST', headers: { origin: ORIGIN },
    }))
    const challenge = await start.clone().json() as { code: string }
    const malformed = await bff.handle(new Request(`${ORIGIN}/api/internal/auth/challenge/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        transport: 'MIP_WEB_LOGIN_CONFIRM_V1', timestamp: NOW,
        nonce: '0123456789abcdefghijklmn', challengeCode: 'ABC123',
        principal: { appId: 'wx-mip-app', openId: 'attacker' }, signature: '0'.repeat(64),
      }),
    }))
    assert.equal(malformed.status, 400)
    assert.equal((await malformed.json()).error.code, 'CONFIRMATION_INVALID')

    const forgedBody = await loginConfirmationBody(challenge.code)
    const forged = await bff.handle(new Request(`${ORIGIN}/api/internal/auth/challenge/confirm`, {
      method: 'POST',
      body: JSON.stringify({ ...forgedBody, signature: '0'.repeat(64) }),
    }))
    assert.equal(forged.status, 401)
    assert.equal((await forged.json()).error.code, 'CONFIRMATION_SIGNATURE_INVALID')

    const authenticated = await confirmedLogin(fetchQueue())
    const replay = await authenticated.bff.handle(new Request(`${ORIGIN}/api/auth/challenge/status`, {
      method: 'POST', headers: { cookie: authenticated.challengeCookie, origin: ORIGIN },
    }))
    assert.equal(replay.status, 410)
  })

  it('reports missing login configuration separately from invalid codes', async () => {
    const missingSecret = createAdminBff({ ...env(), MIP_ADMIN_WEB_LOGIN_HMAC_SECRET: undefined }, { now: () => NOW })
    const response = await missingSecret.handle(new Request(`${ORIGIN}/api/auth/challenge`, {
      method: 'POST', headers: { origin: ORIGIN },
    }))

    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'AUTH_NOT_CONFIGURED')
  })

  it('atomically locks each trusted AppID and principal after five failed codes for five minutes', async () => {
    const database = new MemoryD1()
    let now = NOW
    const bff = createAdminBff(env(database), { now: () => now })
    const start = await bff.handle(new Request(`${ORIGIN}/api/auth/challenge`, {
      method: 'POST', headers: { origin: ORIGIN },
    }))
    const challenge = await start.clone().json() as { code: string }
    const secondStart = await bff.handle(new Request(`${ORIGIN}/api/auth/challenge`, {
      method: 'POST', headers: { origin: ORIGIN },
    }))
    const secondChallenge = await secondStart.clone().json() as { code: string }
    const wrongCode = challenge.code === '000000' ? '000001' : '000000'
    const confirm = async (code: string, openId = 'trusted-admin-openid') => bff.handle(new Request(
      `${ORIGIN}/api/internal/auth/challenge/confirm`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(await loginConfirmationBody(code, {
          now,
          principal: { appId: 'wx-mip-app', openId, displayName: '运营成员' },
        })),
      },
    ))

    for (let attempt = 1; attempt < 5; attempt += 1) {
      const response = await confirm(wrongCode)
      assert.equal(response.status, 404)
      assert.equal((await response.json()).error.code, 'CHALLENGE_NOT_FOUND')
    }
    const locked = await confirm(wrongCode)
    assert.equal(locked.status, 429)
    assert.equal(locked.headers.get('retry-after'), '300')
    assert.equal((await locked.json()).error.code, 'CHALLENGE_RATE_LIMITED')
    assert.equal(database.limits.size, 1)
    assert.match([...database.limits.keys()][0], /^[a-f0-9]{64}$/)
    assert.equal([...database.limits.keys()][0].includes('trusted-admin-openid'), false)

    assert.equal((await confirm(challenge.code)).status, 429)
    const otherPrincipal = await confirm(challenge.code, 'another-trusted-admin')
    assert.equal(otherPrincipal.status, 200)
    assert.equal(database.limits.size, 1)

    now += 5 * 60 * 1000
    assert.equal((await confirm(secondChallenge.code)).status, 200)
    assert.equal(database.limits.size, 0)
  })

  it('clears expired challenges before issuing a new six-digit code', async () => {
    const database = new MemoryD1()
    let now = NOW
    const bff = createAdminBff(env(database), { now: () => now })
    const request = () => bff.handle(new Request(`${ORIGIN}/api/auth/challenge`, {
      method: 'POST', headers: { origin: ORIGIN },
    }))

    const first = await request()
    assert.equal(first.status, 201)
    assert.equal(database.rows.size, 1)
    now += 5 * 60 * 1000 + 1
    const second = await request()
    assert.equal(second.status, 201)
    assert.match((await second.json()).code, /^\d{6}$/)
    assert.equal(database.rows.size, 1)
  })

  it('rejects missing or tampered sessions without contacting the upstream', async () => {
    const fetchMock = fetchQueue()
    const bff = createAdminBff(env(), { fetch: fetchMock, now: () => NOW })
    const request = (cookie: string) => new Request(`${ORIGIN}/api/admin`, {
      method: 'POST', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion: 1, action: 'mip.admin.users.list', input: { limit: 50 } }),
    })

    assert.equal((await bff.handle(request(''))).status, 401)
    assert.equal((await bff.handle(request('mip_admin_session=forged.value'))).status, 401)
    assert.equal(fetchMock.calls.length, 0)
  })

  it('forwards every explicitly reviewed query action', async () => {
    assert.equal(REVIEWED_QUERY_ACTIONS.length, 80)
    const fetchMock = fetchQueue(...REVIEWED_QUERY_ACTIONS.map(action => new Response(JSON.stringify({
      ok: true,
      data: { action },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)

    for (const action of REVIEWED_QUERY_ACTIONS) {
      const input = reviewedQueryInput(action)
      const response = await bff.handle(new Request(`${ORIGIN}/api/admin`, {
        method: 'POST',
        headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ contractVersion: 1, action, input }),
      }))
      assert.equal(response.status, 200, action)
      assert.deepEqual(await response.json(), { ok: true, data: { action } }, action)
    }

    assert.equal(fetchMock.calls.length, REVIEWED_QUERY_ACTIONS.length)
    assert.deepEqual(fetchMock.calls.map(([, init]) => {
      const envelope = JSON.parse(String(init?.body))
      return { action: envelope.request.action, input: envelope.request.input }
    }), REVIEWED_QUERY_ACTIONS.map(action => ({ action, input: reviewedQueryInput(action) })))
  })

  it('restricts sensitive export actions to user and order filters plus opaque ticket credentials', async () => {
    const fetchMock = fetchQueue()
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)
    const submit = (action: string, input: Record<string, unknown>, mutation = true) => bff.handle(new Request(`${ORIGIN}/api/admin`, {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: 1,
        action,
        input,
        ...(mutation ? { idempotencyKey: 'web-export-operation-fixture' } : {}),
      }),
    }))

    const invalid = [
      submit('mip.admin.exports.create', { exportType: 'EVENT_ROSTER_ALL', includesPhone: false, filters: {} }),
      submit('mip.admin.exports.create', { exportType: 'ORDERS', includesPhone: true, filters: {} }),
      submit('mip.admin.exports.create', { exportType: 'USERS', includesPhone: false, filters: { branchId: 'branch-a' } }),
      submit('mip.admin.exports.reserve', { ticketId: 'ticket-a', token: 'short' }),
      submit('mip.admin.exports.status', { ticketId: 'ticket-a', token: EXPORT_TOKEN, extra: true }, false),
    ]
    for (const response of await Promise.all(invalid)) {
      assert.equal(response.status, 400)
      assert.equal((await response.json()).error.code, 'VALIDATION_FAILED')
    }
    assert.equal(fetchMock.calls.length, 0)
  })

  it('rejects unreviewed Banner query fields and malformed Banner identifiers', async () => {
    const fetchMock = fetchQueue()
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)
    const submit = (action: string, input: Record<string, unknown>) => bff.handle(new Request(`${ORIGIN}/api/admin`, {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion: 1, action, input }),
    }))

    for (const response of await Promise.all([
      submit('mip.admin.banners.session', { appId: 'forged' }),
      submit('mip.admin.banners.list', { filters: { query: '活动', ownerUserId: 'forged' } }),
      submit('mip.admin.banners.list', { filters: { status: 'UNKNOWN' } }),
      submit('mip.admin.banners.get', { bannerId: 'not-a-uuid' }),
    ])) {
      assert.equal(response.status, 400)
      assert.equal((await response.json()).error.code, 'VALIDATION_FAILED')
    }
    assert.equal(fetchMock.calls.length, 0)
  })

  it('rejects malformed game queries before signing the upstream envelope', async () => {
    const fetchMock = fetchQueue()
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)
    const submit = (action: string, input: Record<string, unknown>) => bff.handle(new Request(`${ORIGIN}/api/admin`, {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion: 1, action, input }),
    }))
    const invalid = [
      submit('mip.admin.game.session', { roleKey: 'PLATFORM_OWNER' }),
      submit('mip.admin.game.rankings.list', { seasonId: 'bad', rankingType: 'TEAM_HALF_YEAR' }),
      submit('mip.admin.game.members.assignable.list', { seasonId: '30000000-0000-4000-8000-000000000001', teamId: '30000000-0000-4000-8000-000000000002', query: '', limit: 0 }),
      submit('mip.admin.game.blindBoxes.cards.list', { catalogId: 'bad' }),
    ]
    for (const response of await Promise.all(invalid)) {
      assert.equal(response.status, 400)
      assert.equal((await response.json()).error.code, 'VALIDATION_FAILED')
    }
    assert.equal(fetchMock.calls.length, 0)
  })

  it('rejects mutations and query actions outside the reviewed batch', async () => {
    const fetchMock = fetchQueue()
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)

    for (const action of ['mip.admin.webLogin.confirm', 'mip.admin.communityReports.archive']) {
      const response = await bff.handle(new Request(`${ORIGIN}/api/admin`, {
        method: 'POST',
        headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ contractVersion: 1, action, input: {} }),
      }))
      assert.equal(response.status, 403, action)
    }
    assert.equal(fetchMock.calls.length, 0)
  })

  it('forwards only the reviewed mutations with a business idempotency key and fresh nonce', async () => {
    const fetchMock = fetchQueue(...REVIEWED_MUTATION_ACTIONS.map(action => new Response(JSON.stringify({
      ok: true,
      data: { action },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)

    for (const [index, action] of REVIEWED_MUTATION_ACTIONS.entries()) {
      const response = await bff.handle(new Request(`${ORIGIN}/api/admin`, {
        method: 'POST',
        headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          contractVersion: 1,
          action,
          idempotencyKey: `web-mutation-${index.toString().padStart(2, '0')}`,
          input: reviewedMutationInput(action),
        }),
      }))
      assert.equal(response.status, 200, action)
      assert.deepEqual(await response.json(), { ok: true, data: { action } }, action)
    }

    const envelopes = fetchMock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    assert.deepEqual(envelopes.map((envelope) => envelope.request.action), REVIEWED_MUTATION_ACTIONS)
    assert.deepEqual(envelopes.map((envelope) => envelope.request.idempotencyKey),
      REVIEWED_MUTATION_ACTIONS.map((_, index) => `web-mutation-${index.toString().padStart(2, '0')}`))
    assert.ok(envelopes.every((envelope) => /^[A-Za-z0-9_-]{32}$/.test(envelope.nonce)))
    assert.equal(new Set(envelopes.map((envelope) => envelope.nonce)).size, envelopes.length)
  })

  it('rejects mutation requests without a valid idempotency key and never retries upstream', async () => {
    const fetchMock = fetchQueue()
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)
    const request = (action: string, idempotencyKey?: unknown) => new Request(`${ORIGIN}/api/admin`, {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion: 1, action, input: {}, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) }),
    })

    for (const key of [undefined, '', 'too-short', 'web mutation key with spaces']) {
      const response = await bff.handle(request('mip.admin.events.clone', key))
      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), {
        ok: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: '写操作必须提供有效的业务幂等键', retryable: false },
      })
    }
    assert.equal(fetchMock.calls.length, 0)

    let upstreamAttempts = 0
    const throwingFetch = Object.assign((async () => {
      upstreamAttempts += 1
      throw new Error('NETWORK_DOWN')
    }) as typeof fetch, { calls: [] })
    const networkBff = createAdminBff(env(), { fetch: throwingFetch, now: () => NOW })
    const response = await networkBff.handle(new Request(`${ORIGIN}/api/admin`, {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: 1,
        action: 'mip.admin.refunds.submit',
        input: reviewedMutationInput('mip.admin.refunds.submit'),
        idempotencyKey: 'web-refund-request-01',
      }),
    }))
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '运营服务暂时不可用', retryable: false },
    })
    assert.equal(upstreamAttempts, 1)
  })

  it('rejects browser-controlled fields before signing reviewed mutations', async () => {
    const fetchMock = fetchQueue()
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)
    const cases = [
      ['mip.admin.memberships.grant', { userId: 'user-a', forged: true }],
      ['mip.admin.events.clone', { sourceEventId: 'event-a', forged: true }],
      ['mip.admin.events.changeStatus', { eventId: 'event-a', status: 'PUBLISHED', forged: true }],
      ['mip.admin.events.archive', { eventId: 'event-a', reason: '归档', forged: true }],
      ['mip.admin.communications.publishEventReminder', { eventId: 'event-a', recipientUserIds: ['user-a'] }],
      ['mip.admin.refunds.submit', { orderId: 'order-a', amountCents: 1 }],
      ['mip.admin.banners.save', {
        banner: {
          title: 'Banner', accessibilityLabel: '说明',
          imageAssetId: '20000000-0000-4000-8000-000000000002',
          targetType: 'MINIPROGRAM_PATH', targetValue: '/pages/events/index',
          ownerUserId: 'forged',
        },
      }],
      ['mip.admin.banners.save', {
        bannerId: '10000000-0000-4000-8000-000000000001',
        banner: {
          title: 'Banner', accessibilityLabel: '说明',
          imageAssetId: '20000000-0000-4000-8000-000000000002',
          targetType: 'MINIPROGRAM_PATH', targetValue: '/pages/events/index',
        },
      }],
      ['mip.admin.banners.changeStatus', {
        bannerId: '10000000-0000-4000-8000-000000000001', expectedVersion: 1, status: 'DELETED',
      }],
      ['mip.admin.banners.move', {
        bannerId: '10000000-0000-4000-8000-000000000001', expectedVersion: 1, direction: 'LEFT',
      }],
      ['mip.admin.game.seasons.save', {
        season: { ...CORE_MUTATION_INPUTS['mip.admin.game.seasons.save'].season as object, clientScore: 100 },
      }],
      ['mip.admin.game.teams.members.replace', {
        ...CORE_MUTATION_INPUTS['mip.admin.game.teams.members.replace'],
        members: [{ memberRef: 'a', role: 'CAPTAIN' }, { memberRef: 'b', role: 'CAPTAIN' }],
      }],
      ['mip.admin.game.matches.save', {
        match: {
          ...CORE_MUTATION_INPUTS['mip.admin.game.matches.save'].match as object,
          weekEnd: '2030-01-10',
          teamAScore: 100,
        },
      }],
      ['mip.admin.game.blindBoxes.cards.save', {
        card: { ...CORE_MUTATION_INPUTS['mip.admin.game.blindBoxes.cards.save'].card as object, rewardAmount: 999 },
      }],
    ] as const

    for (const [index, [action, input]] of cases.entries()) {
      const response = await bff.handle(new Request(`${ORIGIN}/api/admin`, {
        method: 'POST',
        headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          contractVersion: 1,
          action,
          idempotencyKey: `web-input-review-${index.toString().padStart(2, '0')}`,
          input,
        }),
      }))
      assert.equal(response.status, 400, action)
      assert.deepEqual(await response.json(), {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: '运营请求包含未开放字段', retryable: false },
      })
    }
    assert.equal(fetchMock.calls.length, 0)
  })

  it('uses the same canonical signing representation as the CloudBase adapter', () => {
    assert.equal(
      canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: ['x'] }),
      '{"a":["x"],"nested":{"a":1,"b":2},"z":1}',
    )
  })
})
