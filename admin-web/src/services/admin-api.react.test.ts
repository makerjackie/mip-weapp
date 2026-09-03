import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApiClient, AdminApiClientError } from './admin-api'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AdminApiClient network failures', () => {
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
