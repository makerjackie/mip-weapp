import type { MipMediaAsset, MipMediaGateway, MipMediaPurpose } from './types'
import { MipMediaError } from './types'

interface MediaEnvelope {
  ok: boolean
  data?: MipMediaAsset
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipMediaTransport {
  invoke: (action: string, data: Record<string, unknown>) => Promise<unknown>
}

export function createMipMediaGateway(transport: MipMediaTransport): MipMediaGateway {
  return {
    async uploadImage(purpose: MipMediaPurpose, imageBase64: string) {
      const result = await transport.invoke('uploadImage', { purpose, imageBase64 }) as MediaEnvelope
      if (!result || typeof result.ok !== 'boolean') {
        throw new MipMediaError('SERVICE_UNAVAILABLE', '素材服务返回了无效响应', true)
      }
      if (!result.ok || !result.data) {
        throw new MipMediaError(
          result.error?.code || 'UPLOAD_FAILED',
          result.error?.message || '图片上传失败，请重试',
          result.error?.retryable === true,
        )
      }
      return result.data
    },
  }
}
