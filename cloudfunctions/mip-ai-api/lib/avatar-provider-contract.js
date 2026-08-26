'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

const CONTRACT_VERSION = 'mip.ai.avatar-provider.v1'
const ACTION = 'generateDigitalAvatar'
const responseKeys = new Set([
  'version',
  'timestamp',
  'requestId',
  'operationKey',
  'ok',
  'data',
  'dataDigest',
  'signature',
])
const payloadKeys = new Set([
  'appId',
  'generationId',
  'styleKey',
  'sourceImageFileId',
  'sourceContentSha256',
  'sourceContentType',
  'sourceContentBytes',
  'sourceWidth',
  'sourceHeight',
])
const styleKeys = new Set(['PROFESSIONAL', 'ILLUSTRATED', 'MONOCHROME'])

function createAvatarProviderRequest(input, secret, now = Date.now()) {
  assertSecret(secret)
  if (!Number.isSafeInteger(now)) throw new Error('DIGITAL_AVATAR_PROVIDER_REQUEST_INVALID')
  const payload = avatarPayload(input)
  validateAvatarPayload(payload)
  const payloadDigest = digest(payload)
  const operationKey = avatarOperationKey(payload)
  const requestId = avatarRequestId(operationKey, payloadDigest)
  const unsignedRequest = {
    version: CONTRACT_VERSION,
    action: ACTION,
    timestamp: now,
    appId: payload.appId,
    requestId,
    operationKey,
    payloadDigest,
    payload,
  }
  return { ...unsignedRequest, signature: sign(unsignedRequest, secret) }
}

function verifyAvatarProviderResponse(value, request, secret, now = Date.now()) {
  assertSecret(secret)
  if (!plainObject(value)
    || !exactKeys(value, responseKeys)
    || value.version !== CONTRACT_VERSION
    || value.ok !== true
    || value.requestId !== request.requestId
    || value.operationKey !== request.operationKey
    || !Number.isSafeInteger(value.timestamp)
    || Math.abs(now - value.timestamp) > 5 * 60 * 1000
    || !/^[a-f0-9]{64}$/.test(String(value.dataDigest || ''))
    || digest(value.data) !== value.dataDigest
    || !validSignature(value, secret)) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
  }
  return value.data
}

function avatarPayload(input = {}) {
  return {
    appId: text(input.appId),
    generationId: text(input.generationId),
    styleKey: text(input.styleKey),
    sourceImageFileId: text(input.sourceImageFileId),
    sourceContentSha256: text(input.sourceContentSha256).toLowerCase(),
    sourceContentType: text(input.sourceContentType),
    sourceContentBytes: Number(input.sourceContentBytes),
    sourceWidth: Number(input.sourceWidth),
    sourceHeight: Number(input.sourceHeight),
  }
}

function validateAvatarPayload(value) {
  const extension = value.sourceContentType === 'image/png' ? 'png' : 'jpg'
  if (!plainObject(value)
    || !exactKeys(value, payloadKeys)
    || !/^wx[0-9a-f]{16}$/i.test(value.appId)
    || !uuid(value.generationId)
    || !styleKeys.has(value.styleKey)
    || !/^[a-f0-9]{64}$/.test(value.sourceContentSha256)
    || !['image/png', 'image/jpeg'].includes(value.sourceContentType)
    || !Number.isInteger(value.sourceContentBytes)
    || value.sourceContentBytes < 32
    || value.sourceContentBytes > 1024 * 1024
    || !validDimension(value.sourceWidth)
    || !validDimension(value.sourceHeight)
    || value.sourceWidth * value.sourceHeight > 4_194_304
    || !validSourceFileId(value.sourceImageFileId, extension)) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_REQUEST_INVALID')
  }
  return value
}

function avatarOperationKey(payload) {
  return createHash('sha256').update([
    'MIP_AI_AVATAR_OPERATION_V1',
    payload.appId,
    payload.generationId,
    ACTION,
  ].join('\0')).digest('hex')
}

function avatarRequestId(operationKey, payloadDigest) {
  return createHash('sha256').update([
    'MIP_AI_AVATAR_REQUEST_V1',
    operationKey,
    payloadDigest,
  ].join('\0')).digest('hex')
}

function validSourceFileId(value, extension) {
  return typeof value === 'string'
    && value.length <= 1024
    && new RegExp(
      `^cloud://[^/\\s]{1,128}/mip/(?:development|test|staging|production)/[0-9a-f]{24}/avatars/[0-9a-f]{24}/[0-9a-f-]{36}\\.${extension}$`,
      'i',
    ).test(value)
    && !value.includes('..')
    && !value.includes('\\')
}

function sign(value, secret) {
  assertSecret(secret)
  return createHmac('sha256', secret).update(stableJson(unsigned(value))).digest('hex')
}

function validSignature(value, secret) {
  const actual = String(value?.signature || '')
  if (!/^[a-f0-9]{64}$/.test(actual)) return false
  const expected = sign(value, secret)
  const actualBuffer = Buffer.from(actual, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
}

function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function unsigned(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => key !== 'signature'))
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function exactKeys(value, expected) {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every(key => expected.has(key))
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validDimension(value) {
  return Number.isInteger(value) && value >= 64 && value <= 2048
}

function assertSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('AI_PROVIDER_UNAVAILABLE')
  }
}

module.exports = {
  ACTION,
  CONTRACT_VERSION,
  avatarOperationKey,
  avatarPayload,
  avatarRequestId,
  createAvatarProviderRequest,
  digest,
  sign,
  stableJson,
  unsigned,
  validateAvatarPayload,
  verifyAvatarProviderResponse,
}
