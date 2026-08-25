import type { MipIdentityTransport } from './gateway'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'
import { createMipIdentityGateway } from './gateway'
import { isRetryableIdentityAction } from './retry-policy'

export function createMipIdentityCloudbaseTransport(
  functionName = runtimeConfig.cloudbase.identityFunctionName,
): MipIdentityTransport {
  return {
    async invoke(request) {
      try {
        const result = await retryTransport(async () => {
          const cloud = await requireCloudClient()
          const response = await cloud.callFunction({ name: functionName, data: request })
          return { cloud, response }
        }, isRetryableIdentityAction(request.action) ? COLD_START_READ_RETRY : { attempts: 1 })
        return resolveCloudFileUrls(result.response.result, result.cloud)
      }
      catch {
        throw new Error('身份服务暂时不可用，请稍后重试')
      }
    },
  }
}

export function createMipIdentityCloudbaseGateway(
  functionName = runtimeConfig.cloudbase.identityFunctionName,
) {
  return createMipIdentityGateway(createMipIdentityCloudbaseTransport(functionName))
}
