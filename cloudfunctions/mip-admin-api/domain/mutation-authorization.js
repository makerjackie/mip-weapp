'use strict'

const { coversScope, roleCapabilities } = require('./capabilities')

const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'

async function assertMutationAuthorization(tx, input, requestedScope) {
  const authorization = await lockMutationAuthorization(tx, input)
  assertMutationScope(authorization, requestedScope)
  return authorization.effectiveGrant
}

async function lockMutationAuthorization(tx, input) {
  const authorization = input?.authorization
  const grant = authorization?.effectiveGrant
  const capability = authorization?.capability
  if (!tx || typeof tx.one !== 'function'
    || !input?.appId || !input?.actorUserId
    || typeof capability !== 'string'
    || !grant || !['PLATFORM', 'BRANCH', 'EVENT'].includes(grant.scopeType)
    || typeof grant.roleKey !== 'string') {
    throw codeError('FORBIDDEN')
  }

  const actor = await tx.one(
    `SELECT id, status FROM mip_users
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [input.appId, input.actorUserId],
  )
  if (!actor || actor.status !== 'ACTIVE') throw codeError('FORBIDDEN')

  const storedScopeId = grant.scopeType === 'PLATFORM'
    ? PLATFORM_SCOPE_ID
    : grant.scopeId
  if (!storedScopeId) throw codeError('FORBIDDEN')
  const binding = await tx.one(
    `SELECT scope_type, scope_id, role_key, status
     FROM mip_admin_role_bindings
     WHERE app_id = ? AND user_id = ? AND scope_type = ? AND scope_id = ?
       AND role_key = ? FOR UPDATE`,
    [input.appId, input.actorUserId, grant.scopeType, storedScopeId, grant.roleKey],
  )
  if (!binding || binding.status !== 'ACTIVE') throw codeError('FORBIDDEN')

  const effectiveGrant = {
    scopeType: binding.scope_type,
    scopeId: binding.scope_type === 'PLATFORM' ? null : binding.scope_id,
    roleKey: binding.role_key,
  }
  if (!roleCapabilities[effectiveGrant.roleKey]?.includes(capability)) throw codeError('FORBIDDEN')
  return { capability, effectiveGrant }
}

function assertMutationScope(authorization, requestedScope) {
  if (!authorization?.effectiveGrant
    || !roleCapabilities[authorization.effectiveGrant.roleKey]?.includes(authorization.capability)
    || !coversScope(authorization.effectiveGrant, normalizeRequestedScope(requestedScope))) {
    throw codeError('FORBIDDEN')
  }
}

function normalizeRequestedScope(scope) {
  if (!scope || !['PLATFORM', 'BRANCH', 'EVENT'].includes(scope.scopeType)) {
    throw codeError('FORBIDDEN')
  }
  if (scope.scopeType === 'PLATFORM') {
    return { scopeType: 'PLATFORM', scopeId: null, branchId: null }
  }
  if (typeof scope.scopeId !== 'string' || !scope.scopeId) throw codeError('FORBIDDEN')
  return {
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    branchId: scope.branchId || null,
  }
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = {
  PLATFORM_SCOPE_ID,
  assertMutationAuthorization,
  assertMutationScope,
  lockMutationAuthorization,
}
