import type { MipBannerAction } from './types'

const retryableBannerActions = new Set<MipBannerAction>([
  'mip.banners.listActive',
  'mip.banners.admin.session',
  'mip.banners.admin.list',
  'mip.banners.admin.get',
])

export function isRetryableBannerAction(action: MipBannerAction) {
  return retryableBannerActions.has(action)
}
