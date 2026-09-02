import type { MipMediaTransport } from './gateway'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../../platform/cloudbase/client'
import { resolveCloudFileUrls } from '../../platform/storage/cloud-media'
import { createMipMediaGateway } from './gateway'

export function createMipMediaCloudbaseTransport(
  functionName = runtimeConfig.cloudbase.mediaFunctionName,
): MipMediaTransport {
  return {
    async invoke(action, data) {
      try {
        const cloud = await requireCloudClient()
        const response = await cloud.callFunction({
          name: functionName,
          data: { action, ...data },
        })
        return resolveCloudFileUrls(response.result, cloud)
      }
      catch {
        throw new Error('图片上传暂时不可用，请稍后重试')
      }
    },
  }
}

export function createMipMediaCloudbaseGateway(
  functionName = runtimeConfig.cloudbase.mediaFunctionName,
) {
  return createMipMediaGateway(createMipMediaCloudbaseTransport(functionName))
}
