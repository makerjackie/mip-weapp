export const ADMIN_MEDIA_UPLOAD_ACTION = 'mip.admin.media.uploadImage' as const
export const ADMIN_MEDIA_MAX_IMAGE_BYTES = 1024 * 1024
export const ADMIN_MEDIA_PURPOSE_OPTIONS = [
  { value: 'BANNER', label: 'Banner 图片' },
  { value: 'EVENT_ALBUM', label: '活动相册' },
  { value: 'EVENT_CONTENT', label: '活动正文图片' },
  { value: 'EVENT_COVER', label: '活动封面' },
  { value: 'OPPORTUNITY_COVER', label: '机会封面' },
  { value: 'SUPER_CASE_COVER', label: '超级案例封面' },
  { value: 'SUPER_CASE_MEDIA', label: '超级案例图片' },
  { value: 'TASK_TEMPLATE', label: '任务模板图片' },
] as const
export const ADMIN_MEDIA_PURPOSE_CAPABILITIES = Object.freeze({
  BANNER: 'banners.manage',
  EVENT_ALBUM: 'events.album.manage',
  EVENT_CONTENT: 'events.write',
  EVENT_COVER: 'events.write',
  OPPORTUNITY_COVER: 'opportunities.moderate',
  SUPER_CASE_COVER: 'userContent.moderate',
  SUPER_CASE_MEDIA: 'userContent.moderate',
  TASK_TEMPLATE: 'tasks.manage',
} satisfies Record<AdminMediaPurpose, string>)

export type AdminMediaPurpose = typeof ADMIN_MEDIA_PURPOSE_OPTIONS[number]['value']

export interface AdminMediaFile {
  name: string
  size: number
  type: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

export interface PreparedAdminMediaUpload {
  action: typeof ADMIN_MEDIA_UPLOAD_ACTION
  input: { purpose: AdminMediaPurpose; imageBase64: string }
}

export interface AdminMediaUploadResult {
  assetId: string
  imageUrl: string
}

export interface AdminMediaCapabilityGrant {
  capability: string
  scopeType?: string
}

export class AdminMediaUploadError extends Error {
  readonly code: 'PURPOSE_INVALID' | 'IMAGE_INVALID' | 'IMAGE_TOO_LARGE' | 'INVALID_RESPONSE'

  constructor(code: 'PURPOSE_INVALID' | 'IMAGE_INVALID' | 'IMAGE_TOO_LARGE' | 'INVALID_RESPONSE', message: string) {
    super(message)
    this.name = 'AdminMediaUploadError'
    this.code = code
  }
}

const purposeSet = new Set<string>(ADMIN_MEDIA_PURPOSE_OPTIONS.map(option => option.value))
const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const assetIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function prepareAdminMediaUpload(
  file: AdminMediaFile,
  purpose: AdminMediaPurpose,
): Promise<PreparedAdminMediaUpload> {
  if (!purposeSet.has(purpose)) throw new AdminMediaUploadError('PURPOSE_INVALID', '图片用途无效')
  const declaredType = validateAdminMediaFileMetadata(file)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength !== file.size || bytes.byteLength === 0) {
    throw new AdminMediaUploadError('IMAGE_INVALID', '图片读取结果无效')
  }
  const actualType = imageContentType(bytes)
  if (!actualType || actualType !== declaredType) {
    throw new AdminMediaUploadError('IMAGE_INVALID', '图片格式与文件类型不一致')
  }
  return {
    action: ADMIN_MEDIA_UPLOAD_ACTION,
    input: { purpose, imageBase64: bytesToBase64(bytes) },
  }
}

export function validateAdminMediaFileMetadata(file: Pick<AdminMediaFile, 'size' | 'type'>) {
  const declaredType = file.type.trim().toLowerCase()
  if (!['image/png', 'image/jpeg'].includes(declaredType)
    || !Number.isSafeInteger(file.size)
    || file.size < 1) {
    throw new AdminMediaUploadError('IMAGE_INVALID', '请选择 PNG 或 JPEG 图片')
  }
  if (file.size > ADMIN_MEDIA_MAX_IMAGE_BYTES) {
    throw new AdminMediaUploadError('IMAGE_TOO_LARGE', '图片不能超过 1MB')
  }
  return declaredType as 'image/png' | 'image/jpeg'
}

export function availableAdminMediaPurposeOptions(grants: readonly AdminMediaCapabilityGrant[] = []) {
  return ADMIN_MEDIA_PURPOSE_OPTIONS.filter(option => hasPlatformMediaCapability(
    grants,
    ADMIN_MEDIA_PURPOSE_CAPABILITIES[option.value],
  ))
}

export function hasAdminMediaUploadAccess(grants: readonly AdminMediaCapabilityGrant[] = []) {
  return ADMIN_MEDIA_PURPOSE_OPTIONS.some(option => hasPlatformMediaCapability(
    grants,
    ADMIN_MEDIA_PURPOSE_CAPABILITIES[option.value],
  ))
}

export function hasPlatformMediaCapability(
  grants: readonly AdminMediaCapabilityGrant[],
  capability: string,
) {
  return grants.some(grant => grant.capability === capability && grant.scopeType === 'PLATFORM')
}

export function parseAdminMediaUploadResult(value: unknown): AdminMediaUploadResult {
  if (!plainRecord(value) || value.ok !== true || !plainRecord(value.data)) {
    throw new AdminMediaUploadError('INVALID_RESPONSE', '图片上传结果无效')
  }
  const assetId = value.data.assetId
  const imageUrl = value.data.imageUrl
  if (typeof assetId !== 'string' || !assetIdPattern.test(assetId)
    || typeof imageUrl !== 'string' || imageUrl.length < 1 || imageUrl.length > 1024
    || !/^(?:cloud|https):\/\/[^\s\\]+$/.test(imageUrl)) {
    throw new AdminMediaUploadError('INVALID_RESPONSE', '图片上传结果无效')
  }
  return { assetId, imageUrl }
}

function imageContentType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.byteLength >= 24 && pngSignature.every((byte, index) => bytes[index] === byte)
    && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR'
    && unsigned32(bytes, 16) > 0 && unsigned32(bytes, 20) > 0) {
    return 'image/png'
  }
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  return null
}

function unsigned32(bytes: Uint8Array, offset: number) {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]
}

function bytesToBase64(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.byteLength; index += 3) {
    const a = bytes[index]
    const hasB = index + 1 < bytes.byteLength
    const hasC = index + 2 < bytes.byteLength
    const b = hasB ? bytes[index + 1] : 0
    const c = hasC ? bytes[index + 2] : 0
    output += alphabet[a >> 2]
    output += alphabet[((a & 3) << 4) | (b >> 4)]
    output += hasB ? alphabet[((b & 15) << 2) | (c >> 6)] : '='
    output += hasC ? alphabet[c & 63] : '='
  }
  return output
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
