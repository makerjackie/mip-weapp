'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

const CONTRACT_VERSION = 'mip.ai.avatar-provider.v1'
const ACTION = 'generateDigitalAvatar'
const maximumRequestBytes = 16 * 1024
const transportMetadataKeys = new Set(['frameworkContext', 'tcbContext', 'userInfo'])
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
  if (!plainObject(event)) throw new Error('FORBIDDEN')
  const serialized = safeStableJson(event)
  const request = withoutTransportMetadata(event)
  if (Buffer.byteLength(serialized) > maximumRequestBytes
    || !exactKeys(request, requestKeys)
    || request.version !== CONTRACT_VERSION
    || request.action !== ACTION
    || !Number.isSafeInteger(request.timestamp)
    || Math.abs(now - request.timestamp) > 5 * 60 * 1000
    || !(options.allowedAppIds instanceof Set)
    || !options.allowedAppIds.has(request.appId)
    || !/^[a-f0-9]{64}$/.test(String(request.requestId || ''))
    || !/^[a-f0-9]{64}$/.test(String(request.operationKey || ''))
    || !/^[a-f0-9]{64}$/.test(String(request.payloadDigest || ''))
    || digest(request.payload) !== request.payloadDigest
    || !validSignature(request, options.secret)) {
    throw new Error('FORBIDDEN')
  }
  validatePayload(request.payload, request.appId)
  if (avatarOperationKey(request.payload) !== request.operationKey
    || avatarRequestId(request.operationKey, request.payloadDigest) !== request.requestId) {
    throw new Error('DIGITAL_AVATAR_PROVIDER_REQUEST_INVALID')
  }
  return request
}

function withoutTransportMetadata(event) {
  const request = { ...event }
  for (const key of transportMetadataKeys) {
    if (!Object.hasOwn(request, key)) continue
    if (!plainTransportObject(request[key])) throw new Error('FORBIDDEN')
    delete request[key]
  }
  return request
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

function plainTransportObject(value) {
  if (!plainObject(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
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
