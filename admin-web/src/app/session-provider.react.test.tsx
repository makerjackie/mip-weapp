import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApiClient, AdminApiClientError } from '../services/admin-api'
import { SessionProvider, isProtectedAdminQueryKey, useAdminSession } from './session-provider'

afterEach(cleanup)

class SessionClient extends AdminApiClient {
  readonly logoutSpy = vi.fn(async () => undefined)
  private reads = 0

  override async getSession() {
    this.reads += 1
    return this.reads === 1
      ? { enabled: true, actor: { id: 'actor-a', name: '账号 A' }, capabilities: [{ capability: 'users.read', scopeType: 'PLATFORM' }] }
      : { enabled: false }
  }

  override async logout() {
    await this.logoutSpy()
  }
}

function SessionProbe() {
  const session = useAdminSession()
  return (
    <div>
      <span>{session.session?.actor?.id || 'anonymous'}</span>
      <span>{session.sessionBoundary}</span>
      <button onClick={() => void session.logout()}>退出</button>
      <button onClick={() => void session.refreshSession()}>刷新</button>
    </div>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const actorSession = (id: string) => ({ enabled: true, actor: { id, name: id }, capabilities: [{ capability: 'users.read', scopeType: 'PLATFORM' }] })

function ExpiringSessionProbe() {
  const session = useAdminSession()
  return <>
    <span>{session.session?.actor?.id || 'anonymous'}</span>
    <span>{session.error?.code || 'no-error'}</span>
    <button onClick={() => void session.request('mip.admin.users.list').catch(() => undefined)}>加载用户</button>
  </>
}

class ConfirmedLoginFailureClient extends AdminApiClient {
  private reads = 0

  override async getSession() {
    this.reads += 1
    if (this.reads === 1) return { enabled: false }
    if (this.reads === 2) throw new AdminApiClientError('TIMEOUT', '请求超时，请重试', true)
    return { enabled: true, actor: { id: 'actor-a', name: '运营账号' }, capabilities: [] }
  }

  override async beginLogin() {
    return {
      state: 'PENDING' as const,
      code: '123456',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pollAfterMs: 0,
    }
  }

  override async pollLogin() {
    return {
      state: 'AUTHENTICATED' as const,
      actor: { name: '运营账号' },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
  }
}

function LoginProbe() {
  const session = useAdminSession()
  return (
    <div>
      <span>{session.challenge?.code || 'no-code'}</span>
      <span>{session.loginError || 'no-error'}</span>
      <span>{session.session?.actor?.id || 'anonymous'}</span>
      <button onClick={() => void (session.loginConfirmed ? session.retryConfirmedLogin() : session.beginLogin())}>
        {session.loginConfirmed ? '重新加载会话' : '登录'}
      </button>
      <button onClick={session.closeLogin}>关闭登录</button>
    </div>
  )
}

describe('admin session query boundary', () => {
  it('keeps the newest session when an older refresh finishes last', async () => {
    const client = new AdminApiClient()
    const older = deferred<Awaited<ReturnType<typeof client.getSession>>>()
    const latest = deferred<Awaited<ReturnType<typeof client.getSession>>>()
    vi.spyOn(client, 'getSession').mockResolvedValueOnce(actorSession('actor-a'))
      .mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise)
    render(<QueryClientProvider client={new QueryClient()}><SessionProvider client={client}><SessionProbe /></SessionProvider></QueryClientProvider>)
    await screen.findByText('actor-a')
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    await act(async () => { latest.resolve(actorSession('actor-b')); await latest.promise })
    await screen.findByText('actor-b')
    await act(async () => { older.resolve(actorSession('actor-a')); await older.promise })
    expect(screen.getByText('actor-b')).toBeVisible()
  })

  it('ignores an older refresh authentication error after the latest session succeeds', async () => {
    const client = new AdminApiClient()
    const older = deferred<Awaited<ReturnType<typeof client.getSession>>>()
    vi.spyOn(client, 'getSession').mockResolvedValueOnce(actorSession('actor-a'))
      .mockReturnValueOnce(older.promise).mockResolvedValueOnce(actorSession('actor-b'))
    render(<QueryClientProvider client={new QueryClient()}><SessionProvider client={client}><SessionProbe /></SessionProvider></QueryClientProvider>)
    await screen.findByText('actor-a')
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByText('actor-b')
    await act(async () => { older.reject(new AdminApiClientError('AUTH_REQUIRED', '旧会话失效')); await older.promise.catch(() => undefined) })
    expect(screen.getByText('actor-b')).toBeVisible()
  })

  it('does not restore a stale session while logout is in flight', async () => {
    const client = new AdminApiClient()
    const older = deferred<Awaited<ReturnType<typeof client.getSession>>>()
    const signingOut = deferred<void>()
    vi.spyOn(client, 'getSession').mockResolvedValueOnce(actorSession('actor-a'))
      .mockReturnValueOnce(older.promise).mockResolvedValue({ enabled: false })
    vi.spyOn(client, 'logout').mockReturnValue(signingOut.promise)
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}><SessionProvider client={client}><SessionProbe /></SessionProvider></QueryClientProvider>)
    await screen.findByText('actor-a')
    queryClient.setQueryData(['admin', 'users'], { confidential: 'old data' })
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    await userEvent.click(screen.getByRole('button', { name: '退出' }))
    await act(async () => { older.resolve(actorSession('actor-a')); await older.promise })
    expect(screen.getByText('anonymous')).toBeVisible()
    expect(queryClient.getQueryData(['admin', 'users'])).toBeUndefined()
    await act(async () => { signingOut.resolve(); await signingOut.promise })
  })
  it('rejects stale request results and prevents a previous account callback from dispatching', async () => {
    const client = new AdminApiClient()
    const pending = deferred<unknown>()
    const transport = vi.spyOn(client, 'request').mockReturnValue(pending.promise)
    vi.spyOn(client, 'getSession').mockResolvedValueOnce(actorSession('actor-a')).mockResolvedValue(actorSession('actor-b'))
    let latest!: ReturnType<typeof useAdminSession>
    function Probe() {
      const session = useAdminSession()
      useEffect(() => { latest = session }, [session])
      return <span>{session.session?.actor?.id || 'anonymous'}</span>
    }
    render(<QueryClientProvider client={new QueryClient()}><SessionProvider client={client}><Probe /></SessionProvider></QueryClientProvider>)
    await screen.findByText('actor-a')
    const oldRequest = latest.request
    const inFlight = oldRequest('mip.admin.users.list').catch(error => error)
    await act(async () => { await latest.refreshSession() })
    await screen.findByText('actor-b')
    await act(async () => { pending.resolve({ items: [{ id: 'old-private-data' }] }); await pending.promise })
    expect(await inFlight).toMatchObject({ code: 'SESSION_CHANGED' })
    await expect(oldRequest('mip.admin.users.list')).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(transport).toHaveBeenCalledOnce()
  })

  it('ignores an old authentication failure after switching away and back to the same account', async () => {
    const client = new AdminApiClient(), pending = deferred<unknown>()
    vi.spyOn(client, 'request').mockReturnValue(pending.promise)
    vi.spyOn(client, 'getSession').mockResolvedValueOnce(actorSession('actor-a'))
      .mockResolvedValueOnce(actorSession('actor-b')).mockResolvedValue(actorSession('actor-a'))
    let latest!: ReturnType<typeof useAdminSession>
    function Probe() {
      const session = useAdminSession()
      useEffect(() => { latest = session }, [session])
      return <span>{session.session?.actor?.id || 'anonymous'}</span>
    }
    render(<QueryClientProvider client={new QueryClient()}><SessionProvider client={client}><Probe /></SessionProvider></QueryClientProvider>)
    await screen.findByText('actor-a')
    const old = latest.request('mip.admin.users.list').catch(error => error)
    await act(async () => { await latest.refreshSession() })
    await screen.findByText('actor-b')
    await act(async () => { await latest.refreshSession() })
    await screen.findByText('actor-a')
    await act(async () => { pending.reject(new AdminApiClientError('AUTH_REQUIRED', '旧账号会话')); await old })
    expect(screen.getByText('actor-a')).toBeVisible()
  })

  it('does not revive an expired session from a refresh that started before the request failure', async () => {
    const client = new AdminApiClient(), pending = deferred<Awaited<ReturnType<typeof client.getSession>>>()
    vi.spyOn(client, 'getSession').mockResolvedValueOnce(actorSession('actor-a')).mockReturnValue(pending.promise)
    vi.spyOn(client, 'request').mockRejectedValue(new AdminApiClientError('AUTH_REQUIRED', '当前会话失效'))
    let latest!: ReturnType<typeof useAdminSession>
    function Probe() {
      const session = useAdminSession()
      useEffect(() => { latest = session }, [session])
      return <span>{session.session?.actor?.id || 'anonymous'}</span>
    }
    render(<QueryClientProvider client={new QueryClient()}><SessionProvider client={client}><Probe /></SessionProvider></QueryClientProvider>)
    await screen.findByText('actor-a')
    let refreshing!: Promise<boolean>
    await act(async () => { refreshing = latest.refreshSession() })
    await act(async () => { await latest.request('mip.admin.users.list').catch(() => undefined) })
    await screen.findByText('anonymous')
    await act(async () => { pending.resolve(actorSession('actor-a')); await refreshing })
    expect(screen.getByText('anonymous')).toBeVisible()
  })

  it('recognizes every protected admin query family', () => {
    expect(isProtectedAdminQueryKey(['admin', 'detail', 'actor-a'])).toBe(true)
    expect(isProtectedAdminQueryKey(['admin', 'read-page', 'actor-a'])).toBe(true)
    expect(isProtectedAdminQueryKey(['admin', 'overview', 'actor-a'])).toBe(true)
    expect(isProtectedAdminQueryKey(['admin-detail', 'actor-a'])).toBe(false)
    expect(isProtectedAdminQueryKey(['public-catalog'])).toBe(false)
  })

  it('removes protected cached data immediately on logout while preserving unrelated cache', async () => {
    const client = new SessionClient()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['admin', 'detail', 'actor-a', 1, 'users', 'user-1'], { title: '账号 A 的用户详情' })
    queryClient.setQueryData(['public-catalog'], { value: 'public' })
    render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider client={client}>
          <SessionProbe />
        </SessionProvider>
      </QueryClientProvider>,
    )

    await screen.findByText('actor-a')
    await userEvent.click(screen.getByRole('button', { name: '退出' }))
    await waitFor(() => expect(screen.getByText('anonymous')).toBeVisible())

    expect(client.logoutSpy).toHaveBeenCalledOnce()
    expect(queryClient.getQueriesData({ predicate: query => isProtectedAdminQueryKey(query.queryKey) })).toEqual([])
    expect(queryClient.getQueryData(['public-catalog'])).toEqual({ value: 'public' })
  })

  it('reports a retryable login error when session loading fails after confirmation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider client={new ConfirmedLoginFailureClient()}>
          <LoginProbe />
        </SessionProvider>
      </QueryClientProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    await screen.findByText('123456')
    await waitFor(() => {
      expect(screen.getByText('登录已确认，但运营会话暂时无法加载，请重试')).toBeVisible()
      expect(screen.getByText('no-code')).toBeVisible()
    }, { timeout: 2_000 })

    await userEvent.click(screen.getByRole('button', { name: '重新加载会话' }))
    await screen.findByText('actor-a')
  })

  it('ignores a pending challenge response after the login dialog closes', async () => {
    const client = new ConfirmedLoginFailureClient()
    let resolveChallenge!: (value: Awaited<ReturnType<typeof client.beginLogin>>) => void
    vi.spyOn(client, 'beginLogin').mockImplementation(() => new Promise(resolve => { resolveChallenge = resolve }))
    const poll = vi.spyOn(client, 'pollLogin')
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider client={client}><LoginProbe /></SessionProvider>
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    await userEvent.click(screen.getByRole('button', { name: '关闭登录' }))
    resolveChallenge({ state: 'PENDING', code: '123456', expiresAt: new Date(Date.now() + 60_000).toISOString(), pollAfterMs: 0 })
    await waitFor(() => expect(screen.getByText('no-code')).toBeVisible())
    expect(poll).not.toHaveBeenCalled()
  })
  it('clears the session and protected cache when a normal request requires login', async () => {
    const client = new SessionClient()
    const failure = new AdminApiClientError('AUTH_REQUIRED', '请登录后继续')
    vi.spyOn(client, 'request').mockRejectedValue(failure)
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}><SessionProvider client={client}>
      <ExpiringSessionProbe />
    </SessionProvider></QueryClientProvider>)
    await screen.findByText('actor-a')
    queryClient.setQueryData(['admin', 'users'], { private: '用户详情' })
    queryClient.setQueryData(['public-catalog'], { public: true })
    await userEvent.click(screen.getByRole('button', { name: '加载用户' }))
    await screen.findByText('anonymous')
    expect(screen.getByText('AUTH_REQUIRED')).toBeVisible()
    expect(queryClient.getQueryData(['admin', 'users'])).toBeUndefined()
    expect(queryClient.getQueryData(['public-catalog'])).toEqual({ public: true })
  })

  it('preserves the current session and cache after a non-authentication request failure', async () => {
    const client = new SessionClient()
    const request = vi.spyOn(client, 'request').mockRejectedValue(new AdminApiClientError('FORBIDDEN', '权限不足'))
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}><SessionProvider client={client}>
      <ExpiringSessionProbe />
    </SessionProvider></QueryClientProvider>)
    await screen.findByText('actor-a')
    queryClient.setQueryData(['admin', 'users'], { private: '用户详情' })
    await userEvent.click(screen.getByRole('button', { name: '加载用户' }))
    expect(request).toHaveBeenCalledOnce()
    expect(screen.getByText('actor-a')).toBeVisible()
    expect(queryClient.getQueryData(['admin', 'users'])).toEqual({ private: '用户详情' })
  })

})
