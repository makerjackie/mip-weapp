import type {
  MipBannerAction,
  MipBannerActionInputMap,
  MipBannerGateway,
  MipBannerRequest,
} from './types'
import {
  parseAdminBanner,
  parseAdminBannerPage,
  parseBannerAdminSession,
  parseBannerDeletion,
  parsePublicBannerList,
} from './contracts'
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
  async function invoke<A extends MipBannerAction>(
    action: A,
    input: MipBannerActionInputMap[A],
  ) {
    const result = await transport.invoke({
      contractVersion: MIP_BANNER_CONTRACT_VERSION,
      action,
      input,
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
    return result.data
  }

  return {
    async listActive() {
      return parsePublicBannerList(await invoke('mip.banners.listActive', {}))
    },
    async getAdminSession() {
      return parseBannerAdminSession(await invoke('mip.banners.admin.session', {}))
    },
    async listAdmin(filters = {}) {
      return parseAdminBannerPage(await invoke('mip.banners.admin.list', { filters }))
    },
    async getAdmin(bannerId: string) {
      return parseAdminBanner(await invoke('mip.banners.admin.get', { bannerId }))
    },
    async saveAdmin(input) {
      return parseAdminBanner(await invoke('mip.banners.admin.save', input))
    },
    async changeStatus(bannerId, expectedVersion, status) {
      return parseAdminBanner(await invoke('mip.banners.admin.changeStatus', {
        bannerId,
        expectedVersion,
        status,
      }))
    },
    async move(bannerId: string, expectedVersion: number, direction: 'UP' | 'DOWN') {
      return parseAdminBannerPage(await invoke('mip.banners.admin.move', {
        bannerId,
        expectedVersion,
        direction,
      }))
    },
    async remove(bannerId: string, expectedVersion: number) {
      return parseBannerDeletion(await invoke('mip.banners.admin.delete', {
        bannerId,
        expectedVersion,
      }))
    },
  }
}
