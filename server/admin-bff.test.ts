import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canonicalJson,
  createAdminBff,
  type AdminBffEnv,
  type D1DatabaseBinding,
} from './admin-bff.ts'

const NOW = Date.UTC(2030, 0, 1)
const ORIGIN = 'https://mipmini.01mvp.com'
const SESSION_SECRET = 'session-encryption-secret-that-is-long-enough-for-tests'
const LOGIN_SECRET = 'login-confirm-secret-that-is-long-enough-for-tests'
const REVIEWED_QUERY_ACTIONS = [
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
] as const
const REVIEWED_MUTATION_ACTIONS = [
  'mip.admin.memberships.grant',
  'mip.admin.events.clone',
  'mip.admin.communications.publishEventReminder',
  'mip.admin.refunds.submit',
] as const

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

class MemoryD1 implements D1DatabaseBinding {
  readonly rows = new Map<string, Row>()

  prepare(query: string) {
    let values: unknown[] = []
    const statement = {
      bind: (...input: unknown[]) => {
        values = input
        return statement
      },
      first: async <T>() => {
        if (!query.includes('FROM mip_admin_web_login_challenges')) throw new Error('QUERY_UNSUPPORTED')
        const row = this.rows.get(String(values[0]))
        if (!row || row.browser_key_hash !== values[1]) return null
        return { ...row } as T
      },
      run: async () => {
        if (query.includes('INSERT INTO mip_admin_web_login_challenges')) {
          const [id, codeHash, browserKeyHash, createdAt, expiresAt] = values
          if ([...this.rows.values()].some(row => row.code_hash === codeHash)) throw new Error('UNIQUE')
          this.rows.set(String(id), {
            id: String(id), code_hash: String(codeHash), browser_key_hash: String(browserKeyHash),
            status: 'PENDING', app_id: null, open_id: null, display_name: null,
            created_at: Number(createdAt), expires_at: Number(expiresAt), confirmed_at: null, consumed_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (query.includes("SET status = 'CONFIRMED'")) {
          const [appId, openId, displayName, confirmedAt, codeHash] = values
          const row = [...this.rows.values()].find(item => item.code_hash === codeHash)
          if (!row || row.status !== 'PENDING' || row.expires_at < Number(confirmedAt)) {
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

async function confirmedLogin(fetchMock: FetchMock, database = new MemoryD1()) {
  const bff = createAdminBff(env(database), { fetch: fetchMock, now: () => NOW })
  const start = await bff.handle(new Request(`${ORIGIN}/api/auth/challenge`, {
    method: 'POST', headers: { origin: ORIGIN },
  }))
  const challengeCookie = cookieValue(start, 'mip_admin_login_challenge')
  const challenge = await start.clone().json() as { code: string }
  const unsigned = {
    transport: 'MIP_WEB_LOGIN_CONFIRM_V1', timestamp: NOW,
    nonce: '0123456789abcdefghijklmn', challengeCode: challenge.code,
    principal: { appId: 'wx-mip-app', openId: 'trusted-admin-openid', displayName: '运营成员' },
  }
  const signature = await hmacHex(LOGIN_SECRET, canonicalJson(unsigned))
  const confirm = await bff.handle(new Request(`${ORIGIN}/api/internal/auth/challenge/confirm`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...unsigned, signature }),
  }))
  const exchange = await bff.handle(new Request(`${ORIGIN}/api/auth/challenge/status`, {
    method: 'POST', headers: { cookie: challengeCookie, origin: ORIGIN },
  }))
  return { bff, challengeCookie, confirm, exchange, sessionCookie: cookieValue(exchange, 'mip_admin_session') }
}

describe('Admin Web BFF', () => {
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
    assert.match((await start.clone().json()).code, /^[A-HJ-NP-Z2-9]{8}$/)
    assert.deepEqual(await pending.json(), {
      state: 'PENDING', expiresAt: new Date(NOW + 5 * 60 * 1000).toISOString(), pollAfterMs: 1_500,
    })
  })

  it('rejects forged confirmation and makes a challenge single-use', async () => {
    const bff = createAdminBff(env(), { now: () => NOW })
    const start = await bff.handle(new Request(`${ORIGIN}/api/auth/challenge`, {
      method: 'POST', headers: { origin: ORIGIN },
    }))
    const challenge = await start.clone().json() as { code: string }
    const forged = await bff.handle(new Request(`${ORIGIN}/api/internal/auth/challenge/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        transport: 'MIP_WEB_LOGIN_CONFIRM_V1', timestamp: NOW,
        nonce: '0123456789abcdefghijklmn', challengeCode: challenge.code,
        principal: { appId: 'wx-mip-app', openId: 'attacker' }, signature: '0'.repeat(64),
      }),
    }))
    assert.equal(forged.status, 401)

    const authenticated = await confirmedLogin(fetchQueue())
    const replay = await authenticated.bff.handle(new Request(`${ORIGIN}/api/auth/challenge/status`, {
      method: 'POST', headers: { cookie: authenticated.challengeCookie, origin: ORIGIN },
    }))
    assert.equal(replay.status, 410)
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
    const fetchMock = fetchQueue(...REVIEWED_QUERY_ACTIONS.map(action => new Response(JSON.stringify({
      ok: true,
      data: { action },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)

    for (const action of REVIEWED_QUERY_ACTIONS) {
      const response = await bff.handle(new Request(`${ORIGIN}/api/admin`, {
        method: 'POST',
        headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ contractVersion: 1, action, input: {} }),
      }))
      assert.equal(response.status, 200, action)
      assert.deepEqual(await response.json(), { ok: true, data: { action } }, action)
    }

    assert.equal(fetchMock.calls.length, REVIEWED_QUERY_ACTIONS.length)
    assert.deepEqual(fetchMock.calls.map(([, init]) => {
      const envelope = JSON.parse(String(init?.body))
      return { action: envelope.request.action, input: envelope.request.input }
    }), REVIEWED_QUERY_ACTIONS.map(action => ({ action, input: {} })))
  })

  it('rejects mutations and query actions outside the reviewed batch', async () => {
    const fetchMock = fetchQueue()
    const { bff, sessionCookie } = await confirmedLogin(fetchMock)

    for (const action of ['mip.admin.users.update', 'mip.admin.communityReports.list']) {
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
          input: {},
        }),
      }))
      assert.equal(response.status, 200, action)
      assert.deepEqual(await response.json(), { ok: true, data: { action } }, action)
    }

    const envelopes = fetchMock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    assert.deepEqual(envelopes.map((envelope) => envelope.request.action), REVIEWED_MUTATION_ACTIONS)
    assert.deepEqual(envelopes.map((envelope) => envelope.request.idempotencyKey), [
      'web-mutation-00', 'web-mutation-01', 'web-mutation-02', 'web-mutation-03',
    ])
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
    const response = await networkBff.handle(request('mip.admin.refunds.submit', 'web-refund-request-01'))
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '运营服务暂时不可用', retryable: false },
    })
    assert.equal(upstreamAttempts, 1)
  })

  it('uses the same canonical signing representation as the CloudBase adapter', () => {
    assert.equal(
      canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: ['x'] }),
      '{"a":["x"],"nested":{"a":1,"b":2},"z":1}',
    )
  })
})
