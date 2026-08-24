'use strict'

const { createHash, createHmac, randomUUID } = require('node:crypto')
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')

const maximumAvatarBytes = 2 * 1024 * 1024
const minimumAvatarEdge = 256
const maximumAvatarEdge = 2048
const maximumAvatarPixels = 4_194_304
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function decodeAvatarImage(value, declaredContentType) {
  const buffer = strictBase64(value)
  let image
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(pngSignature)) {
    if (declaredContentType !== 'image/png') throw new Error('DIGITAL_AVATAR_IMAGE_INVALID')
    image = sanitizePng(buffer)
  }
  else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    if (declaredContentType !== 'image/jpeg') throw new Error('DIGITAL_AVATAR_IMAGE_INVALID')
    image = sanitizeJpeg(buffer)
  }
  else {
    throw new Error('DIGITAL_AVATAR_IMAGE_INVALID')
  }
  assertAvatarDimensions(image.width, image.height)
  return image
}

function strictBase64(value) {
  if (typeof value !== 'string'
    || value.length < 32
    || value.length % 4 !== 0
    || value.length > Math.ceil(maximumAvatarBytes / 3) * 4 + 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('DIGITAL_AVATAR_IMAGE_INVALID')
  }
  const buffer = Buffer.from(value, 'base64')
  if (!buffer.length || buffer.length > maximumAvatarBytes || buffer.toString('base64') !== value) {
    throw new Error(buffer.length > maximumAvatarBytes
      ? 'DIGITAL_AVATAR_IMAGE_TOO_LARGE'
      : 'DIGITAL_AVATAR_IMAGE_INVALID')
  }
  return buffer
}

function sanitizePng(buffer) {
  let decoded
  try {
    decoded = PNG.sync.read(buffer, { checkCRC: true, skipRescale: false })
  }
  catch {
    throw new Error('DIGITAL_AVATAR_IMAGE_INVALID')
  }
  assertAvatarDimensions(decoded?.width, decoded?.height)
  let sanitized
  try {
    sanitized = PNG.sync.write(decoded, { colorType: 6, inputHasAlpha: true })
  }
  catch {
    throw new Error('DIGITAL_AVATAR_IMAGE_INVALID')
  }
  assertSanitizedBuffer(sanitized)
  return {
    buffer: sanitized,
    contentType: 'image/png',
    extension: 'png',
    width: decoded.width,
    height: decoded.height,
  }
}

function sanitizeJpeg(buffer) {
  let decoded
  try {
    decoded = jpeg.decode(buffer, {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: 96,
      maxResolutionInMP: 4.3,
    })
  }
  catch {
    throw new Error('DIGITAL_AVATAR_IMAGE_INVALID')
  }
  assertAvatarDimensions(decoded?.width, decoded?.height)
  let sanitized
  try {
    sanitized = jpeg.encode({
      data: Buffer.from(decoded.data),
      width: decoded.width,
      height: decoded.height,
    }, 86).data
  }
  catch {
    throw new Error('DIGITAL_AVATAR_IMAGE_INVALID')
  }
  assertSanitizedBuffer(sanitized)
  return {
    buffer: sanitized,
    contentType: 'image/jpeg',
    extension: 'jpg',
    width: decoded.width,
    height: decoded.height,
  }
}

function assertAvatarDimensions(width, height) {
  const ratio = Number(width) / Number(height)
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < minimumAvatarEdge || height < minimumAvatarEdge
    || width > maximumAvatarEdge || height > maximumAvatarEdge
    || width * height > maximumAvatarPixels
    || ratio < 0.8 || ratio > 1.25) {
    throw new Error('DIGITAL_AVATAR_IMAGE_DIMENSIONS_INVALID')
  }
}

function assertSanitizedBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maximumAvatarBytes) {
    throw new Error(buffer?.length > maximumAvatarBytes
      ? 'DIGITAL_AVATAR_IMAGE_TOO_LARGE'
      : 'DIGITAL_AVATAR_IMAGE_INVALID')
  }
}

function openApiAvatarChecker(cloud) {
  return async (image) => {
    const check = cloud?.openapi?.security?.imgSecCheck
    if (typeof check !== 'function') throw new Error('DIGITAL_AVATAR_SAFETY_UNAVAILABLE')
    try {
      const result = await check.call(cloud.openapi.security, {
        media: { contentType: image.contentType, value: image.buffer },
      })
      const code = Object.hasOwn(result || {}, 'errCode') ? result.errCode : result?.errcode
      if (code !== 0) throw new Error('DIGITAL_AVATAR_CONTENT_REJECTED')
    }
    catch (error) {
      if (error instanceof Error && error.message === 'DIGITAL_AVATAR_CONTENT_REJECTED') throw error
      const code = Number(error?.errCode ?? error?.errcode)
      if (code === 87014) throw new Error('DIGITAL_AVATAR_CONTENT_REJECTED')
      throw new Error('DIGITAL_AVATAR_SAFETY_UNAVAILABLE')
    }
  }
}

function createAvatarStore(cloud, options = {}) {
  const storageKey = options.storageKey
  const stage = options.stage
  const configured = typeof storageKey === 'string'
    && storageKey.length >= 32
    && ['development', 'test', 'staging', 'production'].includes(stage)
    && typeof cloud?.uploadFile === 'function'
    && typeof cloud?.deleteFile === 'function'
  const checkImage = options.checkImage || openApiAvatarChecker(cloud)

  async function remove(input = {}) {
    try {
      assertOwnedAvatarFile({ ...input, storageKey })
      const result = await cloud.deleteFile({ fileList: [input.fileId] })
      const item = Array.isArray(result?.fileList)
        ? result.fileList.find(entry => (entry?.fileID || entry?.fileId || entry?.file_id) === input.fileId)
        : null
      return Number(item?.status) === 0
    }
    catch {
      return false
    }
  }

  return {
    configured,
    async store(input) {
      if (!configured) throw new Error('DIGITAL_AVATAR_STORAGE_UNAVAILABLE')
      const image = decodeAvatarImage(input.imageBase64, input.contentType)
      await checkImage(image)
      const assetId = randomUUID()
      const appScope = avatarScope(storageKey, 'app', input.appId)
      const userScope = avatarScope(storageKey, 'user', input.userId)
      const objectKey = `mip/${stage}/${appScope}/digital-avatars/${userScope}/${assetId}.${image.extension}`
      const uploaded = await cloud.uploadFile({ cloudPath: objectKey, fileContent: image.buffer })
      const cloudFileId = typeof uploaded?.fileID === 'string' ? uploaded.fileID.trim() : ''
      assertOwnedAvatarFile({
        appId: input.appId,
        userId: input.userId,
        objectKey,
        fileId: cloudFileId,
        storageKey,
      })
      return {
        assetId,
        objectKey,
        cloudFileId,
        contentSha256: createHash('sha256').update(image.buffer).digest('hex'),
        contentType: image.contentType,
        contentBytes: image.buffer.length,
        width: image.width,
        height: image.height,
      }
    },
    remove,
  }
}

function assertOwnedAvatarFile(input) {
  if (typeof input.storageKey !== 'string' || input.storageKey.length < 32
    || typeof input.appId !== 'string' || !input.appId
    || typeof input.userId !== 'string' || !input.userId) {
    throw new Error('DIGITAL_AVATAR_FILE_INVALID')
  }
  const appScope = avatarScope(input.storageKey, 'app', input.appId)
  const userScope = avatarScope(input.storageKey, 'user', input.userId)
  if (typeof input.objectKey !== 'string'
    || !new RegExp(
      `^mip/(?:development|test|staging|production)/${appScope}/digital-avatars/${userScope}/[0-9a-f-]{36}\\.(?:png|jpg)$`,
    ).test(input.objectKey)
    || input.objectKey.includes('..')
    || input.objectKey.includes('\\')
    || /\s/.test(input.objectKey)
    || cloudObjectKey(input.fileId) !== input.objectKey) {
    throw new Error('DIGITAL_AVATAR_FILE_INVALID')
  }
  return true
}

function cloudObjectKey(fileId) {
  if (typeof fileId !== 'string' || fileId.length > 1024 || !fileId.startsWith('cloud://')
    || fileId.includes('..') || fileId.includes('\\') || /\s/.test(fileId)) {
    throw new Error('DIGITAL_AVATAR_FILE_INVALID')
  }
  const tail = fileId.slice('cloud://'.length)
  const slash = tail.indexOf('/')
  if (slash <= 0 || slash === tail.length - 1) throw new Error('DIGITAL_AVATAR_FILE_INVALID')
  return tail.slice(slash + 1)
}

function avatarScope(key, kind, value) {
  return createHmac('sha256', key)
    .update(`MIP_AI_AVATAR_STORAGE_V1\0${kind}\0${value}`)
    .digest('hex')
    .slice(0, 24)
}

module.exports = {
  assertAvatarDimensions,
  assertOwnedAvatarFile,
  avatarScope,
  createAvatarStore,
  decodeAvatarImage,
  maximumAvatarBytes,
  openApiAvatarChecker,
  strictBase64,
}
