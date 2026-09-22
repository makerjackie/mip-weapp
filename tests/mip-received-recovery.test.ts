import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseReceivedVisitors } from '../src/modules/mip-opportunities/received-visitors'
import { clearLoadingDiagnostics, getLoadingDiagnostics } from '../src/platform/cloudbase/loading-diagnostics'

const mocks = vi.hoisted(() => ({ access: vi.fn(), peekSnapshot: vi.fn(), list: vi.fn(), markRead: vi.fn(), invalidate: vi.fn() }))
vi.mock('../src/modules/mip-identity', () => ({ mipAccessPageUrl: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { beginProtectedAction: mocks.access, peekSnapshot: mocks.peekSnapshot } }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: { invalidate: mocks.invalidate } }))
vi.mock('../src/modules/mip-opportunities', () => ({ opportunityModule: { listReceived: mocks.list, markReceivedRead: mocks.markRead } }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))

interface TestPage {
  data: Record<string, unknown>
  categoryCache: Record<string, unknown>
  onHide: () => void
  openInteraction: (event: unknown) => Promise<void>
  accessReady: boolean
  checkingAccess: boolean
  setData: (patch: Record<string, unknown>) => void
  checkAccess: () => Promise<void>
  retry: () => Promise<void> | undefined
  loadCategory: (category: string, reset: boolean) => Promise<void>
  copyLoadingDiagnostics: () => void
}
let definition: TestPage
function page() {
  return {
    ...definition,
    data: { ...structuredClone(definition.data), category: 'VISITOR' },
    categoryCache: structuredClone(definition.categoryCache),
    setData(patch: Record<string, unknown>, callback?: () => void) {
      Object.assign(this.data, patch)
      callback?.()
    },
  }
}
beforeAll(async () => {
  vi.stubGlobal('Page', (value: TestPage) => {
    definition = value
  })
  await import('../src/packages/member/mip-received/index')
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.resetAllMocks()
  clearLoadingDiagnostics()
  mocks.access.mockResolvedValue({ decision: { ready: true } })
  mocks.peekSnapshot.mockReturnValue(undefined)
  mocks.list.mockResolvedValue({ items: [], unreadCount: 0 })
})

describe('received interactions failure recovery', () => {
  it('renders a non-empty adapted visitor page instead of throwing on actor.nickname', async () => {
    const p = page()
    mocks.list.mockResolvedValueOnce(parseReceivedVisitors({ items: [{ profileRef: 'public-ref', nickname: '访客甲', visitCount: 3, lastVisitedAt: '2026-09-12T03:00:00Z', unread: true }], unreadCount: 1, totalViewCount: 3 }))
    await p.loadCategory('VISITOR', true)
    expect(p.data.state).toBe('ready')
    expect(p.data.items).toEqual([expect.objectContaining({ actorName: '访客甲', messageId: 'public-ref', unread: false, detailText: '访问了你的公开档案 3 次' })])
    expect(p.data.totalViewCount).toBe(3)
  })

  it('only marks displayed visitors and retains unloaded unread records', async () => {
    const p = page()
    mocks.list.mockResolvedValueOnce(parseReceivedVisitors({ items: [{ profileRef: 'public-ref', nickname: '访客甲', visitCount: 3, lastVisitedAt: '2026-09-12T03:00:00Z', unread: true }], unreadCount: 2, totalViewCount: 4 }))
    await p.loadCategory('VISITOR', true)
    await vi.waitFor(() => expect(p.data.visitorUnreadCount).toBe(1))
    expect(mocks.markRead).toHaveBeenCalledWith('public-ref', 'VISITOR')
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
  })

  it('does not mark background preloaded visitors read', async () => {
    const p = page()
    p.data.category = 'GUEST'
    mocks.list.mockResolvedValueOnce(parseReceivedVisitors({ items: [{ profileRef: 'public-ref', nickname: '访客甲', visitCount: 1, lastVisitedAt: '2026-09-12T03:00:00Z', unread: true }], unreadCount: 1, totalViewCount: 1 }))
    await p.loadCategory('VISITOR', true)
    expect(mocks.markRead).not.toHaveBeenCalled()
    expect(p.data.visitorUnreadCount).toBe(1)
  })

  it('retains unread state and the list when read synchronization fails', async () => {
    const p = page()
    mocks.markRead.mockRejectedValueOnce(new Error('offline'))
    mocks.list.mockResolvedValueOnce(parseReceivedVisitors({ items: [{ profileRef: 'public-ref', nickname: '访客甲', visitCount: 1, lastVisitedAt: '2026-09-12T03:00:00Z', unread: true }], unreadCount: 1, totalViewCount: 1 }))
    await p.loadCategory('VISITOR', true)
    await vi.waitFor(() => expect(p.data.message).toContain('刷新重试'))
    expect(p.data.state).toBe('ready')
    expect(p.data.visitorUnreadCount).toBe(1)
    expect(p.data.items).toEqual([expect.objectContaining({ unread: true })])
  })

  it('retries read synchronization from a ready list and clears the unread badge', async () => {
    const p = page()
    p.accessReady = true
    const visitors = parseReceivedVisitors({ items: [{ profileRef: 'public-ref', nickname: '访客甲', visitCount: 1, lastVisitedAt: '2026-09-12T03:00:00Z', unread: true }], unreadCount: 1, totalViewCount: 1 })
    mocks.list.mockResolvedValue(visitors)
    mocks.markRead.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    await p.loadCategory('VISITOR', true)
    await vi.waitFor(() => expect(p.data.message).toContain('刷新重试'))
    expect(p.data.state).toBe('ready')
    await p.retry()
    await vi.waitFor(() => expect(p.data.visitorUnreadCount).toBe(0))
    expect(mocks.markRead).toHaveBeenCalledTimes(2)
    expect(p.data.message).toBe('')
    expect(p.data.items).toEqual([expect.objectContaining({ actorName: '访客甲', unread: false })])
  })

  it('shows refresh progress and prevents duplicate retry while retaining the visitor list', async () => {
    const p = page()
    p.accessReady = true
    const visitors = parseReceivedVisitors({ items: [{ profileRef: 'public-ref', nickname: '访客甲', visitCount: 1, lastVisitedAt: '2026-09-12T03:00:00Z', unread: true }], unreadCount: 1 })
    mocks.list.mockResolvedValue(visitors)
    mocks.markRead.mockRejectedValueOnce(new Error('offline'))
    await p.loadCategory('VISITOR', true)
    await vi.waitFor(() => expect(p.data.message).toContain('刷新重试'))
    let finish!: (value: unknown) => void
    mocks.list.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    const retry = p.retry()
    expect(p.data.refreshing).toBe(true)
    expect(p.data.state).toBe('ready')
    expect(p.retry()).toBeUndefined()
    expect(mocks.list).toHaveBeenCalledTimes(2)
    finish(visitors)
    await retry
    await vi.waitFor(() => expect(p.data.refreshing).toBe(false))
    expect(p.data.message).toBe('')
  })

  it('refreshes expired identity before retrying unread synchronization', async () => {
    const p = page()
    p.accessReady = true
    mocks.list.mockResolvedValueOnce(parseReceivedVisitors({ items: [{ profileRef: 'public-ref', nickname: '访客甲', visitCount: 1, lastVisitedAt: '2026-09-12T03:00:00Z', unread: true }], unreadCount: 1 }))
    mocks.markRead.mockRejectedValueOnce(Object.assign(new Error('登录已过期'), { code: 'AUTH_REQUIRED' }))
    await p.loadCategory('VISITOR', true)
    await vi.waitFor(() => expect(p.data.message).toContain('刷新重试'))
    expect(p.accessReady).toBe(false)
    expect(getLoadingDiagnostics()).toContainEqual(expect.objectContaining({ errorCode: 'AUTH_REQUIRED' }))
    await p.retry()
    expect(mocks.access).toHaveBeenCalledTimes(1)
  })

  it('waits for rendering before marking visitors read', async () => {
    const p = page()
    const rendered: Array<() => void> = []
    p.setData = function (patch, callback) {
      Object.assign(this.data, patch)
      if (callback) {
        rendered.push(callback)
      }
    }
    mocks.list.mockResolvedValueOnce(parseReceivedVisitors({ items: [{ profileRef: 'public-ref', nickname: '访客甲', visitCount: 1, lastVisitedAt: '2026-09-12T03:00:00Z', unread: true }], unreadCount: 1, totalViewCount: 1 }))
    await p.loadCategory('VISITOR', true)
    expect(mocks.markRead).not.toHaveBeenCalled()
    p.onHide()
    rendered.forEach(callback => callback())
    expect(mocks.markRead).not.toHaveBeenCalled()
  })

  it('does not mark a visitor twice when opening their profile during synchronization', async () => {
    const p = page()
    let finish!: () => void
    mocks.markRead.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    mocks.list.mockResolvedValueOnce(parseReceivedVisitors({ items: [{ profileRef: 'public-ref', nickname: '访客甲', visitCount: 1, lastVisitedAt: '2026-09-12T03:00:00Z', unread: true }], unreadCount: 2, totalViewCount: 2 }))
    await p.loadCategory('VISITOR', true)
    const items = p.data.items as Array<{ viewKey: string }>
    await p.openInteraction({ currentTarget: { dataset: { key: items[0].viewKey } } })
    expect(mocks.markRead).toHaveBeenCalledTimes(1)
    finish()
    await vi.waitFor(() => expect(p.data.visitorUnreadCount).toBe(1))
  })

  it('rechecks failed identity before loading any interaction lists', async () => {
    const p = page()
    mocks.access.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'SERVICE_UNAVAILABLE' }))
    await p.checkAccess()
    expect(p.data.state).toBe('error')
    expect(mocks.list).not.toHaveBeenCalled()
    await p.retry()
    expect(mocks.access).toHaveBeenCalledTimes(2)
    expect(mocks.list).toHaveBeenCalledWith('VISITOR', undefined)
    expect(p.data.state).toBe('empty')
  })

  it('retries a failed visitor list and exposes loading while the request is pending', async () => {
    const p = page()
    p.accessReady = true
    mocks.list.mockRejectedValueOnce(Object.assign(new Error('暂时不可用'), { code: 'SERVICE_UNAVAILABLE' }))
    await p.loadCategory('VISITOR', true)
    expect(p.data.state).toBe('error')
    expect(getLoadingDiagnostics()).toContainEqual(expect.objectContaining({ stage: 'opportunities.response', errorCode: 'SERVICE_UNAVAILABLE' }))
    let finish!: (value: unknown) => void
    mocks.list.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    const retry = p.retry()
    expect(p.data.state).toBe('loading')
    expect(p.retry()).toBeUndefined()
    finish({ items: [], unreadCount: 0 })
    await retry
    expect(p.data.state).toBe('empty')
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('rechecks access when the visitor API reports expired identity', async () => {
    const p = page()
    p.accessReady = true
    mocks.list.mockRejectedValueOnce(Object.assign(new Error('登录后可继续操作'), { code: 'AUTH_REQUIRED' }))
    await p.loadCategory('VISITOR', true)
    expect(p.accessReady).toBe(false)
    await p.retry()
    expect(mocks.access).toHaveBeenCalledTimes(1)
    expect(p.data.state).toBe('empty')
  })

  it('does not hold the identity retry lock while other categories are still loading', async () => {
    const p = page()
    let finish!: (value: unknown) => void
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    mocks.list.mockImplementation((category: string) => category === 'VISITOR'
      ? Promise.reject(Object.assign(new Error('登录后可继续操作'), { code: 'AUTH_REQUIRED' }))
      : pending)
    const initial = p.checkAccess()
    await vi.waitFor(() => expect(p.data.state).toBe('error'))
    expect(p.checkingAccess).toBe(false)
    mocks.list.mockResolvedValue({ items: [], unreadCount: 0 })
    await p.retry()
    expect(mocks.access).toHaveBeenCalledTimes(2)
    expect(p.data.state).toBe('empty')
    finish({ items: [], unreadCount: 0 })
    await initial
  })

  it('retains a denied access flow when identity retry requires user completion', async () => {
    const p = page()
    p.data.state = 'error'
    mocks.access.mockResolvedValueOnce({ decision: { ready: false }, token: 'resume-test' })
    await p.retry()
    expect(p.data.state).toBe('access')
    expect(p.data.accessToken).toBe('resume-test')
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
