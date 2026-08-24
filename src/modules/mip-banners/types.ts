export type MipBannerTargetType = 'MINIPROGRAM_PATH' | 'ARTICLE_URL'
export type MipBannerStatus = 'ACTIVE' | 'INACTIVE' | 'DELETED'

export interface MipPublicBanner {
  id: string
  title: string
  accessibilityLabel: string
  imageUrl: string
  targetType: MipBannerTargetType
  targetValue: string
  sortOrder: number
}

export interface MipAdminBanner extends MipPublicBanner {
  imageAssetId: string
  imageWidth: number
  imageHeight: number
  imageStatus: string
  status: MipBannerStatus
  version: number
  activatedAt: string
  deletedAt: string
  updatedAt: string
}

export interface MipBannerDraft {
  title: string
  accessibilityLabel: string
  imageAssetId: string
  targetType: MipBannerTargetType
  targetValue: string
}

export interface MipBannerAdminPage {
  items: MipAdminBanner[]
  truncated: boolean
}

export interface MipBannerUploadedImage {
  assetId: string
  imageUrl: string
  width: number
  height: number
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
