import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canonicalJson, createAdminBff, type AdminBffEnv } from './admin-bff.ts'

const NOW = Date.UTC(2030, 0, 1)
const ORIGIN = 'https://mipmini.01mvp.com'
const env: AdminBffEnv = {
  MIP_ADMIN_UPSTREAM_URL: 'https://cloud.example.test/mip-admin-api',
  MIP_ADMIN_UPSTREAM_HMAC_SECRET: 'upstream-hmac-secret-that-is-long-enough-for-tests',
  MIP_WEB_ALLOWED_APP_IDS: 'wx-mip-app',
  MIP_WEB_ALLOWED_ORIGIN: ORIGIN,
  MIP_WEB_IDENTITY_AUTHORIZE_URL: 'https://identity.example.test/authorize',
  MIP_WEB_IDENTITY_CLIENT_ID: 'mip-admin-web',
  MIP_WEB_IDENTITY_CLIENT_SECRET: 'server-only-client-secret',
  MIP_WEB_IDENTITY_EXCHANGE_URL: 'https://identity.example.test/exchange',
  MIP_WEB_SESSION_SECRET: 'session-encryption-secret-that-is-long-enough-for-tests',
}

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

function identityResponse(value: object) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

function cookieValue(response: Response, name: string) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || '']
  const match = values.join(',').match(new RegExp(`${name}=([^;,]+)`))
  if (!match) throw new Error(`COOKIE_NOT_FOUND:${name}`)
  return `${name}=${match[1]}`
}

async function login(fetchMock: FetchMock) {
  const bff = createAdminBff(env, { fetch: fetchMock, now: () => NOW })
  const start = await bff.handle(new Request(`${ORIGIN}/api/auth/login?returnTo=%2Fusers`))
  const authorize = new URL(start.headers.get('location')!)
  const callback = await bff.handle(new Request(
    `${ORIGIN}/api/auth/callback?code=verified-code&state=${authorize.searchParams.get('state')}`,
    { headers: { cookie: cookieValue(start, 'mip_admin_oauth_state') } },
  ))
  return { bff, callback, sessionCookie: cookieValue(callback, 'mip_admin_session') }
}

describe('Admin Web BFF', () => {
  it('exchanges identity server-side and forwards a signed read-only request', async () => {
    const fetchMock = fetchQueue(
      identityResponse({
        verified: true,
        appId: 'wx-mip-app',
        openId: 'trusted-admin-openid',
        displayName: '运营成员',
      }),
      new Response(JSON.stringify({ ok: true, data: { people: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const { bff, callback, sessionCookie } = await login(fetchMock)

    assert.equal(callback.status, 302)
    assert.equal(callback.headers.get('location'), `${ORIGIN}/users`)
    const response = await bff.handle(new Request(`${ORIGIN}/api/admin`, {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: 1,
        action: 'mip.admin.dashboard.overview.get',
        input: {},
      }),
    }))

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, data: { people: {} } })
    const exchangeHeaders = fetchMock.calls[0][1]?.headers as Record<string, string>
    assert.match(exchangeHeaders.authorization, /^Basic /)
    const upstreamBody = JSON.parse(fetchMock.calls[1][1]?.body as string)
    assert.deepEqual(upstreamBody.principal, { appId: 'wx-mip-app', openId: 'trusted-admin-openid' })
    assert.equal(upstreamBody.request.action, 'mip.admin.dashboard.overview.get')
    assert.match(upstreamBody.signature, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(upstreamBody).includes(env.MIP_WEB_SESSION_SECRET!), false)
    assert.equal(JSON.stringify(upstreamBody).includes(env.MIP_WEB_IDENTITY_CLIENT_SECRET!), false)
  })

  it('rejects missing or tampered sessions without contacting the upstream', async () => {
    const fetchMock = fetchQueue()
    const bff = createAdminBff(env, { fetch: fetchMock, now: () => NOW })
    const request = (cookie: string) => new Request(`${ORIGIN}/api/admin`, {
      method: 'POST',
      headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion: 1, action: 'mip.admin.users.list', input: { limit: 50 } }),
    })

    const missing = await bff.handle(request(''))
    const tampered = await bff.handle(request('mip_admin_session=forged.value'))

    assert.equal(missing.status, 401)
    assert.equal(tampered.status, 401)
    assert.equal(fetchMock.calls.length, 0)
  })

  it('does not trust identity-provider output without verification and app allowlisting', async () => {
    for (const identity of [
      { appId: 'wx-mip-app', openId: 'admin' },
      { verified: true, appId: 'wx-other-app', openId: 'admin' },
    ]) {
      const fetchMock = fetchQueue(identityResponse(identity))
      const bff = createAdminBff(env, { fetch: fetchMock, now: () => NOW })
      const start = await bff.handle(new Request(`${ORIGIN}/api/auth/login`))
      const authorize = new URL(start.headers.get('location')!)
      const callback = await bff.handle(new Request(
        `${ORIGIN}/api/auth/callback?code=code&state=${authorize.searchParams.get('state')}`,
        { headers: { cookie: cookieValue(start, 'mip_admin_oauth_state') } },
      ))
      assert.equal(callback.status, 401)
      assert.equal(Boolean(callback.headers.get('set-cookie')?.includes('mip_admin_session=')), false)
    }
  })

  it('allows only the explicitly reviewed query actions', async () => {
    const fetchMock = fetchQueue(identityResponse({
      verified: true, appId: 'wx-mip-app', openId: 'trusted-admin-openid',
    }))
    const { bff, sessionCookie } = await login(fetchMock)
    const response = await bff.handle(new Request(`${ORIGIN}/api/admin`, {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion: 1, action: 'mip.admin.users.update', input: {} }),
    }))

    assert.equal(response.status, 403)
    assert.equal(fetchMock.calls.length, 1)
  })

  it('uses the same canonical signing representation as the CloudBase adapter', () => {
    assert.equal(
      canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: ['x'] }),
      '{"a":["x"],"nested":{"a":1,"b":2},"z":1}',
    )
  })
})
