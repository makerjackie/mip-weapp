import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AdminApiClient } from '../services/admin-api'
import { SessionProvider, isProtectedAdminQueryKey, useAdminSession } from './session-provider'

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
    </div>
  )
}

describe('admin session query boundary', () => {
  it('recognizes every protected admin query family', () => {
    expect(isProtectedAdminQueryKey(['admin-detail', 'actor-a'])).toBe(true)
    expect(isProtectedAdminQueryKey(['admin', 'read-page'])).toBe(true)
    expect(isProtectedAdminQueryKey(['admin-read-page', 'actor-a'])).toBe(true)
    expect(isProtectedAdminQueryKey(['admin-overview', 'actor-a'])).toBe(true)
    expect(isProtectedAdminQueryKey(['public-catalog'])).toBe(false)
  })

  it('removes protected cached data immediately on logout while preserving unrelated cache', async () => {
    const client = new SessionClient()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['admin-detail', 'actor-a', 1, 'users', 'user-1'], { title: '账号 A 的用户详情' })
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
})
