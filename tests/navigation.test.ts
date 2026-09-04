import {
  getCustomNavigationStatusBarHeight,
} from '@weapp/platform/navigation'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { caseNavigateTo } from '../src/platform/navigation/client'

describe('custom navigation content inset', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
    const navigateTo = vi.fn(async () => undefined)
    vi.stubGlobal('wx', { navigateTo })

    await caseNavigateTo({ url: 'packages/member/mip-events/mine/index' })
    await caseNavigateTo({ url: '/pages/events/index' })

    expect(navigateTo).toHaveBeenNthCalledWith(1, {
      url: '/packages/member/mip-events/mine/index',
    })
    expect(navigateTo).toHaveBeenNthCalledWith(2, { url: '/pages/events/index' })
  })
})
