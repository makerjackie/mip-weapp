import type { MipBannerGateway } from './types'
import { createQueryCache } from '@weapp/shared/cache'

export function createMipBannerModule(gateway: MipBannerGateway) {
  const cache = createQueryCache(15_000)

  return {
    listActive: (force = false) => cache.query(
      'mip-banners:active',
      gateway.listActive,
      { force },
    ),
    invalidate() {
      cache.invalidate()
    },
  }
}
