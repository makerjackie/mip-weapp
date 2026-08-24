import type { MipBannerStatus } from './types'
import { createQueryCache } from '@weapp/shared/cache'
import { compressImageToBase64, IMAGE_UPLOAD_POLICIES } from '../platform/image-upload'

export function createMipBannerModule(gateway: ReturnType<typeof import('./gateway').createMipBannerGateway>) {
  const cache = createQueryCache(15_000)

  function refresh() {
    cache.invalidate('mip-banners')
  }

  return {
    listActive: (force = false) => cache.query('mip-banners:active', gateway.listActive, { force }),
    getAdminSession: (force = false) => cache.query(
      'mip-banners:admin-session',
      gateway.getAdminSession,
      { force },
    ),
    listAdmin: (
      filters: { status?: MipBannerStatus | '', query?: string } = {},
      force = false,
    ) => cache.query(
      `mip-banners:admin:${JSON.stringify(filters)}`,
      () => gateway.listAdmin(filters),
      { force },
    ),
    getAdmin: (bannerId: string, force = false) => cache.query(
      `mip-banners:admin:${bannerId}`,
      () => gateway.getAdmin(bannerId),
      { force },
    ),
    async mutate<T>(work: () => Promise<T>) {
      const result = await work()
      refresh()
      return result
    },
    async uploadBannerImageFromPath(sourcePath: string) {
      if (!sourcePath.trim()) {
        throw new Error('没有选择图片')
      }
      const imageBase64 = await compressImageToBase64(sourcePath, IMAGE_UPLOAD_POLICIES.banner)
      return gateway.uploadBannerImage(imageBase64)
    },
    gateway,
  }
}
