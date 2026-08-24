'use strict'

const { randomUUID } = require('node:crypto')

const { capabilitiesForBinding, roleCapabilities } = require('./capabilities')

const configurableRoleKeys = Object.freeze([
  'PLATFORM_OPERATIONS',
  'PLATFORM_FINANCE',
  'BRANCH_ADMIN',
  'EVENT_OWNER',
  'EVENT_MANAGER',
  'EVENT_STAFF',
])

function assertPolicy(roleKey, capabilities) {
  if (!configurableRoleKeys.includes(roleKey) || !Array.isArray(capabilities)) {
    throw codeError('VALIDATION_FAILED')
  }
  const safeMaximum = roleCapabilities[roleKey] || []
  const unique = new Set(capabilities)
  if (unique.size !== capabilities.length
    || capabilities.some(item => typeof item !== 'string' || !safeMaximum.includes(item))) {
    throw codeError('VALIDATION_FAILED')
  }
}

function assertConfigurableRole(roleKey) {
  if (!configurableRoleKeys.includes(roleKey)) {
    throw codeError('VALIDATION_FAILED')
  }
}

function assertPlatformOwner(authorization) {
  if (authorization?.effectiveGrant?.roleKey !== 'PLATFORM_OWNER'
    || authorization.effectiveGrant.scopeType !== 'PLATFORM') {
    throw codeError('FORBIDDEN')
  }
}

function mapPolicy(row) {
  const mode = row.policy_mode === 'CUSTOM' ? 'CUSTOM' : 'DEFAULT'
  return {
    roleKey: row.role_key,
    capabilities: mode === 'CUSTOM'
      ? capabilitiesForBinding({
          roleKey: row.role_key,
          policyCapabilities: row.capabilities_json,
        })
      : roleCapabilities[row.role_key],
    mode,
    version: Number(row.version),
    updatedAt: iso(row.updated_at),
  }
}

function createRoleCapabilityPolicyRepository(database, options = {}) {
  const createId = options.id || randomUUID
  const lockMutation = options.lockMutation
  if (typeof lockMutation !== 'function') {
    throw new TypeError('lockMutation is required')
  }

  async function listRoleCapabilityPolicies(appId) {
    const rows = await database.query(
      `SELECT role_key, policy_mode, capabilities_json, version, updated_at
       FROM mip_role_capability_policies
       WHERE app_id = ? ORDER BY role_key`,
      [appId],
    )
    return rows
      .filter(row => configurableRoleKeys.includes(row.role_key))
      .map(mapPolicy)
  }

  async function updateRoleCapabilityPolicy(input) {
    assertPolicy(input.roleKey, input.capabilities)
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertPlatformOwner(authorization)

      const current = await tx.one(
        `SELECT role_key, policy_mode, capabilities_json, version, updated_at
         FROM mip_role_capability_policies
         WHERE app_id = ? AND role_key = ? FOR UPDATE`,
        [input.appId, input.roleKey],
      )
      if (current) {
        if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
        const updated = await tx.query(
          `UPDATE mip_role_capability_policies
           SET policy_mode = 'CUSTOM', capabilities_json = ?, version = version + 1,
             updated_by_user_id = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND role_key = ? AND version = ?`,
          [JSON.stringify(input.capabilities), input.actorUserId, input.appId, input.roleKey, input.expectedVersion],
        )
        if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        if (input.expectedVersion !== 0) throw codeError('CONFLICT')
        try {
          await tx.query(
            `INSERT INTO mip_role_capability_policies (
              app_id, role_key, policy_mode, capabilities_json, version, updated_by_user_id
            ) VALUES (?, ?, 'CUSTOM', ?, 1, ?)`,
            [input.appId, input.roleKey, JSON.stringify(input.capabilities), input.actorUserId],
          )
        }
        catch (error) {
          if (error?.code === 'ER_DUP_ENTRY') throw codeError('CONFLICT')
          throw error
        }
      }

      await tx.query(
        `INSERT INTO mip_audit_logs (
          id, app_id, actor_user_id, scope_type, scope_id, action,
          resource_type, resource_id, effective_role, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [createId(), input.audit.appId, input.audit.actorUserId, input.audit.scopeType,
          input.audit.scopeId, input.audit.action, input.audit.resourceType,
          input.audit.resourceId, input.audit.effectiveRole, JSON.stringify(input.audit.metadata || {})],
      )
      return {
        roleKey: input.roleKey,
        capabilities: input.capabilities,
        version: current ? input.expectedVersion + 1 : 1,
        updatedAt: input.now.toISOString(),
      }
    })
  }

  async function resetRoleCapabilityPolicy(input) {
    assertConfigurableRole(input.roleKey)
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertPlatformOwner(authorization)

      const current = await tx.one(
        `SELECT role_key, policy_mode, version
         FROM mip_role_capability_policies
         WHERE app_id = ? AND role_key = ? FOR UPDATE`,
        [input.appId, input.roleKey],
      )
      if (current) {
        if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
        const reset = await tx.query(
          `UPDATE mip_role_capability_policies
           SET policy_mode = 'DEFAULT', capabilities_json = JSON_ARRAY(),
             version = version + 1, updated_by_user_id = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND role_key = ? AND version = ?`,
          [input.actorUserId, input.appId, input.roleKey, input.expectedVersion],
        )
        if (Number(reset.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        if (input.expectedVersion !== 0) throw codeError('CONFLICT')
        try {
          await tx.query(
            `INSERT INTO mip_role_capability_policies (
              app_id, role_key, policy_mode, capabilities_json, version, updated_by_user_id
            ) VALUES (?, ?, 'DEFAULT', JSON_ARRAY(), 1, ?)`,
            [input.appId, input.roleKey, input.actorUserId],
          )
        }
        catch (error) {
          if (error?.code === 'ER_DUP_ENTRY') throw codeError('CONFLICT')
          throw error
        }
      }

      await tx.query(
        `INSERT INTO mip_audit_logs (
          id, app_id, actor_user_id, scope_type, scope_id, action,
          resource_type, resource_id, effective_role, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [createId(), input.audit.appId, input.audit.actorUserId, input.audit.scopeType,
          input.audit.scopeId, input.audit.action, input.audit.resourceType,
          input.audit.resourceId, input.audit.effectiveRole, JSON.stringify(input.audit.metadata || {})],
      )
      return {
        roleKey: input.roleKey,
        capabilities: roleCapabilities[input.roleKey],
        mode: 'DEFAULT',
        version: current ? input.expectedVersion + 1 : 1,
        updatedAt: input.now.toISOString(),
      }
    })
  }

  return {
    listRoleCapabilityPolicies,
    resetRoleCapabilityPolicy,
    updateRoleCapabilityPolicy,
  }
}

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = {
  configurableRoleKeys,
  createRoleCapabilityPolicyRepository,
}
