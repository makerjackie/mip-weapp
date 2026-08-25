import type { MipBannerMediaPort } from './types'
import { parseBannerUploadedImage } from './contracts'
import { MipBannerError } from './types'

export interface MipBannerMediaUploadRequest {
  action: 'uploadImage'
  purpose: 'BANNER'
  imageBase64: string
}

export interface MipBannerMediaTransport {
  invoke: (request: MipBannerMediaUploadRequest) => Promise<unknown>
}

interface MediaEnvelope {
  ok: boolean
  data?: unknown
  error?: { code?: string, message?: string, retryable?: boolean }
}

export function createMipBannerMediaPort(transport: MipBannerMediaTransport): MipBannerMediaPort {
  return {
    async uploadBannerImage(imageBase64) {
      const result = await transport.invoke({
        action: 'uploadImage',
        purpose: 'BANNER',
        imageBase64,
      }) as MediaEnvelope
      if (!result || typeof result.ok !== 'boolean') {
        throw new MipBannerError('SERVICE_UNAVAILABLE', '图片服务返回了无效响应', true)
      }
      if (!result.ok) {
        throw new MipBannerError(
          result.error?.code || 'SERVICE_UNAVAILABLE',
          result.error?.message || '图片服务暂时不可用',
          result.error?.retryable === true,
        )
      }
      return parseBannerUploadedImage(result.data)
    },
  }
}
