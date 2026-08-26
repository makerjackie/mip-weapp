'use strict'

const { cursorPredicateFor, pageRows } = require('../pagination')
const { createUserInfluenceRepository } = require('./user-influence')

function createAdminUserRepository(database, options) {
  const assertMutationScope = options.assertMutationScope
  const assertUserMutationScope = options.assertUserMutationScope
  const createId = options.createId
  const lockMutation = options.lockMutationAuthorization
  const { codeError, escapeLike, iso, json } = options.repositorySupport
  const visibleBranchesWhere = options.visibleBranchesWhere
  const writeAudit = options.writeAudit
  const { listUserInfluence } = createUserInfluenceRepository(database, {
    iso,
    json,
  })

  async function listUsers(appId, visibility, filters, pageLimit, cursor = null) {
    const access = visibleBranchesWhere(visibility)
    const clauses = ['u.app_id = ?', access.sql]
    const params = [appId, ...access.params]
    if (filters.status && ['ACTIVE', 'BLOCKED', 'CLOSED'].includes(filters.status)) {
      clauses.push('u.status = ?')
      params.push(filters.status)
    }
    if (filters.branchId) {
      clauses.push('u.primary_branch_id = ?')
      params.push(filters.branchId)
    }
    if (filters.levelId) {
      clauses.push('gl.id = ?')
      params.push(filters.levelId)
    }
    if (filters.experienceMin !== null && filters.experienceMin !== undefined) {
      clauses.push('COALESCE(ga.experience_balance, 0) >= ?')
      params.push(filters.experienceMin)
    }
    if (filters.experienceMax !== null && filters.experienceMax !== undefined) {
      clauses.push('COALESCE(ga.experience_balance, 0) <= ?')
      params.push(filters.experienceMax)
    }
    if (filters.kind === 'PLAYER') {
      clauses.push(`EXISTS (SELECT 1 FROM mip_membership_entitlements me
        WHERE me.app_id = u.app_id AND me.user_id = u.id AND me.status = 'ACTIVE'
          AND me.starts_at <= UTC_TIMESTAMP(3) AND me.ends_at > UTC_TIMESTAMP(3))`)
    }
    if (filters.kind === 'GUEST') {
      clauses.push(`NOT EXISTS (SELECT 1 FROM mip_membership_entitlements me
        WHERE me.app_id = u.app_id AND me.user_id = u.id AND me.status = 'ACTIVE'
          AND me.starts_at <= UTC_TIMESTAMP(3) AND me.ends_at > UTC_TIMESTAMP(3))`)
    }
    if (filters.controlType) {
      clauses.push(`EXISTS (SELECT 1 FROM mip_user_access_controls c
        WHERE c.app_id = u.app_id AND c.user_id = u.id AND c.control_type = ? AND c.status = 'ACTIVE')`)
      params.push(filters.controlType)
    }
    if (filters.phoneBound === 'BOUND') {
      clauses.push('pp.phone_verified_at IS NOT NULL')
    }
    if (filters.phoneBound === 'UNBOUND') {
      clauses.push('pp.phone_verified_at IS NULL')
    }
    if (filters.profileComplete === 'COMPLETE') {
      clauses.push('u.primary_branch_id IS NOT NULL AND p.nickname IS NOT NULL AND TRIM(p.nickname) <> \'\'')
    }
    if (filters.profileComplete === 'INCOMPLETE') {
      clauses.push('(u.primary_branch_id IS NULL OR p.nickname IS NULL OR TRIM(p.nickname) = \'\')')
    }
    if (filters.joinedWithinDays) {
      clauses.push('u.created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)')
      params.push(filters.joinedWithinDays)
    }
    if (filters.createdFrom) {
      clauses.push('u.created_at >= ?')
      params.push(filters.createdFrom)
    }
    if (filters.createdTo) {
      clauses.push('u.created_at <= ?')
      params.push(filters.createdTo)
    }
    if (filters.query) {
      clauses.push('(p.nickname LIKE ? ESCAPE \'\\\\\' OR p.headline LIKE ? ESCAPE \'\\\\\' OR b.city_name LIKE ? ESCAPE \'\\\\\')')
      const query = `%${escapeLike(filters.query)}%`
      params.push(query, query, query)
    }
    const cursorWhere = cursorPredicateFor('u.updated_at', cursor, 'updatedAt', 'u.id')
    const rows = await database.query(
      `SELECT u.id, u.status, u.primary_branch_id, u.version AS user_version,
        p.nickname, p.headline, p.introduction, p.visibility_json, p.version AS profile_version,
        pp.phone_ciphertext, pp.phone_verified_at, b.name AS branch_name, b.city_name,
        gl.id AS current_level_id, ga.experience_balance, gl.name AS level_name,
        EXISTS (SELECT 1 FROM mip_membership_entitlements me
          WHERE me.app_id = u.app_id AND me.user_id = u.id AND me.status = 'ACTIVE'
            AND me.starts_at <= UTC_TIMESTAMP(3) AND me.ends_at > UTC_TIMESTAMP(3)) AS is_player,
        (SELECT GROUP_CONCAT(c.control_type ORDER BY c.control_type SEPARATOR ',')
          FROM mip_user_access_controls c
          WHERE c.app_id = u.app_id AND c.user_id = u.id AND c.status = 'ACTIVE') AS controls,
        u.created_at, u.updated_at
       FROM mip_users u
       LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
       LEFT JOIN mip_private_profiles pp ON pp.app_id = u.app_id AND pp.user_id = u.id
       LEFT JOIN mip_city_branches b ON b.app_id = u.app_id AND b.id = u.primary_branch_id
       LEFT JOIN mip_growth_accounts ga ON ga.app_id = u.app_id AND ga.user_id = u.id
       LEFT JOIN mip_growth_levels gl
         ON gl.app_id = u.app_id AND gl.status = 'ACTIVE'
        AND gl.minimum_experience = (
          SELECT MAX(current_level.minimum_experience)
          FROM mip_growth_levels current_level
          WHERE current_level.app_id = u.app_id AND current_level.status = 'ACTIVE'
            AND current_level.minimum_experience <= COALESCE(ga.experience_balance, 0)
        )
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql}
       ORDER BY u.updated_at DESC, u.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: row.id,
      status: row.status,
      kind: Number(row.is_player) === 1 ? 'PLAYER' : 'GUEST',
      nickname: row.nickname || '未填写昵称',
      headline: row.headline || '',
      introduction: row.introduction || '',
      primaryBranchId: row.primary_branch_id || null,
      branchName: row.branch_name || '',
      cityName: row.city_name || '',
      phoneBound: Boolean(row.phone_verified_at),
      phoneCiphertext: row.phone_ciphertext || null,
      controls: row.controls ? String(row.controls).split(',') : [],
      levelId: row.current_level_id || null,
      levelName: row.level_name || '',
      experience: Number(row.experience_balance || 0),
      visibility: json(row.visibility_json, {}),
      userVersion: Number(row.user_version || 1),
      profileVersion: Number(row.profile_version || 0),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }))
    return pageRows(items, pageLimit, row => ({ updatedAt: row.updatedAt, id: row.id }))
  }

  async function getUserDetail(appId, userId) {
    const user = await database.one(
      `SELECT u.id, u.status, u.primary_branch_id, u.version AS user_version,
        u.created_at, u.updated_at,
        p.nickname, p.headline, p.introduction, p.companies_json,
        p.organizations_json, p.visibility_json, p.version AS profile_version,
        pp.phone_ciphertext, pp.phone_verified_at,
        b.name AS branch_name, b.city_name,
        (SELECT GROUP_CONCAT(c.control_type ORDER BY c.control_type SEPARATOR ',')
          FROM mip_user_access_controls c
          WHERE c.app_id = u.app_id AND c.user_id = u.id AND c.status = 'ACTIVE') AS controls
       FROM mip_users u
       LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
       LEFT JOIN mip_private_profiles pp ON pp.app_id = u.app_id AND pp.user_id = u.id
       LEFT JOIN mip_city_branches b ON b.app_id = u.app_id AND b.id = u.primary_branch_id
       WHERE u.app_id = ? AND u.id = ?`,
      [appId, userId],
    )
    if (!user) {
      return null
    }

    const [entitlement, growth, counts, tags, roles] = await Promise.all([
      database.one(
        `SELECT status, starts_at, ends_at
         FROM mip_membership_entitlements
         WHERE app_id = ? AND user_id = ?
         ORDER BY ends_at DESC, id DESC LIMIT 1`,
        [appId, userId],
      ),
      database.one(
        `SELECT account.experience_balance, account.contribution_balance, account.coin_balance,
                level.name AS level_name
         FROM mip_growth_accounts account
         LEFT JOIN mip_growth_levels level
           ON level.app_id = account.app_id AND level.status = 'ACTIVE'
          AND level.minimum_experience = (
            SELECT MAX(current_level.minimum_experience)
            FROM mip_growth_levels current_level
            WHERE current_level.app_id = account.app_id AND current_level.status = 'ACTIVE'
              AND current_level.minimum_experience <= account.experience_balance
          )
         WHERE account.app_id = ? AND account.user_id = ?`,
        [appId, userId],
      ),
      database.one(
        `SELECT
          (SELECT COUNT(*) FROM mip_event_registrations r
            WHERE r.app_id = ? AND r.user_id = ?) AS registration_count,
          (SELECT COUNT(*) FROM mip_event_registrations r
            WHERE r.app_id = ? AND r.user_id = ? AND r.status = 'ATTENDED') AS attended_count,
          (SELECT COUNT(*) FROM mip_orders o
            WHERE o.app_id = ? AND o.user_id = ?) AS order_count,
          (SELECT COUNT(*) FROM mip_opportunities o
            WHERE o.app_id = ? AND o.owner_user_id = ? AND o.status <> 'ARCHIVED') AS opportunity_count,
          (SELECT COUNT(*) FROM mip_cooperation_cards c
            WHERE c.app_id = ? AND c.owner_user_id = ?) AS cooperation_card_count,
          (SELECT COUNT(*) FROM mip_super_cases c
            WHERE c.app_id = ? AND c.owner_user_id = ?) AS super_case_count`,
        [appId, userId, appId, userId, appId, userId, appId, userId, appId, userId, appId, userId],
      ),
      database.query(
        `SELECT relation.relation, tag.id, tag.kind, tag.label
         FROM mip_profile_tags relation
         INNER JOIN mip_tags tag
           ON tag.app_id = relation.app_id AND tag.id = relation.tag_id
         WHERE relation.app_id = ? AND relation.user_id = ? AND tag.enabled = 1
         ORDER BY relation.relation, tag.sort_order, tag.id`,
        [appId, userId],
      ),
      database.query(
        `SELECT role_key, scope_type, scope_id, granted_at
         FROM mip_admin_role_bindings
         WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
         ORDER BY scope_type, scope_id, role_key`,
        [appId, userId],
      ),
    ])

    const activePlayer = entitlement?.status === 'ACTIVE'
      && new Date(entitlement.starts_at).getTime() <= Date.now()
      && new Date(entitlement.ends_at).getTime() > Date.now()
    return {
      id: user.id,
      status: user.status,
      kind: activePlayer ? 'PLAYER' : 'GUEST',
      nickname: user.nickname || '未填写昵称',
      headline: user.headline || '',
      introduction: user.introduction || '',
      companies: json(user.companies_json, []),
      organizations: json(user.organizations_json, []),
      visibility: json(user.visibility_json, {}),
      primaryBranchId: user.primary_branch_id || null,
      branchName: user.branch_name || '',
      cityName: user.city_name || '',
      phoneBound: Boolean(user.phone_verified_at),
      phoneCiphertext: user.phone_ciphertext || null,
      controls: user.controls ? String(user.controls).split(',') : [],
      userVersion: Number(user.user_version || 1),
      profileVersion: Number(user.profile_version || 0),
      membership: entitlement
        ? { status: entitlement.status, startsAt: iso(entitlement.starts_at), endsAt: iso(entitlement.ends_at) }
        : null,
      growth: {
        levelName: growth?.level_name || '',
        experience: Number(growth?.experience_balance || 0),
        contribution: Number(growth?.contribution_balance || 0),
        coin: Number(growth?.coin_balance || 0),
      },
      counts: {
        registrations: Number(counts?.registration_count || 0),
        attended: Number(counts?.attended_count || 0),
        orders: Number(counts?.order_count || 0),
        opportunities: Number(counts?.opportunity_count || 0),
        cooperationCards: Number(counts?.cooperation_card_count || 0),
        superCases: Number(counts?.super_case_count || 0),
      },
      tags: tags.map(tag => ({ id: tag.id, kind: tag.kind, relation: tag.relation, label: tag.label })),
      roles: roles.map(role => ({
        roleKey: role.role_key,
        scopeType: role.scope_type,
        scopeId: role.scope_id || null,
        grantedAt: iso(role.granted_at),
      })),
      createdAt: iso(user.created_at),
      updatedAt: iso(user.updated_at),
    }
  }

  async function getUserScope(appId, userId) {
    const row = await database.one(
      `SELECT id, primary_branch_id FROM mip_users WHERE app_id = ? AND id = ?`,
      [appId, userId],
    )
    return row ? { scopeType: row.primary_branch_id ? 'BRANCH' : 'PLATFORM', scopeId: row.primary_branch_id || null } : null
  }

  async function listPrimaryBranchOptions(appId) {
    const rows = await database.query(
      `SELECT id, name, city_name FROM mip_city_branches
       WHERE app_id = ? AND status = 'ACTIVE'
       ORDER BY city_name, name, id`,
      [appId],
    )
    return rows.map(row => ({ id: row.id, name: row.name, cityName: row.city_name }))
  }

  async function updateUserFields(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const user = await tx.one(
        `SELECT u.id, u.status, u.primary_branch_id, u.version AS user_version,
          p.version AS profile_version, p.nickname, p.headline, p.introduction, p.visibility_json
         FROM mip_users u LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
         WHERE u.app_id = ? AND u.id = ? FOR UPDATE`,
        [input.appId, input.userId],
      )
      if (!user) {
        throw codeError('NOT_FOUND')
      }
      assertUserMutationScope(authorization, user, input.authorizedScope)
      if (user.status !== 'ACTIVE') {
        throw codeError('INVALID_STATE')
      }
      if (Number(user.profile_version || 0) !== input.expectedVersion) {
        throw codeError('CONFLICT')
      }
      const current = {
        nickname: user.nickname || '',
        headline: user.headline || '',
        introduction: user.introduction || '',
        visibility: json(user.visibility_json, {}),
      }
      const next = { ...current, ...input.fields }
      if (user.profile_version === null) {
        await tx.query(
          `INSERT INTO mip_profiles (
            app_id, user_id, nickname, headline, introduction,
            companies_json, organizations_json, visibility_json, version
          ) VALUES (?, ?, ?, ?, ?, JSON_ARRAY(), JSON_ARRAY(), ?, 1)`,
          [input.appId, input.userId, next.nickname, next.headline || null, next.introduction || null, JSON.stringify(next.visibility)],
        )
      }
      else {
        const result = await tx.query(
          `UPDATE mip_profiles SET nickname = ?, headline = ?, introduction = ?,
            visibility_json = ?, version = version + 1
           WHERE app_id = ? AND user_id = ? AND version = ?`,
          [next.nickname, next.headline || null, next.introduction || null, JSON.stringify(next.visibility), input.appId, input.userId, input.expectedVersion],
        )
        if (Number(result.affectedRows) !== 1) {
          throw codeError('CONFLICT')
        }
      }
      await writeAudit(tx, input.audit)
      return { userId: input.userId, version: input.expectedVersion + 1 }
    })
  }

  async function changeUserPrimaryBranch(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertMutationScope(authorization, { scopeType: 'PLATFORM', scopeId: null })

      const user = await tx.one(
        `SELECT id, status, primary_branch_id, version
         FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.userId],
      )
      if (!user) throw codeError('NOT_FOUND')
      if (user.status === 'CLOSED') throw codeError('INVALID_STATE')
      if (Number(user.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (user.primary_branch_id === input.targetBranchId) throw codeError('INVALID_STATE')

      const targetBranch = await tx.one(
        `SELECT id, status FROM mip_city_branches
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.targetBranchId],
      )
      if (!targetBranch) throw codeError('NOT_FOUND')
      if (targetBranch.status !== 'ACTIVE') throw codeError('INVALID_STATE')

      const membershipBranchIds = [user.primary_branch_id, input.targetBranchId]
        .filter(Boolean)
        .sort()
      await tx.query(
        `SELECT branch_id, status, ended_at FROM mip_branch_memberships
         WHERE app_id = ? AND user_id = ?
           AND branch_id IN (${membershipBranchIds.map(() => '?').join(', ')})
         ORDER BY branch_id FOR UPDATE`,
        [input.appId, input.userId, ...membershipBranchIds],
      )

      if (user.primary_branch_id) {
        const ended = await tx.query(
          `UPDATE mip_branch_memberships
           SET status = 'INACTIVE', ended_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND branch_id = ? AND user_id = ?`,
          [input.appId, user.primary_branch_id, input.userId],
        )
        if (Number(ended.affectedRows) !== 1) throw codeError('CONFLICT')
      }

      await tx.query(
        `INSERT INTO mip_branch_memberships (
          app_id, branch_id, user_id, status, joined_at, ended_at
        ) VALUES (?, ?, ?, 'ACTIVE', UTC_TIMESTAMP(3), NULL)
        ON DUPLICATE KEY UPDATE
          joined_at = IF(status = 'INACTIVE', UTC_TIMESTAMP(3), joined_at),
          status = 'ACTIVE', ended_at = NULL`,
        [input.appId, input.targetBranchId, input.userId],
      )

      const updated = await tx.query(
        `UPDATE mip_users SET primary_branch_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [input.targetBranchId, input.appId, input.userId, input.expectedVersion],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')

      await writeAudit(tx, input.audit(user.primary_branch_id || null))
      return {
        userId: input.userId,
        primaryBranchId: input.targetBranchId,
        version: input.expectedVersion + 1,
      }
    })
  }

  async function setUserControl(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const user = await tx.one(
        'SELECT id, status, primary_branch_id FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE',
        [input.appId, input.userId],
      )
      if (!user) {
        throw codeError('NOT_FOUND')
      }
      assertUserMutationScope(authorization, user, input.authorizedScope)
      if (user.status === 'CLOSED') {
        throw codeError('INVALID_STATE')
      }
      if (input.active) {
        await tx.query(
          `INSERT INTO mip_user_access_controls (
            id, app_id, user_id, control_type, status, reason, previous_user_status,
            created_by_user_id
          ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            previous_user_status = IF(status = 'REVOKED', VALUES(previous_user_status), previous_user_status),
            status = 'ACTIVE', reason = VALUES(reason),
            created_by_user_id = VALUES(created_by_user_id), revoked_by_user_id = NULL,
            revoked_at = NULL, version = version + 1`,
          [createId(), input.appId, input.userId, input.controlType, input.reason, input.controlType === 'BLOCKLIST' ? user.status : null, input.actorUserId],
        )
        if (input.controlType === 'BLOCKLIST' && user.status === 'ACTIVE') {
          await tx.query(
            `UPDATE mip_users SET status = 'BLOCKED', version = version + 1
             WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
            [input.appId, input.userId],
          )
        }
      }
      else {
        const control = await tx.one(
          `SELECT previous_user_status FROM mip_user_access_controls
           WHERE app_id = ? AND user_id = ? AND control_type = ? AND status = 'ACTIVE'
           FOR UPDATE`,
          [input.appId, input.userId, input.controlType],
        )
        await tx.query(
          `UPDATE mip_user_access_controls SET status = 'REVOKED', revoked_by_user_id = ?,
            revoked_at = UTC_TIMESTAMP(3), reason = ?, version = version + 1
           WHERE app_id = ? AND user_id = ? AND control_type = ? AND status = 'ACTIVE'`,
          [input.actorUserId, input.reason, input.appId, input.userId, input.controlType],
        )
        if (input.controlType === 'BLOCKLIST'
          && control?.previous_user_status === 'ACTIVE'
          && user.status === 'BLOCKED') {
          await tx.query(
            `UPDATE mip_users SET status = 'ACTIVE', version = version + 1
             WHERE app_id = ? AND id = ? AND status = 'BLOCKED'`,
            [input.appId, input.userId],
          )
        }
      }
      await writeAudit(tx, input.audit)
      return { userId: input.userId, controlType: input.controlType, active: input.active }
    })
  }

  return {
    changeUserPrimaryBranch,
    getUserDetail,
    getUserScope,
    listPrimaryBranchOptions,
    listUserInfluence,
    listUsers,
    setUserControl,
    updateUserFields,
  }
}

module.exports = { createAdminUserRepository }
