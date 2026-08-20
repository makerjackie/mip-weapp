'use strict'

/**
 * Avatar image validation + content-safety gate.
 *
 * Decode path uses mature pure-JS decoders (pngjs / jpeg-js):
 * - PNG without IDAT, bad CRC, truncated IEND, or decompression bombs fail closed
 * - JPEG without SOS/EOI, truncated segments, or bombs fail closed
 * - Successful decode is re-encoded so READY media is always sanitize-output bytes
 *
 * Content safety:
 * - Default handler lazily wires wx-server-sdk `cloud.openapi.security.imgSecCheck`
 * - Fail closed for any deployment stage, any payment mode (including disabled),
 *   production NODE_ENV, or CloudBase-like runtime when OpenAPI is missing/errors
 * - Skip is allowed ONLY for pure unit tests: NODE_ENV=test, no stage, no payment mode
 * - Process-wide setter is test-only; production does not depend on it
 * - imgSecCheck contentType always matches real buffer MIME (image/png vs image/jpeg)
 */

const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')

const MAX_AVATAR_BYTES = 512 * 1024
const MIN_AVATAR_EDGE = 64
const MAX_AVATAR_EDGE = 2048
const MAX_AVATAR_PIXELS = MAX_AVATAR_EDGE * MAX_AVATAR_EDGE
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c >>> 0
  }
  return table
})()

/** PNG CRC-32 over type+data (IEEE polynomial 0xEDB88320). */
function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function assertBoundedDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < MIN_AVATAR_EDGE || height < MIN_AVATAR_EDGE
    || width > MAX_AVATAR_EDGE || height > MAX_AVATAR_EDGE
    || width * height > MAX_AVATAR_PIXELS) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
}

/**
 * Structural JPEG walk: require SOI, SOF dims, SOS, and EOI; reject truncated streams.
 */
function inspectJpegStructure(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  let offset = 2
  let width = 0
  let height = 0
  let sawSof = false
  let sawSos = false
  let sawEoi = false

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      // Entropy-coded scan data continues until the next marker.
      if (!sawSos) {
        throw new Error('AVATAR_IMAGE_INVALID')
      }
      offset += 1
      continue
    }
    // Skip fill bytes 0xFF.
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1
    }
    if (offset >= buffer.length) {
      break
    }
    const marker = buffer[offset]
    offset += 1

    if (marker === 0xd9) {
      sawEoi = true
      break
    }
    if (marker === 0xd8) {
      // Nested SOI is invalid for a single image.
      throw new Error('AVATAR_IMAGE_INVALID')
    }
    // Standalone markers without length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }
    if (offset + 2 > buffer.length) {
      throw new Error('AVATAR_IMAGE_INVALID')
    }
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) {
      throw new Error('AVATAR_IMAGE_INVALID')
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) {
        throw new Error('AVATAR_IMAGE_INVALID')
      }
      height = buffer.readUInt16BE(offset + 3)
      width = buffer.readUInt16BE(offset + 5)
      sawSof = true
    }
    if (marker === 0xda) {
      sawSos = true
      // After SOS, payload is entropy data until EOI; advance past SOS header only.
      offset += length
      continue
    }
    offset += length
  }

  if (!sawSof || !sawSos || !sawEoi || !width || !height) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  return { width, height }
}

/**
 * Structural PNG walk before full decode: IHDR first, IDAT required, IEND required, CRC checked.
 */
function inspectPngStructure(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }

  let offset = 8
  let width = 0
  let height = 0
  let sawIhdr = false
  let sawIdat = false
  let sawIend = false

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const typeStart = offset + 4
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const crcOffset = dataEnd
    if (!Number.isFinite(length) || length < 0 || dataEnd + 4 > buffer.length) {
      throw new Error('AVATAR_IMAGE_INVALID')
    }

    const type = buffer.toString('ascii', typeStart, typeStart + 4)
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new Error('AVATAR_IMAGE_INVALID')
    }

    const typeAndData = buffer.subarray(typeStart, dataEnd)
    const expectedCrc = buffer.readUInt32BE(crcOffset)
    if (crc32(typeAndData) !== expectedCrc) {
      throw new Error('AVATAR_IMAGE_INVALID')
    }

    if (!sawIhdr) {
      if (type !== 'IHDR' || length !== 13) {
        throw new Error('AVATAR_IMAGE_INVALID')
      }
      width = buffer.readUInt32BE(dataStart)
      height = buffer.readUInt32BE(dataStart + 4)
      sawIhdr = true
    }
    else if (type === 'IHDR') {
      throw new Error('AVATAR_IMAGE_INVALID')
    }

    if (type === 'IDAT') {
      if (length === 0) {
        throw new Error('AVATAR_IMAGE_INVALID')
      }
      sawIdat = true
    }

    if (type === 'IEND') {
      if (length !== 0) {
        throw new Error('AVATAR_IMAGE_INVALID')
      }
      sawIend = true
      offset = crcOffset + 4
      break
    }

    offset = crcOffset + 4
  }

  if (!sawIhdr || !sawIdat || !sawIend || offset !== buffer.length) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  return { width, height }
}

function decodeAndSanitizePng(buffer) {
  const structural = inspectPngStructure(buffer)
  assertBoundedDimensions(structural.width, structural.height)

  let decoded
  try {
    decoded = PNG.sync.read(buffer, {
      checkCRC: true,
      skipRescale: false,
    })
  }
  catch {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  if (!decoded || decoded.width !== structural.width || decoded.height !== structural.height) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  assertBoundedDimensions(decoded.width, decoded.height)
  if (!Buffer.isBuffer(decoded.data) || decoded.data.length < decoded.width * decoded.height * 4) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }

  let sanitized
  try {
    sanitized = PNG.sync.write(decoded, { colorType: 6, inputHasAlpha: true })
  }
  catch {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  if (!Buffer.isBuffer(sanitized) || !sanitized.length || sanitized.length > MAX_AVATAR_BYTES) {
    throw new Error(sanitized && sanitized.length > MAX_AVATAR_BYTES
      ? 'AVATAR_IMAGE_TOO_LARGE'
      : 'AVATAR_IMAGE_INVALID')
  }
  // Re-verify the sanitize output is a complete PNG with IDAT.
  inspectPngStructure(sanitized)

  return {
    mimeType: 'image/png',
    extension: 'png',
    width: decoded.width,
    height: decoded.height,
    buffer: sanitized,
    bytes: sanitized.length,
  }
}

function decodeAndSanitizeJpeg(buffer) {
  const structural = inspectJpegStructure(buffer)
  assertBoundedDimensions(structural.width, structural.height)

  let decoded
  try {
    decoded = jpeg.decode(buffer, {
      useTArray: true,
      maxMemoryUsageInMB: 32,
      maxResolutionInMP: (MAX_AVATAR_PIXELS / 1_000_000) + 0.1,
      formatAsRGBA: true,
    })
  }
  catch {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  if (!decoded || decoded.width !== structural.width || decoded.height !== structural.height) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  assertBoundedDimensions(decoded.width, decoded.height)
  const pixelBytes = decoded.data
  if (!pixelBytes || pixelBytes.length < decoded.width * decoded.height * 4) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }

  let sanitized
  try {
    sanitized = jpeg.encode({
      data: Buffer.from(pixelBytes),
      width: decoded.width,
      height: decoded.height,
    // One bounded server-side quality target keeps stored masters predictable
    // even when a client skips or inconsistently implements pre-compression.
    }, 82).data
  }
  catch {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  if (!Buffer.isBuffer(sanitized) || !sanitized.length || sanitized.length > MAX_AVATAR_BYTES) {
    throw new Error(sanitized && sanitized.length > MAX_AVATAR_BYTES
      ? 'AVATAR_IMAGE_TOO_LARGE'
      : 'AVATAR_IMAGE_INVALID')
  }
  inspectJpegStructure(sanitized)

  return {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    width: decoded.width,
    height: decoded.height,
    buffer: sanitized,
    bytes: sanitized.length,
  }
}

function metadata(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const image = decodeAndSanitizePng(buffer)
    return {
      mimeType: image.mimeType,
      extension: image.extension,
      width: image.width,
      height: image.height,
    }
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const image = decodeAndSanitizeJpeg(buffer)
    return {
      mimeType: image.mimeType,
      extension: image.extension,
      width: image.width,
      height: image.height,
    }
  }
  throw new Error('AVATAR_IMAGE_INVALID')
}

/**
 * Full decode + sanitize. Returns re-encoded bytes only; READY rows must use these bytes.
 */
function decodeAvatar(base64) {
  if (typeof base64 !== 'string'
    || base64.length < 32
    || base64.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 4
    || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.length || buffer.length > MAX_AVATAR_BYTES) {
    throw new Error('AVATAR_IMAGE_TOO_LARGE')
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return decodeAndSanitizePng(buffer)
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return decodeAndSanitizeJpeg(buffer)
  }
  throw new Error('AVATAR_IMAGE_INVALID')
}

function isProductionEnvironment(env = process.env) {
  return env.MEMBERSHIP_DEPLOYMENT_STAGE === 'production'
    || env.NODE_ENV === 'production'
}

/** SCF / CloudBase runtime markers — never treat a deployed function as unit-test skip. */
function isDeployedLikeEnvironment(env = process.env) {
  return Boolean(
    env.SCF_FUNCTIONNAME
    || env.SCF_RUNTIME
    || env.TENCENTCLOUD_RUNENV
    || env.TCB_ENV
    || env.CLOUDBASE_ENV_ID,
  )
}

/**
 * Pure unit-test skip path only.
 * NODE_ENV=test AND no MEMBERSHIP_DEPLOYMENT_STAGE AND no MEMBERSHIP_PAYMENT_MODE
 * (payment mode disabled/test/live all require real imgSecCheck — never fail-open on payment alone).
 */
function allowsContentSafetySkip(env = process.env) {
  return env.NODE_ENV === 'test'
    && !env.MEMBERSHIP_DEPLOYMENT_STAGE
    && !env.MEMBERSHIP_PAYMENT_MODE
    && !isDeployedLikeEnvironment(env)
}

/**
 * Content safety is required unless the pure unit-test skip path applies.
 * production / test / development stages, any payment mode, production NODE_ENV,
 * and CloudBase-like runtime all fail closed without OpenAPI.
 */
function requiresContentSafety(env = process.env) {
  return !allowsContentSafetySkip(env)
}

/**
 * Detect image MIME from buffer signature (PNG / JPEG only).
 * @param {Buffer} buffer
 * @returns {'image/png'|'image/jpeg'|null}
 */
function detectImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return null
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png'
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg'
  }
  return null
}

function isContentSafetyConfigured(env = process.env) {
  return env.MEMBERSHIP_IMAGE_SAFETY_ENABLED === '1'
    || env.MEMBERSHIP_IMAGE_SAFETY_ENABLED === 'true'
    || Boolean(env.MEMBERSHIP_IMAGE_SAFETY_CHECKER)
    || typeof configuredImageChecker === 'function'
}

/** Optional process-wide WeChat imgSecCheck adapter (tests only). */
let configuredImageChecker = null
/** Lazy cloud reference for default OpenAPI wiring. */
let configuredCloudClient = null

function setAvatarContentChecker(checker) {
  configuredImageChecker = typeof checker === 'function' ? checker : null
}

function clearAvatarContentChecker() {
  configuredImageChecker = null
}

function setAvatarCloudClient(cloud) {
  configuredCloudClient = cloud || null
}

function clearAvatarCloudClient() {
  configuredCloudClient = null
}

/**
 * Lazy OpenAPI image checker. Fail-closed on missing openapi, transport error, or reject.
 * contentType is the real buffer MIME (image/png or image/jpeg) — never hardcode PNG for JPEG.
 * @param {object} cloud wx-server-sdk cloud instance
 * @param {{ mimeType?: string }} [options] optional MIME override; otherwise detected from buffer
 */
function createWxOpenApiImageChecker(cloud, options = {}) {
  return async function checkImageWithOpenApi(buffer) {
    if (!cloud || typeof cloud !== 'object') {
      throw new Error('AVATAR_SAFETY_NOT_CONFIGURED')
    }
    const security = cloud.openapi && cloud.openapi.security
    if (!security || typeof security.imgSecCheck !== 'function') {
      throw new Error('AVATAR_SAFETY_NOT_CONFIGURED')
    }
    const contentType = options.mimeType || detectImageMimeType(buffer)
    if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
      throw new Error('AVATAR_IMAGE_INVALID')
    }
    let result
    try {
      result = await security.imgSecCheck({
        media: {
          contentType,
          value: buffer,
        },
      })
    }
    catch (error) {
      if (error instanceof Error && /^AVATAR_/.test(error.message)) {
        throw error
      }
      // Missing permission / unavailable OpenAPI / transport failures fail closed.
      const message = String(error?.message || error || '')
      if (/not.?config|not.?found|permission|openapi|undefined|is not a function/i.test(message)) {
        throw new Error('AVATAR_SAFETY_NOT_CONFIGURED')
      }
      throw new Error('AVATAR_CONTENT_REJECTED')
    }
    if (!isOpenApiImgSecCheckSuccess(result)) {
      throw new Error('AVATAR_CONTENT_REJECTED')
    }
    return { ok: true, provider: 'wx.openapi.security.imgSecCheck', contentType }
  }
}

/**
 * Fail-closed OpenAPI imgSecCheck envelope.
 * Accepts only a non-null object that owns numeric errCode/errcode === 0.
 * Rejects undefined/null/array/primitives, missing field, string "0", and non-zero codes.
 * @param {unknown} result
 * @returns {boolean}
 */
function isOpenApiImgSecCheckSuccess(result) {
  if (result === null || result === undefined || typeof result !== 'object' || Array.isArray(result)) {
    return false
  }
  const hasErrCode = Object.prototype.hasOwnProperty.call(result, 'errCode')
  const hasErrcode = Object.prototype.hasOwnProperty.call(result, 'errcode')
  if (!hasErrCode && !hasErrcode) {
    return false
  }
  // Prefer canonical errCode when both exist; either field must be strict numeric 0.
  const raw = hasErrCode ? result.errCode : result.errcode
  return typeof raw === 'number' && Number.isFinite(raw) && raw === 0
}

/**
 * Default checker: OpenAPI when available; fail closed without it unless pure unit-test skip.
 * Process setter is only a test seam — production must work via cloud.openapi alone.
 */
async function defaultContentChecker(buffer, env = process.env, deps = {}) {
  if (typeof configuredImageChecker === 'function') {
    return configuredImageChecker(buffer)
  }
  const cloud = deps.cloud || configuredCloudClient
  const mimeType = deps.mimeType || detectImageMimeType(buffer)
  if (cloud && cloud.openapi && cloud.openapi.security
    && typeof cloud.openapi.security.imgSecCheck === 'function') {
    return createWxOpenApiImageChecker(cloud, { mimeType: mimeType || undefined })(buffer)
  }
  if (requiresContentSafety(env) || isContentSafetyConfigured(env)) {
    throw new Error('AVATAR_SAFETY_NOT_CONFIGURED')
  }
  return { ok: true, skipped: true }
}

/**
 * Injectable WeChat image content safety gate.
 * @param {Buffer} buffer
 * @param {{
 *   checkImage?: (buffer: Buffer) => Promise<any>,
 *   cloud?: object,
 *   env?: NodeJS.ProcessEnv,
 *   mimeType?: string,
 * }} [deps]
 */
async function assertAvatarContentSafe(buffer, deps = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('AVATAR_IMAGE_INVALID')
  }
  const env = deps.env || process.env
  const mimeType = deps.mimeType || detectImageMimeType(buffer)
  const checker = deps.checkImage
    || (bufferArg => defaultContentChecker(bufferArg, env, { ...deps, mimeType: mimeType || undefined }))
  let result
  try {
    result = await checker(buffer)
  }
  catch (error) {
    if (error instanceof Error && /^AVATAR_/.test(error.message)) {
      throw error
    }
    throw new Error('AVATAR_CONTENT_REJECTED')
  }
  if (result === false || result?.ok === false || result?.rejected === true) {
    throw new Error('AVATAR_CONTENT_REJECTED')
  }
  return result && typeof result === 'object' ? result : { ok: true }
}

/**
 * Build a real displayable PNG (signature + IHDR + IDAT + IEND) for tests.
 * Uses pngjs so decodeAvatar accepts the fixture.
 */
function buildMinimalPng(width, height, { corruptCrc = false, omitIdat = false } = {}) {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2
      png.data[idx] = (x * 3 + y) & 0xff
      png.data[idx + 1] = (y * 5) & 0xff
      png.data[idx + 2] = (x + y) & 0xff
      png.data[idx + 3] = 255
    }
  }
  const full = PNG.sync.write(png, { colorType: 6 })
  if (!corruptCrc && !omitIdat) {
    return full
  }

  // Manual chunk rebuild for fault injection.
  if (omitIdat) {
    const ihdrData = Buffer.alloc(13)
    ihdrData.writeUInt32BE(width >>> 0, 0)
    ihdrData.writeUInt32BE(height >>> 0, 4)
    ihdrData[8] = 8
    ihdrData[9] = 6
    ihdrData[10] = 0
    ihdrData[11] = 0
    ihdrData[12] = 0
    function chunk(type, data) {
      const typeBuf = Buffer.from(type, 'ascii')
      const length = Buffer.alloc(4)
      length.writeUInt32BE(data.length)
      const digest = crc32(Buffer.concat([typeBuf, data]))
      const crcBuf = Buffer.alloc(4)
      crcBuf.writeUInt32BE(digest >>> 0)
      return Buffer.concat([length, typeBuf, data, crcBuf])
    }
    return Buffer.concat([
      PNG_SIGNATURE,
      chunk('IHDR', ihdrData),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }

  // Corrupt IHDR CRC while leaving IDAT intact.
  const corrupted = Buffer.from(full)
  // IHDR starts at offset 8; CRC is at 8+4+4+13 = 29.
  const ihdrCrcOffset = 8 + 4 + 4 + 13
  corrupted.writeUInt32BE(corrupted.readUInt32BE(ihdrCrcOffset) ^ 0xffffffff, ihdrCrcOffset)
  return corrupted
}

/**
 * Build a real JPEG with SOS+EOI for tests via jpeg-js encode.
 */
function buildMinimalJpeg(width, height, { truncate = false } = {}) {
  const frame = {
    data: Buffer.alloc(width * height * 4, 0),
    width,
    height,
  }
  for (let i = 0; i < frame.data.length; i += 4) {
    frame.data[i] = 40
    frame.data[i + 1] = 80
    frame.data[i + 2] = 120
    frame.data[i + 3] = 255
  }
  const encoded = jpeg.encode(frame, 85).data
  if (truncate) {
    // Drop trailing EOI and part of scan so structure validation fails.
    return encoded.subarray(0, Math.max(4, encoded.length - 8))
  }
  return encoded
}

module.exports = {
  MAX_AVATAR_BYTES,
  MIN_AVATAR_EDGE,
  MAX_AVATAR_EDGE,
  allowsContentSafetySkip,
  assertAvatarContentSafe,
  buildMinimalJpeg,
  buildMinimalPng,
  clearAvatarCloudClient,
  clearAvatarContentChecker,
  createWxOpenApiImageChecker,
  crc32,
  decodeAvatar,
  defaultContentChecker,
  detectImageMimeType,
  inspectJpegStructure,
  inspectPngStructure,
  isContentSafetyConfigured,
  isDeployedLikeEnvironment,
  isOpenApiImgSecCheckSuccess,
  isProductionEnvironment,
  metadata,
  requiresContentSafety,
  setAvatarCloudClient,
  setAvatarContentChecker,
}
