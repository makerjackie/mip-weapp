'use strict'

const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')

const MAX_IMAGE_BYTES = 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

const PURPOSE_POLICIES = Object.freeze({
  AVATAR: Object.freeze({ directory: 'avatars', minimumEdge: 64, maximumEdge: 2048, maximumPixels: 4_194_304 }),
  EVENT_COVER: Object.freeze({ directory: 'event-covers', minimumEdge: 64, maximumEdge: 4096, maximumPixels: 12_000_000 }),
  EVENT_ALBUM: Object.freeze({ directory: 'event-album', minimumEdge: 64, maximumEdge: 4096, maximumPixels: 12_000_000 }),
  OPPORTUNITY_COVER: Object.freeze({ directory: 'opportunity-covers', minimumEdge: 64, maximumEdge: 4096, maximumPixels: 12_000_000 }),
  SUPER_CASE_COVER: Object.freeze({ directory: 'case-covers', minimumEdge: 64, maximumEdge: 4096, maximumPixels: 12_000_000 }),
  SUPER_CASE_MEDIA: Object.freeze({ directory: 'case-media', minimumEdge: 64, maximumEdge: 4096, maximumPixels: 12_000_000 }),
})

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function assertDimensions(width, height, policy) {
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < policy.minimumEdge || height < policy.minimumEdge
    || width > policy.maximumEdge || height > policy.maximumEdge
    || width * height > policy.maximumPixels) {
    throw new Error('IMAGE_DIMENSIONS_INVALID')
  }
}

function inspectPng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('IMAGE_INVALID')
  }
  let offset = 8
  let width = 0
  let height = 0
  let sawHeader = false
  let sawData = false
  let sawEnd = false
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const typeStart = offset + 4
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const crcOffset = dataEnd
    if (dataEnd + 4 > buffer.length) {
      throw new Error('IMAGE_INVALID')
    }
    const type = buffer.toString('ascii', typeStart, typeStart + 4)
    if (!/^[A-Za-z]{4}$/.test(type)
      || crc32(buffer.subarray(typeStart, dataEnd)) !== buffer.readUInt32BE(crcOffset)) {
      throw new Error('IMAGE_INVALID')
    }
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw new Error('IMAGE_INVALID')
      width = buffer.readUInt32BE(dataStart)
      height = buffer.readUInt32BE(dataStart + 4)
      sawHeader = true
    }
    else if (type === 'IHDR') {
      throw new Error('IMAGE_INVALID')
    }
    if (type === 'IDAT') {
      if (!length) throw new Error('IMAGE_INVALID')
      sawData = true
    }
    offset = crcOffset + 4
    if (type === 'IEND') {
      if (length) throw new Error('IMAGE_INVALID')
      sawEnd = true
      break
    }
  }
  if (!sawHeader || !sawData || !sawEnd || offset !== buffer.length) {
    throw new Error('IMAGE_INVALID')
  }
  return { width, height }
}

function inspectJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('IMAGE_INVALID')
  }
  let offset = 2
  let width = 0
  let height = 0
  let sawFrame = false
  let sawScan = false
  let sawEnd = false
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      if (!sawScan) throw new Error('IMAGE_INVALID')
      offset += 1
      continue
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    if (offset >= buffer.length) break
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9) {
      sawEnd = true
      break
    }
    if (marker === 0xd8) throw new Error('IMAGE_INVALID')
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) throw new Error('IMAGE_INVALID')
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) throw new Error('IMAGE_INVALID')
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) throw new Error('IMAGE_INVALID')
      height = buffer.readUInt16BE(offset + 3)
      width = buffer.readUInt16BE(offset + 5)
      sawFrame = true
    }
    if (marker === 0xda) sawScan = true
    offset += length
  }
  if (!sawFrame || !sawScan || !sawEnd || !width || !height) {
    throw new Error('IMAGE_INVALID')
  }
  return { width, height }
}

function strictBase64(value) {
  if (typeof value !== 'string' || value.length < 32
    || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('IMAGE_INVALID')
  }
  const buffer = Buffer.from(value, 'base64')
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('IMAGE_TOO_LARGE')
  }
  return buffer
}

function sanitizePng(buffer, policy) {
  const structural = inspectPng(buffer)
  assertDimensions(structural.width, structural.height, policy)
  let decoded
  try {
    decoded = PNG.sync.read(buffer, { checkCRC: true, skipRescale: false })
  }
  catch {
    throw new Error('IMAGE_INVALID')
  }
  if (!decoded || decoded.width !== structural.width || decoded.height !== structural.height) {
    throw new Error('IMAGE_INVALID')
  }
  assertDimensions(decoded.width, decoded.height, policy)
  let sanitized
  try {
    sanitized = PNG.sync.write(decoded, { colorType: 6, inputHasAlpha: true })
  }
  catch {
    throw new Error('IMAGE_INVALID')
  }
  if (!Buffer.isBuffer(sanitized) || !sanitized.length || sanitized.length > MAX_IMAGE_BYTES) {
    throw new Error(sanitized?.length > MAX_IMAGE_BYTES ? 'IMAGE_TOO_LARGE' : 'IMAGE_INVALID')
  }
  inspectPng(sanitized)
  return {
    buffer: sanitized,
    bytes: sanitized.length,
    contentType: 'image/png',
    extension: 'png',
    width: decoded.width,
    height: decoded.height,
  }
}

function sanitizeJpeg(buffer, policy) {
  const structural = inspectJpeg(buffer)
  assertDimensions(structural.width, structural.height, policy)
  let decoded
  try {
    decoded = jpeg.decode(buffer, {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: 80,
      maxResolutionInMP: (policy.maximumPixels / 1_000_000) + 0.1,
    })
  }
  catch {
    throw new Error('IMAGE_INVALID')
  }
  if (!decoded || decoded.width !== structural.width || decoded.height !== structural.height) {
    throw new Error('IMAGE_INVALID')
  }
  assertDimensions(decoded.width, decoded.height, policy)
  let sanitized
  try {
    sanitized = jpeg.encode({
      data: Buffer.from(decoded.data),
      width: decoded.width,
      height: decoded.height,
    }, 82).data
  }
  catch {
    throw new Error('IMAGE_INVALID')
  }
  if (!Buffer.isBuffer(sanitized) || !sanitized.length || sanitized.length > MAX_IMAGE_BYTES) {
    throw new Error(sanitized?.length > MAX_IMAGE_BYTES ? 'IMAGE_TOO_LARGE' : 'IMAGE_INVALID')
  }
  inspectJpeg(sanitized)
  return {
    buffer: sanitized,
    bytes: sanitized.length,
    contentType: 'image/jpeg',
    extension: 'jpg',
    width: decoded.width,
    height: decoded.height,
  }
}

function decodeAndSanitizeImage(base64, purpose) {
  const policy = PURPOSE_POLICIES[purpose]
  if (!policy) throw new Error('PURPOSE_INVALID')
  const buffer = strictBase64(base64)
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return sanitizePng(buffer, policy)
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return sanitizeJpeg(buffer, policy)
  }
  throw new Error('IMAGE_INVALID')
}

function openApiChecker(cloud) {
  return async (image) => {
    const check = cloud?.openapi?.security?.imgSecCheck
    if (typeof check !== 'function') throw new Error('IMAGE_SAFETY_UNAVAILABLE')
    let result
    try {
      result = await check.call(cloud.openapi.security, {
        media: { contentType: image.contentType, value: image.buffer },
      })
    }
    catch (error) {
      const code = Number(error?.errCode ?? error?.errcode)
      if (code === 87014) throw new Error('IMAGE_CONTENT_REJECTED')
      throw new Error('IMAGE_SAFETY_UNAVAILABLE')
    }
    const code = Object.prototype.hasOwnProperty.call(result || {}, 'errCode')
      ? result.errCode
      : result?.errcode
    if (typeof code !== 'number' || code !== 0) {
      throw new Error('IMAGE_CONTENT_REJECTED')
    }
    return true
  }
}

module.exports = {
  MAX_IMAGE_BYTES,
  PURPOSE_POLICIES,
  crc32,
  decodeAndSanitizeImage,
  inspectJpeg,
  inspectPng,
  openApiChecker,
}
