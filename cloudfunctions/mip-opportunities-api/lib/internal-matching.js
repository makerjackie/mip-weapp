'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

const transportMetadataKeys = new Set(['frameworkContext', 'tcbContext', 'userInfo'])
const matchingEventKeys = new Set([
  'action',
  'appId',
  'actorUserId',
  'requesterUserId',
  'opportunityId',
  'sourceVersion',
  'idempotencyKey',
  'nonce',
  'timestamp',
  'signature',
])

function verifyInternalMatching(event, options = {}) {
  const verifiedEvent = eventForVerification(event)
  if (!hasExactKeys(verifiedEvent, matchingEventKeys)) throw new Error('AUTH_REQUIRED')
  const secret = String(options.secret || '')
  const timestamp = Number(verifiedEvent.timestamp)
  const now = Number((options.now || Date.now)())
  if (secret.length < 32 || !Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300_000
    || verifiedEvent.action !== 'recalculateMatchingInternal'
    || !isUuid(verifiedEvent.actorUserId) || !isUuid(verifiedEvent.requesterUserId)
    || !isUuid(verifiedEvent.opportunityId)
    || !Number.isInteger(Number(verifiedEvent.sourceVersion)) || Number(verifiedEvent.sourceVersion) < 1
    || typeof verifiedEvent.idempotencyKey !== 'string' || verifiedEvent.idempotencyKey.length < 12
    || verifiedEvent.idempotencyKey.length > 128
    || typeof verifiedEvent.nonce !== 'string' || !/^[a-f0-9]{24}$/.test(verifiedEvent.nonce)
    || typeof verifiedEvent.appId !== 'string' || !verifiedEvent.appId.trim()) {
    throw new Error('AUTH_REQUIRED')
  }
  const expected = createHmac('sha256', secret).update(canonical(verifiedEvent)).digest('hex')
  const actual = String(verifiedEvent.signature || '')
  if (!/^[a-f0-9]{64}$/.test(actual)
    || !timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error('AUTH_REQUIRED')
  }
  return {
    appId: verifiedEvent.appId.trim(),
    actorUserId: verifiedEvent.actorUserId,
    requesterUserId: verifiedEvent.requesterUserId,
    opportunityId: verifiedEvent.opportunityId,
    sourceVersion: Number(verifiedEvent.sourceVersion),
    idempotencyKey: verifiedEvent.idempotencyKey,
  }
}

function eventForVerification(event) {
  if (!isPlainObject(event)) throw new Error('AUTH_REQUIRED')
  const verifiedEvent = Object.create(null)
  for (const key of Reflect.ownKeys(event)) {
    if (typeof key === 'string' && transportMetadataKeys.has(key)) {
      if (!isPlainObject(event[key])) throw new Error('AUTH_REQUIRED')
      continue
    }
    verifiedEvent[key] = event[key]
  }
  return verifiedEvent
}

function hasExactKeys(value, expectedKeys) {
  const keys = Reflect.ownKeys(value)
  return keys.length === expectedKeys.size
    && keys.every(key => typeof key === 'string' && expectedKeys.has(key))
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

async function authorizeInternalMatching(database, request, source, options = {}) {
  if (!source || source.owner_user_id !== request.requesterUserId
    || Number(source.version) !== Number(request.sourceVersion)
    || (source.status && source.status !== 'PUBLISHED')) {
    throw new Error('CONFLICT')
  }
  const actor = await database.one(
    `SELECT id, status FROM mip_users WHERE app_id = ? AND id = ?${options.lock ? ' FOR UPDATE' : ''}`,
    [request.appId, request.actorUserId],
  )
  if (!actor || actor.status !== 'ACTIVE') { throw new Error('AUTH_REQUIRED') }
  const bindings = await database.query(
    `SELECT binding.role_key, binding.scope_type, binding.scope_id,
            policy.policy_mode, policy.capabilities_json
     FROM mip_admin_role_bindings binding
     LEFT JOIN mip_role_capability_policies policy
       ON policy.app_id = binding.app_id AND policy.role_key = binding.role_key
     WHERE binding.app_id = ? AND binding.user_id = ? AND binding.status = 'ACTIVE'
     ORDER BY binding.scope_type, binding.scope_id, binding.role_key${options.lock ? ' FOR UPDATE' : ''}`,
    [request.appId, request.actorUserId],
  )
  if (!bindings.some(binding => bindingAllowsMatching(binding, source.branch_id || null))) {
    throw new Error('AUTH_REQUIRED')
  }
  return { requesterUserId: source.owner_user_id }
}

function bindingAllowsMatching(binding, branchId) {
  if (binding.role_key === 'PLATFORM_OWNER' && binding.scope_type === 'PLATFORM') { return true }
  const validDefault = (
    binding.role_key === 'PLATFORM_OPERATIONS' && binding.scope_type === 'PLATFORM'
  ) || (
    binding.role_key === 'BRANCH_ADMIN' && binding.scope_type === 'BRANCH'
    && branchId && binding.scope_id === branchId
  )
  if (!validDefault) { return false }
  if (binding.policy_mode !== 'CUSTOM') { return true }
  const capabilities = jsonArray(binding.capabilities_json)
  return capabilities.includes('opportunities.moderate')
}

function jsonArray(value) {
  if (Array.isArray(value)) { return value }
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

function canonical(event) {
  const body = Object.fromEntries(
    Object.entries(event).filter(([key]) => !['signature', 'timestamp'].includes(key)),
  )
  return [
    Number(event.timestamp),
    String(event.action || '').trim(),
    String(event.appId || '').trim(),
    createHash('sha256').update(stableJson(body)).digest('hex'),
  ].join('\n')
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') { return JSON.stringify(value) }
  if (Array.isArray(value)) { return `[${value.map(stableJson).join(',')}]` }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

module.exports = { authorizeInternalMatching, canonical, verifyInternalMatching }
