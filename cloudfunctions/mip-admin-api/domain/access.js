'use strict'

const { assertFullAccessUser } = require('./full-access')
const {
  authorize,
  capabilitySnapshot,
  isValidRoleBinding,
} = require('./capabilities')
const { AdminError, requiredId } = require('./validation')

function createAdminAccess({ repository }) {
  async function session(caller) {
    const user = assertFullAccessUser(await repository.resolveUser(caller))
    const bindings = (await repository.listRoleBindings(caller.appId, user.id))
      .filter(isValidRoleBinding)
    if (!bindings.length) {
      throw new AdminError('FORBIDDEN', '当前账号没有运营权限')
    }
    return {
      caller: { appId: caller.appId, userId: user.id },
      bindings,
      capabilities: capabilitySnapshot(bindings),
    }
  }

  function publicBindings(bindings) {
    return bindings.map(binding => ({
      roleKey: binding.roleKey,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
    }))
  }

  function requirePlatformOwner(context) {
    const grant = context.bindings.find(binding => binding.roleKey === 'PLATFORM_OWNER'
      && binding.scopeType === 'PLATFORM'
      && (binding.scopeId === null || binding.scopeId === undefined))
    if (!grant) throw new AdminError('FORBIDDEN', '当前账号没有权限配置权限')
    return grant
  }

  function audit(context, grant, input) {
    return {
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      scopeType: input.scopeType,
      scopeId: input.scopeId || null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId || null,
      effectiveRole: grant.roleKey,
      metadata: input.metadata || {},
    }
  }

  function mutationAuthorization(grant, capability) {
    return {
      capability,
      effectiveGrant: {
        roleKey: grant.roleKey,
        scopeType: grant.scopeType,
        scopeId: grant.scopeType === 'PLATFORM' ? null : grant.scopeId,
      },
    }
  }

  async function eventAuthorization(context, eventId, capability) {
    const scope = await repository.getEventScope(
      context.caller.appId,
      requiredId(eventId, '活动'),
    )
    if (!scope) throw new AdminError('NOT_FOUND', '活动不存在')
    return { scope, grant: authorize(context.bindings, capability, scope) }
  }

  async function userAuthorization(context, userId, capability) {
    const scope = await repository.getUserScope(
      context.caller.appId,
      requiredId(userId, '用户'),
    )
    if (!scope) throw new AdminError('NOT_FOUND', '用户不存在')
    return { scope, grant: authorize(context.bindings, capability, scope) }
  }

  return {
    audit,
    eventAuthorization,
    mutationAuthorization,
    publicBindings,
    requirePlatformOwner,
    session,
    userAuthorization,
  }
}

module.exports = { createAdminAccess }
