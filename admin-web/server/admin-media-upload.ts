export const ADMIN_MEDIA_UPLOAD_ACTION = 'mip.admin.media.uploadImage' as const
export const ADMIN_MEDIA_UPLOAD_PATH = '/api/media/image' as const
export const ADMIN_MEDIA_MAX_IMAGE_BYTES = 1024 * 1024
export const ADMIN_MEDIA_MAX_REQUEST_BYTES = 1.5 * 1024 * 1024
export const ADMIN_MEDIA_UPSTREAM_TIMEOUT_MS = 60_000
export const ADMIN_MEDIA_PURPOSES = [
  'BANNER',
  'EVENT_ALBUM',
  'EVENT_CONTENT',
  'EVENT_COVER',
  'OPPORTUNITY_COVER',
  'SUPER_CASE_COVER',
  'SUPER_CASE_MEDIA',
  'TASK_TEMPLATE',
] as const

export type AdminMediaPurpose = typeof ADMIN_MEDIA_PURPOSES[number]

export interface AdminMediaUploadInput extends Record<string, unknown> {
  purpose: AdminMediaPurpose
  imageBase64: string
}

export interface AdminMediaUploadRequest {
  action: typeof ADMIN_MEDIA_UPLOAD_ACTION
  input: AdminMediaUploadInput
}

export interface AdminMediaImageFacts {
  contentType: 'image/png' | 'image/jpeg'
  byteLength: number
  width: number
  height: number
}

export interface InspectedAdminMediaUpload {
  request: AdminMediaUploadRequest
  image: AdminMediaImageFacts
}

export class AdminMediaUploadRequestError extends Error {
  readonly code: 'REQUEST_TOO_LARGE' | 'VALIDATION_FAILED' | 'PURPOSE_INVALID' | 'IMAGE_INVALID' | 'IMAGE_TOO_LARGE'
  readonly status: number

  constructor(
    code: 'REQUEST_TOO_LARGE' | 'VALIDATION_FAILED' | 'PURPOSE_INVALID' | 'IMAGE_INVALID' | 'IMAGE_TOO_LARGE',
    message: string,
    status = code === 'REQUEST_TOO_LARGE' || code === 'IMAGE_TOO_LARGE' ? 413 : 400,
  ) {
    super(message)
    this.name = 'AdminMediaUploadRequestError'
    this.code = code
    this.status = status
  }
}

const requestKeys = new Set(['action', 'input'])
const inputKeys = new Set(['purpose', 'imageBase64'])
const purposeSet = new Set<string>(ADMIN_MEDIA_PURPOSES)
const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpegSofMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

export async function readAdminMediaUploadRequest(request: Request): Promise<InspectedAdminMediaUpload> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new AdminMediaUploadRequestError('VALIDATION_FAILED', '请求内容类型必须为 JSON')
  }
  assertDeclaredBodySize(request.headers.get('content-length'))
  const body = await readBoundedBody(request, ADMIN_MEDIA_MAX_REQUEST_BYTES)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  }
  catch {
    throw new AdminMediaUploadRequestError('VALIDATION_FAILED', '请求 JSON 无效')
  }
  return inspectAdminMediaUploadValue(value)
}

export function inspectAdminMediaUploadValue(value: unknown): InspectedAdminMediaUpload {
  if (!plainRecord(value) || !hasExactKeys(value, requestKeys)
    || value.action !== ADMIN_MEDIA_UPLOAD_ACTION
    || !plainRecord(value.input)
    || !hasExactKeys(value.input, inputKeys)) {
    throw new AdminMediaUploadRequestError('VALIDATION_FAILED', '媒体上传请求无效')
  }
  const purpose = value.input.purpose
  if (typeof purpose !== 'string' || !purposeSet.has(purpose)) {
    throw new AdminMediaUploadRequestError('PURPOSE_INVALID', '图片用途无效')
  }
  const imageBase64 = value.input.imageBase64
  if (typeof imageBase64 !== 'string') {
    throw new AdminMediaUploadRequestError('IMAGE_INVALID', '图片编码无效')
  }
  const bytes = decodeCanonicalBase64(imageBase64)
  const image = inspectImageHeader(bytes)
  return {
    request: {
      action: ADMIN_MEDIA_UPLOAD_ACTION,
      input: { purpose: purpose as AdminMediaPurpose, imageBase64 },
    },
    image: { ...image, byteLength: bytes.byteLength },
  }
}

export function createAdminMediaUpstreamRequestInit(
  init: RequestInit,
  timeoutFactory: (milliseconds: number) => AbortSignal = milliseconds => AbortSignal.timeout(milliseconds),
): RequestInit {
  if (init.signal) {
    throw new AdminMediaUploadRequestError('VALIDATION_FAILED', '媒体上传上游请求不能覆盖超时信号')
  }
  return { ...init, signal: timeoutFactory(ADMIN_MEDIA_UPSTREAM_TIMEOUT_MS) }
}

function assertDeclaredBodySize(header: string | null) {
  if (header === null) return
  if (!/^(?:0|[1-9][0-9]*)$/.test(header)) {
    throw new AdminMediaUploadRequestError('VALIDATION_FAILED', '请求大小无效')
  }
  if (Number(header) > ADMIN_MEDIA_MAX_REQUEST_BYTES) {
    throw new AdminMediaUploadRequestError('REQUEST_TOO_LARGE', '图片上传请求过大')
  }
}

async function readBoundedBody(request: Request, maximumBytes: number) {
  if (!request.body) throw new AdminMediaUploadRequestError('VALIDATION_FAILED', '请求内容为空')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) {
        await reader.cancel('REQUEST_TOO_LARGE')
        throw new AdminMediaUploadRequestError('REQUEST_TOO_LARGE', '图片上传请求过大')
      }
      chunks.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function decodeCanonicalBase64(value: unknown) {
  if (typeof value !== 'string' || value.length < 4 || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new AdminMediaUploadRequestError('IMAGE_INVALID', '图片编码无效')
  }
  let binary: string
  try { binary = atob(value) }
  catch { throw new AdminMediaUploadRequestError('IMAGE_INVALID', '图片编码无效') }
  if (binary.length > ADMIN_MEDIA_MAX_IMAGE_BYTES) {
    throw new AdminMediaUploadRequestError('IMAGE_TOO_LARGE', '图片不能超过 1MB')
  }
  if (binary.length === 0 || btoa(binary) !== value) {
    throw new AdminMediaUploadRequestError('IMAGE_INVALID', '图片编码无效')
  }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return bytes
}

function inspectImageHeader(bytes: Uint8Array): Omit<AdminMediaImageFacts, 'byteLength'> {
  if (bytes.byteLength >= 24 && pngSignature.every((byte, index) => bytes[index] === byte)
    && ascii(bytes, 12, 16) === 'IHDR') {
    const width = unsigned32(bytes, 16)
    const height = unsigned32(bytes, 20)
    if (width > 0 && height > 0) return { contentType: 'image/png', width, height }
  }
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 3 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) break
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1
      const marker = bytes[offset]
      offset += 1
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.byteLength) break
      const length = unsigned16(bytes, offset)
      if (length < 2 || offset + length > bytes.byteLength) break
      if (jpegSofMarkers.has(marker) && length >= 7) {
        const height = unsigned16(bytes, offset + 3)
        const width = unsigned16(bytes, offset + 5)
        if (width > 0 && height > 0) return { contentType: 'image/jpeg', width, height }
      }
      offset += length
    }
  }
  throw new AdminMediaUploadRequestError('IMAGE_INVALID', '仅支持有效的 PNG 或 JPEG 图片')
}

function unsigned16(bytes: Uint8Array, offset: number) {
  return bytes[offset] * 256 + bytes[offset + 1]
}

function unsigned32(bytes: Uint8Array, offset: number) {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, allowed: Set<string>) {
  const keys = Reflect.ownKeys(value)
  return keys.length === allowed.size
    && keys.every(key => typeof key === 'string' && allowed.has(key))
}
