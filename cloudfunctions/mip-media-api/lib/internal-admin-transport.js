'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')
const {
  MAX_IMAGE_BYTES,
  PURPOSE_POLICIES,
  inspectJpeg,
  inspectPng,
} = require('../domain/image')

const MEDIA_ADMIN_TRANSPORT = 'MIP_MEDIA_ADMIN_V1'
const MEDIA_ADMIN_PROTOCOL = 'mip-media-admin/v1'
const MAX_CLOCK_SKEW_MS = 60_000
const MEDIA_ADMIN_ACTION = 'admin.uploadImage'
const MEDIA_ADMIN_PURPOSE_CAPABILITIES = Object.freeze({
  BANNER: 'banners.manage',
  EVENT_ALBUM: 'events.album.manage',
  EVENT_CONTENT: 'events.write',
  EVENT_COVER: 'events.write',
  OPPORTUNITY_COVER: 'opportunities.moderate',
  SUPER_CASE_COVER: 'userContent.moderate',
  SUPER_CASE_MEDIA: 'userContent.moderate',
  TASK_TEMPLATE: 'tasks.manage',
})
const MEDIA_ADMIN_UPLOAD_POLICIES = Object.freeze(Object.fromEntries(
  Object.keys(MEDIA_ADMIN_PURPOSE_CAPABILITIES).map(purpose => [purpose, PURPOSE_POLICIES[purpose]]),
))
const SIGNED_KEYS = new Set([
  'transport', 'protocol', 'timestamp', 'nonce', 'appId', 'actorUserId',
  'capability', 'action', 'input', 'sourceFunction',
])
const INPUT_KEYS = new Set(['purpose', 'imageBase64'])
const FRAMEWORK_KEYS = new Set(['userInfo', 'tcbContext', 'frameworkContext'])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function verifyMediaAdminRequest(
  value,
  { secret, allowedAppIds, sourceFunction = 'mip-admin-api', now = Date.now } = {},
) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('MEDIA_INTERNAL_AUTH_CONFIG_REQUIRED')
  }
  if (!isPlainRecord(value)) throw new Error('AUTH_REQUIRED')
  const signed = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'signature') continue
    if (FRAMEWORK_KEYS.has(key)) continue
    if (!SIGNED_KEYS.has(key)) throw new Error('AUTH_REQUIRED')
    signed[key] = item
  }
  const capability = mediaCapabilityForInput(signed.input)
  if (!hasExactKeys(signed, SIGNED_KEYS)
    || typeof value.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.signature)
    || signed.transport !== MEDIA_ADMIN_TRANSPORT
    || signed.protocol !== MEDIA_ADMIN_PROTOCOL
    || signed.action !== MEDIA_ADMIN_ACTION
    || signed.capability !== capability
    || !Number.isSafeInteger(signed.timestamp)
    || typeof now !== 'function'
    || Math.abs(Number(now()) - signed.timestamp) > MAX_CLOCK_SKEW_MS
    || typeof signed.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{24,128}$/.test(signed.nonce)
    || !(allowedAppIds instanceof Set)
    || !allowedAppIds.has(signed.appId)
    || !uuid(signed.actorUserId)
    || !trustedFunctionName(signed.sourceFunction)
    || signed.sourceFunction !== sourceFunction) {
    throw new Error('AUTH_REQUIRED')
  }
  const expected = createHmac('sha256', secret)
    .update(`${MEDIA_ADMIN_PROTOCOL}\0${stableJson(signed)}`)
    .digest()
  const supplied = Buffer.from(value.signature, 'hex')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('AUTH_REQUIRED')
  }
  inspectAdminImageInput(signed.input)
  return signed
}

async function assertMediaAdminCapability(database, request) {
  if (!database || typeof database.query !== 'function') {
    throw new Error('MEDIA_INTERNAL_HANDLER_CONFIG_INVALID')
  }
  const rows = await database.query(
    `SELECT binding.role_key,
       CASE WHEN policy.policy_mode = 'CUSTOM' THEN policy.capabilities_json ELSE NULL END AS policy_capabilities_json
     FROM mip_users u
     INNER JOIN mip_admin_role_bindings binding
       ON binding.app_id = u.app_id AND binding.user_id = u.id
     LEFT JOIN mip_role_capability_policies policy
       ON policy.app_id = binding.app_id AND policy.role_key = binding.role_key
     WHERE u.app_id = ? AND u.id = ? AND u.status = 'ACTIVE'
       AND binding.scope_type = 'PLATFORM'
       AND binding.scope_id = '00000000-0000-0000-0000-000000000000'
       AND binding.status = 'ACTIVE'
       AND binding.role_key IN ('PLATFORM_OWNER', 'PLATFORM_OPERATIONS')`,
    [request.appId, request.actorUserId],
  )
  if (!(Array.isArray(rows) && rows.some(row => configuredCapabilityAllows(row, request.capability)))) {
    throw new Error('FORBIDDEN')
  }
}

function createInternalMediaHandler({
  service,
  database,
  secret,
  allowedAppIds,
  failure,
  sourceFunction = 'mip-admin-api',
  now = Date.now,
} = {}) {
  if (!service || typeof service.uploadImage !== 'function' || typeof failure !== 'function') {
    throw new Error('MEDIA_INTERNAL_HANDLER_CONFIG_INVALID')
  }
  return async function handle(event = {}) {
    try {
      const request = verifyMediaAdminRequest(event, {
        secret,
        allowedAppIds,
        sourceFunction,
        now,
      })
      await assertMediaAdminCapability(database, request)
      return {
        ok: true,
        data: await service.uploadImage({
          appId: request.appId,
          userId: request.actorUserId,
        }, request.input),
      }
    }
    catch (error) {
      return failure(error)
    }
  }
}

function signMediaAdminRequest(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('MEDIA_INTERNAL_AUTH_CONFIG_REQUIRED')
  }
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'signature'))
  return createHmac('sha256', secret)
    .update(`${MEDIA_ADMIN_PROTOCOL}\0${stableJson(unsigned)}`)
    .digest('hex')
}

function inspectAdminImageInput(input) {
  const capability = mediaCapabilityForInput(input)
  if (!capability) throw new Error('PURPOSE_INVALID')
  if (!isPlainRecord(input) || !hasExactKeys(input, INPUT_KEYS)) {
    throw new Error('IMAGE_INVALID')
  }
  const base64 = input.imageBase64
  if (typeof base64 !== 'string' || base64.length < 32
    || base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4
    || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('IMAGE_INVALID')
  }
  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE')
  if (buffer.toString('base64') !== base64) throw new Error('IMAGE_INVALID')
  const dimensions = buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
    ? inspectPng(buffer)
    : buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8
      ? inspectJpeg(buffer)
      : null
  if (!dimensions) throw new Error('IMAGE_INVALID')
  const policy = MEDIA_ADMIN_UPLOAD_POLICIES[input.purpose]
  if (!policy
    || dimensions.width < policy.minimumEdge
    || dimensions.height < policy.minimumEdge
    || dimensions.width > policy.maximumEdge
    || dimensions.height > policy.maximumEdge
    || dimensions.width * dimensions.height > policy.maximumPixels) {
    throw new Error('IMAGE_DIMENSIONS_INVALID')
  }
  return { ...dimensions, capability }
}

function mediaCapabilityForInput(input) {
  return isPlainRecord(input) && typeof input.purpose === 'string'
    ? MEDIA_ADMIN_PURPOSE_CAPABILITIES[input.purpose]
    : undefined
}

function configuredCapabilityAllows(row, capability) {
  if (row?.role_key === 'PLATFORM_OWNER') return true
  if (row?.role_key !== 'PLATFORM_OPERATIONS') return false
  const value = row.policy_capabilities_json
  if (value === null || value === undefined) return true
  try {
    const capabilities = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(capabilities)
      && new Set(capabilities).size === capabilities.length
      && capabilities.every(item => typeof item === 'string')
      && capabilities.includes(capability)
  }
  catch {
    return false
  }
}

function hasExactKeys(value, allowed) {
  const keys = Reflect.ownKeys(value)
  return keys.length === allowed.size
    && keys.every(key => typeof key === 'string' && allowed.has(key))
}

function trustedFunctionName(value) {
  return typeof value === 'string' && /^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(value)
}

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

module.exports = {
  MAX_CLOCK_SKEW_MS,
  MEDIA_ADMIN_ACTION,
  MEDIA_ADMIN_PROTOCOL,
  MEDIA_ADMIN_PURPOSE_CAPABILITIES,
  MEDIA_ADMIN_TRANSPORT,
  MEDIA_ADMIN_UPLOAD_POLICIES,
  assertMediaAdminCapability,
  createInternalMediaHandler,
  inspectAdminImageInput,
  signMediaAdminRequest,
  verifyMediaAdminRequest,
}
