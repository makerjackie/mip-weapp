import type {
  MipBannerGateway,
  MipBannerRequest,
} from './types'
import { parsePublicBannerList } from './contracts'
import { MIP_BANNER_CONTRACT_VERSION, MipBannerError } from './types'

interface Envelope {
  ok: boolean
  data?: unknown
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipBannerTransport {
  invoke: (request: MipBannerRequest) => Promise<unknown>
}

export function createMipBannerGateway(transport: MipBannerTransport): MipBannerGateway {
  return {
    async listActive() {
      const result = await transport.invoke({
        contractVersion: MIP_BANNER_CONTRACT_VERSION,
        action: 'mip.banners.listActive',
        input: {},
      }) as Envelope
      if (!result || typeof result.ok !== 'boolean') {
        throw new MipBannerError('SERVICE_UNAVAILABLE', 'Banner 服务返回了无效响应', true)
      }
      if (!result.ok) {
        throw new MipBannerError(
          result.error?.code || 'SERVICE_UNAVAILABLE',
          result.error?.message || 'Banner 服务暂时不可用',
          result.error?.retryable === true,
        )
      }
      return parsePublicBannerList(result.data)
    },
  }
}
