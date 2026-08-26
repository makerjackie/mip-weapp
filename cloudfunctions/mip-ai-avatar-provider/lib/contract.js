'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

const CONTRACT_VERSION = 'mip.ai.avatar-provider.v1'
const ACTION = 'generateDigitalAvatar'
const maximumRequestBytes = 16 * 1024
const requestKeys = new Set([
  'version',
  'action',
  'timestamp',
  'appId',
  'requestId',
  'operationKey',
  'payloadDigest',
  'payload',
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

function verifyProviderRequest(event, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : Date.now()
  const serialized = safeStableJson(event)
  if (!plainObject(event)
    || Buffer.byteLength(serialized) > maximumRequestBytes
    || !exactKeys(event, requestKeys)
    || event.version !== CONTRACT_VERSION
    || event.action !== ACTION
    || !Number.isSafeInteger(event.timestamp)
    || Math.abs(now - event.timestamp) > 5 * 60 * 1000
    || !(options.allowedAppIds instanceof Set)
    || !options.allowedAppIds.has(event.appId)
    || !/^[a-f0-9]{64}$/.test(String(event.requestId || ''))
    || !/^[a-f0-9]{64}$/.test(String(event.operationKey || ''))
    || !/^[a-f0-9]{64}$/.test(String(event.payloadDigest || ''))
    || digest(event.payload) !== event.payloadDigest
    || !validSignature(event, options.secret)) {
    throw new Error('FORBIDDEN')
  }
  validatePayload(event.payload, event.appId)
  if (avatarOperationKey(event.payload) !== event.operationKey
    || avatarRequestId(event.operationKey, event.payloadDigest) !== event.requestId) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_REQUEST_INVALID')
  }
  return event
}

function validatePayload(value, appId) {
  const extension = value?.sourceContentType === 'image/png' ? 'png' : 'jpg'
  if (!plainObject(value)
    || !exactKeys(value, payloadKeys)
    || value.appId !== appId
    || !/^wx[0-9a-f]{16}$/i.test(value.appId)
    || !uuid(value.generationId)
    || !styleKeys.has(value.styleKey)
    || !/^[a-f0-9]{64}$/.test(String(value.sourceContentSha256 || ''))
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

function createProviderResponse(request, data, secret, now = Date.now()) {
  if (!Number.isSafeInteger(now)) throw new Error('DIGITAL_AVATAR_PROVIDER_RESPONSE_INVALID')
  const unsignedResponse = {
    version: CONTRACT_VERSION,
    timestamp: now,
    requestId: request.requestId,
    operationKey: request.operationKey,
    ok: true,
    data,
    dataDigest: digest(data),
  }
  return { ...unsignedResponse, signature: sign(unsignedResponse, secret) }
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
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_NOT_CONFIGURED')
  }
  return createHmac('sha256', secret).update(stableJson(unsigned(value))).digest('hex')
}

function validSignature(value, secret) {
  const actual = String(value?.signature || '')
  if (typeof secret !== 'string' || secret.length < 32 || !/^[a-f0-9]{64}$/.test(actual)) {
    return false
  }
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

function safeStableJson(value) {
  try {
    const result = stableJson(value)
    return typeof result === 'string' ? result : ''
  }
  catch {
    return ''
  }
}

function exactKeys(value, expected) {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every(key => expected.has(key))
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validDimension(value) {
  return Number.isInteger(value) && value >= 64 && value <= 2048
}

module.exports = {
  ACTION,
  CONTRACT_VERSION,
  avatarOperationKey,
  avatarRequestId,
  createProviderResponse,
  digest,
  maximumRequestBytes,
  sign,
  stableJson,
  unsigned,
  validatePayload,
  verifyProviderRequest,
}
