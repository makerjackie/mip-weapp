import type { MipBannerDraft, MipBannerStatus } from './types'
import {
  parseAdminBanner,
  parseAdminBannerPage,
  parseBannerAdminSession,
  parseBannerDeletion,
  parseBannerUploadedImage,
  parsePublicBannerList,
} from './contracts'
import { MipBannerError } from './types'

interface Envelope {
  ok: boolean
  data?: unknown
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipBannerTransport {
  invoke: (functionName: string, action: string, data?: Record<string, unknown>) => Promise<unknown>
}

export function createMipBannerGateway(transport: MipBannerTransport) {
  async function invoke(functionName: string, action: string, data: Record<string, unknown> = {}) {
    const result = await transport.invoke(functionName, action, data) as Envelope
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
      return parsePublicBannerList(await invoke('mip-banners-api', 'mip.banners.listActive'))
    },
    async getAdminSession() {
      return parseBannerAdminSession(await invoke('mip-banners-api', 'mip.banners.admin.session'))
    },
    async listAdmin(filters: { status?: MipBannerStatus | '', query?: string } = {}) {
      return parseAdminBannerPage(await invoke('mip-banners-api', 'mip.banners.admin.list', { filters }))
    },
    async getAdmin(bannerId: string) {
      return parseAdminBanner(await invoke('mip-banners-api', 'mip.banners.admin.get', { bannerId }))
    },
    async saveAdmin(input: { bannerId?: string, expectedVersion?: number, banner: MipBannerDraft }) {
      return parseAdminBanner(await invoke('mip-banners-api', 'mip.banners.admin.save', input))
    },
    async changeStatus(bannerId: string, expectedVersion: number, status: Exclude<MipBannerStatus, 'DELETED'>) {
      return parseAdminBanner(await invoke('mip-banners-api', 'mip.banners.admin.changeStatus', {
        bannerId,
        expectedVersion,
        status,
      }))
    },
    async move(bannerId: string, expectedVersion: number, direction: 'UP' | 'DOWN') {
      return parseAdminBannerPage(await invoke('mip-banners-api', 'mip.banners.admin.move', {
        bannerId,
        expectedVersion,
        direction,
      }))
    },
    async remove(bannerId: string, expectedVersion: number) {
      return parseBannerDeletion(await invoke('mip-banners-api', 'mip.banners.admin.delete', {
        bannerId,
        expectedVersion,
      }))
    },
    async uploadBannerImage(imageBase64: string) {
      return parseBannerUploadedImage(await invoke('mip-media-api', 'uploadImage', {
        purpose: 'BANNER',
        imageBase64,
      }))
    },
  }
}
