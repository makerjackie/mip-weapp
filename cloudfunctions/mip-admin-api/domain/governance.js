'use strict'

const {
  CAPABILITIES,
  authorize,
  firstGrant,
  roleCapabilities,
  visibilityForCapability,
} = require('./capabilities')
const {
  availableExceptionTypes,
  normalizeExceptionRequest,
} = require('./operational-exception-access')
const { decodeCursor } = require('./pagination')
const { configurableRoleKeys } = require('./role-capability-policies')
const {
  AdminError,
  expectedVersion,
  limit,
  requiredId,
  stableKey,
  text,
} = require('./validation')

const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'

function createAdminGovernance({ repository, access, now = () => new Date() }) {
  async function listBranches(caller) {
    const context = await access.session(caller)
    platformGrant(context, CAPABILITIES.BRANCHES_MANAGE)
    return {
      items: await repository.listBranches(context.caller.appId),
      nextCursor: null,
    }
  }

  async function createBranch(caller, input = {}) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.BRANCHES_MANAGE)
    const draft = normalizeBranchDraft(input, { includeKey: true })
    return repository.createBranch({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      ...draft,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.BRANCHES_MANAGE),
      audit: branchId => access.audit(context, grant, {
        scopeType: 'BRANCH',
        scopeId: branchId,
        action: 'admin.branches.create',
        resourceType: 'CITY_BRANCH',
        resourceId: branchId,
        metadata: { branchKey: draft.branchKey, status: 'ACTIVE' },
      }),
    })
  }

  async function updateBranch(caller, input = {}) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.BRANCHES_MANAGE)
    if (Object.hasOwn(input, 'branchKey')) {
      throw new AdminError('VALIDATION_FAILED', '分会标识创建后不可修改')
    }
    const branchId = requiredId(input.branchId, '城市分会')
    const version = expectedVersion(input.expectedVersion)
    const draft = normalizeBranchDraft(input)
    return repository.updateBranch({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      branchId,
      expectedVersion: version,
      ...draft,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.BRANCHES_MANAGE),
      audit: access.audit(context, grant, {
        scopeType: 'BRANCH',
        scopeId: branchId,
        action: 'admin.branches.update',
        resourceType: 'CITY_BRANCH',
        resourceId: branchId,
        metadata: { expectedVersion: version, fields: ['name', 'cityName', 'summary'] },
      }),
    })
  }

  async function changeBranchStatus(caller, input = {}) {
    const context = await access.session(caller)
    const grant = platformGrant(context, CAPABILITIES.BRANCHES_MANAGE)
    const branchId = requiredId(input.branchId, '城市分会')
    const version = expectedVersion(input.expectedVersion)
    const status = ['ACTIVE', 'INACTIVE'].includes(input.status) ? input.status : null
    if (!status) {
      throw new AdminError('VALIDATION_FAILED', '分会状态无效')
    }
    return repository.changeBranchStatus({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      branchId,
      expectedVersion: version,
      status,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.BRANCHES_MANAGE),
      audit: access.audit(context, grant, {
        scopeType: 'BRANCH',
        scopeId: branchId,
        action: 'admin.branches.status.change',
        resourceType: 'CITY_BRANCH',
        resourceId: branchId,
        metadata: { status, expectedVersion: version },
      }),
    })
  }

  async function listRoles(caller) {
    const context = await access.session(caller)
    const grant = firstGrant(context.bindings, CAPABILITIES.ROLES_CHANGE)
    const visibility = visibilityForCapability(context.bindings, CAPABILITIES.ROLES_CHANGE)
    const items = await repository.listRoles(
      context.caller.appId,
      visibility,
      { includeAdministrativeScopes: visibility.platform },
    )
    await repository.recordAudit(access.audit(context, grant, {
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      action: 'admin.roles.view',
      resourceType: 'ADMIN_ROLE_BINDING_LIST',
      metadata: { count: items.length },
    }))
    return { items }
  }

  async function searchRoleCandidates(caller, input) {
    const context = await access.session(caller)
    await access.eventAuthorization(context, input.eventId, CAPABILITIES.ROLES_CHANGE)
    const query = text(input.query, 80, { required: true, label: '搜索内容' })
    return {
      items: await repository.searchRoleCandidates(
        context.caller.appId,
        query,
        limit(input.limit, 20),
      ),
    }
  }

  async function setRole(caller, input) {
    const context = await access.session(caller)
    const roleKey = normalizeRole(input.roleKey)
    const requestedScope = normalizeRoleScope(roleKey, input)
    const { scope, grant } = requestedScope.scopeType === 'EVENT'
      ? await access.eventAuthorization(
          context,
          requestedScope.scopeId,
          CAPABILITIES.ROLES_CHANGE,
        )
      : {
          scope: requestedScope,
          grant: authorize(context.bindings, CAPABILITIES.ROLES_CHANGE, requestedScope),
        }
    assertRoleDelegation(grant.roleKey, roleKey)
    const userId = requiredId(input.userId, '用户')
    if (typeof input.active !== 'boolean') {
      throw new AdminError('VALIDATION_FAILED', '角色状态无效')
    }
    if (!input.active && roleKey === 'PLATFORM_OWNER' && userId === context.caller.userId) {
      throw new AdminError('INVALID_STATE', '平台超级管理员不能撤销自己的角色')
    }
    return repository.setRole({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      userId,
      roleKey,
      active: input.active,
      scope: {
        ...scope,
        scopeId: scope.scopeType === 'PLATFORM' ? PLATFORM_SCOPE_ID : scope.scopeId,
      },
      authorization: access.mutationAuthorization(grant, CAPABILITIES.ROLES_CHANGE),
      authorizedScope: scope,
      audit: access.audit(context, grant, {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        action: input.active ? 'admin.roles.grant' : 'admin.roles.revoke',
        resourceType: 'ADMIN_ROLE_BINDING',
        resourceId: userId,
        metadata: { roleKey, active: input.active },
      }),
    })
  }

  async function listRoleCapabilityPolicies(caller) {
    const context = await access.session(caller)
    const grant = access.requirePlatformOwner(context)
    const stored = new Map(
      (await repository.listRoleCapabilityPolicies(context.caller.appId))
        .map(policy => [policy.roleKey, policy]),
    )
    const items = configurableRoleKeys.map((roleKey) => {
      const policy = stored.get(roleKey)
      return roleCapabilityPolicyView(
        roleKey,
        policy,
        policy?.mode === 'CUSTOM' ? 'CUSTOM' : 'DEFAULT',
      )
    })
    await repository.recordAudit(access.audit(context, grant, {
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.role_capability_policies.view',
      resourceType: 'ROLE_CAPABILITY_POLICY_LIST',
      metadata: { count: items.length },
    }))
    return { items }
  }

  async function updateRoleCapabilityPolicy(caller, input = {}) {
    const context = await access.session(caller)
    const grant = access.requirePlatformOwner(context)
    const roleKey = normalizeConfigurableRole(input.roleKey)
    const policyVersion = Number(input.expectedVersion)
    if (!Number.isInteger(policyVersion) || policyVersion < 0) {
      throw new AdminError('VALIDATION_FAILED', '权限版本无效')
    }
    if (input.reset !== undefined && input.reset !== true) {
      throw new AdminError('VALIDATION_FAILED', '恢复默认设置无效')
    }
    const resetting = input.reset === true
    const capabilities = resetting ? null : normalizeRoleCapabilities(roleKey, input.capabilities)
    const mutationInput = {
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      roleKey,
      expectedVersion: policyVersion,
      now: now(),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.ROLES_CHANGE),
      audit: access.audit(context, grant, {
        scopeType: 'PLATFORM',
        scopeId: null,
        action: resetting
          ? 'admin.role_capability_policies.reset'
          : 'admin.role_capability_policies.update',
        resourceType: 'ROLE_CAPABILITY_POLICY',
        resourceId: roleKey,
        metadata: {
          roleKey,
          expectedVersion: policyVersion,
          ...(capabilities ? { capabilities } : {}),
        },
      }),
    }
    if (resetting) {
      const policy = await repository.resetRoleCapabilityPolicy(mutationInput)
      return roleCapabilityPolicyView(roleKey, policy, 'DEFAULT')
    }
    const policy = await repository.updateRoleCapabilityPolicy({
      ...mutationInput,
      capabilities,
    })
    return roleCapabilityPolicyView(roleKey, policy, 'CUSTOM')
  }

  async function listAudit(caller, input = {}) {
    const context = await access.session(caller)
    const grant = firstGrant(context.bindings, CAPABILITIES.AUDIT_READ)
    const filters = normalizeFilters(input.filters)
    const page = pageResult(await repository.listAudit(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.AUDIT_READ),
      filters,
      limit(input.limit),
      decodeCursor(input.cursor, ['createdAt', 'id']),
    ))
    await repository.recordAudit(access.audit(context, grant, {
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      action: 'admin.audit.view',
      resourceType: 'AUDIT_LOG_LIST',
      metadata: { count: page.items.length, filters },
    }))
    return page
  }

  async function listOperationalExceptions(caller, input = {}) {
    const context = await access.session(caller)
    const authorizedGrant = platformGrant(
      context,
      CAPABILITIES.OPERATIONS_EXCEPTIONS_READ,
    )
    const availableTypes = availableExceptionTypes(context.bindings)
    const request = normalizeExceptionRequest(input, availableTypes)
    const items = await repository.listOperationalExceptions(context.caller.appId, request)
    const fullGrant = context.bindings.find(binding => binding.scopeType === 'PLATFORM'
      && ['PLATFORM_OWNER', 'PLATFORM_OPERATIONS'].includes(binding.roleKey))
    const grant = fullGrant || authorizedGrant
    await repository.recordAudit(access.audit(context, grant, {
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.operational_exceptions.view',
      resourceType: 'OPERATIONAL_EXCEPTION_LIST',
      metadata: {
        count: items.length,
        type: request.type || null,
        status: request.status || null,
        limit: request.limit,
      },
    }))
    return { items, nextCursor: null, availableTypes }
  }

  return {
    changeBranchStatus,
    createBranch,
    listAudit,
    listBranches,
    listOperationalExceptions,
    listRoleCapabilityPolicies,
    listRoles,
    searchRoleCandidates,
    setRole,
    updateBranch,
    updateRoleCapabilityPolicy,
  }
}

function platformGrant(context, capability) {
  return authorize(context.bindings, capability, { scopeType: 'PLATFORM', scopeId: null })
}

function pageResult(value) {
  if (Array.isArray(value)) {
    return { items: value, nextCursor: null }
  }
  return {
    items: Array.isArray(value?.items) ? value.items : [],
    nextCursor: typeof value?.nextCursor === 'string' ? value.nextCursor : null,
  }
}

function normalizeBranchDraft(value, { includeKey = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '分会内容无效')
  }
  const draft = {
    name: normalizedBranchText(value.name, 80, { required: true, label: '分会名称' }),
    cityName: normalizedBranchText(value.cityName, 80, { required: true, label: '城市名称' }),
    summary: normalizedBranchText(value.summary, 500, { label: '分会简介' }),
  }
  if (includeKey) {
    const rawKey = typeof value.branchKey === 'string'
      ? value.branchKey.normalize('NFKC').toLowerCase()
      : value.branchKey
    const branchKey = stableKey(rawKey, '分会', 64)
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(branchKey)) {
      throw new AdminError('VALIDATION_FAILED', '分会标识格式无效')
    }
    draft.branchKey = branchKey
  }
  return draft
}

function normalizedBranchText(value, maximum, options) {
  const normalized = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : value
  return text(normalized, maximum, options)
}

function normalizeRole(value) {
  const roles = [
    'PLATFORM_OWNER',
    'PLATFORM_OPERATIONS',
    'PLATFORM_FINANCE',
    'BRANCH_ADMIN',
    'EVENT_OWNER',
    'EVENT_MANAGER',
    'EVENT_STAFF',
  ]
  if (!roles.includes(value)) {
    throw new AdminError('VALIDATION_FAILED', '角色无效')
  }
  return value
}

function normalizeConfigurableRole(value) {
  if (!configurableRoleKeys.includes(value)) {
    throw new AdminError('VALIDATION_FAILED', '权限模板角色无效')
  }
  return value
}

function normalizeRoleCapabilities(roleKey, value) {
  if (!Array.isArray(value)) {
    throw new AdminError('VALIDATION_FAILED', '权限列表无效')
  }
  const safeMaximum = roleCapabilities[roleKey] || []
  const requested = new Set(value)
  if (requested.size !== value.length
    || value.some(item => typeof item !== 'string' || !safeMaximum.includes(item))) {
    throw new AdminError('VALIDATION_FAILED', '权限列表包含当前角色不可授予的能力')
  }
  return safeMaximum.filter(capability => requested.has(capability))
}

function roleCapabilityPolicyView(roleKey, policy, source) {
  return {
    roleKey,
    scopeType: roleKey.startsWith('PLATFORM_')
      ? 'PLATFORM'
      : roleKey === 'BRANCH_ADMIN' ? 'BRANCH' : 'EVENT',
    allowedCapabilities: roleCapabilities[roleKey],
    capabilities: source === 'DEFAULT'
      ? roleCapabilities[roleKey]
      : policy?.capabilities || [],
    version: Number(policy?.version || 0),
    source,
    updatedAt: policy?.updatedAt || null,
  }
}

function assertRoleDelegation(actorRole, targetRole) {
  if (actorRole === 'PLATFORM_OWNER') {
    return
  }
  if (actorRole === 'BRANCH_ADMIN'
    && ['EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF'].includes(targetRole)) {
    return
  }
  if (actorRole === 'EVENT_OWNER' && ['EVENT_MANAGER', 'EVENT_STAFF'].includes(targetRole)) {
    return
  }
  if (actorRole === 'EVENT_MANAGER' && targetRole === 'EVENT_STAFF') {
    return
  }
  if (targetRole === 'EVENT_OWNER') {
    throw new AdminError('FORBIDDEN', '当前账号不能设置活动负责人')
  }
  throw new AdminError('FORBIDDEN', '当前账号不能设置该角色')
}

function normalizeRoleScope(roleKey, input) {
  if (roleKey.startsWith('PLATFORM_')) {
    return { scopeType: 'PLATFORM', scopeId: null }
  }
  if (roleKey === 'BRANCH_ADMIN') {
    return { scopeType: 'BRANCH', scopeId: requiredId(input.scopeId, '城市分会') }
  }
  return {
    scopeType: 'EVENT',
    scopeId: requiredId(input.scopeId, '活动'),
    branchId: input.branchId || null,
  }
}

function normalizeFilters(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

module.exports = {
  PLATFORM_SCOPE_ID,
  createAdminGovernance,
}
