'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')
const { failure } = require('../domain/handler')

const BANNER_ADMIN_TRANSPORT = 'MIP_BANNERS_ADMIN_V1'
const BANNER_ADMIN_PROTOCOL = 'mip-banners-admin/v1'
const MAX_CLOCK_SKEW_MS = 60_000
const ACTION_SPECS = Object.freeze({
  'admin.getSession': spec([]),
  'admin.list': spec(['filters'], { filters: ['status', 'query'] }),
  'admin.get': spec(['bannerId']),
  'admin.save': spec(['bannerId', 'expectedVersion', 'banner', 'idempotencyKey'], {
    banner: ['title', 'accessibilityLabel', 'imageAssetId', 'targetType', 'targetValue'],
  }),
  'admin.changeStatus': spec(['bannerId', 'expectedVersion', 'status']),
  'admin.move': spec(['bannerId', 'expectedVersion', 'direction']),
  'admin.delete': spec(['bannerId', 'expectedVersion']),
})
const SIGNED_KEYS = new Set([
  'transport', 'protocol', 'timestamp', 'nonce', 'appId', 'actorUserId',
  'action', 'input', 'sourceFunction',
])
const FRAMEWORK_KEYS = new Set(['userInfo', 'tcbContext', 'frameworkContext'])

function spec(inputKeys, nestedKeys = {}) {
  return Object.freeze({
    inputKeys: Object.freeze([...inputKeys]),
    nestedKeys: Object.freeze(Object.fromEntries(
      Object.entries(nestedKeys).map(([key, keys]) => [key, Object.freeze([...keys])]),
    )),
  })
}

function verifyBannerAdminRequest(
  value,
  { secret, allowedAppIds, sourceFunction = 'mip-admin-api', now = Date.now } = {},
) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('BANNERS_INTERNAL_AUTH_CONFIG_REQUIRED')
  }
  if (!isPlainRecord(value)) throw new Error('AUTH_REQUIRED')
  const signed = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'signature') continue
    if (FRAMEWORK_KEYS.has(key)) continue
    if (!SIGNED_KEYS.has(key)) throw new Error('AUTH_REQUIRED')
    signed[key] = item
  }
  const operation = ACTION_SPECS[signed.action]
  if (!hasExactKeys(signed, SIGNED_KEYS)
    || value.signature === undefined
    || typeof value.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.signature)
    || signed.transport !== BANNER_ADMIN_TRANSPORT
    || signed.protocol !== BANNER_ADMIN_PROTOCOL
    || !Number.isSafeInteger(signed.timestamp)
    || typeof now !== 'function'
    || Math.abs(Number(now()) - signed.timestamp) > MAX_CLOCK_SKEW_MS
    || typeof signed.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{24,128}$/.test(signed.nonce)
    || !(allowedAppIds instanceof Set)
    || !allowedAppIds.has(signed.appId)
    || !uuid(signed.actorUserId)
    || !operation
    || !isPlainRecord(signed.input)
    || !validInput(operation, signed.input)
    || !trustedFunctionName(signed.sourceFunction)
    || signed.sourceFunction !== sourceFunction) {
    throw new Error('AUTH_REQUIRED')
  }
  const expected = createHmac('sha256', secret)
    .update(`${BANNER_ADMIN_PROTOCOL}\0${stableJson(signed)}`)
    .digest()
  const supplied = Buffer.from(value.signature, 'hex')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('AUTH_REQUIRED')
  }
  return signed
}

function validInput(operation, input) {
  if (!hasAllowedKeys(input, operation.inputKeys)) return false
  if (operation === ACTION_SPECS['admin.save']
    && !/^[A-Za-z0-9_.:-]{12,128}$/.test(text(input.idempotencyKey))) return false
  for (const [key, allowed] of Object.entries(operation.nestedKeys)) {
    if (!Object.hasOwn(input, key)) continue
    if (!isPlainRecord(input[key]) || !hasAllowedKeys(input[key], allowed)) return false
  }
  return true
}

function hasAllowedKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys)
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.has(key))
}

function createInternalBannerHandler({
  service,
  secret,
  allowedAppIds,
  assertAdminReady,
  sourceFunction = 'mip-admin-api',
  now = Date.now,
} = {}) {
  if (!service || typeof assertAdminReady !== 'function') {
    throw new Error('BANNERS_INTERNAL_HANDLER_CONFIG_INVALID')
  }
  const dispatch = Object.freeze({
    'admin.getSession': caller => service.getAdminSession(caller),
    'admin.list': (caller, input) => service.listAdmin(caller, input),
    'admin.get': (caller, input) => service.getAdmin(caller, input),
    'admin.save': (caller, input) => service.save(caller, input),
    'admin.changeStatus': (caller, input) => service.changeStatus(caller, input),
    'admin.move': (caller, input) => service.move(caller, input),
    'admin.delete': (caller, input) => service.remove(caller, input),
  })
  return async function handle(event = {}) {
    try {
      const request = verifyBannerAdminRequest(event, {
        secret,
        allowedAppIds,
        sourceFunction,
        now,
      })
      const caller = { appId: request.appId, userId: request.actorUserId }
      await assertAdminReady(caller)
      const run = dispatch[request.action]
      if (!run) throw new Error('NOT_FOUND')
      return { ok: true, data: await run(caller, request.input) }
    }
    catch (error) {
      return failure(error)
    }
  }
}

function signBannerAdminRequest(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('BANNERS_INTERNAL_AUTH_CONFIG_REQUIRED')
  }
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'signature'))
  return createHmac('sha256', secret).update(`${BANNER_ADMIN_PROTOCOL}\0${stableJson(unsigned)}`).digest('hex')
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

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

module.exports = {
  ACTION_SPECS,
  BANNER_ADMIN_PROTOCOL,
  BANNER_ADMIN_TRANSPORT,
  MAX_CLOCK_SKEW_MS,
  createInternalBannerHandler,
  signBannerAdminRequest,
  verifyBannerAdminRequest,
}
