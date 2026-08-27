'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')
const { errorResponse, normalizeAdminRequest } = require('../domain/handler')
const { publicOperationContract } = require('../domain/public-operation-contract')

const WEB_BFF_TRANSPORT = 'MIP_WEB_BFF_V1'
const WEB_BFF_MAX_CLOCK_SKEW_MS = 60_000
const WEB_BFF_FIRST_QUERY_ACTIONS = Object.freeze([
  'mip.admin.session',
  'mip.admin.dashboard.overview.get',
  'mip.admin.users.list',
  'mip.admin.events.list',
  'mip.admin.orders.list',
  'mip.admin.branches.list',
  'mip.admin.roles.list',
  'mip.admin.rolePolicies.list',
  'mip.admin.audit.list',
  'mip.admin.messageCampaigns.list',
  'mip.admin.messageTemplates.list',
  'mip.admin.knowledge.list',
])
const WEB_BFF_SECOND_QUERY_ACTIONS = Object.freeze([
  'mip.admin.users.get',
  'mip.admin.users.influence.list',
  'mip.admin.events.get',
  'mip.admin.events.insights.get',
  'mip.admin.events.roster',
  'mip.admin.events.rosterAll',
  'mip.admin.events.policy.get',
  'mip.admin.orders.get',
  'mip.admin.paymentAttempts.list',
  'mip.admin.memberships.get',
  'mip.admin.memberships.timeline',
  'mip.admin.benefits.ledger',
  'mip.admin.roles.candidates',
  'mip.admin.messageCampaigns.get',
  'mip.admin.messageCampaigns.recipients',
  'mip.admin.messageTemplates.get',
  'mip.admin.messageDeliveryReviews.list',
  'mip.admin.messageDeliveryReviews.get',
  'mip.admin.messageDeliveryRecords.list',
  'mip.admin.knowledge.get',
  'mip.admin.knowledge.schedules.list',
])
const WEB_BFF_QUERY_ACTIONS = createQueryActionAllowlist(
  [...WEB_BFF_FIRST_QUERY_ACTIONS, ...WEB_BFF_SECOND_QUERY_ACTIONS],
  publicOperationContract,
)
const envelopeKeys = new Set(['nonce', 'principal', 'request', 'signature', 'timestamp', 'transport'])
const principalKeys = new Set(['appId', 'openId'])
const requestKeys = new Set(['action', 'contractVersion', 'idempotencyKey', 'input'])

function createQueryActionAllowlist(actions, contract) {
  if (!Array.isArray(actions)
    || new Set(actions).size !== actions.length
    || !contract
    || !Array.isArray(contract.operations)) {
    throw new Error('WEB_BFF_QUERY_CONTRACT_INVALID')
  }
  const operationByAction = new Map(contract.operations.map(operation => [operation.action, operation]))
  const allowlist = new Set()
  for (const action of actions) {
    const operation = operationByAction.get(action)
    if (!operation
      || operation.kind !== 'QUERY'
      || operation.safeToRetry !== true
      || operation.authentication !== 'REQUIRED'
      || operation.session !== 'REQUIRED') {
      throw new Error('WEB_BFF_QUERY_CONTRACT_INVALID')
    }
    allowlist.add(action)
  }
  return allowlist
}

function createWebBffRoute({ application, issuePrincipal, secret, now = Date.now } = {}) {
  if (!application || typeof application.execute !== 'function'
    || typeof issuePrincipal !== 'function'
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
      const { action, input } = normalizeAdminRequest(verified.request)
      const data = await application.execute(principal, action, input)
      return { ok: true, data }
    }
    catch (error) {
      if (error?.message === 'WEB_BFF_CONFIG_REQUIRED') {
        return {
          ok: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: '运营服务暂时不可用', retryable: true },
        }
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
    || !WEB_BFF_QUERY_ACTIONS.has(value.request.action)
    || !isPlainRecord(value.request.input)) {
    throw new Error('FORBIDDEN')
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

module.exports = {
  WEB_BFF_MAX_CLOCK_SKEW_MS,
  WEB_BFF_FIRST_QUERY_ACTIONS,
  WEB_BFF_QUERY_ACTIONS,
  WEB_BFF_SECOND_QUERY_ACTIONS,
  WEB_BFF_TRANSPORT,
  canonicalJson,
  createQueryActionAllowlist,
  createWebBffRoute,
  isWebBffEvent,
  signWebBffEnvelope,
  verifyWebBffEnvelope,
}
