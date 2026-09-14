import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseReceivedVisitors } from '../src/modules/mip-opportunities/received-visitors'
import { clearLoadingDiagnostics, getLoadingDiagnostics } from '../src/platform/cloudbase/loading-diagnostics'

const mocks = vi.hoisted(() => ({ access: vi.fn(), list: vi.fn() }))
vi.mock('../src/modules/mip-identity', () => ({ mipAccessPageUrl: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { beginProtectedAction: mocks.access } }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/modules/mip-opportunities', () => ({ opportunityModule: { listReceived: mocks.list } }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))

interface TestPage {
  data: Record<string, unknown>
  categoryCache: Record<string, unknown>
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
    setData(patch: Record<string, unknown>) {
      Object.assign(this.data, patch)
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
  mocks.list.mockResolvedValue({ items: [], unreadCount: 0 })
})

describe('received interactions failure recovery', () => {
  it('renders a non-empty adapted visitor page instead of throwing on actor.nickname', async () => {
    const p = page()
    mocks.list.mockResolvedValueOnce(parseReceivedVisitors({ items: [{ profileRef: 'public-ref', nickname: '访客甲', visitCount: 3, lastVisitedAt: '2026-09-12T03:00:00Z', unread: true }], unreadCount: 1, totalViewCount: 3 }))
    await p.loadCategory('VISITOR', true)
    expect(p.data.state).toBe('ready')
    expect(p.data.items).toEqual([expect.objectContaining({ actorName: '访客甲', messageId: 'public-ref', unread: true, detailText: '访问了你的公开档案 3 次' })])
    expect(p.data.totalViewCount).toBe(3)
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
