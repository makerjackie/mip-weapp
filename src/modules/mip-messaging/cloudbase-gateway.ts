import type { MipMessagingTransport } from './gateway'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../platform/cloudbase'
import { createMipMessagingGateway as createGateway } from './gateway'
import { isRetryableMessagingAction } from './retry-policy'
import { MipMessagingError } from './types'

export function createMipMessagingCloudbaseTransport(
  functionName = runtimeConfig.cloudbase.notificationsFunctionName,
): MipMessagingTransport {
  return {
    async invoke(request) {
      try {
        const response = await retryTransport(async () => {
          const cloud = await requireCloudClient()
          return cloud.callFunction({ name: functionName, data: request })
        }, isRetryableMessagingAction(request.action) ? COLD_START_READ_RETRY : { attempts: 1 })
        return response.result
      }
      catch (error) {
        if (error instanceof MipMessagingError) {
          throw error
        }
        throw new MipMessagingError('SERVICE_UNAVAILABLE', '消息服务暂时不可用，请稍后重试', true)
      }
    },
  }
}

export function createMipMessagingGateway(
  functionName = runtimeConfig.cloudbase.notificationsFunctionName,
) {
  return createGateway(createMipMessagingCloudbaseTransport(functionName))
}

export const cloudbaseMipMessagingGateway = createMipMessagingGateway()
