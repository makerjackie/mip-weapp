import type { MipBannerTransport } from './gateway'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'
import { resolveBannerTransportFunction } from './function-routing'
import { createMipBannerGateway } from './gateway'
import { MipBannerError } from './types'

const readActions = new Set([
  'mip.banners.listActive',
  'mip.banners.admin.session',
  'mip.banners.admin.list',
  'mip.banners.admin.get',
])

export function createMipBannerCloudbaseTransport(
  bannerFunctionName = runtimeConfig.cloudbase.bannersFunctionName,
  mediaFunctionName = runtimeConfig.cloudbase.mediaFunctionName,
): MipBannerTransport {
  return {
    async invoke(requestedFunctionName, action, data = {}) {
      try {
        const functionName = resolveBannerTransportFunction(
          requestedFunctionName,
          bannerFunctionName,
          mediaFunctionName,
        )
        const response = await retryTransport(async () => {
          const cloud = await requireCloudClient()
          return cloud.callFunction({ name: functionName, data: { action, ...data } })
        }, readActions.has(action) ? COLD_START_READ_RETRY : { attempts: 1 })
        const cloud = await requireCloudClient()
        return resolveCloudFileUrls(response.result, cloud)
      }
      catch (error) {
        if (error instanceof MipBannerError) {
          throw error
        }
        throw new MipBannerError('SERVICE_UNAVAILABLE', 'Banner 服务暂时不可用，请稍后重试', true)
      }
    },
  }
}

export function createMipBannerCloudbaseGateway(
  bannerFunctionName = runtimeConfig.cloudbase.bannersFunctionName,
  mediaFunctionName = runtimeConfig.cloudbase.mediaFunctionName,
) {
  return createMipBannerGateway(createMipBannerCloudbaseTransport(bannerFunctionName, mediaFunctionName))
}
