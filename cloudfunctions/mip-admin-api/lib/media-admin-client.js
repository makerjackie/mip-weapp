'use strict'

const { createHmac, randomBytes } = require('node:crypto')
const {
  MEDIA_ADMIN_OPERATION,
  MEDIA_ADMIN_PURPOSE_CAPABILITIES,
} = require('../domain/media')

const MEDIA_ADMIN_TRANSPORT = 'MIP_MEDIA_ADMIN_V1'
const MEDIA_ADMIN_PROTOCOL = 'mip-media-admin/v1'
const MEDIA_ADMIN_ACTION = 'admin.uploadImage'
const DEFAULT_TIMEOUT_MS = 45_000
const MAX_TIMEOUT_MS = 50_000
const MAX_IMAGE_BYTES = 1024 * 1024
const MEDIA_ADMIN_UPLOAD_POLICIES = Object.freeze({
  BANNER: policy(64, 4096, 12_000_000),
  EVENT_ALBUM: policy(64, 4096, 12_000_000),
  EVENT_CONTENT: policy(64, 4096, 12_000_000),
  EVENT_COVER: policy(64, 4096, 12_000_000),
  OPPORTUNITY_COVER: policy(64, 4096, 12_000_000),
  SUPER_CASE_COVER: policy(64, 4096, 12_000_000),
  SUPER_CASE_MEDIA: policy(64, 4096, 12_000_000),
  TASK_TEMPLATE: policy(64, 4096, 12_000_000),
})
const INPUT_KEYS = new Set(['purpose', 'imageBase64'])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function policy(minimumEdge, maximumEdge, maximumPixels) {
  return Object.freeze({ minimumEdge, maximumEdge, maximumPixels })
}

function createMediaAdminClient(options = {}) {
  const functionName = text(options.functionName) || 'mip-media-api'
  const sourceFunction = text(options.sourceFunction) || 'mip-admin-api'
  const timeoutMs = boundedTimeout(options.timeoutMs)
  const configured = Boolean(
    options.cloud
    && typeof options.cloud.callFunction === 'function'
    && typeof options.secret === 'string'
    && options.secret.length >= 32
    && validFunctionName(functionName)
    && validFunctionName(sourceFunction)
    && functionName !== sourceFunction,
  )
  const now = options.now || Date.now
  const nonce = options.nonce || (() => randomBytes(18).toString('base64url'))

  return Object.freeze({
    configured,
    async execute({ appId, actorUserId, action, input = {} } = {}) {
      if (action !== MEDIA_ADMIN_OPERATION) throw codedError('MEDIA_OPERATION_NOT_ALLOWED')
      const image = inspectImageInput(input)
      if (!configured || typeof now !== 'function' || typeof nonce !== 'function') {
        throw codedError('MEDIA_DISPATCH_CONFIG_REQUIRED')
      }
      if (!trustedIdentifier(appId, 64) || !uuid(actorUserId)) {
        throw codedError('AUTH_REQUIRED')
      }
      const timestamp = Number(now())
      const requestNonce = nonce()
      if (!Number.isSafeInteger(timestamp) || !/^[A-Za-z0-9_-]{24,128}$/.test(requestNonce)) {
        throw codedError('MEDIA_DISPATCH_CONFIG_REQUIRED')
      }
      const request = {
        transport: MEDIA_ADMIN_TRANSPORT,
        protocol: MEDIA_ADMIN_PROTOCOL,
        timestamp,
        nonce: requestNonce,
        appId,
        actorUserId,
        capability: image.capability,
        action: MEDIA_ADMIN_ACTION,
        input: { purpose: input.purpose, imageBase64: input.imageBase64 },
        sourceFunction,
      }
      request.signature = signMediaAdminRequest(request, options.secret)
      let response
      try {
        response = await invokeWithTimeout(
          options.cloud.callFunction({ name: functionName, data: request }),
          timeoutMs,
        )
      }
      catch {
        throw codedError('MEDIA_DISPATCH_UNAVAILABLE')
      }
      if (response?.result?.ok !== true) {
        throw codedError(publicErrorCode(response?.result?.error?.code))
      }
      return response.result.data
    },
  })
}

function inspectImageInput(input) {
  if (!isPlainRecord(input) || !hasExactKeys(input, INPUT_KEYS)) {
    throw codedError('VALIDATION_FAILED')
  }
  const purpose = text(input.purpose)
  const capability = MEDIA_ADMIN_PURPOSE_CAPABILITIES[purpose]
  const imageBase64 = input.imageBase64
  if (!capability) throw codedError('PURPOSE_INVALID')
  if (typeof imageBase64 !== 'string' || imageBase64.length < 32
    || imageBase64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4
    || imageBase64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
    throw codedError('IMAGE_INVALID')
  }
  const buffer = Buffer.from(imageBase64, 'base64')
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw codedError('IMAGE_TOO_LARGE')
  if (buffer.toString('base64') !== imageBase64) throw codedError('IMAGE_INVALID')
  const dimensions = inspectImageDimensions(buffer)
  const uploadPolicy = MEDIA_ADMIN_UPLOAD_POLICIES[purpose]
  if (dimensions.width < uploadPolicy.minimumEdge
    || dimensions.height < uploadPolicy.minimumEdge
    || dimensions.width > uploadPolicy.maximumEdge
    || dimensions.height > uploadPolicy.maximumEdge
    || dimensions.width * dimensions.height > uploadPolicy.maximumPixels) {
    throw codedError('IMAGE_DIMENSIONS_INVALID')
  }
  return { ...dimensions, capability, purpose }
}

function inspectImageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
    && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { contentType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw codedError('IMAGE_INVALID')
  }
  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) throw codedError('IMAGE_INVALID')
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) break
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break
    if (JPEG_SOF_MARKERS.has(marker) && length >= 7) {
      return {
        contentType: 'image/jpeg',
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      }
    }
    offset += length
  }
  throw codedError('IMAGE_INVALID')
}

function signMediaAdminRequest(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw codedError('MEDIA_DISPATCH_CONFIG_REQUIRED')
  }
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'signature'))
  return createHmac('sha256', secret)
    .update(`${MEDIA_ADMIN_PROTOCOL}\0${stableJson(unsigned)}`)
    .digest('hex')
}

async function invokeWithTimeout(invocation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      invocation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('MEDIA_DISPATCH_TIMEOUT')), timeoutMs)
        timer.unref?.()
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

function boundedTimeout(value) {
  const requested = Number(value)
  return Number.isInteger(requested) && requested >= 250 && requested <= MAX_TIMEOUT_MS
    ? requested
    : DEFAULT_TIMEOUT_MS
}

function validFunctionName(value) {
  return /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(value)
}

function trustedIdentifier(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function publicErrorCode(value) {
  const code = text(value)
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'MEDIA_DISPATCH_UNAVAILABLE'
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  error.retryable = [
    'MEDIA_DISPATCH_UNAVAILABLE',
    'IMAGE_SAFETY_UNAVAILABLE',
    'SERVICE_UNAVAILABLE',
    'UPLOAD_FAILED',
  ].includes(code)
  return error
}

function hasExactKeys(value, allowed) {
  const keys = Reflect.ownKeys(value)
  return keys.length === allowed.size
    && keys.every(key => typeof key === 'string' && allowed.has(key))
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  MAX_TIMEOUT_MS,
  MEDIA_ADMIN_ACTION,
  MEDIA_ADMIN_OPERATION,
  MEDIA_ADMIN_PROTOCOL,
  MEDIA_ADMIN_PURPOSE_CAPABILITIES,
  MEDIA_ADMIN_TRANSPORT,
  MEDIA_ADMIN_UPLOAD_POLICIES,
  boundedTimeout,
  createMediaAdminClient,
  inspectImageInput,
  signMediaAdminRequest,
}
