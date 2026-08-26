'use strict'

const { createHash } = require('node:crypto')
const { CAPABILITIES, authorize } = require('./capabilities')
const { AdminError } = require('./validation')

const durationMonths = new Set([1, 3, 6, 12])
const getInputKeys = new Set(['userId'])
const grantInputKeys = new Set([
  'durationMonths',
  'expectedChainVersion',
  'idempotencyKey',
  'reason',
  'userId',
])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createAdminMemberships({ repository, access }) {
  async function getMembership(caller, input = {}) {
    const context = await access.session(caller)
    assertExactInput(input, getInputKeys)
    platformGrant(context, CAPABILITIES.MEMBERSHIPS_READ)
    return repository.getMembership({
      appId: context.caller.appId,
      userId: strictUuid(input.userId),
    })
  }

  async function grantMembership(caller, input = {}) {
    const context = await access.session(caller)
    assertExactInput(input, grantInputKeys)
    const normalized = normalizeGrant(input)
    const grant = platformGrant(context, CAPABILITIES.MEMBERSHIPS_ADJUST)
    const requestHash = membershipGrantRequestHash({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ...normalized,
    })
    return repository.grantMembership({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ...normalized,
      requestHash,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MEMBERSHIPS_ADJUST),
      audit: (adjustmentId, facts) => access.audit(context, grant, {
        scopeType: 'PLATFORM',
        action: 'admin.memberships.grant',
        resourceType: 'MEMBERSHIP_ADJUSTMENT',
        resourceId: adjustmentId,
        metadata: {
          userId: normalized.userId,
          durationMonths: normalized.durationMonths,
          reasonLength: normalized.reason.length,
          startsAt: facts.startsAt,
          endsAt: facts.endsAt,
          expectedChainVersion: normalized.expectedChainVersion,
          resultChainVersion: facts.resultChainVersion,
        },
      }),
    })
  }

  return { getMembership, grantMembership }
}

function assertExactInput(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('会员请求格式无效')
  }
  const prototype = Object.getPrototypeOf(value)
  const keys = Reflect.ownKeys(value)
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== allowedKeys.size
    || keys.some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
    throw validationError('会员请求格式无效')
  }
}

function normalizeGrant(input) {
  if (!durationMonths.has(input.durationMonths)) {
    throw validationError('会员时长无效')
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!reason || reason.length > 300) {
    throw validationError('调整原因格式无效')
  }
  const expectedChainVersion = input.expectedChainVersion
  if (!Number.isSafeInteger(expectedChainVersion) || expectedChainVersion < 1) {
    throw validationError('会员版本无效')
  }
  const idempotencyKey = typeof input.idempotencyKey === 'string'
    ? input.idempotencyKey.trim()
    : ''
  if (!idempotencyKey
    || idempotencyKey.length > 128
    || !/^[A-Za-z0-9_.:-]+$/.test(idempotencyKey)) {
    throw validationError('请求标识无效')
  }
  return {
    userId: strictUuid(input.userId),
    durationMonths: input.durationMonths,
    reason,
    expectedChainVersion,
    idempotencyKey,
  }
}

function membershipGrantRequestHash(input) {
  const canonical = [
    input.appId,
    input.actorUserId,
    input.userId,
    input.durationMonths,
    input.reason,
    input.expectedChainVersion,
  ]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function strictUuid(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!uuidPattern.test(normalized)) throw validationError('用户标识无效')
  return normalized
}

function platformGrant(context, capability) {
  return authorize(context.bindings, capability, { scopeType: 'PLATFORM', scopeId: null })
}

function validationError(message) {
  return new AdminError('VALIDATION_FAILED', message)
}

module.exports = { createAdminMemberships }
