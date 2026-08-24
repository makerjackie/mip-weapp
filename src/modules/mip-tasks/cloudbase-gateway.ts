import type { MipTasksTransport } from './gateway'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'
import { createMipTasksGateway } from './gateway'
import { isRetryableTaskAction } from './retry-policy'
import { MipTasksError } from './types'

export function createMipTasksCloudbaseTransport(
  functionName = runtimeConfig.cloudbase.tasksFunctionName,
): MipTasksTransport {
  return {
    async invoke(action, data = {}) {
      try {
        const response = await retryTransport(async () => {
          const cloud = await requireCloudClient()
          return cloud.callFunction({ name: functionName, data: { action, ...data } })
        }, isRetryableTaskAction(action) ? COLD_START_READ_RETRY : { attempts: 1 })
        const cloud = await requireCloudClient()
        return resolveCloudFileUrls(response.result, cloud)
      }
      catch (error) {
        if (error instanceof MipTasksError) {
          throw error
        }
        throw new MipTasksError('SERVICE_UNAVAILABLE', '任务服务暂时不可用，请稍后重试', true)
      }
    },
  }
}

export function createMipTasksCloudbaseGateway(
  functionName = runtimeConfig.cloudbase.tasksFunctionName,
) {
  return createMipTasksGateway(createMipTasksCloudbaseTransport(functionName))
}
