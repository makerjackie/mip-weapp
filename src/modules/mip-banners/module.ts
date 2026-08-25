import type {
  MipBannerAdminFilters,
  MipBannerGateway,
  MipBannerMediaPort,
} from './types'
import { createQueryCache } from '@weapp/shared/cache'
import { compressImageToBase64, IMAGE_UPLOAD_POLICIES } from '../platform/image-upload'

export interface MipBannerQueryFacade {
  listActive: (force?: boolean) => ReturnType<MipBannerGateway['listActive']>
  getAdminSession: (force?: boolean) => ReturnType<MipBannerGateway['getAdminSession']>
  listAdmin: (
    filters?: MipBannerAdminFilters,
    force?: boolean,
  ) => ReturnType<MipBannerGateway['listAdmin']>
  getAdmin: (bannerId: string, force?: boolean) => ReturnType<MipBannerGateway['getAdmin']>
}

export interface MipBannerMutationFacade {
  saveAdmin: MipBannerGateway['saveAdmin']
  changeStatus: MipBannerGateway['changeStatus']
  move: MipBannerGateway['move']
  remove: MipBannerGateway['remove']
}

export function createMipBannerModule(
  gateway: MipBannerGateway,
  mediaPort: MipBannerMediaPort,
) {
  const cache = createQueryCache(15_000)

  function invalidateBannerFacts() {
    cache.invalidate('mip-banners:active')
    cache.invalidate('mip-banners:admin:list')
    cache.invalidate('mip-banners:admin:detail')
  }

  async function writeBanner<T>(work: () => Promise<T>) {
    const result = await work()
    invalidateBannerFacts()
    return result
  }

  const query: MipBannerQueryFacade = {
    listActive: (force = false) => cache.query(
      'mip-banners:active',
      gateway.listActive,
      { force },
    ),
    getAdminSession: (force = false) => cache.query(
      'mip-banners:admin-session',
      gateway.getAdminSession,
      { force },
    ),
    listAdmin: (filters = {}, force = false) => cache.query(
      `mip-banners:admin:list:${JSON.stringify(filters)}`,
      () => gateway.listAdmin(filters),
      { force },
    ),
    getAdmin: (bannerId, force = false) => cache.query(
      `mip-banners:admin:detail:${bannerId}`,
      () => gateway.getAdmin(bannerId),
      { force },
    ),
  }

  const mutation: MipBannerMutationFacade = {
    saveAdmin: input => writeBanner(() => gateway.saveAdmin(input)),
    changeStatus: (bannerId, expectedVersion, status) => writeBanner(
      () => gateway.changeStatus(bannerId, expectedVersion, status),
    ),
    move: (bannerId, expectedVersion, direction) => writeBanner(
      () => gateway.move(bannerId, expectedVersion, direction),
    ),
    remove: (bannerId, expectedVersion) => writeBanner(
      () => gateway.remove(bannerId, expectedVersion),
    ),
  }

  async function uploadBannerImageFromPath(sourcePath: string) {
    if (!sourcePath.trim()) {
      throw new Error('没有选择图片')
    }
    const imageBase64 = await compressImageToBase64(sourcePath, IMAGE_UPLOAD_POLICIES.banner)
    return mediaPort.uploadBannerImage(imageBase64)
  }

  return {
    mutation,
    query,
    uploadBannerImageFromPath,
    // Public consumer pages remain on this compatibility alias until their own page slice is migrated.
    listActive: query.listActive,
  }
}
