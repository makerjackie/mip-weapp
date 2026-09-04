import type { MipBannerGateway, MipBannerRequest } from '../src/modules/mip-banners/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipBannerCloudbaseGateway } from '../src/modules/mip-banners/cloudbase-gateway'
import { parsePublicBannerList } from '../src/modules/mip-banners/contracts'
import { createMipBannerGateway } from '../src/modules/mip-banners/gateway'
import { createMipBannerModule } from '../src/modules/mip-banners/module'

const cloudHarness = vi.hoisted(() => ({
  callFunction: vi.fn(),
  downloadFile: vi.fn(),
}))

vi.mock('../src/platform/cloudbase/client', () => ({
  requireCloudClient: vi.fn(async () => cloudHarness),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { bannersFunctionName: 'mip-banners-api' } },
}))

const publicBanner = {
  id: '10000000-0000-4000-8000-000000000001',
  title: '活动主页头图',
  accessibilityLabel: '活动报名信息',
  imageUrl: '/tmp/banner.jpg',
  targetType: 'MINIPROGRAM_PATH',
  targetValue: '/pages/events/index',
  sortOrder: 10,
} as const

describe('MIP Banner public client', () => {
  beforeEach(() => {
    cloudHarness.callFunction.mockReset()
    cloudHarness.downloadFile.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts the public DTO and rejects missing or leaked fields', () => {
    expect(parsePublicBannerList([publicBanner])).toEqual([publicBanner])
    expect(() => parsePublicBannerList([{ ...publicBanner, imageUrl: '' }]))
      .toThrow('无效的Banner 信息')
    expect(() => parsePublicBannerList([{ ...publicBanner, ownerUserId: 'must-not-leak' }]))
      .toThrow('无效的Banner 信息')
  })

  it('sends the exact listActive request and parses the response', async () => {
    const requests: MipBannerRequest[] = []
    const gateway = createMipBannerGateway({
      async invoke(request) {
        requests.push(request)
        return { ok: true, data: [publicBanner] }
      },
    })

    await expect(gateway.listActive()).resolves.toEqual([publicBanner])
    expect(requests).toEqual([{
      contractVersion: 1,
      action: 'mip.banners.listActive',
      input: {},
    }])
  })

  it('preserves service errors and rejects malformed envelopes', async () => {
    const conflictGateway = createMipBannerGateway({
      async invoke() {
        return {
          ok: false,
          error: { code: 'CONFLICT', message: 'Banner 状态已变化', retryable: true },
        }
      },
    })
    const malformedGateway = createMipBannerGateway({
      async invoke() {
        return { data: [] }
      },
    })

    await expect(conflictGateway.listActive()).rejects.toMatchObject({
      name: 'MipBannerError',
      code: 'CONFLICT',
      message: 'Banner 状态已变化',
      retryable: true,
    })
    await expect(malformedGateway.listActive()).rejects.toMatchObject({
      name: 'MipBannerError',
      code: 'SERVICE_UNAVAILABLE',
      retryable: true,
    })
  })

  it('caches reads while supporting force refresh and invalidation', async () => {
    let reads = 0
    const gateway: MipBannerGateway = {
      async listActive() {
        reads += 1
        return [publicBanner]
      },
    }
    const module = createMipBannerModule(gateway)

    await module.listActive()
    await module.listActive()
    expect(reads).toBe(1)

    await module.listActive(true)
    expect(reads).toBe(2)

    module.invalidate()
    await module.listActive()
    expect(reads).toBe(3)
  })

  it('retries a cold-start read and resolves CloudBase image paths', async () => {
    vi.useFakeTimers()
    const cloudImage = 'cloud://mip-test/banners/banner.jpg'
    cloudHarness.callFunction
      .mockRejectedValueOnce(new Error('cold start'))
      .mockResolvedValueOnce({
        result: { ok: true, data: [{ ...publicBanner, imageUrl: cloudImage }] },
      })
    cloudHarness.downloadFile.mockResolvedValue({ tempFilePath: 'wxfile://tmp/banner.jpg' })
    const gateway = createMipBannerCloudbaseGateway('mip-banners-api')

    const pending = gateway.listActive()
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual([{
      ...publicBanner,
      imageUrl: 'wxfile://tmp/banner.jpg',
    }])
    expect(cloudHarness.callFunction).toHaveBeenCalledTimes(2)
    expect(cloudHarness.callFunction).toHaveBeenNthCalledWith(1, {
      name: 'mip-banners-api',
      data: {
        contractVersion: 1,
        action: 'mip.banners.listActive',
        input: {},
      },
    })
    expect(cloudHarness.callFunction).toHaveBeenNthCalledWith(2, {
      name: 'mip-banners-api',
      data: {
        contractVersion: 1,
        action: 'mip.banners.listActive',
        input: {},
      },
    })
    expect(cloudHarness.downloadFile).toHaveBeenCalledWith({ fileID: cloudImage })
  })
})
