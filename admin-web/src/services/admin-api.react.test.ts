import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApiClient, AdminApiClientError } from './admin-api'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AdminApiClient network failures', () => {
  it('accepts a bounded mini-program code image on the login challenge', async () => {
    const qrCodeDataUrl = `data:image/png;base64,${Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).toString('base64')}`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      state: 'PENDING',
      code: '123456',
      qrCodeDataUrl,
      expiresAt: '2030-01-01T00:05:00.000Z',
      pollAfterMs: 1_500,
    }), { status: 201 })))

    await expect(new AdminApiClient('/api/admin').beginLogin()).resolves.toMatchObject({
      code: '123456',
      qrCodeDataUrl,
    })
  })

  it('rejects an untrusted login challenge image URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      state: 'PENDING',
      code: '123456',
      qrCodeDataUrl: 'https://attacker.example/login.png',
      expiresAt: '2030-01-01T00:05:00.000Z',
      pollAfterMs: 1_500,
    }), { status: 201 })))

    await expect(new AdminApiClient('/api/admin').beginLogin()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })

  it('maps a login fetch failure to a retryable domain error', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input
      void _init
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(new AdminApiClient('/api/admin').beginLogin()).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      message: '网页登录服务连接失败，请稍后重试',
      retryable: true,
    } satisfies Partial<AdminApiClientError>)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps an admin fetch failure to a retryable domain error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    await expect(new AdminApiClient('/api/admin').getSession()).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: '运营服务连接失败，请稍后重试',
      retryable: true,
    } satisfies Partial<AdminApiClientError>)
  })

  it('aborts an admin request after the client timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })))

    const pending = new AdminApiClient('/api/admin').getSession().then(
      () => null,
      error => error,
    )
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(pending).resolves.toMatchObject({
      code: 'TIMEOUT',
      message: '请求超时，请重试',
      retryable: true,
    } satisfies Partial<AdminApiClientError>)
  })
})

describe('password authentication transport', () => {
  it('sends credentials in a same-origin POST body and never a URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authenticated: true })))
    vi.stubGlobal('fetch', fetchMock)
    await new AdminApiClient().loginWithPassword('13800000000', 'fictional-test-password')
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/password/login', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ phone: '13800000000', password: 'fictional-test-password' }),
    }))
  })

  it.each([[401, 'INVALID_CREDENTIALS'], [429, 'RATE_LIMITED']])('preserves password error code for HTTP %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code, message: '登录未完成' } }), { status })))
    await expect(new AdminApiClient().loginWithPassword('13800000000', 'fictional-test-password')).rejects.toMatchObject({ code, message: '登录未完成' })
  })

  it('reports a missing password route without falling back to demo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Not Found</html>', { status: 404 })))
    await expect(new AdminApiClient().loginWithPassword('13800000000', 'fictional-test-password')).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', message: '密码登录服务尚未部署，请使用小程序登录' })
  })

  it('reads password configuration using GET and rejects demo mutations before fetching', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ configured: true, maskedPhone: '138****0000', recentWechatAuth: false })))
    vi.stubGlobal('fetch', fetchMock)
    const client = new AdminApiClient()
    await expect(client.getPasswordStatus()).resolves.toMatchObject({ configured: true, recentWechatAuth: false })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/password', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    fetchMock.mockClear()
    Object.defineProperty(client, 'demoMode', { value: true })
    await expect(client.setPassword('fictional-test-password')).rejects.toMatchObject({ code: 'DEMO_READ_ONLY' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})


describe('password change response', () => {
  it.each([true, false])('preserves requiresLogin=%s from the server', async requiresLogin => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ configured: true, requiresLogin }))))
    await expect(new AdminApiClient().setPassword('fictional-test-password')).resolves.toEqual({ configured: true, requiresLogin })
  })
  it('rejects responses without the session revocation decision', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ configured: true }))))
    await expect(new AdminApiClient().setPassword('fictional-test-password')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})


describe('password login service startup', () => {
  it('waits through JSON and gateway failures before successful login', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'AUTH_UNAVAILABLE' } }), { status: 503 }))
      .mockResolvedValueOnce(new Response('<html>Starting</html>', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true })))
    vi.stubGlobal('fetch', fetchMock)
    const pending = new AdminApiClient().loginWithPassword('13800000000', 'fictional-test-password')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_001)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('stops after three temporary failures', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response('Starting', { status: 504 }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = new AdminApiClient().loginWithPassword('13800000000', 'fictional-test-password').catch(error => error)
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ code: 'AUTH_UNAVAILABLE', message: '登录服务仍未就绪，请稍后重试' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each([[401, 'INVALID_CREDENTIALS'], [403, 'FORBIDDEN'], [429, 'RATE_LIMITED'], [503, 'CONFIGURATION_REQUIRED']])('never retries %s %s', async (status, code) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code } }), { status }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(new AdminApiClient().loginWithPassword('13800000000', 'fictional-test-password')).rejects.toMatchObject({ code })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not replay an ambiguous network failure or a password change', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'AUTH_UNAVAILABLE' } }), { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new AdminApiClient()
    await expect(client.loginWithPassword('13800000000', 'fictional-test-password')).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE' })
    await expect(client.setPassword('fictional-test-password')).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('cancels pending retries when the login dialog closes', async () => {
    vi.useFakeTimers()
    let current = true
    const fetchMock = vi.fn(async () => new Response('Starting', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = new AdminApiClient().loginWithPassword('13800000000', 'fictional-test-password', () => current)
    await vi.advanceTimersByTimeAsync(1_000)
    current = false
    await vi.runAllTimersAsync()
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('image gateway transport', () => {
  it('uploads an image above the text gateway limit with the binary content type', async () => {
    const bytes = new Uint8Array(120 * 1024)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    bytes[19] = 96
    bytes[23] = 64
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { assetId: '58000000-0000-4000-8000-000000000011', imageUrl: 'https://example.test/image.png' } })))
    vi.stubGlobal('fetch', fetchMock)
    await new AdminApiClient().uploadImage({ name: 'cover.png', type: 'image/png', size: bytes.length, arrayBuffer: async () => bytes.buffer }, 'EVENT_COVER')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/media/image')
    expect(new Headers(init.headers).get('content-type')).toBe('application/octet-stream')
    expect(String(init.body).length).toBeGreaterThan(100 * 1024)
    expect(JSON.parse(String(init.body))).toMatchObject({ action: 'mip.admin.media.uploadImage', input: { purpose: 'EVENT_COVER' } })
  })
})
