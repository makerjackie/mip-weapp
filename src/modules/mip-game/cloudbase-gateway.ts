import type { MipGameTransport } from './gateway'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'
import { createMipGameGateway } from './gateway'
import { isRetryableGameAction } from './retry-policy'
import { MipGameError } from './types'

export const MIP_GAME_FUNCTION_NAME = runtimeConfig.cloudbase.gameFunctionName

export function createMipGameCloudbaseTransport(functionName = MIP_GAME_FUNCTION_NAME): MipGameTransport {
  return {
    async invoke(request) {
      try {
        const response = await retryTransport(async () => {
          const cloud = await requireCloudClient()
          return cloud.callFunction({ name: functionName, data: request })
        }, isRetryableGameAction(request.action) ? COLD_START_READ_RETRY : { attempts: 1 })
        const cloud = await requireCloudClient()
        return resolveCloudFileUrls(response.result, cloud)
      }
      catch (error) {
        if (error instanceof MipGameError) {
          throw error
        }
        throw new MipGameError('SERVICE_UNAVAILABLE', '赛季服务暂时不可用，请稍后重试', true)
      }
    },
  }
}

export function createMipGameCloudbaseGateway(functionName = MIP_GAME_FUNCTION_NAME) {
  return createMipGameGateway(createMipGameCloudbaseTransport(functionName))
}
