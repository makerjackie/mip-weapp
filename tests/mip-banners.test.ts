import { describe, expect, it } from 'vitest'
import {
  parseAdminBanner,
  parsePublicBannerList,
} from '../src/modules/mip-banners/contracts'
import { resolveBannerTransportFunction } from '../src/modules/mip-banners/function-routing'
import { createMipBannerGateway } from '../src/modules/mip-banners/gateway'

const publicBanner = {
  id: '10000000-0000-4000-8000-000000000001',
  title: '活动主页头图',
  accessibilityLabel: '活动报名信息',
  imageUrl: '/tmp/banner.jpg',
  targetType: 'MINIPROGRAM_PATH',
  targetValue: '/pages/events/index',
  sortOrder: 10,
} as const

const adminBanner = {
  ...publicBanner,
  imageAssetId: '20000000-0000-4000-8000-000000000001',
  imageWidth: 1500,
  imageHeight: 600,
  imageStatus: 'READY',
  status: 'INACTIVE',
  version: 2,
  activatedAt: '',
  deletedAt: '',
  updatedAt: '2026-08-24T02:00:00.000Z',
} as const

const uploadedBanner = {
  assetId: '30000000-0000-4000-8000-000000000001',
  purpose: 'BANNER',
  imageUrl: '/tmp/uploaded-banner.jpg',
  width: 1500,
  height: 600,
} as const

describe('MIP Banner client contracts', () => {
  it('parses public and admin DTOs without accepting extra server fields', () => {
    expect(parsePublicBannerList([publicBanner])).toEqual([publicBanner])
    expect(parseAdminBanner(adminBanner)).toEqual(adminBanner)
    expect(() => parseAdminBanner({ ...adminBanner, ownerUserId: 'must-not-leak' }))
      .toThrow('无效的Banner 信息')
  })

  it('routes public reads and capability-protected admin writes to the independent API', async () => {
    const calls: Array<{ functionName: string, action: string, data?: Record<string, unknown> }> = []
    const gateway = createMipBannerGateway({
      async invoke(functionName, action, data) {
        calls.push({ functionName, action, data })
        if (action === 'mip.banners.listActive') {
          return { ok: true, data: [publicBanner] }
        }
        if (action === 'uploadImage') {
          return { ok: true, data: uploadedBanner }
        }
        return { ok: true, data: adminBanner }
      },
    })
    await expect(gateway.listActive()).resolves.toEqual([publicBanner])
    await expect(gateway.changeStatus(adminBanner.id, 2, 'ACTIVE')).resolves.toEqual(adminBanner)
    await expect(gateway.uploadBannerImage('AAAA')).resolves.toEqual({
      assetId: uploadedBanner.assetId,
      imageUrl: uploadedBanner.imageUrl,
      width: uploadedBanner.width,
      height: uploadedBanner.height,
    })
    expect(calls).toEqual([
      { functionName: 'mip-banners-api', action: 'mip.banners.listActive', data: {} },
      {
        functionName: 'mip-banners-api',
        action: 'mip.banners.admin.changeStatus',
        data: { bannerId: adminBanner.id, expectedVersion: 2, status: 'ACTIVE' },
      },
      {
        functionName: 'mip-media-api',
        action: 'uploadImage',
        data: { purpose: 'BANNER', imageBase64: 'AAAA' },
      },
    ])
  })

  it('maps Banner and media calls to their independently configured runtime functions', () => {
    expect(resolveBannerTransportFunction('mip-banners-api', 'mip-banners-custom', 'mip-media-custom'))
      .toBe('mip-banners-custom')
    expect(resolveBannerTransportFunction('mip-media-api', 'mip-banners-custom', 'mip-media-custom'))
      .toBe('mip-media-custom')
    expect(() => resolveBannerTransportFunction('mip-admin-api', 'mip-banners-custom', 'mip-media-custom'))
      .toThrow('Banner 服务请求无效')
  })

  it('preserves service conflict details for page recovery', async () => {
    const gateway = createMipBannerGateway({
      async invoke() {
        return {
          ok: false,
          error: { code: 'CONFLICT', message: 'Banner 状态已变化，请刷新后重试', retryable: true },
        }
      },
    })
    await expect(gateway.getAdmin(publicBanner.id)).rejects.toEqual(expect.objectContaining({
      name: 'MipBannerError',
      code: 'CONFLICT',
      retryable: true,
    }))
  })
})
