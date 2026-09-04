export type MipBannerTargetType = 'MINIPROGRAM_PATH' | 'ARTICLE_URL'

export interface MipPublicBanner {
  id: string
  title: string
  accessibilityLabel: string
  imageUrl: string
  targetType: MipBannerTargetType
  targetValue: string
  sortOrder: number
}

export const MIP_BANNER_CONTRACT_VERSION = 1 as const

export interface MipBannerRequest {
  contractVersion: typeof MIP_BANNER_CONTRACT_VERSION
  action: 'mip.banners.listActive'
  input: Record<string, never>
}

export interface MipBannerGateway {
  listActive: () => Promise<MipPublicBanner[]>
}

export class MipBannerError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'MipBannerError'
    this.code = code
    this.retryable = retryable
  }
}
