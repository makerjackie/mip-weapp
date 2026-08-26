'use strict'

const { createHash, timingSafeEqual } = require('node:crypto')
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')

const maximumSourceBytes = 1024 * 1024
const maximumOutputBytes = 2 * 1024 * 1024
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpegSofMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function createImageLoader(cloud) {
  return {
    async load(input) {
      if (typeof cloud?.downloadFile !== 'function') {
        throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_UNAVAILABLE')
      }
      let result
      try {
        result = await cloud.downloadFile({ fileID: input.sourceImageFileId })
      }
      catch {
        throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_UNAVAILABLE')
      }
      const content = Buffer.isBuffer(result?.fileContent)
        ? result.fileContent
        : Buffer.from(result?.fileContent || '')
      const actualDigest = createHash('sha256').update(content).digest()
      const expectedDigest = Buffer.from(input.sourceContentSha256, 'hex')
      if (content.length !== input.sourceContentBytes
        || content.length < 32
        || content.length > maximumSourceBytes
        || expectedDigest.length !== actualDigest.length
        || !timingSafeEqual(actualDigest, expectedDigest)) {
        throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
      }
      const image = inspectImage(content, input.sourceContentType, sourcePolicy)
      if (image.width !== input.sourceWidth || image.height !== input.sourceHeight) {
        throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
      }
      return {
        contentBase64: content.toString('base64'),
        contentSha256: input.sourceContentSha256,
        contentType: input.sourceContentType,
        contentBytes: content.length,
        width: image.width,
        height: image.height,
      }
    },
  }
}

function normalizeOutputImage(value, contentType) {
  const content = strictBase64(value, maximumOutputBytes)
  try {
    inspectImage(content, contentType, outputPolicy)
  }
  catch {
    throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
  }
  return content.toString('base64')
}

function strictBase64(value, maximumBytes) {
  if (typeof value !== 'string'
    || value.length < 32
    || value.length % 4 !== 0
    || value.length > Math.ceil(maximumBytes / 3) * 4 + 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
  }
  const content = Buffer.from(value, 'base64')
  if (!content.length || content.length > maximumBytes || content.toString('base64') !== value) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
  }
  return content
}

function inspectImage(content, contentType, policy) {
  let dimensions
  if (contentType === 'image/png') {
    dimensions = pngDimensions(content)
    assertDimensions(dimensions, policy)
    let decoded
    try {
      decoded = PNG.sync.read(content, { checkCRC: true, skipRescale: false })
    }
    catch {
      throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
    }
    if (decoded?.width !== dimensions.width || decoded?.height !== dimensions.height) {
      throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
    }
  }
  else if (contentType === 'image/jpeg') {
    dimensions = jpegDimensions(content)
    assertDimensions(dimensions, policy)
    let decoded
    try {
      decoded = jpeg.decode(content, {
        useTArray: true,
        formatAsRGBA: true,
        maxMemoryUsageInMB: 96,
        maxResolutionInMP: 4.3,
      })
    }
    catch {
      throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
    }
    if (decoded?.width !== dimensions.width || decoded?.height !== dimensions.height) {
      throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
    }
  }
  else {
    throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
  }
  return dimensions
}

function pngDimensions(content) {
  if (content.length < 33
    || !content.subarray(0, 8).equals(pngSignature)
    || content.readUInt32BE(8) !== 13
    || content.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
  }
  return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) }
}

function jpegDimensions(content) {
  if (content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
  }
  let offset = 2
  while (offset + 3 < content.length) {
    if (content[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (content[offset] === 0xff) offset += 1
    const marker = content[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x00 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > content.length) break
    const length = content.readUInt16BE(offset)
    if (length < 2 || offset + length > content.length) break
    if (jpegSofMarkers.has(marker) && length >= 7) {
      return {
        height: content.readUInt16BE(offset + 3),
        width: content.readUInt16BE(offset + 5),
      }
    }
    offset += length
  }
  throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
}

function assertDimensions(value, policy) {
  const ratio = Number(value.width) / Number(value.height)
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height)
    || value.width < policy.minimumEdge || value.height < policy.minimumEdge
    || value.width > 2048 || value.height > 2048
    || value.width * value.height > 4_194_304
    || policy.square && (ratio < 0.8 || ratio > 1.25)) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_IMAGE_INVALID')
  }
}

const sourcePolicy = Object.freeze({ minimumEdge: 64, square: false })
const outputPolicy = Object.freeze({ minimumEdge: 256, square: true })

module.exports = {
  createImageLoader,
  inspectImage,
  jpegDimensions,
  maximumOutputBytes,
  maximumSourceBytes,
  normalizeOutputImage,
  pngDimensions,
  strictBase64,
}
