import type { MipIdentityTransport } from './gateway'
import { runtimeConfig } from '../../config/runtime'
import { resolveCloudFileUrls } from '../platform/cloud-media'
import { requireCloudClient } from '../platform/cloudbase'
import { createMipIdentityGateway } from './gateway'

export function createMipIdentityCloudbaseTransport(
  functionName = runtimeConfig.cloudbase.identityFunctionName,
): MipIdentityTransport {
  return {
    async invoke(action, data = {}) {
      try {
        const cloud = await requireCloudClient()
        const response = await cloud.callFunction({
          name: functionName,
          data: { action, ...data },
        })
        return resolveCloudFileUrls(response.result)
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
