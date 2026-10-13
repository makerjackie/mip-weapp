import {
  getCustomNavigationStatusBarHeight,
} from '@weapp/platform/navigation'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { caseNavigateTo, caseOpenRoute, caseRedirectTo } from '../src/platform/navigation/client'
import { leaveSecondaryPage } from '../src/platform/navigation/leave'

describe('custom navigation content inset', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the real status-bar height without depending on capsule geometry', () => {
    const getMenuButtonBoundingClientRect = vi.fn()
    vi.stubGlobal('wx', {
      getWindowInfo: () => ({ statusBarHeight: 24.2 }),
      getMenuButtonBoundingClientRect,
    })

    expect(getCustomNavigationStatusBarHeight()).toBe(25)
    expect(getMenuButtonBoundingClientRect).not.toHaveBeenCalled()
  })

  it('falls back to the portrait safe-area inset when status-bar height is unavailable', () => {
    vi.stubGlobal('wx', {
      getWindowInfo: () => ({ safeArea: { top: 31.4 } }),
    })

    expect(getCustomNavigationStatusBarHeight()).toBe(32)
  })

  it('normalizes relative routes through the public navigation client', async () => {
    const navigateTo = vi.fn((options: { complete?: () => void }) => {
      options.complete?.()
    })
    vi.stubGlobal('wx', { navigateTo })

    await caseNavigateTo({ url: 'packages/member/mip-events/mine/index' })
    await caseNavigateTo({ url: '/pages/events/index' })

    expect(navigateTo).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: '/packages/member/mip-events/mine/index',
    }))
    expect(navigateTo).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: '/pages/events/index',
    }))
  })
})

// BUG-02（交互审计 2026-10-12）：双击窗口内同一 URL 只入栈一次。
describe('navigation double-tap dedupe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('drops the second navigateTo to the same url inside the dedupe window', () => {
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo })
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    caseNavigateTo({ url: '/packages/member/mip-tasks/detail/index?taskId=t1' })
    now += 200
    caseNavigateTo({ url: '/packages/member/mip-tasks/detail/index?taskId=t1' })

    expect(navigateTo).toHaveBeenCalledTimes(1)
  })

  it('keeps distinct targets and re-allows the same url after the window passes', () => {
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo })
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    caseNavigateTo({ url: '/pages/index/first' })
    caseNavigateTo({ url: '/pages/index/second' })
    now += 601
    caseNavigateTo({ url: '/pages/index/first' })

    expect(navigateTo).toHaveBeenCalledTimes(3)
  })

  it('re-allows the same url immediately after a navigation fails', () => {
    const navigateTo = vi.fn((options: { fail?: (error: unknown) => void }) => {
      options.fail?.(new Error('navigateTo:fail'))
    })
    vi.stubGlobal('wx', { navigateTo })
    vi.spyOn(Date, 'now').mockImplementation(() => 1_000)

    caseNavigateTo({ url: '/pages/index/flaky' })
    caseNavigateTo({ url: '/pages/index/flaky' })

    expect(navigateTo).toHaveBeenCalledTimes(2)
  })

  it('deduplicates redirectTo to the same url inside the window', () => {
    const redirectTo = vi.fn()
    vi.stubGlobal('wx', { redirectTo })
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    caseRedirectTo({ url: '/packages/member/mip-ai/voice/index' })
    now += 100
    caseRedirectTo({ url: '/packages/member/mip-ai/voice/index' })

    expect(redirectTo).toHaveBeenCalledTimes(1)
  })
})

// MIW-84：任务配置跳转目标页——tab 页走 switchTab，普通页入栈。
describe('caseOpenRoute splits tab and regular task jump targets', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('switches to the primary tab for tab-bar targets', () => {
    const switchTab = vi.fn()
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { switchTab, navigateTo })

    caseOpenRoute('/pages/events/index')

    expect(switchTab).toHaveBeenCalledWith({ url: '/pages/events/index' })
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('normalizes relative tab targets before switching', () => {
    const switchTab = vi.fn()
    vi.stubGlobal('wx', { switchTab, navigateTo: vi.fn() })

    caseOpenRoute('pages/profile/index')

    expect(switchTab).toHaveBeenCalledWith({ url: '/pages/profile/index' })
  })

  it('pushes regular member-package targets with navigateTo', async () => {
    const switchTab = vi.fn()
    const navigateTo = vi.fn((options: { complete?: () => void }) => {
      options.complete?.()
    })
    vi.stubGlobal('wx', { switchTab, navigateTo })

    await caseOpenRoute('packages/member/mip-events/detail/index')

    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/packages/member/mip-events/detail/index',
    }))
    expect(switchTab).not.toHaveBeenCalled()
  })
})

// BUG-03（交互审计 2026-10-12）：返回按钮双击只退一层。
describe('leaveSecondaryPage double-tap dedupe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('navigates back only once for two quick taps', () => {
    const navigateBack = vi.fn()
    vi.stubGlobal('wx', { navigateBack, switchTab: vi.fn() })
    vi.stubGlobal('getCurrentPages', () => [{}, {}, {}])
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    leaveSecondaryPage('/pages/profile/index')
    now += 150
    leaveSecondaryPage('/pages/profile/index')

    expect(navigateBack).toHaveBeenCalledTimes(1)
  })

  it('allows another back after the window passes', () => {
    const navigateBack = vi.fn()
    vi.stubGlobal('wx', { navigateBack, switchTab: vi.fn() })
    vi.stubGlobal('getCurrentPages', () => [{}, {}, {}])
    // 独立时间基准：leave 的防重窗是模块级状态，避免上一个用例残留。
    let now = 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    leaveSecondaryPage('/pages/profile/index')
    now += 601
    leaveSecondaryPage('/pages/profile/index')

    expect(navigateBack).toHaveBeenCalledTimes(2)
  })
})
