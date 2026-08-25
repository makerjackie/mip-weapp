'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')

function verifyInternalMatching(event, options = {}) {
  const secret = String(options.secret || '')
  const timestamp = Number(event?.timestamp)
  const now = Number((options.now || Date.now)())
  if (secret.length < 32 || !Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300_000
    || event?.action !== 'recalculateMatchingInternal'
    || !isUuid(event?.actorUserId) || !isUuid(event?.requesterUserId)
    || !isUuid(event?.opportunityId)
    || !Number.isInteger(Number(event?.sourceVersion)) || Number(event.sourceVersion) < 1
    || typeof event?.idempotencyKey !== 'string' || event.idempotencyKey.length < 12
    || event.idempotencyKey.length > 128
    || typeof event?.nonce !== 'string' || !/^[a-f0-9]{24}$/.test(event.nonce)
    || typeof event?.appId !== 'string' || !event.appId.trim()) {
    throw new Error('AUTH_REQUIRED')
  }
  const expected = createHmac('sha256', secret).update(canonical(event)).digest('hex')
  const actual = String(event.signature || '')
  if (!/^[a-f0-9]{64}$/.test(actual)
    || !timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error('AUTH_REQUIRED')
  }
  return {
    appId: event.appId.trim(),
    actorUserId: event.actorUserId,
    requesterUserId: event.requesterUserId,
    opportunityId: event.opportunityId,
    sourceVersion: Number(event.sourceVersion),
    idempotencyKey: event.idempotencyKey,
  }
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
