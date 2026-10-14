import { canNavigateBack, leaveSecondaryPage } from '@weapp/platform/navigation'
import { afterEach, describe, expect, it, vi } from 'vitest'

// BUG-03：leaveSecondaryPage 带 600ms 模块级防重窗（双击返回只退一层）。
// 用互不重叠的时间基准隔离各用例，避免上一用例的窗口吞掉本用例的调用。
describe('leaveSecondaryPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('navigates back when the page stack is deeper than one', () => {
    vi.stubGlobal('getCurrentPages', () => [{}, {}])
    const navigateBack = vi.fn()
    const switchTab = vi.fn()
    vi.stubGlobal('wx', { navigateBack, switchTab })
    vi.spyOn(Date, 'now').mockImplementation(() => 1_000)

    leaveSecondaryPage('/pages/profile/index')

    expect(canNavigateBack()).toBe(true)
    expect(navigateBack).toHaveBeenCalledOnce()
    expect(switchTab).not.toHaveBeenCalled()
  })

  it('switches to a tab when this page is the stack root', () => {
    vi.stubGlobal('getCurrentPages', () => [{}])
    const navigateBack = vi.fn()
    const switchTab = vi.fn()
    vi.stubGlobal('wx', { navigateBack, switchTab })
    vi.spyOn(Date, 'now').mockImplementation(() => 10_000)

    leaveSecondaryPage('/pages/profile/index')

    expect(canNavigateBack()).toBe(false)
    expect(navigateBack).not.toHaveBeenCalled()
    expect(switchTab).toHaveBeenCalledWith({
      url: '/pages/profile/index',
      fail: expect.any(Function),
    })
  })

  it('falls back to home when switchTab rejects the requested url', () => {
    vi.stubGlobal('getCurrentPages', () => [{}])
    const switchTab = vi.fn((options: { url: string, fail?: () => void }) => {
      if (options.url === '/pages/profile/index') {
        options.fail?.()
      }
    })
    vi.stubGlobal('wx', { navigateBack: vi.fn(), switchTab })
    vi.spyOn(Date, 'now').mockImplementation(() => 20_000)

    leaveSecondaryPage('/pages/profile/index', '/pages/opportunities/index')

    expect(switchTab).toHaveBeenCalledTimes(2)
    expect(switchTab).toHaveBeenLastCalledWith({ url: '/pages/opportunities/index' })
  })
})
