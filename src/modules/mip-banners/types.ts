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

export interface MipBannerAdminSession {
  capability: 'banners.manage'
  roleKey: 'PLATFORM_OWNER' | 'PLATFORM_OPERATIONS'
}

export interface MipBannerAdminFilters {
  status?: MipBannerStatus | ''
  query?: string
}

export interface MipBannerSaveInput {
  bannerId?: string
  expectedVersion?: number
  banner: MipBannerDraft
}

export interface MipBannerVersionInput {
  bannerId: string
  expectedVersion: number
}

export const MIP_BANNER_CONTRACT_VERSION = 1 as const

export interface MipBannerActionInputMap {
  'mip.banners.listActive': Record<string, never>
  'mip.banners.admin.session': Record<string, never>
  'mip.banners.admin.list': { filters?: MipBannerAdminFilters }
  'mip.banners.admin.get': { bannerId: string }
  'mip.banners.admin.save': MipBannerSaveInput
  'mip.banners.admin.changeStatus': MipBannerVersionInput & { status: Exclude<MipBannerStatus, 'DELETED'> }
  'mip.banners.admin.move': MipBannerVersionInput & { direction: 'UP' | 'DOWN' }
  'mip.banners.admin.delete': MipBannerVersionInput
}

export interface MipBannerActionResultMap {
  'mip.banners.listActive': MipPublicBanner[]
  'mip.banners.admin.session': MipBannerAdminSession
  'mip.banners.admin.list': MipBannerAdminPage
  'mip.banners.admin.get': MipAdminBanner
  'mip.banners.admin.save': MipAdminBanner
  'mip.banners.admin.changeStatus': MipAdminBanner
  'mip.banners.admin.move': MipBannerAdminPage
  'mip.banners.admin.delete': { bannerId: string, deleted: true }
}

export type MipBannerAction = keyof MipBannerActionInputMap

export interface MipBannerRequest<A extends MipBannerAction = MipBannerAction> {
  contractVersion: typeof MIP_BANNER_CONTRACT_VERSION
  action: A
  input: MipBannerActionInputMap[A]
}

export interface MipBannerGateway {
  listActive: () => Promise<MipPublicBanner[]>
  getAdminSession: () => Promise<MipBannerAdminSession>
  listAdmin: (filters?: MipBannerAdminFilters) => Promise<MipBannerAdminPage>
  getAdmin: (bannerId: string) => Promise<MipAdminBanner>
  saveAdmin: (input: MipBannerSaveInput) => Promise<MipAdminBanner>
  changeStatus: (
    bannerId: string,
    expectedVersion: number,
    status: Exclude<MipBannerStatus, 'DELETED'>,
  ) => Promise<MipAdminBanner>
  move: (
    bannerId: string,
    expectedVersion: number,
    direction: 'UP' | 'DOWN',
  ) => Promise<MipBannerAdminPage>
  remove: (bannerId: string, expectedVersion: number) => Promise<{ bannerId: string, deleted: true }>
}

export interface MipBannerMediaPort {
  uploadBannerImage: (imageBase64: string) => Promise<MipBannerUploadedImage>
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
