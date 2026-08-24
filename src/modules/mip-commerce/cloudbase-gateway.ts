import type { MipCommerceTransport } from './gateway'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../platform/cloudbase'
import { createMipCommerceGateway, MipCommerceError } from './gateway'

export const cloudbaseMipCommerceTransport: MipCommerceTransport = {
  async invoke(functionName, action, data = {}, retryable = false) {
    try {
      const response = await retryTransport(async () => {
        const cloud = await requireCloudClient()
        return cloud.callFunction({ name: functionName, data: { action, ...data } })
      }, retryable ? COLD_START_READ_RETRY : { attempts: 1 })
      return response.result
    }
    catch (error) {
      if (error instanceof MipCommerceError) {
        throw error
      }
      throw new MipCommerceError('SERVICE_UNAVAILABLE', '服务暂时不可用，请稍后重试', true)
    }
  },
}

export const cloudbaseMipCommerceGateway = createMipCommerceGateway(
  cloudbaseMipCommerceTransport,
  {
    commerce: runtimeConfig.cloudbase.commerceFunctionName,
    payment: runtimeConfig.cloudbase.paymentFunctionName,
  },
)
