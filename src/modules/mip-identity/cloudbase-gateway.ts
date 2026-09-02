import type { MipIdentityTransport } from './gateway'
import { COLD_START_READ_RETRY, retryTransport } from '@weapp/shared/retry'
import { runtimeConfig } from '../../config/runtime'
import { requireCloudClient } from '../../platform/cloudbase/client'
import { resolveCloudFileUrls } from '../../platform/storage/cloud-media'
import { createMipIdentityGateway } from './gateway'
import { isRetryableIdentityAction } from './retry-policy'

function isDevToolsRuntime() {
  if (typeof wx === 'undefined') {
    return false
  }
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      return wx.getDeviceInfo().platform === 'devtools'
    }
  }
  catch { /* Fall back for older base-library runtimes. */ }
  try {
    return typeof wx.getSystemInfoSync === 'function'
      && wx.getSystemInfoSync().platform === 'devtools'
  }
  catch {
    return false
  }
}

export function createMipIdentityCloudbaseTransport(
  functionName = runtimeConfig.cloudbase.identityFunctionName,
): MipIdentityTransport {
  return {
    async invoke(request) {
      if (request.action === 'bindWechatPhone' && isDevToolsRuntime()) {
        throw new Error('手机号授权必须在微信真机完成。')
      }
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
