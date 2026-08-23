import { canNavigateBack, leaveSecondaryPage } from '@weapp/platform/navigation'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('leaveSecondaryPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('navigates back when the page stack is deeper than one', () => {
    vi.stubGlobal('getCurrentPages', () => [{}, {}])
    const navigateBack = vi.fn()
    const switchTab = vi.fn()
    vi.stubGlobal('wx', { navigateBack, switchTab })

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

    leaveSecondaryPage('/pages/profile/index', '/pages/index/index')

    expect(switchTab).toHaveBeenCalledTimes(2)
    expect(switchTab).toHaveBeenLastCalledWith({ url: '/pages/index/index' })
  })
})
