export const mipMediaPurposes = [
  'AVATAR',
  'EVENT_COVER',
  'EVENT_CONTENT',
  'EVENT_ALBUM',
  'OPPORTUNITY_COVER',
  'SUPER_CASE_COVER',
  'SUPER_CASE_MEDIA',
] as const

export type MipMediaPurpose = (typeof mipMediaPurposes)[number]

export interface MipMediaAsset {
  assetId: string
  purpose: MipMediaPurpose
  imageUrl: string
  width: number
  height: number
}

export interface MipMediaGateway {
  uploadImage: (purpose: MipMediaPurpose, imageBase64: string) => Promise<MipMediaAsset>
}

export class MipMediaError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'MipMediaError'
    this.code = code
    this.retryable = retryable
  }
}
