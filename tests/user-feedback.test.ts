import { afterEach, describe, expect, it, vi } from 'vitest'
import { showErrorFeedback } from '../src/platform/feedback/client'

describe('user feedback', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a visible error toast and returns the public message', () => {
    const showToast = vi.fn()
    vi.stubGlobal('wx', { showToast })

    expect(showErrorFeedback(new Error('本活动仅限玩家报名'), '报名提交失败')).toBe('本活动仅限玩家报名')
    expect(showToast).toHaveBeenCalledWith({
      title: '本活动仅限玩家报名',
      icon: 'none',
      duration: 3000,
    })
  })

  it('uses the fallback when no public message is available', () => {
    const showToast = vi.fn()
    vi.stubGlobal('wx', { showToast })

    expect(showErrorFeedback(null, '报名提交失败')).toBe('报名提交失败')
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '报名提交失败' }))
  })
})
