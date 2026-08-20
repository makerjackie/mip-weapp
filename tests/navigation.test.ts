import { getCustomNavigationContentTop } from '@weapp/platform/navigation'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('custom navigation content inset', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('places content below the real WeChat capsule', () => {
    vi.stubGlobal('wx', {
      getWindowInfo: () => ({ statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, bottom: 64 }),
    })

    expect(getCustomNavigationContentTop()).toBe(72)
  })

  it('falls back to the current status-bar geometry', () => {
    vi.stubGlobal('wx', {
      getWindowInfo: () => ({ statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => {
        throw new Error('capsule unavailable')
      },
    })

    expect(getCustomNavigationContentTop()).toBe(68)
  })
})
