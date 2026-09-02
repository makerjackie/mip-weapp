'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')
const { errorResponse, normalizeAdminRequest } = require('../domain/handler')
const { adminWebOperationContract } = require('../domain/public-operation-contract')

const WEB_BFF_TRANSPORT = 'MIP_WEB_BFF_V1'
const WEB_BFF_MAX_CLOCK_SKEW_MS = 60_000
const WEB_BFF_OPERATIONS = adminWebOperationContract.operations.filter(operation => operation.webAllowed)
const WEB_BFF_OPERATION_BY_ACTION = new Map(
  WEB_BFF_OPERATIONS.map(operation => [operation.action, operation]),
)
const WEB_BFF_QUERY_ACTIONS = new Set(
  WEB_BFF_OPERATIONS
    .filter(operation => operation.kind === 'QUERY' && operation.webRoute === 'ADMIN')
    .map(operation => operation.action),
)
const WEB_BFF_MUTATION_ACTIONS = new Set(
  WEB_BFF_OPERATIONS
    .filter(operation => operation.kind === 'MUTATION')
    .map(operation => operation.action),
)
const WEB_BFF_REVIEWED_MUTATION_MANIFEST = Object.freeze(
  WEB_BFF_OPERATIONS
    .filter(operation => operation.kind === 'MUTATION'),
)
const envelopeKeys = new Set(['nonce', 'principal', 'request', 'signature', 'timestamp', 'transport'])
const principalKeys = new Set(['appId', 'openId'])
const requestKeys = new Set(['action', 'contractVersion', 'idempotencyKey', 'input'])

function createWebBffRoute({
  application,
  issuePrincipal,
  replayGuard,
  afterSuccessfulMutation,
  secret,
  now = Date.now,
} = {}) {
  if (!application || typeof application.execute !== 'function'
    || typeof issuePrincipal !== 'function'
    || !replayGuard || typeof replayGuard.consume !== 'function'
    || typeof afterSuccessfulMutation !== 'function'
    || typeof now !== 'function') {
    throw new Error('WEB_BFF_ROUTE_CONFIG_INVALID')
  }

  return async function runWebBff(event = {}) {
    try {
      const verified = verifyWebBffEnvelope(event, { secret, now: now() })
      const principal = issuePrincipal({
        APPID: verified.principal.appId,
        OPENID: verified.principal.openId,
      })
      const normalized = normalizeAdminRequest(verified.request)
      const { action } = normalized
      const input = applicationInput(action, normalized.input)
      await replayGuard.consume({
        appId: verified.principal.appId,
        nonce: verified.nonce,
        principalIdentityKey: principal.identityKey,
        action,
        requestHash: createHash('sha256').update(canonicalJson(verified)).digest('hex'),
      })
      const data = await application.execute(principal, action, input)
      if (WEB_BFF_MUTATION_ACTIONS.has(action)) {
        const postCommit = await afterSuccessfulMutation({
          action,
          principal,
          resultData: data,
        })
        if (postCommit && postCommit.ok === false) return postCommit
      }
      return { ok: true, data }
    }
    catch (error) {
      if (error?.message === 'WEB_BFF_CONFIG_REQUIRED') {
        return {
          ok: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: '运营服务暂时不可用', retryable: true },
        }
      }
      if (error?.message === 'WEB_BFF_REPLAY_GUARD_UNAVAILABLE') {
        return {
          ok: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: '运营服务暂时不可用', retryable: true },
        }
      }
      if (error?.message === 'WEB_BFF_REPLAYED') {
        return errorResponse(new Error('AUTH_REQUIRED'))
      }
      return errorResponse(error)
    }
  }
}

function isWebBffEvent(value) {
  return Boolean(value && typeof value === 'object' && value.transport === WEB_BFF_TRANSPORT)
}

function verifyWebBffEnvelope(value, { secret, now = Date.now() } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('WEB_BFF_CONFIG_REQUIRED')
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, envelopeKeys)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (value.transport !== WEB_BFF_TRANSPORT
    || !Number.isSafeInteger(value.timestamp)
    || Math.abs(now - value.timestamp) > WEB_BFF_MAX_CLOCK_SKEW_MS
    || typeof value.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{24,128}$/.test(value.nonce)
    || typeof value.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.signature)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (!isPlainRecord(value.principal)
    || !hasExactKeys(value.principal, principalKeys)
    || !trustedIdentifier(value.principal.appId, 64)
    || !trustedIdentifier(value.principal.openId, 128)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (!isPlainRecord(value.request)
    || !hasAllowedKeys(value.request, requestKeys)
    || value.request.contractVersion !== 1
    || typeof value.request.action !== 'string'
    || (!WEB_BFF_QUERY_ACTIONS.has(value.request.action)
      && !WEB_BFF_MUTATION_ACTIONS.has(value.request.action))
    || !isPlainRecord(value.request.input)) {
    throw new Error('FORBIDDEN')
  }
  if (WEB_BFF_MUTATION_ACTIONS.has(value.request.action)
    && !validMutationIdempotencyKey(value.request.idempotencyKey)) {
    throw new Error('VALIDATION_FAILED')
  }
  const inputSchema = reviewedMutationInputSchema(value.request.action)
  if (inputSchema && !hasReviewedInputKeys(value.request.input, inputSchema)) {
    throw new Error('VALIDATION_FAILED')
  }

  const unsigned = unsignedEnvelope(value)
  const expected = createHmac('sha256', secret).update(canonicalJson(unsigned)).digest()
  const supplied = Buffer.from(value.signature, 'hex')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('AUTH_REQUIRED')
  }
  return unsigned
}

function signWebBffEnvelope(value, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('WEB_BFF_CONFIG_REQUIRED')
  }
  const unsigned = unsignedEnvelope(value)
  return {
    ...unsigned,
    signature: createHmac('sha256', secret).update(canonicalJson(unsigned)).digest('hex'),
  }
}

function unsignedEnvelope(value) {
  return {
    transport: value.transport,
    timestamp: value.timestamp,
    nonce: value.nonce,
    principal: value.principal,
    request: value.request,
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hasExactKeys(value, expected) {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.size
    && keys.every(key => typeof key === 'string' && expected.has(key))
}

function hasAllowedKeys(value, allowed) {
  const keys = Reflect.ownKeys(value)
  return keys.every(key => typeof key === 'string' && allowed.has(key))
    && ['action', 'contractVersion', 'input'].every(key => Object.hasOwn(value, key))
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function trustedIdentifier(value, maximum) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function validMutationIdempotencyKey(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9_.:-]{1,128}$/.test(value.trim())
}

function reviewedMutationInputSchema(action) {
  const entry = WEB_BFF_OPERATION_BY_ACTION.get(action)
  if (entry?.kind !== 'MUTATION') return null
  return entry
    ? { required: entry.requiredInputKeys, optional: entry.optionalInputKeys }
    : null
}

function hasReviewedInputKeys(value, schema) {
  if (!isPlainRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  const allowed = new Set([...schema.required, ...schema.optional])
  return keys.every(key => typeof key === 'string' && allowed.has(key))
    && schema.required.every(key => Object.hasOwn(value, key))
}

function applicationInput(action, input) {
  const operation = WEB_BFF_OPERATION_BY_ACTION.get(action)
  if (operation?.forwardIdempotencyKey === true || !Object.hasOwn(input, 'idempotencyKey')) {
    return input
  }
  const output = { ...input }
  delete output.idempotencyKey
  return output
}

module.exports = {
  WEB_BFF_MAX_CLOCK_SKEW_MS,
  WEB_BFF_MUTATION_ACTIONS,
  WEB_BFF_REVIEWED_MUTATION_MANIFEST,
  WEB_BFF_QUERY_ACTIONS,
  WEB_BFF_TRANSPORT,
  canonicalJson,
  createWebBffRoute,
  isWebBffEvent,
  signWebBffEnvelope,
  verifyWebBffEnvelope,
}
