'use strict'

const { randomUUID } = require('node:crypto')
const { pageRows, cursorPredicateFor } = require('./pagination')
const {
  assertMutationScope,
  lockMutationAuthorization,
} = require('./mutation-authorization')
const { load: loadCommercialTerms, sync: syncCommercialTerms } = require('./opportunity-commercial-terms')
const { claimOptional, complete } = require('./idempotency')

function codeError(code, details = null) {
  const error = new Error(code)
  error.code = code
  if (details) error.details = details
  return error
}

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function json(value, fallback) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(value) }
  catch { return fallback }
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function sameScope(left, right) {
  return left?.scopeType === right?.scopeType
    && (left?.scopeId || null) === (right?.scopeId || null)
}

function ownedScope(row) {
  return {
    scopeType: row.branch_id ? 'BRANCH' : 'PLATFORM',
    scopeId: row.branch_id || null,
  }
}

function eventScope(row) {
  return {
    scopeType: 'EVENT',
    scopeId: row.id,
    branchId: row.branch_id || null,
  }
}

function visibilityWhere(visibility, alias, { includeEvents = false } = {}) {
  if (visibility.platform) return { sql: '1 = 1', params: [] }
  const clauses = []
  const params = []
  if (visibility.branchIds?.length) {
    clauses.push(`${alias}.branch_id IN (${placeholders(visibility.branchIds)})`)
    params.push(...visibility.branchIds)
  }
  if (includeEvents && visibility.eventIds?.length) {
    clauses.push(`${alias}.id IN (${placeholders(visibility.eventIds)})`)
    params.push(...visibility.eventIds)
  }
  return clauses.length
    ? { sql: `(${clauses.join(' OR ')})`, params }
    : { sql: '1 = 0', params: [] }
}

async function writeAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'ADMIN', ?, ?, ?, ?, ?, ?, ?)`,
    [audit.appId, audit.actorUserId, audit.scopeType, audit.scopeId || null,
      audit.action, audit.resourceType, audit.resourceId || null,
      audit.effectiveRole, JSON.stringify(audit.metadata || {})],
  )
}

function opportunityDto(row, { history = [], teamMembers = [], commercialTerms } = {}) {
  return {
    id: String(row.id),
    ownerUserId: row.owner_user_id || '',
    ownerNickname: row.owner_nickname || '未填写昵称',
    title: row.title,
    valueSummary: row.value_summary,
    targetSummary: row.target_summary || '',
    description: row.description || '',
    coverAssetId: row.cover_asset_id || null,
    coverUrl: row.cover_file_id || '',
    scopeType: row.scope_type,
    branchId: row.branch_id || null,
    branchName: row.branch_name || '',
    cityTagId: row.city_tag_id || null,
    cityName: row.city_name || '',
    ...(commercialTerms ? { commercialTerms } : row.city_tag_id ? {
      commercialTerms: {
        currency: 'CNY', amountUnit: 'CNY_CENTS', amountDisplay: '',
        locations: [{ type: 'CITY', cityTagId: row.city_tag_id, cityName: row.city_name || '' }],
      },
    } : {}),
    roleKeys: row.role_keys ? String(row.role_keys).split(',').filter(Boolean) : [],
    tagIds: row.tag_ids ? String(row.tag_ids).split(',').filter(Boolean) : [],
    tags: row.tag_labels ? String(row.tag_labels).split(',').filter(Boolean) : [],
    status: row.status,
    contentSafetyStatus: row.content_safety_status,
    referralCount: Number(row.referral_count || 0),
    deadlineAt: iso(row.deadline_at),
    version: Number(row.version),
    publishedAt: iso(row.published_at),
    endedAt: iso(row.ended_at),
    moderatedAt: iso(row.moderated_at),
    moderationReason: row.moderation_reason || '',
    archivedAt: iso(row.archived_at),
    archiveReason: row.archive_reason || '',
    updatedAt: iso(row.updated_at),
    history,
    teamMembers,
  }
}

function opportunitySelect(where, suffix = '') {
  return `SELECT o.id, o.owner_user_id, o.title, o.value_summary, o.target_summary, o.description,
      o.scope_type, o.branch_id, o.city_tag_id, o.cover_asset_id, b.name AS branch_name,
      COALESCE(b.city_name, city_tag.label, '') AS city_name,
      owner_profile.nickname AS owner_nickname,
      o.status, o.content_safety_status, o.referral_count, o.deadline_at, o.version,
      o.published_at, o.ended_at, o.updated_at, o.moderated_at, o.moderation_reason,
      o.archived_at, o.archive_reason,
      cover.cloud_file_id AS cover_file_id,
      (SELECT GROUP_CONCAT(role.role_key ORDER BY role.role_key SEPARATOR ',')
       FROM mip_opportunity_roles role
       WHERE role.app_id = o.app_id AND role.opportunity_id = o.id) AS role_keys,
      (SELECT GROUP_CONCAT(relation.tag_id ORDER BY relation.relation, tag.sort_order, tag.id SEPARATOR ',')
       FROM mip_opportunity_tags relation
       INNER JOIN mip_tags tag ON tag.app_id = relation.app_id AND tag.id = relation.tag_id
       WHERE relation.app_id = o.app_id AND relation.opportunity_id = o.id) AS tag_ids,
      (SELECT GROUP_CONCAT(REPLACE(tag.label, ',', '，') ORDER BY relation.relation, tag.sort_order, tag.id SEPARATOR ',')
       FROM mip_opportunity_tags relation
       INNER JOIN mip_tags tag ON tag.app_id = relation.app_id AND tag.id = relation.tag_id
       WHERE relation.app_id = o.app_id AND relation.opportunity_id = o.id) AS tag_labels
    FROM mip_opportunities o
    LEFT JOIN mip_city_branches b ON b.app_id = o.app_id AND b.id = o.branch_id
    LEFT JOIN mip_tags city_tag ON city_tag.app_id = o.app_id AND city_tag.id = o.city_tag_id
    LEFT JOIN mip_profiles owner_profile ON owner_profile.app_id = o.app_id AND owner_profile.user_id = o.owner_user_id
    LEFT JOIN mip_media_assets cover
      ON cover.app_id = o.app_id AND cover.id = o.cover_asset_id AND cover.status = 'READY'
    WHERE ${where} ${suffix}`
}

function createAdminPrdExtensions(database, options = {}) {
  const id = options.id || randomUUID
  const now = options.now || (() => new Date())
  const lockMutation = options.lockMutation || lockMutationAuthorization
  const assertScope = options.assertMutationScope || assertMutationScope

  async function listOpportunitiesV2(appId, visibility, filters, pageLimit, cursor = null) {
    const access = visibilityWhere(visibility, 'o')
    const clauses = ['o.app_id = ?', access.sql]
    const params = [appId, ...access.params]
    if (filters.status) { clauses.push('o.status = ?'); params.push(filters.status) }
    if (filters.query) {
      clauses.push(`(o.title LIKE ? ESCAPE '\\\\' OR o.value_summary LIKE ? ESCAPE '\\\\'
        OR o.target_summary LIKE ? ESCAPE '\\\\' OR o.description LIKE ? ESCAPE '\\\\')`)
      const query = `%${escapeLike(filters.query)}%`
      params.push(query, query, query, query)
    }
    if (filters.ownerQuery) { clauses.push("owner_profile.nickname LIKE ? ESCAPE '\\\\'"); params.push(`%${escapeLike(filters.ownerQuery)}%`) }
    if (filters.cityQuery) {
      clauses.push("(b.city_name LIKE ? ESCAPE '\\\\' OR city_tag.label LIKE ? ESCAPE '\\\\' OR EXISTS (SELECT 1 FROM mip_opportunity_locations location LEFT JOIN mip_tags location_city ON location_city.app_id = location.app_id AND location_city.id = location.city_tag_id WHERE location.app_id = o.app_id AND location.opportunity_id = o.id AND location_city.label LIKE ? ESCAPE '\\\\'))")
      const query = `%${escapeLike(filters.cityQuery)}%`
      params.push(query, query, query)
    }
    if (filters.locationTypes?.length) {
      clauses.push(`EXISTS (SELECT 1 FROM mip_opportunity_locations location WHERE location.app_id = o.app_id AND location.opportunity_id = o.id AND location.location_type IN (${placeholders(filters.locationTypes)}))`)
      params.push(...filters.locationTypes)
    }
    if (filters.locationCityTagIds?.length) {
      clauses.push(`EXISTS (SELECT 1 FROM mip_opportunity_locations location WHERE location.app_id = o.app_id AND location.opportunity_id = o.id AND location.location_type = 'CITY' AND location.city_tag_id IN (${placeholders(filters.locationCityTagIds)}))`)
      params.push(...filters.locationCityTagIds)
    }
    if (filters.minAmountCents !== undefined) {
      clauses.push("EXISTS (SELECT 1 FROM mip_opportunity_commercial_terms terms WHERE terms.app_id = o.app_id AND terms.opportunity_id = o.id AND terms.status = 'ACTIVE' AND COALESCE(terms.max_amount_cents, 18446744073709551615) >= ?)")
      params.push(filters.minAmountCents)
    }
    if (filters.maxAmountCents !== undefined) {
      clauses.push("EXISTS (SELECT 1 FROM mip_opportunity_commercial_terms terms WHERE terms.app_id = o.app_id AND terms.opportunity_id = o.id AND terms.status = 'ACTIVE' AND COALESCE(terms.min_amount_cents, 0) <= ?)")
      params.push(filters.maxAmountCents)
    }
    if (filters.deadlineFrom) { clauses.push('o.deadline_at >= ?'); params.push(filters.deadlineFrom) }
    if (filters.deadlineTo) { clauses.push('o.deadline_at <= ?'); params.push(filters.deadlineTo) }
    if (filters.updatedFrom) { clauses.push('o.updated_at >= ?'); params.push(filters.updatedFrom) }
    if (filters.updatedTo) { clauses.push('o.updated_at <= ?'); params.push(filters.updatedTo) }
    const cursorWhere = cursorPredicateFor('o.updated_at', cursor, 'updatedAt', 'o.id')
    const rows = await database.query(
      opportunitySelect(clauses.join(' AND '), `${cursorWhere.sql} ORDER BY o.updated_at DESC, o.id DESC LIMIT ?`),
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const terms = await Promise.all(rows.map(row => loadCommercialTerms(database, appId, row.id)))
    const items = rows.map((row, index) => opportunityDto(row, { commercialTerms: terms[index] }))
    return pageRows(items, pageLimit, row => ({ updatedAt: row.updatedAt, id: row.id }))
  }

  async function getOpportunityDetail(appId, opportunityId) {
    const row = await database.one(opportunitySelect('o.app_id = ? AND o.id = ?'), [appId, opportunityId])
    if (!row) return null
    const [auditRows, teamRows, commercialTerms] = await Promise.all([
      database.query(
        `SELECT a.id, a.action, a.metadata_json, a.created_at, p.nickname AS actor_nickname
         FROM mip_audit_logs a
         LEFT JOIN mip_profiles p ON p.app_id = a.app_id AND p.user_id = a.actor_user_id
         WHERE a.app_id = ? AND a.resource_type = 'OPPORTUNITY' AND a.resource_id = ?
         ORDER BY a.created_at DESC, a.id DESC LIMIT 100`,
        [appId, opportunityId],
      ),
      database.query(
        `SELECT member.user_id, profile.nickname, branch.name AS branch_name
         FROM mip_opportunity_team_members member
         INNER JOIN mip_users user
           ON user.app_id = member.app_id AND user.id = member.user_id AND user.status = 'ACTIVE'
         LEFT JOIN mip_profiles profile
           ON profile.app_id = user.app_id AND profile.user_id = user.id
         LEFT JOIN mip_city_branches branch
           ON branch.app_id = user.app_id AND branch.id = user.primary_branch_id
         WHERE member.app_id = ? AND member.opportunity_id = ? AND member.status = 'ACTIVE'
         ORDER BY member.sort_order, member.id`,
        [appId, opportunityId],
      ),
      loadCommercialTerms(database, appId, opportunityId),
    ])
    return opportunityDto(row, { commercialTerms,
      history: auditRows.map(item => ({
        id: String(item.id),
        action: item.action,
        actorNickname: item.actor_nickname || '系统',
        metadata: json(item.metadata_json, {}),
        createdAt: iso(item.created_at),
      })),
      teamMembers: teamRows.map(item => ({
        userId: item.user_id,
        nickname: item.nickname || '未填写昵称',
        branchName: item.branch_name || '',
      })),
    })
  }

  async function getOpportunityEditorOptions(appId, visibility) {
    const branchIds = visibility?.platform ? [] : [...new Set(visibility?.branchIds || [])]
    const branchAccess = visibility?.platform
      ? { sql: '1 = 1', params: [] }
      : branchIds.length
        ? { sql: `id IN (${placeholders(branchIds)})`, params: branchIds }
        : { sql: '1 = 0', params: [] }
    const ownerAccess = visibility?.platform
      ? { sql: '1 = 1', params: [] }
      : branchIds.length
        ? { sql: `u.primary_branch_id IN (${placeholders(branchIds)})`, params: branchIds }
        : { sql: '1 = 0', params: [] }
    const [branches, owners, tags] = await Promise.all([
      database.query(
        `SELECT id, name, city_name FROM mip_city_branches
         WHERE app_id = ? AND status = 'ACTIVE' AND ${branchAccess.sql}
         ORDER BY city_name, name, id`,
        [appId, ...branchAccess.params],
      ),
      database.query(
        `SELECT u.id, p.nickname, b.name AS branch_name
         FROM mip_users u
         LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
         LEFT JOIN mip_city_branches b ON b.app_id = u.app_id AND b.id = u.primary_branch_id
         WHERE u.app_id = ? AND u.status = 'ACTIVE' AND ${ownerAccess.sql}
         ORDER BY p.nickname, u.id LIMIT 500`,
        [appId, ...ownerAccess.params],
      ),
      database.query(
        `SELECT id, kind, label, popular, sort_order FROM mip_tags
         WHERE app_id = ? AND enabled = 1 AND selectable = 1
           AND kind IN ('CITY', 'INDUSTRY', 'ABILITY')
         ORDER BY kind, popular DESC, sort_order, id`,
        [appId],
      ),
    ])
    return {
      branches: branches.map(row => ({ id: row.id, name: row.name, cityName: row.city_name })),
      owners: owners.map(row => ({ id: row.id, nickname: row.nickname || '未填写昵称', branchName: row.branch_name || '' })),
      cities: tags.filter(row => row.kind === 'CITY').map(row => ({ id: row.id, label: row.label })),
      tags: tags.filter(row => row.kind !== 'CITY').map(row => ({ id: row.id, kind: row.kind, label: row.label })),
      roles: [
        ['connector', '皮条客'], ['business_builder', '生意佬'], ['capital_operator', '暴发户'],
        ['strategist', '狗策划'], ['visual_designer', '死美工'], ['delivery_lead', '老保姆'],
      ].map(([key, label]) => ({ key, label })),
    }
  }

  async function saveOpportunity(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const opportunityId = input.opportunityId || id()
      const draftScope = { scopeType: input.draft.scopeType, scopeId: input.draft.branchId || null }
      assertScope(authorization, draftScope)
      let status = 'DRAFT'
      let version = 1
      if (input.opportunityId) {
        const current = await tx.one(
          `SELECT id, branch_id, status, version FROM mip_opportunities
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, opportunityId],
        )
        if (!current) throw codeError('NOT_FOUND')
        const currentScope = ownedScope(current)
        assertScope(authorization, currentScope)
        if (!sameScope(currentScope, input.authorizedScope)) throw codeError('CONFLICT')
        if (authorization.effectiveGrant.scopeType !== 'PLATFORM' && !sameScope(currentScope, draftScope)) throw codeError('FORBIDDEN')
        if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
        if (!['DRAFT', 'PUBLISHED'].includes(current.status)) throw codeError('INVALID_STATE')
        if (current.status === 'PUBLISHED' && input.contentSafetyStatus !== 'APPROVED') {
          throw codeError('CONTENT_SAFETY_REQUIRED')
        }
        status = current.status
        version = Number(current.version) + 1
      }
      const owner = await tx.one(
        `SELECT id, primary_branch_id FROM mip_users
         WHERE app_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE`,
        [input.appId, input.draft.ownerUserId],
      )
      if (!owner) throw codeError('VALIDATION_FAILED')
      if (draftScope.scopeType === 'BRANCH' && owner.primary_branch_id !== draftScope.scopeId) {
        throw codeError('FORBIDDEN')
      }
      if (input.draft.cityTagId) {
        const city = await tx.one(
          `SELECT id FROM mip_tags WHERE app_id = ? AND id = ? AND kind = 'CITY' AND enabled = 1 FOR SHARE`,
          [input.appId, input.draft.cityTagId],
        )
        if (!city) throw codeError('VALIDATION_FAILED')
      }
      const legacyCityTagId = input.draft.commercialTerms
        ? (input.draft.commercialTerms.locations.find(location => location.type === 'CITY')?.cityTagId || null)
        : input.draft.cityTagId
      if (input.draft.commercialTerms) {
        const cityIds = input.draft.commercialTerms.locations.filter(item => item.type === 'CITY').map(item => item.cityTagId)
        if (cityIds.length) {
          const cities = await tx.query(
            `SELECT id FROM mip_tags WHERE app_id = ? AND kind = 'CITY' AND enabled = 1
             AND id IN (${placeholders(cityIds)}) FOR SHARE`,
            [input.appId, ...cityIds],
          )
          if (new Set(cities.map(row => row.id)).size !== cityIds.length) throw codeError('VALIDATION_FAILED')
        }
      }
      let selectedTags = []
      if (input.draft.tagIds.length) {
        selectedTags = await tx.query(
          `SELECT id, kind FROM mip_tags WHERE app_id = ? AND id IN (${placeholders(input.draft.tagIds)})
             AND kind IN ('INDUSTRY', 'ABILITY') AND enabled = 1 AND selectable = 1 FOR SHARE`,
          [input.appId, ...input.draft.tagIds],
        )
        if (new Set(selectedTags.map(row => row.id)).size !== input.draft.tagIds.length) throw codeError('VALIDATION_FAILED')
      }
      if (input.opportunityId) {
        const updated = await tx.query(
          `UPDATE mip_opportunities SET owner_user_id = ?, scope_type = ?, branch_id = ?,
            title = ?, value_summary = ?, target_summary = ?, description = ?, city_tag_id = ?,
            deadline_at = ?, content_safety_status = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status IN ('DRAFT', 'PUBLISHED')`,
          [input.draft.ownerUserId, input.draft.scopeType, input.draft.branchId,
            input.draft.title, input.draft.valueSummary, input.draft.targetSummary,
            input.draft.description, legacyCityTagId, input.draft.deadlineAt,
            input.contentSafetyStatus, input.appId, opportunityId, input.expectedVersion],
        )
        if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        await tx.query(
          `INSERT INTO mip_opportunities (
            id, app_id, owner_user_id, scope_type, branch_id, title, value_summary,
            target_summary, description, city_tag_id, status, content_safety_status, deadline_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
          [opportunityId, input.appId, input.draft.ownerUserId, input.draft.scopeType,
            input.draft.branchId, input.draft.title, input.draft.valueSummary,
            input.draft.targetSummary, input.draft.description, legacyCityTagId,
            input.contentSafetyStatus, input.draft.deadlineAt],
        )
      }
      await syncCommercialTerms(tx, input.appId, opportunityId, input.draft.commercialTerms, version)
      await tx.query('DELETE FROM mip_opportunity_roles WHERE app_id = ? AND opportunity_id = ?', [input.appId, opportunityId])
      for (const roleKey of input.draft.roleKeys) {
        await tx.query(
          'INSERT INTO mip_opportunity_roles (app_id, opportunity_id, role_key) VALUES (?, ?, ?)',
          [input.appId, opportunityId, roleKey],
        )
      }
      await tx.query('DELETE FROM mip_opportunity_tags WHERE app_id = ? AND opportunity_id = ?', [input.appId, opportunityId])
      for (const tag of selectedTags) {
        await tx.query(
          `INSERT INTO mip_opportunity_tags (app_id, opportunity_id, tag_id, relation)
           VALUES (?, ?, ?, ?)`,
          [input.appId, opportunityId, tag.id, tag.kind],
        )
      }
      await writeAudit(tx, input.audit(opportunityId))
      return { id: opportunityId, status, version }
    })
  }

  async function publishOpportunity(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const current = await tx.one(
        `SELECT id, branch_id, status, version, content_safety_status, deadline_at
         FROM mip_opportunities WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.opportunityId],
      )
      if (!current) throw codeError('NOT_FOUND')
      const scope = ownedScope(current)
      assertScope(authorization, scope)
      if (!sameScope(scope, input.authorizedScope)) throw codeError('CONFLICT')
      if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (!['DRAFT', 'UNPUBLISHED'].includes(current.status)) throw codeError('INVALID_STATE')
      if (current.content_safety_status !== 'APPROVED') throw codeError('CONTENT_SAFETY_REQUIRED')
      if (current.deadline_at && new Date(current.deadline_at) <= now()) throw codeError('INVALID_STATE')
      const result = await tx.query(
        `UPDATE mip_opportunities SET status = 'PUBLISHED',
          published_at = COALESCE(published_at, UTC_TIMESTAMP(3)),
          moderated_at = UTC_TIMESTAMP(3), moderated_by_user_id = ?, moderation_reason = NULL,
          version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status IN ('DRAFT', 'UNPUBLISHED')`,
        [input.actorUserId, input.appId, input.opportunityId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit)
      return { id: input.opportunityId, status: 'PUBLISHED', version: input.expectedVersion + 1 }
    })
  }

  async function endOpportunity(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const current = await tx.one(
        `SELECT id, branch_id, status, version
         FROM mip_opportunities WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.opportunityId],
      )
      if (!current) throw codeError('NOT_FOUND')
      const scope = ownedScope(current)
      assertScope(authorization, scope)
      if (!sameScope(scope, input.authorizedScope)) throw codeError('CONFLICT')
      if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status !== 'PUBLISHED') throw codeError('INVALID_STATE')
      const result = await tx.query(
        `UPDATE mip_opportunities SET status = 'ENDED', ended_at = UTC_TIMESTAMP(3),
          moderated_at = UTC_TIMESTAMP(3), moderated_by_user_id = ?,
          moderation_reason = NULL, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'PUBLISHED'`,
        [input.actorUserId, input.appId, input.opportunityId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit)
      return { id: input.opportunityId, status: 'ENDED', version: input.expectedVersion + 1 }
    })
  }

  async function listGrowthLevelsV2(appId) {
    const [levels, relations] = await Promise.all([
      database.query(
        `SELECT level.id, level.level_key, level.name, level.display_badge,
          level.minimum_experience, level.sort_order, level.benefits_json,
          level.status, level.version,
          (SELECT COUNT(*) FROM mip_users user
           LEFT JOIN mip_growth_accounts account
             ON account.app_id = user.app_id AND account.user_id = user.id
           WHERE user.app_id = level.app_id AND user.status = 'ACTIVE'
             AND level.id = (
               SELECT current_level.id FROM mip_growth_levels current_level
               WHERE current_level.app_id = user.app_id AND current_level.status = 'ACTIVE'
                 AND current_level.minimum_experience <= COALESCE(account.experience_balance, 0)
               ORDER BY current_level.minimum_experience DESC, current_level.id DESC LIMIT 1
             )) AS current_user_count,
          (SELECT COUNT(*) FROM mip_users active_user
           WHERE active_user.app_id = level.app_id AND active_user.status = 'ACTIVE') AS active_user_count
         FROM mip_growth_levels level
         WHERE level.app_id = ? ORDER BY level.sort_order, level.minimum_experience, level.id`,
        [appId],
      ),
      database.query(
        `SELECT relation.level_id, benefit.id, benefit.name, benefit.description,
          benefit.sort_order, benefit.status, benefit.version
         FROM mip_growth_level_benefits relation
         INNER JOIN mip_growth_benefits benefit
           ON benefit.app_id = relation.app_id AND benefit.id = relation.benefit_id
         WHERE relation.app_id = ? ORDER BY relation.level_id, relation.sort_order, benefit.id`,
        [appId],
      ),
    ])
    const byLevel = new Map()
    for (const relation of relations) {
      const items = byLevel.get(relation.level_id) || []
      items.push({
        id: relation.id, name: relation.name, description: relation.description || '',
        sortOrder: Number(relation.sort_order), status: relation.status, version: Number(relation.version),
      })
      byLevel.set(relation.level_id, items)
    }
    return levels.map(row => ({
      id: row.id,
      levelKey: row.level_key,
      name: row.name,
      displayBadge: row.display_badge || '',
      minimumExperience: Number(row.minimum_experience),
      sortOrder: Number(row.sort_order),
      benefits: byLevel.get(row.id) || [],
      legacyBenefits: json(row.benefits_json, []),
      status: row.status,
      version: Number(row.version),
      currentUserCount: Number(row.current_user_count || 0),
      currentUserPercentage: Number(row.active_user_count || 0)
        ? Math.round(Number(row.current_user_count || 0) * 10000 / Number(row.active_user_count)) / 100
        : 0,
    }))
  }

  async function listGrowthBenefits(appId) {
    const rows = await database.query(
      `SELECT id, name, description, sort_order, status, version
       FROM mip_growth_benefits WHERE app_id = ? ORDER BY sort_order, id`,
      [appId],
    )
    return rows.map(row => ({
      id: row.id, name: row.name, description: row.description || '',
      sortOrder: Number(row.sort_order), status: row.status, version: Number(row.version),
    }))
  }

  async function saveGrowthBenefit(input) {
    return database.transaction(async (tx) => {
      await lockMutation(tx, input).then(auth => assertScope(auth, { scopeType: 'PLATFORM', scopeId: null }))
      const benefitId = input.benefitId || id()
      if (input.benefitId) {
        const current = await tx.one(
          'SELECT version FROM mip_growth_benefits WHERE app_id = ? AND id = ? FOR UPDATE',
          [input.appId, benefitId],
        )
        if (!current) throw codeError('NOT_FOUND')
        if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
        const result = await tx.query(
          `UPDATE mip_growth_benefits SET name = ?, description = ?, sort_order = ?, status = ?,
            version = version + 1 WHERE app_id = ? AND id = ? AND version = ?`,
          [input.draft.name, input.draft.description, input.draft.sortOrder, input.draft.status,
            input.appId, benefitId, input.expectedVersion],
        )
        if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        await tx.query(
          `INSERT INTO mip_growth_benefits (id, app_id, name, description, sort_order, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [benefitId, input.appId, input.draft.name, input.draft.description,
            input.draft.sortOrder, input.draft.status],
        )
      }
      await writeAudit(tx, input.audit(benefitId))
      return { id: benefitId, version: input.benefitId ? input.expectedVersion + 1 : 1 }
    })
  }

  async function saveGrowthLevelV2(input) {
    return database.transaction(async (tx) => {
      await lockMutation(tx, input).then(auth => assertScope(auth, { scopeType: 'PLATFORM', scopeId: null }))
      const levelId = input.levelId || id()
      const rows = await tx.query(
        `SELECT id, minimum_experience, benefits_json, status, version FROM mip_growth_levels
         WHERE app_id = ? ORDER BY minimum_experience, id FOR UPDATE`,
        [input.appId],
      )
      const current = rows.find(row => row.id === levelId)
      if (input.levelId) {
        if (!current) throw codeError('NOT_FOUND')
        if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
      }
      const projection = rows.filter(row => row.id !== levelId).map(row => ({
        minimumExperience: Number(row.minimum_experience), status: row.status,
      }))
      projection.push({ minimumExperience: input.draft.minimumExperience, status: input.draft.status })
      const active = projection.filter(item => item.status === 'ACTIVE').sort((a, b) => a.minimumExperience - b.minimumExperience)
      if (active.filter(item => item.minimumExperience === 0).length !== 1
        || active.some((item, index) => index > 0 && active[index - 1].minimumExperience >= item.minimumExperience)) {
        throw codeError('GROWTH_LEVEL_THRESHOLD_CONFLICT')
      }
      let benefits = []
      if (input.draft.benefitIds.length) {
        benefits = await tx.query(
          `SELECT id, name FROM mip_growth_benefits
           WHERE app_id = ? AND id IN (${placeholders(input.draft.benefitIds)}) FOR UPDATE`,
          [input.appId, ...input.draft.benefitIds],
        )
        if (new Set(benefits.map(item => item.id)).size !== input.draft.benefitIds.length) throw codeError('VALIDATION_FAILED')
      }
      const legacyBenefits = input.draft.benefitIds.length
        ? input.draft.benefitIds.map(benefitId => benefits.find(item => item.id === benefitId)?.name || '')
        : json(current?.benefits_json, [])
      if (input.levelId) {
        const result = await tx.query(
          `UPDATE mip_growth_levels SET name = ?, display_badge = ?, minimum_experience = ?,
            sort_order = ?, benefits_json = ?, status = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?`,
          [input.draft.name, input.draft.displayBadge, input.draft.minimumExperience,
            input.draft.sortOrder, JSON.stringify(legacyBenefits), input.draft.status,
            input.appId, levelId, input.expectedVersion],
        )
        if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        await tx.query(
          `INSERT INTO mip_growth_levels (
            id, app_id, level_key, name, display_badge, minimum_experience,
            sort_order, benefits_json, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [levelId, input.appId, input.draft.levelKey, input.draft.name, input.draft.displayBadge,
            input.draft.minimumExperience, input.draft.sortOrder, JSON.stringify(legacyBenefits), input.draft.status],
        )
      }
      await tx.query('DELETE FROM mip_growth_level_benefits WHERE app_id = ? AND level_id = ?', [input.appId, levelId])
      for (const [sortOrder, benefitId] of input.draft.benefitIds.entries()) {
        await tx.query(
          `INSERT INTO mip_growth_level_benefits (app_id, level_id, benefit_id, sort_order)
           VALUES (?, ?, ?, ?)`,
          [input.appId, levelId, benefitId, sortOrder],
        )
      }
      await writeAudit(tx, input.audit(levelId))
      return { id: levelId, version: input.levelId ? input.expectedVersion + 1 : 1 }
    })
  }

  async function archiveEvent(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const row = await tx.one(
        `SELECT id, branch_id, status, version FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!row) throw codeError('NOT_FOUND')
      const scope = eventScope(row)
      assertScope(authorization, scope)
      if (!sameScope(scope, input.authorizedScope)) throw codeError('CONFLICT')
      const operation = 'admin.events.archive'
      const idempotency = await claimOptional(tx, input, operation, {
        eventId: input.eventId,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }, id)
      if (idempotency.replay) return idempotency.replay
      if (Number(row.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (row.status !== 'DRAFT') throw codeError('INVALID_STATE')
      const blockers = await tx.one(
        `SELECT
          (SELECT COUNT(*) FROM mip_event_registrations r WHERE r.app_id = ? AND r.event_id = ?) AS registrations,
          (SELECT COUNT(*) FROM mip_orders o WHERE o.app_id = ? AND o.order_type = 'EVENT' AND o.resource_id = ?) AS orders,
          (SELECT COUNT(*) FROM mip_event_checkins c WHERE c.app_id = ? AND c.event_id = ?) AS checkins,
          (SELECT COUNT(*) FROM mip_event_album_photos p WHERE p.app_id = ? AND p.event_id = ?) AS album_photos`,
        [input.appId, input.eventId, input.appId, input.eventId,
          input.appId, input.eventId, input.appId, input.eventId],
      )
      const details = {
        registrations: Number(blockers?.registrations || 0),
        orders: Number(blockers?.orders || 0),
        checkins: Number(blockers?.checkins || 0),
        albumPhotos: Number(blockers?.album_photos || 0),
      }
      if (Object.values(details).some(value => value > 0)) throw codeError('EVENT_ARCHIVE_BLOCKED', details)
      const result = await tx.query(
        `UPDATE mip_events SET status = 'ARCHIVED', archived_at = UTC_TIMESTAMP(3),
          archived_by_user_id = ?, archive_reason = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'DRAFT'`,
        [input.actorUserId, input.reason, input.appId, input.eventId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit)
      const response = { id: input.eventId, status: 'ARCHIVED', version: input.expectedVersion + 1 }
      await complete(tx, input, operation, idempotency.requestHash, response)
      return response
    })
  }

  async function listRosterAll(appId, visibility, filters, pageLimit, cursor = null) {
    const access = visibilityWhere(visibility, 'e', { includeEvents: true })
    const clauses = ['r.app_id = ?', access.sql]
    const params = [appId, ...access.params]
    if (filters.eventId) { clauses.push('r.event_id = ?'); params.push(filters.eventId) }
    if (filters.branchId) { clauses.push('e.branch_id = ?'); params.push(filters.branchId) }
    if (filters.status) { clauses.push('r.status = ?'); params.push(filters.status) }
    if (filters.query) { clauses.push("(p.nickname LIKE ? ESCAPE '\\\\' OR e.title LIKE ? ESCAPE '\\\\')"); const query = `%${escapeLike(filters.query)}%`; params.push(query, query) }
    if (filters.createdFrom) { clauses.push('r.created_at >= ?'); params.push(filters.createdFrom) }
    if (filters.createdTo) { clauses.push('r.created_at <= ?'); params.push(filters.createdTo) }
    const cursorWhere = cursorPredicateFor('r.created_at', cursor, 'submittedAt', 'r.id')
    const rows = await database.query(
      `SELECT r.id, r.event_id, e.title AS event_title, e.branch_id, b.name AS branch_name,
        r.user_id, r.status, r.answers_json, r.created_at, r.registered_at, r.version,
        e.registration_schema_json,
        p.nickname, b.city_name, pp.phone_ciphertext, pp.phone_verified_at, c.checked_in_at
       FROM mip_event_registrations r
       INNER JOIN mip_events e ON e.app_id = r.app_id AND e.id = r.event_id
       LEFT JOIN mip_city_branches b ON b.app_id = e.app_id AND b.id = e.branch_id
       LEFT JOIN mip_profiles p ON p.app_id = r.app_id AND p.user_id = r.user_id
       LEFT JOIN mip_private_profiles pp ON pp.app_id = r.app_id AND pp.user_id = r.user_id
       LEFT JOIN mip_event_checkins c ON c.app_id = r.app_id AND c.registration_id = r.id AND c.status = 'ACTIVE'
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql}
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.event_title,
      branchId: row.branch_id || null,
      branchName: row.branch_name || '',
      userId: row.user_id,
      nickname: row.nickname || '未填写昵称',
      cityName: row.city_name || '',
      status: row.status,
      answers: json(row.answers_json, {}),
      answerItems: registrationAnswerItems(row.registration_schema_json, row.answers_json),
      phoneBound: Boolean(row.phone_verified_at),
      phoneCiphertext: row.phone_ciphertext || null,
      submittedAt: iso(row.created_at),
      registeredAt: iso(row.registered_at),
      checkedInAt: iso(row.checked_in_at),
      version: Number(row.version),
    }))
    return pageRows(items, pageLimit, row => ({ submittedAt: row.submittedAt, id: row.id }))
  }

  async function getUserRelatedRecords(appId, userId) {
    const [cases, opportunities, registrations, orders] = await Promise.all([
      database.query(
        `SELECT id, project_name, summary, status, updated_at FROM mip_super_cases
         WHERE app_id = ? AND owner_user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 50`,
        [appId, userId],
      ),
      database.query(
        `SELECT id, title, status, updated_at FROM mip_opportunities
         WHERE app_id = ? AND owner_user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 50`,
        [appId, userId],
      ),
      database.query(
        `SELECT r.id, r.event_id, e.title, r.status, r.created_at
         FROM mip_event_registrations r
         INNER JOIN mip_events e ON e.app_id = r.app_id AND e.id = r.event_id
         WHERE r.app_id = ? AND r.user_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 50`,
        [appId, userId],
      ),
      database.query(
        `SELECT o.id, o.order_type, o.status, o.amount_cents, o.currency, o.merchant_order_no,
          COALESCE(e.title, plan.name, '业务订单') AS resource_title, o.created_at
         FROM mip_orders o
         LEFT JOIN mip_events e ON e.app_id = o.app_id AND o.order_type = 'EVENT' AND e.id = o.resource_id
         LEFT JOIN mip_membership_plans plan ON plan.app_id = o.app_id AND o.order_type = 'MEMBERSHIP' AND plan.id = o.membership_plan_id
         WHERE o.app_id = ? AND o.user_id = ? ORDER BY o.created_at DESC, o.id DESC LIMIT 50`,
        [appId, userId],
      ),
    ])
    return {
      superCases: cases.map(row => ({ id: row.id, title: row.project_name, summary: row.summary, status: row.status, updatedAt: iso(row.updated_at) })),
      opportunities: opportunities.map(row => ({ id: row.id, title: row.title, status: row.status, updatedAt: iso(row.updated_at) })),
      registrations: registrations.map(row => ({ id: row.id, eventId: row.event_id, title: row.title, status: row.status, createdAt: iso(row.created_at) })),
      orders: orders.map(row => ({
        id: row.id, orderType: row.order_type, title: row.resource_title, status: row.status,
        amountCents: Number(row.amount_cents), currency: row.currency,
        merchantOrderNoMasked: maskMerchantNo(row.merchant_order_no), createdAt: iso(row.created_at),
      })),
    }
  }

  function maskMerchantNo(value) {
    const text = String(value || '')
    return text.length <= 8 ? text : `${text.slice(0, 4)}…${text.slice(-4)}`
  }

  function displayAnswer(value) {
    if (typeof value === 'boolean') return value ? '是' : '否'
    if (typeof value === 'string') return value
    if (value === null || value === undefined) return ''
    try { return JSON.stringify(value) }
    catch { return String(value) }
  }

  function registrationAnswerItems(schemaValue, answersValue) {
    const schema = json(schemaValue, [])
    const answers = json(answersValue, {})
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return []
    const labels = new Map(
      (Array.isArray(schema) ? schema : [])
        .filter(field => field && typeof field === 'object' && !Array.isArray(field)
          && typeof field.key === 'string' && typeof field.label === 'string')
        .map(field => [field.key, field.label]),
    )
    return Object.entries(answers).map(([key, value]) => ({
      key,
      label: labels.get(key) || key,
      value: displayAnswer(value),
    }))
  }

  return {
    archiveEvent,
    endOpportunity,
    getOpportunityDetail,
    getOpportunityEditorOptions,
    getUserRelatedRecords,
    listGrowthBenefits,
    listGrowthLevelsV2,
    listOpportunitiesV2,
    listRosterAll,
    publishOpportunity,
    saveGrowthBenefit,
    saveGrowthLevelV2,
    saveOpportunity,
  }
}

module.exports = { createAdminPrdExtensions }
