import type { MipBannerTransport } from './gateway'
import type { MipBannerMediaTransport } from './media-port'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../../platform/cloudbase/client'
import { resolveCloudFileUrls } from '../../platform/storage/cloud-media'
import { createMipBannerGateway } from './gateway'
import { createMipBannerMediaPort } from './media-port'
import { isRetryableBannerAction } from './retry-policy'
import { MipBannerError } from './types'

function unavailable(error: unknown, message: string): never {
  if (error instanceof MipBannerError) {
    throw error
  }
  throw new MipBannerError('SERVICE_UNAVAILABLE', message, true)
}

export function createMipBannerCloudbaseTransport(
  bannerFunctionName = runtimeConfig.cloudbase.bannersFunctionName,
): MipBannerTransport {
  return {
    async invoke(request) {
      try {
        const response = await retryTransport(async () => {
          const cloud = await requireCloudClient()
          return cloud.callFunction({ name: bannerFunctionName, data: request })
        }, isRetryableBannerAction(request.action) ? COLD_START_READ_RETRY : { attempts: 1 })
        const cloud = await requireCloudClient()
        return resolveCloudFileUrls(response.result, cloud)
      }
      catch (error) {
        return unavailable(error, 'Banner 服务暂时不可用，请稍后重试')
      }
    },
  }
}

export function createMipBannerMediaCloudbaseTransport(
  mediaFunctionName = runtimeConfig.cloudbase.mediaFunctionName,
): MipBannerMediaTransport {
  return {
    async invoke(request) {
      try {
        const response = await retryTransport(async () => {
          const cloud = await requireCloudClient()
          return cloud.callFunction({ name: mediaFunctionName, data: request })
        }, { attempts: 1 })
        const cloud = await requireCloudClient()
        return resolveCloudFileUrls(response.result, cloud)
      }
      catch (error) {
        return unavailable(error, '图片服务暂时不可用，请稍后重试')
      }
    },
  }
}

export function createMipBannerCloudbaseGateway(
  bannerFunctionName = runtimeConfig.cloudbase.bannersFunctionName,
) {
  return createMipBannerGateway(createMipBannerCloudbaseTransport(bannerFunctionName))
}

export function createMipBannerMediaCloudbasePort(
  mediaFunctionName = runtimeConfig.cloudbase.mediaFunctionName,
) {
  return createMipBannerMediaPort(createMipBannerMediaCloudbaseTransport(mediaFunctionName))
}
