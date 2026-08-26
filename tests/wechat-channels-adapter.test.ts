import type { WechatChannelsDestination } from '../src/platform/wechat/channels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWechatChannelsDestination } from '../src/platform/wechat/channels'

const profile: WechatChannelsDestination = {
  provider: 'WECHAT_CHANNELS',
  type: 'PROFILE',
  finderUserName: 'sphMIP2026',
  feedId: null,
}

const originalWechat = (globalThis as { wx?: unknown }).wx

afterEach(() => {
  vi.useRealTimers()
  if (originalWechat === undefined) {
    delete (globalThis as { wx?: unknown }).wx
  }
  else {
    ;(globalThis as { wx?: unknown }).wx = originalWechat
  }
})

describe('WeChat Channels platform adapter', () => {
  it('reports unsupported when the required native API is absent', async () => {
    ;(globalThis as { wx?: unknown }).wx = {}
    await expect(openWechatChannelsDestination(profile)).resolves.toEqual({ status: 'unsupported' })
  })

  it('reports opened only after the native success callback', async () => {
    const openChannelsUserProfile = vi.fn((options: { success: () => void }) => options.success())
    ;(globalThis as { wx?: unknown }).wx = { openChannelsUserProfile }

    await expect(openWechatChannelsDestination(profile)).resolves.toEqual({ status: 'opened' })
    expect(openChannelsUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      finderUserName: 'sphMIP2026',
      success: expect.any(Function),
      fail: expect.any(Function),
    }))
    expect(openChannelsUserProfile.mock.calls[0][0]).not.toHaveProperty('feedId')
  })

  it('distinguishes cancellation from other native failures', async () => {
    const openChannelsActivity = vi
      .fn()
      .mockImplementationOnce((options: { fail: (error: { errMsg: string }) => void }) => {
        options.fail({ errMsg: 'openChannelsActivity:fail cancel' })
      })
      .mockImplementationOnce((options: { fail: (error: { errMsg: string }) => void }) => {
        options.fail({ errMsg: 'openChannelsActivity:fail system error' })
      })
    ;(globalThis as { wx?: unknown }).wx = { openChannelsActivity }
    const activity: WechatChannelsDestination = {
      ...profile,
      type: 'ACTIVITY',
      feedId: 'feed-token-1',
    }

    await expect(openWechatChannelsDestination(activity)).resolves.toEqual({ status: 'cancelled' })
    await expect(openWechatChannelsDestination(activity)).resolves.toEqual({ status: 'failed' })
    expect(openChannelsActivity).toHaveBeenCalledWith(expect.objectContaining({
      finderUserName: 'sphMIP2026',
      feedId: 'feed-token-1',
    }))
  })

  it('settles once when a native implementation invokes both success and fail callbacks', async () => {
    const openChannelsUserProfile = vi.fn((options: {
      success: () => void
      fail: (error: { errMsg: string }) => void
    }) => {
      options.success()
      options.fail({ errMsg: 'openChannelsUserProfile:fail system error' })
    })
    ;(globalThis as { wx?: unknown }).wx = { openChannelsUserProfile }

    await expect(openWechatChannelsDestination(profile)).resolves.toEqual({ status: 'opened' })
  })

  it('fails and releases callers when the native API never invokes a callback', async () => {
    vi.useFakeTimers()
    const openChannelsUserProfile = vi.fn()
    ;(globalThis as { wx?: unknown }).wx = { openChannelsUserProfile }

    const result = openWechatChannelsDestination(profile)
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(result).resolves.toEqual({ status: 'failed' })
  })

  it('fails closed before calling native APIs for malformed destination pairing', async () => {
    const openChannelsUserProfile = vi.fn()
    ;(globalThis as { wx?: unknown }).wx = { openChannelsUserProfile }

    await expect(openWechatChannelsDestination({
      ...profile,
      feedId: 'feed-token-1',
    })).resolves.toEqual({ status: 'failed' })
    expect(openChannelsUserProfile).not.toHaveBeenCalled()
  })
})
