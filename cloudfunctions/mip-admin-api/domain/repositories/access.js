'use strict'

const { cursorPredicateFor, pageRows } = require('../pagination')

function branchBlockersFromRow(row = {}) {
  return {
    activeMemberships: Number(row.active_memberships || 0),
    activeBranchAdmins: Number(row.active_branch_admins || 0),
    publishedEvents: Number(row.published_events || 0),
    publishedOpportunities: Number(row.published_opportunities || 0),
  }
}

function branchDto(row, blockers = branchBlockersFromRow(row)) {
  return {
    id: String(row.id),
    branchKey: String(row.branch_key),
    name: row.name,
    cityName: row.city_name,
    summary: row.summary || '',
    status: row.status,
    version: Number(row.version),
    blockers,
  }
}

function createAdminAccessRepository(database, options) {
  const assertAuthorizedScope = options.assertAuthorizedScope
  const assertMutationScope = options.assertMutationScope
  const authorizeMutation = options.authorizeMutation
  const capabilitiesForBinding = options.capabilitiesForBinding
  const createId = options.createId
  const eventScopeFromRow = options.eventScopeFromRow
  const lockMutation = options.lockMutationAuthorization
  const resolveIdentity = options.resolveIdentity
  const {
    codeError,
    duplicateConstraint,
    escapeLike,
    iso,
    json,
    placeholders,
  } = options.repositorySupport
  const writeAudit = options.writeAudit

  async function resolveUser(caller) {
    return resolveIdentity(caller)
  }

  async function listRoleBindings(appId, userId) {
    const rows = await database.query(
      `SELECT r.scope_type, r.scope_id, r.role_key,
        CASE WHEN p.policy_mode = 'CUSTOM' THEN p.capabilities_json ELSE NULL END AS policy_capabilities_json
       FROM mip_admin_role_bindings r
       LEFT JOIN mip_role_capability_policies p
         ON p.app_id = r.app_id AND p.role_key = r.role_key
       WHERE r.app_id = ? AND r.user_id = ? AND r.status = 'ACTIVE'
       ORDER BY r.scope_type, r.scope_id, r.role_key`,
      [appId, userId],
    )
    return rows.map(row => ({
      scopeType: row.scope_type,
      scopeId: row.scope_type === 'PLATFORM' ? null : row.scope_id,
      roleKey: row.role_key,
      capabilities: capabilitiesForBinding({
        roleKey: row.role_key,
        policyCapabilities: Object.hasOwn(row, 'policy_capabilities_json')
          ? row.policy_capabilities_json
          : null,
      }),
    }))
  }

  async function listBranches(appId) {
    const rows = await database.query(
      `SELECT b.id, b.branch_key, b.name, b.city_name, b.summary, b.status, b.version,
        (SELECT COUNT(*) FROM mip_branch_memberships m
          WHERE m.app_id = b.app_id AND m.branch_id = b.id
            AND m.status = 'ACTIVE') AS active_memberships,
        (SELECT COUNT(*) FROM mip_admin_role_bindings r
          WHERE r.app_id = b.app_id AND r.scope_type = 'BRANCH'
            AND r.scope_id = b.id AND r.role_key = 'BRANCH_ADMIN'
            AND r.status = 'ACTIVE') AS active_branch_admins,
        (SELECT COUNT(*) FROM mip_events e
          WHERE e.app_id = b.app_id AND e.scope_type = 'BRANCH'
            AND e.branch_id = b.id AND e.status = 'PUBLISHED') AS published_events,
        (SELECT COUNT(*) FROM mip_opportunities o
          WHERE o.app_id = b.app_id AND o.scope_type = 'BRANCH'
            AND o.branch_id = b.id AND o.status = 'PUBLISHED') AS published_opportunities
       FROM mip_city_branches b
       WHERE b.app_id = ?
       ORDER BY b.status, b.city_name, b.name, b.id`,
      [appId],
    )
    return rows.map(row => branchDto(row))
  }

  async function createBranch(input) {
    return database.transaction(async (tx) => {
      await authorizeMutation(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      const branchId = createId()
      try {
        await tx.query(
          `INSERT INTO mip_city_branches (
            id, app_id, branch_key, name, city_name, summary, status, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
          [branchId, input.appId, input.branchKey, input.name, input.cityName, input.summary || null, input.actorUserId],
        )
      }
      catch (error) {
        const constraint = duplicateConstraint(error)
        if (constraint.includes('mip_city_branches_key_uk')) {
          throw codeError('BRANCH_KEY_CONFLICT')
        }
        if (constraint) {
          throw codeError('CONFLICT')
        }
        throw error
      }
      await writeAudit(tx, input.audit(branchId))
      return branchDto({
        id: branchId,
        branch_key: input.branchKey,
        name: input.name,
        city_name: input.cityName,
        summary: input.summary,
        status: 'ACTIVE',
        version: 1,
      })
    })
  }

  async function updateBranch(input) {
    return database.transaction(async (tx) => {
      await authorizeMutation(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      const current = await tx.one(
        `SELECT id, branch_key, name, city_name, summary, status, version
         FROM mip_city_branches WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.branchId],
      )
      if (!current) {
        throw codeError('NOT_FOUND')
      }
      if (Number(current.version) !== input.expectedVersion) {
        throw codeError('CONFLICT')
      }
      const updated = await tx.query(
        `UPDATE mip_city_branches SET name = ?, city_name = ?, summary = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [input.name, input.cityName, input.summary || null, input.appId, input.branchId, input.expectedVersion],
      )
      if (Number(updated.affectedRows) !== 1) {
        throw codeError('CONFLICT')
      }
      const blockers = await countBranchBlockers(tx, input.appId, input.branchId)
      await writeAudit(tx, input.audit)
      return branchDto({
        ...current,
        name: input.name,
        city_name: input.cityName,
        summary: input.summary,
        version: input.expectedVersion + 1,
      }, blockers)
    })
  }

  async function changeBranchStatus(input) {
    return database.transaction(async (tx) => {
      await authorizeMutation(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      const current = await tx.one(
        `SELECT id, branch_key, name, city_name, summary, status, version
         FROM mip_city_branches WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.branchId],
      )
      if (!current) {
        throw codeError('NOT_FOUND')
      }
      if (Number(current.version) !== input.expectedVersion) {
        throw codeError('CONFLICT')
      }
      if (current.status === input.status) {
        throw codeError('INVALID_STATE')
      }
      const blockers = await countBranchBlockers(tx, input.appId, input.branchId, true)
      if (input.status === 'INACTIVE' && Object.values(blockers).some(count => count > 0)) {
        const error = codeError('BRANCH_DEACTIVATION_BLOCKED')
        error.details = { blockers }
        throw error
      }
      const updated = await tx.query(
        `UPDATE mip_city_branches SET status = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [input.status, input.appId, input.branchId, input.expectedVersion],
      )
      if (Number(updated.affectedRows) !== 1) {
        throw codeError('CONFLICT')
      }
      await writeAudit(tx, input.audit)
      return branchDto({
        ...current,
        status: input.status,
        version: input.expectedVersion + 1,
      }, blockers)
    })
  }

  async function countBranchBlockers(connection, appId, branchId, lockRows = false) {
    const lock = lockRows ? ' FOR UPDATE' : ''
    const memberships = await connection.one(
      `SELECT COUNT(*) AS total FROM mip_branch_memberships
       WHERE app_id = ? AND branch_id = ? AND status = 'ACTIVE'${lock}`,
      [appId, branchId],
    )
    const administrators = await connection.one(
      `SELECT COUNT(*) AS total FROM mip_admin_role_bindings
       WHERE app_id = ? AND scope_type = 'BRANCH' AND scope_id = ?
         AND role_key = 'BRANCH_ADMIN' AND status = 'ACTIVE'${lock}`,
      [appId, branchId],
    )
    const events = await connection.one(
      `SELECT COUNT(*) AS total FROM mip_events
       WHERE app_id = ? AND scope_type = 'BRANCH' AND branch_id = ?
         AND status = 'PUBLISHED'${lock}`,
      [appId, branchId],
    )
    const opportunities = await connection.one(
      `SELECT COUNT(*) AS total FROM mip_opportunities
       WHERE app_id = ? AND scope_type = 'BRANCH' AND branch_id = ?
         AND status = 'PUBLISHED'${lock}`,
      [appId, branchId],
    )
    return {
      activeMemberships: Number(memberships?.total || 0),
      activeBranchAdmins: Number(administrators?.total || 0),
      publishedEvents: Number(events?.total || 0),
      publishedOpportunities: Number(opportunities?.total || 0),
    }
  }

  async function listRoles(appId, visibility, { includeAdministrativeScopes = false } = {}) {
    const clauses = []
    const params = [appId]
    if (!visibility.platform) {
      if (visibility.branchIds.length) {
        clauses.push(`(r.scope_type = 'BRANCH' AND r.scope_id IN (${placeholders(visibility.branchIds)}))`)
        params.push(...visibility.branchIds)
        clauses.push(`(r.scope_type = 'EVENT' AND EXISTS (
          SELECT 1 FROM mip_events e WHERE e.app_id = r.app_id AND e.id = r.scope_id
            AND e.branch_id IN (${placeholders(visibility.branchIds)})
        ))`)
        params.push(...visibility.branchIds)
      }
      if (visibility.eventIds.length) {
        clauses.push(`(r.scope_type = 'EVENT' AND r.scope_id IN (${placeholders(visibility.eventIds)}))`)
        params.push(...visibility.eventIds)
      }
    }
    const visibleWhere = visibility.platform ? '1 = 1' : clauses.length ? `(${clauses.join(' OR ')})` : '0 = 1'
    const scopeWhere = includeAdministrativeScopes ? '1 = 1' : 'r.scope_type = \'EVENT\''
    const rows = await database.query(
      `SELECT r.id, r.user_id, r.scope_type, r.scope_id, r.role_key, r.status,
        r.granted_at, r.revoked_at, p.nickname, b.name AS branch_name,
        e.title AS event_title, e.branch_id AS event_branch_id
       FROM mip_admin_role_bindings r
       LEFT JOIN mip_profiles p ON p.app_id = r.app_id AND p.user_id = r.user_id
       LEFT JOIN mip_city_branches b ON b.app_id = r.app_id
         AND r.scope_type = 'BRANCH' AND b.id = r.scope_id
       LEFT JOIN mip_events e ON e.app_id = r.app_id
         AND r.scope_type = 'EVENT' AND e.id = r.scope_id
       WHERE r.app_id = ? AND ${visibleWhere} AND ${scopeWhere}
       ORDER BY r.status, r.granted_at DESC, r.id DESC`,
      params,
    )
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      nickname: row.nickname || '未填写昵称',
      scopeType: row.scope_type,
      scopeId: row.scope_type === 'PLATFORM' ? null : row.scope_id,
      scopeName: row.scope_type === 'PLATFORM'
        ? '平台'
        : row.scope_type === 'BRANCH'
          ? row.branch_name || '城市分会'
          : row.event_title || '活动',
      branchId: row.scope_type === 'BRANCH'
        ? row.scope_id
        : row.scope_type === 'EVENT'
          ? row.event_branch_id || null
          : null,
      roleKey: row.role_key,
      status: row.status,
      grantedAt: iso(row.granted_at),
      revokedAt: iso(row.revoked_at),
    }))
  }

  async function searchRoleCandidates(appId, query, pageLimit) {
    if (!query) {
      return []
    }
    const pattern = `%${escapeLike(query)}%`
    const rows = await database.query(
      `SELECT u.id, p.nickname, b.city_name
       FROM mip_users u
       INNER JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
       LEFT JOIN mip_city_branches b ON b.app_id = u.app_id AND b.id = u.primary_branch_id
       WHERE u.app_id = ? AND u.status = 'ACTIVE'
         AND (p.nickname LIKE ? ESCAPE '\\\\' OR p.headline LIKE ? ESCAPE '\\\\')
       ORDER BY p.updated_at DESC, u.id DESC LIMIT ?`,
      [appId, pattern, pattern, pageLimit],
    )
    return rows.map(row => ({ id: row.id, nickname: row.nickname, cityName: row.city_name || '' }))
  }

  async function setRole(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      if (input.scope.scopeType === 'EVENT') {
        const event = await tx.one(
          `SELECT id, branch_id FROM mip_events
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, input.scope.scopeId],
        )
        if (!event) {
          throw codeError('NOT_FOUND')
        }
        const currentScope = eventScopeFromRow(event, input.scope.scopeId)
        assertMutationScope(authorization, currentScope)
        assertAuthorizedScope(currentScope, input.authorizedScope)
      }
      else if (input.scope.scopeType === 'BRANCH') {
        const branch = await tx.one(
          `SELECT id, status FROM mip_city_branches
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, input.scope.scopeId],
        )
        if (!branch) {
          throw codeError('NOT_FOUND')
        }
        if (input.active && branch.status !== 'ACTIVE') {
          throw codeError('INVALID_STATE')
        }
        const currentScope = { scopeType: 'BRANCH', scopeId: input.scope.scopeId }
        assertMutationScope(authorization, currentScope)
        assertAuthorizedScope(currentScope, input.authorizedScope)
      }
      else {
        const currentScope = { scopeType: 'PLATFORM', scopeId: null }
        assertMutationScope(authorization, currentScope)
        assertAuthorizedScope(currentScope, input.authorizedScope)
      }
      const target = await tx.one(
        'SELECT id, status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE',
        [input.appId, input.userId],
      )
      if (!target) {
        throw codeError('NOT_FOUND')
      }
      if (input.active && target.status !== 'ACTIVE') {
        throw codeError('INVALID_STATE')
      }
      if (!input.active && input.roleKey === 'PLATFORM_OWNER') {
        if (input.userId === input.actorUserId) {
          throw codeError('INVALID_STATE')
        }
        const owners = await tx.query(
          `SELECT id FROM mip_admin_role_bindings
           WHERE app_id = ? AND scope_type = 'PLATFORM' AND role_key = 'PLATFORM_OWNER'
             AND status = 'ACTIVE' FOR UPDATE`,
          [input.appId],
        )
        if (owners.length <= 1) {
          throw codeError('INVALID_STATE')
        }
      }
      if (input.active) {
        await tx.query(
          `INSERT INTO mip_admin_role_bindings (
            id, app_id, user_id, scope_type, scope_id, role_key, status, granted_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
          ON DUPLICATE KEY UPDATE status = 'ACTIVE', granted_by_user_id = VALUES(granted_by_user_id),
            granted_at = UTC_TIMESTAMP(3), revoked_at = NULL`,
          [createId(), input.appId, input.userId, input.scope.scopeType, input.scope.scopeId, input.roleKey, input.actorUserId],
        )
      }
      else {
        const revoked = await tx.query(
          `UPDATE mip_admin_role_bindings SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND user_id = ? AND scope_type = ? AND scope_id = ?
             AND role_key = ? AND status = 'ACTIVE'`,
          [input.appId, input.userId, input.scope.scopeType, input.scope.scopeId, input.roleKey],
        )
        if (Number(revoked.affectedRows) !== 1) {
          throw codeError('CONFLICT')
        }
      }
      await writeAudit(tx, input.audit)
      return {
        userId: input.userId,
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeType === 'PLATFORM' ? null : input.scope.scopeId,
        roleKey: input.roleKey,
        active: input.active,
      }
    })
  }

  async function listAudit(appId, visibility, filters, pageLimit, cursor = null) {
    const clauses = ['a.app_id = ?']
    const params = [appId]
    if (!visibility.platform) {
      const scopes = []
      if (visibility.branchIds.length) {
        scopes.push(`(a.scope_type = 'BRANCH' AND a.scope_id IN (${placeholders(visibility.branchIds)}))`)
        params.push(...visibility.branchIds)
        scopes.push(`(a.scope_type = 'EVENT' AND EXISTS (
          SELECT 1 FROM mip_events e WHERE e.app_id = a.app_id AND e.id = a.scope_id
            AND e.branch_id IN (${placeholders(visibility.branchIds)})
        ))`)
        params.push(...visibility.branchIds)
      }
      if (visibility.eventIds.length) {
        scopes.push(`(a.scope_type = 'EVENT' AND a.scope_id IN (${placeholders(visibility.eventIds)}))`)
        params.push(...visibility.eventIds)
      }
      clauses.push(scopes.length ? `(${scopes.join(' OR ')})` : '0 = 1')
    }
    if (filters.action) {
      clauses.push('a.action = ?')
      params.push(filters.action)
    }
    if (filters.resourceType) {
      clauses.push('a.resource_type = ?')
      params.push(filters.resourceType)
    }
    const cursorWhere = cursorPredicateFor('a.created_at', cursor, 'createdAt', 'a.id')
    const rows = await database.query(
      `SELECT a.id, a.actor_user_id, p.nickname AS actor_nickname, a.scope_type,
        a.scope_id, a.action, a.resource_type, a.resource_id, a.effective_role,
        a.metadata_json, a.created_at
       FROM mip_audit_logs a
       LEFT JOIN mip_profiles p ON p.app_id = a.app_id AND p.user_id = a.actor_user_id
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: String(row.id),
      actorUserId: row.actor_user_id || null,
      actorNickname: row.actor_nickname || '系统',
      scopeType: row.scope_type,
      scopeId: row.scope_id || null,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id || null,
      effectiveRole: row.effective_role || null,
      metadata: json(row.metadata_json, {}),
      createdAt: iso(row.created_at),
    }))
    return pageRows(items, pageLimit, row => ({ createdAt: row.createdAt, id: row.id }))
  }

  return {
    changeBranchStatus,
    createBranch,
    listAudit,
    listBranches,
    listRoleBindings,
    listRoles,
    resolveUser,
    searchRoleCandidates,
    setRole,
    updateBranch,
  }
}

module.exports = { createAdminAccessRepository }
