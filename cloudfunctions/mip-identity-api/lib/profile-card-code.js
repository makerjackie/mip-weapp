'use strict'

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} = require('node:crypto')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const SCENE_PREFIX = 'pc1_'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function deploymentStage(value) {
  const stage = String(value || '').trim().toLowerCase()
  if (!['development', 'test', 'staging', 'production'].includes(stage)) {
    throw new Error('PROFILE_CARD_CODE_UNAVAILABLE')
  }
  return stage
}

function codeEnvironment(stage) {
  if (stage === 'production') return 'release'
  if (stage === 'staging') return 'trial'
  return 'develop'
}

function sceneKey(appId, pepper) {
  if (typeof appId !== 'string' || !appId || typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  return createHash('sha256')
    .update('mip-profile-card-scene:v1\0')
    .update(appId)
    .update('\0')
    .update(pepper)
    .digest()
}

function uuidBytes(userId) {
  if (!UUID_PATTERN.test(String(userId || ''))) {
    throw new Error('PROFILE_CARD_CODE_UNAVAILABLE')
  }
  return Buffer.from(userId.replaceAll('-', ''), 'hex')
}

function bytesUuid(value) {
  const hex = value.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

function createProfileCardScene({ appId, userId }, pepper) {
  const cipher = createCipheriv('aes-256-ecb', sceneKey(appId, pepper), null)
  cipher.setAutoPadding(false)
  const encrypted = Buffer.concat([cipher.update(uuidBytes(userId)), cipher.final()])
  return `${SCENE_PREFIX}${encrypted.toString('base64url')}`
}

function readProfileCardScene(scene, appId, pepper) {
  if (typeof scene !== 'string' || !/^pc1_[A-Za-z0-9_-]{22}$/.test(scene)) {
    throw new Error('PUBLIC_PROFILE_NOT_FOUND')
  }
  try {
    const encrypted = Buffer.from(scene.slice(SCENE_PREFIX.length), 'base64url')
    if (encrypted.length !== 16) throw new Error('INVALID_SCENE')
    const decipher = createDecipheriv('aes-256-ecb', sceneKey(appId, pepper), null)
    decipher.setAutoPadding(false)
    const userId = bytesUuid(Buffer.concat([decipher.update(encrypted), decipher.final()]))
    if (!UUID_PATTERN.test(userId)) throw new Error('INVALID_SCENE')
    return userId
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
    throw new Error('PUBLIC_PROFILE_NOT_FOUND')
  }
}

function profileCardCodeKey({ appId, scene, env = process.env, extension = 'png' }) {
  const secret = String(env.MIP_MEDIA_SCOPE_SECRET || '')
  if (!appId || !/^pc1_[A-Za-z0-9_-]{22}$/.test(scene) || secret.length < 32
    || !['jpg', 'png'].includes(extension)) {
    throw new Error('PROFILE_CARD_CODE_UNAVAILABLE')
  }
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  const appScope = createHmac('sha256', secret).update(appId).digest('hex').slice(0, 24)
  const reference = createHash('sha256').update(scene).digest('hex').slice(0, 32)
  return `mip/${stage}/${appScope}/profile-cards/${reference}.${extension}`
}

async function createProfileCardCode({ appId, userId, cloud, pepper, env = process.env }) {
  if (typeof cloud?.openapi?.wxacode?.getUnlimited !== 'function'
    || typeof cloud?.uploadFile !== 'function') {
    throw new Error('PROFILE_CARD_CODE_UNAVAILABLE')
  }
  const scene = createProfileCardScene({ appId, userId }, pepper)
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  let response
  try {
    response = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page: 'packages/member/mip-public-profile/index',
      width: 430,
      checkPath: false,
      envVersion: codeEnvironment(stage),
    })
  }
  catch {
    throw new Error('PROFILE_CARD_OPENAPI_UNAVAILABLE')
  }
  const content = binaryBuffer(Buffer.isBuffer(response) ? response : response?.buffer)
  if (!Buffer.isBuffer(content) || content.length < JPEG_SIGNATURE.length
    || content.length > 2 * 1024 * 1024
    || (!content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
      && !content.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE))) {
    throw new Error('PROFILE_CARD_OPENAPI_INVALID_RESPONSE')
  }
  const extension = content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? 'png' : 'jpg'
  const objectKey = profileCardCodeKey({ appId, scene, env, extension })
  let uploaded
  try {
    uploaded = await cloud.uploadFile({ cloudPath: objectKey, fileContent: content })
  }
  catch {
    throw new Error('PROFILE_CARD_STORAGE_UNAVAILABLE')
  }
  const codeUrl = typeof uploaded?.fileID === 'string' ? uploaded.fileID.trim() : ''
  if (!codeUrl.startsWith('cloud://') || !codeUrl.endsWith(`/${objectKey}`)
    || codeUrl.includes('..') || codeUrl.includes('\\') || /\s/.test(codeUrl)) {
    throw new Error('PROFILE_CARD_STORAGE_INVALID_RESPONSE')
  }
  return { codeUrl }
}

function binaryBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(value))
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data)
  }
  if (typeof value === 'string' && value.length > 0 && value.length <= 3 * 1024 * 1024) {
    try {
      const decoded = Buffer.from(value, 'base64')
      if (decoded.length > 0 && decoded.toString('base64') === value.replace(/\s/g, '')) {
        return decoded
      }
    }
    catch { /* The response is validated by the supported image signatures below. */ }
  }
  return null
}

module.exports = {
  codeEnvironment,
  createProfileCardCode,
  createProfileCardScene,
  deploymentStage,
  profileCardCodeKey,
  readProfileCardScene,
}
