'use strict'

const { createHash, randomBytes, randomUUID } = require('node:crypto')
const { createAnnouncementRepository } = require('./announcements')
const { createFullAccessPolicy } = require('./full-access')
const { assertFixedGrowthRuleUpdate } = require('./growth-rule-catalog')
const { createOpportunityArchiveRepository } = require('./opportunity-archive')
const { listOperationalExceptions: readOperationalExceptions } = require('./operational-exceptions')
const { createOperationsPublisher } = require('./operations-publication')
const { cursorPredicateFor, pageRows } = require('./pagination')
const {
  assertMutationAuthorization,
  assertMutationScope,
  lockMutationAuthorization,
} = require('./mutation-authorization')

function json(value, fallback = {}) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(value) }
  catch { return fallback }
}

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function userScopeFromRow(row) {
  return {
    scopeType: row.primary_branch_id ? 'BRANCH' : 'PLATFORM',
    scopeId: row.primary_branch_id || null,
  }
}

function eventScopeFromRow(row, eventId = row.id) {
  return {
    scopeType: 'EVENT',
    scopeId: eventId,
    branchId: row.branch_id || null,
  }
}

function ownedResourceScopeFromRow(row) {
  return {
    scopeType: row.branch_id ? 'BRANCH' : 'PLATFORM',
    scopeId: row.branch_id || null,
  }
}

function draftResourceScope(draft) {
  return {
    scopeType: draft.scopeType,
    scopeId: draft.scopeType === 'BRANCH' ? draft.branchId : null,
  }
}

function sameScope(left, right) {
  return left?.scopeType === right?.scopeType
    && (left?.scopeId || null) === (right?.scopeId || null)
    && (left?.scopeType !== 'EVENT'
      || (left?.branchId || null) === (right?.branchId || null))
}

function assertAuthorizedScope(currentScope, authorizedScope) {
  if (authorizedScope && !sameScope(currentScope, authorizedScope)) throw codeError('CONFLICT')
}

function assertAuthorizedUserScope(row, authorizedScope) {
  if (!sameScope(userScopeFromRow(row), authorizedScope)) throw codeError('CONFLICT')
}

function growthLevelProjection(rows, levelId, draft) {
  const next = rows.map(row => row.id === levelId
    ? { id: levelId, minimumExperience: draft.minimumExperience, status: draft.status }
    : {
        id: row.id,
        minimumExperience: Number(row.minimum_experience),
        status: row.status,
      })
  if (!rows.some(row => row.id === levelId)) {
    next.push({ id: levelId, minimumExperience: draft.minimumExperience, status: draft.status })
  }
  return next
}

function assertGrowthLevels(levels) {
  const active = levels
    .filter(level => level.status === 'ACTIVE')
    .sort((left, right) => left.minimumExperience - right.minimumExperience)
  for (let index = 1; index < active.length; index += 1) {
    if (active[index - 1].minimumExperience >= active[index].minimumExperience) {
      throw codeError('GROWTH_LEVEL_THRESHOLD_CONFLICT')
    }
  }
  if (active.filter(level => level.minimumExperience === 0).length !== 1) {
    throw codeError('GROWTH_BASE_LEVEL_REQUIRED')
  }
}

function growthRuleProjection(rows, ruleId, draft) {
  const next = rows.map(row => row.id === ruleId
    ? {
        id: ruleId,
        metric: draft.metric,
        sourceEventType: draft.sourceEventType,
        status: draft.status,
      }
    : {
        id: row.id,
        metric: row.metric,
        sourceEventType: row.source_event_type,
        status: row.status,
      })
  if (!rows.some(row => row.id === ruleId)) {
    next.push({
      id: ruleId,
      metric: draft.metric,
      sourceEventType: draft.sourceEventType,
      status: draft.status,
    })
  }
  return next
}

function assertGrowthRules(rules) {
  const activeKeys = new Set()
  for (const rule of rules) {
    if (rule.status !== 'ACTIVE') continue
    const key = `${rule.sourceEventType}\0${rule.metric}`
    if (activeKeys.has(key)) throw codeError('GROWTH_RULE_ACTIVE_CONFLICT')
    activeKeys.add(key)
  }
}

function duplicateConstraint(error) {
  if (error?.code !== 'ER_DUP_ENTRY' && Number(error?.errno) !== 1062) return ''
  return `${error?.message || ''} ${error?.sqlMessage || ''}`
}

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

function communityReportParty(row, prefix) {
  const visibility = json(row[`${prefix}_visibility_json`], {})
  return {
    nickname: visibility.nickname === false
      ? 'MIP 用户'
      : (row[`${prefix}_nickname`] || 'MIP 用户'),
    headline: visibility.headline === false ? '' : (row[`${prefix}_headline`] || ''),
    cityName: visibility.primaryBranch === false ? '' : (row[`${prefix}_city_name`] || ''),
  }
}

function communityReportDto(row) {
  return {
    reportId: String(row.id),
    category: row.category,
    description: row.description || '',
    status: row.status,
    version: Number(row.version),
    reporter: communityReportParty(row, 'reporter'),
    target: communityReportParty(row, 'target'),
    resolutionReason: row.resolution_reason || '',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    reviewedAt: iso(row.reviewed_at),
  }
}

function eventAlbumPhotoDto(row) {
  const visibility = json(row.visibility_json, {})
  return {
    id: String(row.id),
    caption: row.caption || '',
    imageUrl: row.asset_status === 'READY' ? (row.cloud_file_id || '') : '',
    nickname: visibility.nickname === false ? '活动参与者' : (row.nickname || '活动参与者'),
    avatarUrl: visibility.avatar === false ? '' : (row.avatar_file_id || ''),
    status: row.status,
    moderationReason: row.moderation_reason || '',
    version: Number(row.version),
    createdAt: iso(row.created_at),
    reviewedAt: iso(row.reviewed_at),
    publishedAt: iso(row.published_at),
  }
}

function eventAlbumAssetReady(row) {
  return row.asset_status === 'READY'
    && row.asset_purpose === 'EVENT_ALBUM'
    && /^image\/(?:png|jpeg)$/.test(row.asset_content_type || '')
    && /^[0-9a-f]{64}$/.test(row.asset_content_sha256 || '')
    && Number(row.asset_content_bytes) > 0
    && Number(row.asset_width_px) > 0
    && Number(row.asset_height_px) > 0
    && typeof row.asset_cloud_file_id === 'string'
    && row.asset_cloud_file_id.startsWith('cloud://')
    && typeof row.asset_object_key === 'string'
    && /^mip\/(?:development|test|staging|production)\//.test(row.asset_object_key)
    && !row.asset_object_key.includes('..')
}

function communityReportSelect(where, suffix = '') {
  return `SELECT r.id, r.category, r.description, r.status, r.version,
      r.resolution_reason, r.created_at, r.updated_at, r.reviewed_at,
      reporter_profile.nickname AS reporter_nickname,
      reporter_profile.headline AS reporter_headline,
      reporter_profile.visibility_json AS reporter_visibility_json,
      reporter_branch.city_name AS reporter_city_name,
      target_profile.nickname AS target_nickname,
      target_profile.headline AS target_headline,
      target_profile.visibility_json AS target_visibility_json,
      target_branch.city_name AS target_city_name
    FROM mip_reports r
    INNER JOIN mip_users reporter_user
      ON reporter_user.app_id = r.app_id AND reporter_user.id = r.reporter_user_id
    LEFT JOIN mip_profiles reporter_profile
      ON reporter_profile.app_id = reporter_user.app_id AND reporter_profile.user_id = reporter_user.id
    LEFT JOIN mip_city_branches reporter_branch
      ON reporter_branch.app_id = reporter_user.app_id
        AND reporter_branch.id = reporter_user.primary_branch_id
        AND reporter_branch.status = 'ACTIVE'
    INNER JOIN mip_users target_user
      ON target_user.app_id = r.app_id AND target_user.id = r.target_user_id
    LEFT JOIN mip_profiles target_profile
      ON target_profile.app_id = target_user.app_id AND target_profile.user_id = target_user.id
    LEFT JOIN mip_city_branches target_branch
      ON target_branch.app_id = target_user.app_id
        AND target_branch.id = target_user.primary_branch_id
        AND target_branch.status = 'ACTIVE'
    WHERE ${where} ${suffix}`
}

async function assertEventCover(tx, input, currentCoverId) {
  const coverAssetId = input.draft.coverAssetId
  if (!coverAssetId) return
  const unchanged = Boolean(currentCoverId) && currentCoverId === coverAssetId
  const asset = await tx.one(
    `SELECT id FROM mip_media_assets
     WHERE app_id = ? AND id = ?
       ${unchanged ? '' : 'AND owner_user_id = ?'}
       AND purpose = 'EVENT_COVER' AND status = 'READY'
     FOR UPDATE`,
    unchanged
      ? [input.appId, coverAssetId]
      : [input.appId, coverAssetId, input.actorUserId],
  )
  if (!asset) throw codeError('VALIDATION_FAILED')
}

function createAdminRepository(database, options = {}) {
  const id = options.id || randomUUID
  const bytes = options.randomBytes || randomBytes
  const now = options.now || (() => new Date())
  const authorizeMutation = options.authorizeMutation || assertMutationAuthorization
  const lockMutation = options.lockMutation || lockMutationAuthorization
  const assertScope = options.assertMutationScope || assertMutationScope
  const fullAccess = options.fullAccessPolicy || createFullAccessPolicy({
    agreements: options.agreements,
  })
  const announcementRepository = createAnnouncementRepository(database, {
    authorizeMutation,
    assertScope,
    id,
    lockMutation,
    now,
  })
  const opportunityArchiveRepository = createOpportunityArchiveRepository(database, {
    assertScope,
    lockMutation,
    now,
  })
  const operationsPublisher = createOperationsPublisher({
    assertMutationScope: assertScope,
    createId: id,
    lockMutationAuthorization: lockMutation,
    maximumRecipients: options.maximumEventReminderRecipients,
    writeAudit,
  })

  async function health() {
    const row = await database.one('SELECT 1 AS ok')
    if (Number(row?.ok) !== 1) throw codeError('DATABASE_UNAVAILABLE')
    return true
  }

  async function listOperationalExceptions(appId, filters) {
    return readOperationalExceptions(database, {
      appId,
      ...filters,
      now: now(),
    })
  }

  async function resolveUser(caller) {
    return fullAccess.loadByIdentity(database, caller)
  }

  async function listRoleBindings(appId, userId) {
    const rows = await database.query(
      `SELECT scope_type, scope_id, role_key
       FROM mip_admin_role_bindings
       WHERE app_id = ? AND user_id = ? AND status = 'ACTIVE'
       ORDER BY scope_type, scope_id, role_key`,
      [appId, userId],
    )
    return rows.map(row => ({
      scopeType: row.scope_type,
      scopeId: row.scope_type === 'PLATFORM' ? null : row.scope_id,
      roleKey: row.role_key,
    }))
  }

  function visibleEventsWhere(visibility, alias = 'e') {
    if (visibility.platform) return { sql: '1 = 1', params: [] }
    const clauses = []
    const params = []
    if (visibility.branchIds.length) {
      clauses.push(`${alias}.branch_id IN (${placeholders(visibility.branchIds)})`)
      params.push(...visibility.branchIds)
    }
    if (visibility.eventIds.length) {
      clauses.push(`${alias}.id IN (${placeholders(visibility.eventIds)})`)
      params.push(...visibility.eventIds)
    }
    return { sql: clauses.length ? `(${clauses.join(' OR ')})` : '0 = 1', params }
  }

  function visibleBranchesWhere(visibility, alias = 'u') {
    if (visibility.platform) return { sql: '1 = 1', params: [] }
    if (!visibility.branchIds.length) return { sql: '0 = 1', params: [] }
    return {
      sql: `${alias}.primary_branch_id IN (${placeholders(visibility.branchIds)})`,
      params: [...visibility.branchIds],
    }
  }

  async function dashboard(appId, visibility) {
    const events = visibleEventsWhere(visibility.events || visibility)
    const users = visibleBranchesWhere(visibility.users || visibility)
    const orders = visibility.orders || visibility
    const opportunities = visibility.opportunities || visibility
    const [userCounts, eventCounts, orderCounts, opportunityCounts] = await Promise.all([
      database.one(
        `SELECT COUNT(*) AS total_users,
          SUM(CASE WHEN u.created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS new_users_7d,
          SUM(CASE WHEN EXISTS (
            SELECT 1 FROM mip_membership_entitlements me
            WHERE me.app_id = u.app_id AND me.user_id = u.id AND me.status = 'ACTIVE'
              AND me.starts_at <= UTC_TIMESTAMP(3) AND me.ends_at > UTC_TIMESTAMP(3)
          ) THEN 1 ELSE 0 END) AS active_players
         FROM mip_users u WHERE u.app_id = ? AND ${users.sql}`,
        [appId, ...users.params],
      ),
      database.one(
        `SELECT COUNT(e.id) AS total_events,
          SUM(CASE WHEN e.status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published_events,
          COALESCE(SUM((
            SELECT COUNT(*) FROM mip_event_registrations r
            WHERE r.app_id = e.app_id AND r.event_id = e.id AND r.status = 'PENDING_REVIEW'
          )), 0) AS pending_registrations
         FROM mip_events e
         WHERE e.app_id = ? AND ${events.sql}`,
        [appId, ...events.params],
      ),
      listOrderSummary(appId, orders),
      database.one(
        `SELECT COUNT(*) AS total_opportunities,
          SUM(CASE WHEN o.status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published_opportunities
         FROM mip_opportunities o
         WHERE o.app_id = ? ${opportunities.platform
          ? ''
          : opportunities.branchIds.length
            ? `AND o.branch_id IN (${placeholders(opportunities.branchIds)})`
            : 'AND 0 = 1'}`,
        [appId, ...(opportunities.platform ? [] : opportunities.branchIds)],
      ),
    ])
    return {
      totalUsers: Number(userCounts?.total_users || 0),
      newUsers7d: Number(userCounts?.new_users_7d || 0),
      activePlayers: Number(userCounts?.active_players || 0),
      totalEvents: Number(eventCounts?.total_events || 0),
      publishedEvents: Number(eventCounts?.published_events || 0),
      pendingRegistrations: Number(eventCounts?.pending_registrations || 0),
      paidOrders: Number(orderCounts.paidOrders || 0),
      pendingRefunds: Number(orderCounts.pendingRefunds || 0),
      totalOpportunities: Number(opportunityCounts?.total_opportunities || 0),
      publishedOpportunities: Number(opportunityCounts?.published_opportunities || 0),
    }
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
      const branchId = id()
      try {
        await tx.query(
          `INSERT INTO mip_city_branches (
            id, app_id, branch_key, name, city_name, summary, status, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
          [branchId, input.appId, input.branchKey, input.name, input.cityName,
            input.summary || null, input.actorUserId],
        )
      }
      catch (error) {
        const constraint = duplicateConstraint(error)
        if (constraint.includes('mip_city_branches_key_uk')) throw codeError('BRANCH_KEY_CONFLICT')
        if (constraint) throw codeError('CONFLICT')
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
      if (!current) throw codeError('NOT_FOUND')
      if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
      const updated = await tx.query(
        `UPDATE mip_city_branches SET name = ?, city_name = ?, summary = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [input.name, input.cityName, input.summary || null,
          input.appId, input.branchId, input.expectedVersion],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
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
      if (!current) throw codeError('NOT_FOUND')
      if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status === input.status) throw codeError('INVALID_STATE')
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
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
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

  async function listCommunityReports(appId, status, pageLimit) {
    const clauses = ['r.app_id = ?']
    const params = [appId]
    if (status) {
      clauses.push('r.status = ?')
      params.push(status)
    }
    const rows = await database.query(
      communityReportSelect(
        clauses.join(' AND '),
        'ORDER BY r.created_at DESC, r.id DESC LIMIT ?',
      ),
      [...params, pageLimit],
    )
    return rows.map(row => communityReportDto(row))
  }

  async function claimCommunityReport(input) {
    return database.transaction(async (tx) => {
      await authorizeMutation(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      const current = await lockCommunityReport(tx, input)
      if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status !== 'PENDING') throw codeError('INVALID_STATE')
      const updated = await tx.query(
        `UPDATE mip_reports
         SET status = 'REVIEWING', reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(3),
           version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'PENDING'`,
        [input.actorUserId, input.appId, input.reportId, input.expectedVersion],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit)
      return loadCommunityReport(tx, input.appId, input.reportId)
    })
  }

  async function closeCommunityReport(input) {
    return database.transaction(async (tx) => {
      await authorizeMutation(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      const current = await lockCommunityReport(tx, input)
      if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status !== 'REVIEWING') throw codeError('INVALID_STATE')
      const updated = await tx.query(
        `UPDATE mip_reports
         SET status = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(3),
           resolution_reason = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'REVIEWING'`,
        [input.outcome, input.actorUserId, input.reason,
          input.appId, input.reportId, input.expectedVersion],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit)
      return loadCommunityReport(tx, input.appId, input.reportId)
    })
  }

  async function lockCommunityReport(tx, input) {
    const report = await tx.one(
      `SELECT id, status, version FROM mip_reports
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [input.appId, input.reportId],
    )
    if (!report) throw codeError('NOT_FOUND')
    return report
  }

  async function loadCommunityReport(adapter, appId, reportId) {
    const row = await adapter.one(
      communityReportSelect('r.app_id = ? AND r.id = ?'),
      [appId, reportId],
    )
    if (!row) throw codeError('NOT_FOUND')
    return communityReportDto(row)
  }

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
        EXISTS (SELECT 1 FROM mip_membership_entitlements me
          WHERE me.app_id = u.app_id AND me.user_id = u.id AND me.status = 'ACTIVE'
            AND me.starts_at <= UTC_TIMESTAMP(3) AND me.ends_at > UTC_TIMESTAMP(3)) AS is_player,
        (SELECT GROUP_CONCAT(c.control_type ORDER BY c.control_type SEPARATOR ',')
          FROM mip_user_access_controls c
          WHERE c.app_id = u.app_id AND c.user_id = u.id AND c.status = 'ACTIVE') AS controls,
        u.updated_at
       FROM mip_users u
       LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
       LEFT JOIN mip_private_profiles pp ON pp.app_id = u.app_id AND pp.user_id = u.id
       LEFT JOIN mip_city_branches b ON b.app_id = u.app_id AND b.id = u.primary_branch_id
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
      visibility: json(row.visibility_json, {}),
      userVersion: Number(row.user_version || 1),
      profileVersion: Number(row.profile_version || 0),
      updatedAt: iso(row.updated_at),
    }))
    return pageRows(items, pageLimit, row => ({ updatedAt: row.updatedAt, id: row.id }))
  }

  async function getUserScope(appId, userId) {
    const row = await database.one(
      `SELECT id, primary_branch_id FROM mip_users WHERE app_id = ? AND id = ?`,
      [appId, userId],
    )
    return row ? { scopeType: row.primary_branch_id ? 'BRANCH' : 'PLATFORM', scopeId: row.primary_branch_id || null } : null
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
      if (!user) throw codeError('NOT_FOUND')
      assertScope(authorization, userScopeFromRow(user))
      assertAuthorizedUserScope(user, input.authorizedScope)
      if (user.status !== 'ACTIVE') throw codeError('INVALID_STATE')
      if (Number(user.profile_version || 0) !== input.expectedVersion) throw codeError('CONFLICT')
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
        if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      await writeAudit(tx, input.audit)
      return { userId: input.userId, version: input.expectedVersion + 1 }
    })
  }

  async function setUserControl(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const user = await tx.one(
        'SELECT id, status, primary_branch_id FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE',
        [input.appId, input.userId],
      )
      if (!user) throw codeError('NOT_FOUND')
      assertScope(authorization, userScopeFromRow(user))
      assertAuthorizedUserScope(user, input.authorizedScope)
      if (user.status === 'CLOSED') throw codeError('INVALID_STATE')
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
          [id(), input.appId, input.userId, input.controlType, input.reason,
            input.controlType === 'BLOCKLIST' ? user.status : null, input.actorUserId],
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

  async function lockExportAuthorizations(tx, input) {
    const primary = await lockMutation(tx, input)
    const phone = input.includesPhone
      ? await lockMutation(tx, { ...input, authorization: input.phoneAuthorization })
      : null
    return { phone, primary }
  }

  async function assertExportScope(tx, authorizations, descriptor) {
    const scopeType = descriptor.scope_type || descriptor.scopeType
    const scopeId = descriptor.scope_id || descriptor.scopeId || null
    let scope = { scopeType, scopeId }
    if (scopeType === 'EVENT') {
      const event = await tx.one(
        `SELECT id, branch_id FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [descriptor.app_id || descriptor.appId, scopeId],
      )
      if (!event) throw codeError('EXPORT_NOT_FOUND')
      scope = eventScopeFromRow(event, scopeId)
    }
    else if (scopeType === 'BRANCH') {
      const branch = await tx.one(
        `SELECT id FROM mip_city_branches
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [descriptor.app_id || descriptor.appId, scopeId],
      )
      if (!branch) throw codeError('EXPORT_NOT_FOUND')
    }
    assertScope(authorizations.primary, scope)
    assertAuthorizedScope(scope, descriptor.authorizedScope)
    if (descriptor.includes_phone !== undefined
      && (Number(descriptor.includes_phone) === 1) !== Boolean(descriptor.expectedIncludesPhone)) {
      throw codeError('CONFLICT')
    }
    if (descriptor.expectedIncludesPhone) {
      if (!authorizations.phone) throw codeError('FORBIDDEN')
      assertScope(authorizations.phone, scope)
    }
    return scope
  }

  async function authorizedExportTicket(tx, input) {
    const authorizations = await lockExportAuthorizations(tx, input)
    const row = await lockedExportTicket(tx, input)
    await assertExportScope(tx, authorizations, {
      ...row,
      expectedIncludesPhone: input.includesPhone,
      authorizedScope: input.authorizedScope,
    })
    return row
  }

  async function createExportTicket(input) {
    const ticketId = id()
    const token = bytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const appSegment = createHash('sha256').update(input.appId).digest('hex').slice(0, 16)
    const objectKey = `mip/exports/${appSegment}/${ticketId}.xlsx`
    const expiresAt = new Date(input.now.getTime() + 15 * 60 * 1000)
    await database.transaction(async (tx) => {
      const authorizations = await lockExportAuthorizations(tx, input)
      await assertExportScope(tx, authorizations, {
        appId: input.appId,
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeId,
        expectedIncludesPhone: input.includesPhone,
        authorizedScope: input.authorizedScope,
      })
      await tx.query(
        `INSERT INTO mip_admin_export_tickets (
          id, app_id, requested_by_user_id, export_type, scope_type, scope_id,
          filters_json, includes_phone, token_hash, object_key, status, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
        [ticketId, input.appId, input.actorUserId, input.exportType, input.scope.scopeType,
          input.scope.scopeId || null, JSON.stringify(input.filters), input.includesPhone ? 1 : 0,
          tokenHash, objectKey, expiresAt],
      )
      await writeAudit(tx, { ...input.audit, resourceId: ticketId })
    })
    return { ticketId, token, status: 'PENDING', expiresAt: expiresAt.toISOString() }
  }

  async function getExportTicket(input) {
    const row = await database.one(
      `SELECT id, app_id, requested_by_user_id, export_type, scope_type, scope_id,
        filters_json, includes_phone, object_key, cloud_file_id, content_sha256,
        content_bytes, row_count, status, reserved_until, expires_at, consumed_at,
        failed_reason_code, created_at
       FROM mip_admin_export_tickets
       WHERE app_id = ? AND id = ? AND requested_by_user_id = ? AND token_hash = ?`,
      [input.appId, input.ticketId, input.actorUserId, input.tokenHash],
    )
    if (!row) throw codeError('EXPORT_NOT_FOUND')
    return exportTicket(row)
  }

  async function claimExportBuild(input) {
    return database.transaction(async (tx) => {
      const row = await authorizedExportTicket(tx, input)
      const current = input.now
      if (row.expires_at <= current) {
        await expireExportRow(tx, row, input)
        throw codeError('EXPORT_EXPIRED')
      }
      if (row.status === 'READY') return { state: 'READY', ticket: exportTicket(row) }
      if (row.status === 'PENDING' && row.reserved_until && row.reserved_until > current) {
        return { state: 'BUSY', ticket: exportTicket(row) }
      }
      if (!['PENDING', 'FAILED'].includes(row.status)) throw exportStateError(row.status)
      const reservedUntil = input.reservedUntil
      await tx.query(
        `UPDATE mip_admin_export_tickets
         SET status = 'PENDING', reserved_until = ?, failed_reason_code = NULL
         WHERE app_id = ? AND id = ?`,
        [reservedUntil, input.appId, input.ticketId],
      )
      return {
        state: 'CLAIMED',
        reservedUntil: reservedUntil.toISOString(),
        ticket: exportTicket({ ...row, status: 'PENDING', reserved_until: reservedUntil, failed_reason_code: null }),
      }
    })
  }

  async function finishExportBuild(input) {
    return database.transaction(async (tx) => {
      const row = await authorizedExportTicket(tx, input)
      if (row.status !== 'PENDING'
        || !row.reserved_until
        || row.reserved_until.getTime() !== input.reservedUntil.getTime()
        || row.expires_at <= input.now) {
        throw codeError('EXPORT_LEASE_LOST')
      }
      const result = await tx.query(
        `UPDATE mip_admin_export_tickets
         SET cloud_file_id = ?, content_sha256 = ?, content_bytes = ?, row_count = ?,
           status = 'READY', reserved_until = NULL, failed_reason_code = NULL
         WHERE app_id = ? AND id = ? AND requested_by_user_id = ? AND token_hash = ?
           AND status = 'PENDING' AND reserved_until = ? AND expires_at > ?`,
        [input.fileId, input.contentSha256, input.contentBytes, input.rowCount,
          input.appId, input.ticketId, input.actorUserId, input.tokenHash,
          input.reservedUntil, input.now],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('EXPORT_LEASE_LOST')
      await writeAudit(tx, input.audit)
      return { status: 'READY', rowCount: input.rowCount }
    })
  }

  async function failExportBuild(input) {
    return database.transaction(async (tx) => {
      const row = await authorizedExportTicket(tx, input)
      if (row.status !== 'PENDING'
        || !row.reserved_until
        || row.reserved_until.getTime() !== input.reservedUntil.getTime()) {
        throw codeError('EXPORT_LEASE_LOST')
      }
      const result = await tx.query(
        `UPDATE mip_admin_export_tickets
         SET status = 'FAILED', reserved_until = NULL, failed_reason_code = ?
         WHERE app_id = ? AND id = ? AND requested_by_user_id = ? AND token_hash = ?
           AND status = 'PENDING' AND reserved_until = ?`,
        [input.reasonCode, input.appId, input.ticketId, input.actorUserId, input.tokenHash,
          input.reservedUntil],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('EXPORT_LEASE_LOST')
    })
  }

  async function issueExportDownload(input, issue) {
    if (typeof issue !== 'function') throw codeError('EXPORT_URL_UNAVAILABLE')
    return database.transaction(async (tx) => {
      const row = await authorizedExportTicket(tx, input)
      const current = input.now
      if (row.expires_at <= current) {
        await expireExportRow(tx, row, input)
        throw codeError('EXPORT_EXPIRED')
      }
      if (row.status === 'RESERVED' && row.reserved_until && row.reserved_until > current) {
        throw codeError('EXPORT_BUSY')
      }
      if (row.status === 'RESERVED') {
        await tx.query(
          `UPDATE mip_admin_export_tickets SET status = 'READY', reserved_until = NULL
           WHERE app_id = ? AND id = ? AND status = 'RESERVED'`,
          [input.appId, input.ticketId],
        )
        row.status = 'READY'
        row.reserved_until = null
      }
      if (row.status !== 'READY') throw exportStateError(row.status)

      const ticket = exportTicket(row)
      const issuance = await issue(ticket)
      if (issuance?.state === 'REVOKED'
        && issuance.reasonCode === 'EXPORT_INTEGRITY_FAILED') {
        const revoked = await tx.query(
          `UPDATE mip_admin_export_tickets SET status = 'REVOKED', reserved_until = NULL,
            failed_reason_code = 'EXPORT_INTEGRITY_FAILED'
           WHERE app_id = ? AND id = ? AND requested_by_user_id = ? AND token_hash = ?
             AND status = 'READY'`,
          [input.appId, input.ticketId, input.actorUserId, input.tokenHash],
        )
        if (Number(revoked.affectedRows) !== 1) throw codeError('EXPORT_LEASE_LOST')
        return {
          state: 'REVOKED',
          ticket: exportTicket({
            ...row,
            status: 'REVOKED',
            failed_reason_code: 'EXPORT_INTEGRITY_FAILED',
          }),
        }
      }
      if (issuance?.state !== 'ISSUED'
        || typeof issuance.value?.tempUrl !== 'string'
        || !/^https:\/\//.test(issuance.value.tempUrl)) {
        throw codeError('EXPORT_URL_UNAVAILABLE')
      }
      const reserved = await tx.query(
        `UPDATE mip_admin_export_tickets SET status = 'RESERVED', reserved_until = ?
         WHERE app_id = ? AND id = ? AND requested_by_user_id = ? AND token_hash = ?
           AND status = 'READY' AND expires_at > ?`,
        [input.reservedUntil, input.appId, input.ticketId, input.actorUserId, input.tokenHash,
          input.now],
      )
      if (Number(reserved.affectedRows) !== 1) throw codeError('EXPORT_LEASE_LOST')
      await writeAudit(tx, input.audit)
      return {
        state: 'RESERVED',
        ticket: exportTicket({
          ...row,
          status: 'RESERVED',
          reserved_until: input.reservedUntil,
        }),
        value: issuance.value,
      }
    }, 1)
  }

  async function consumeExportDownload(input) {
    return database.transaction(async (tx) => {
      const row = await authorizedExportTicket(tx, input)
      if (row.status === 'CONSUMED') throw codeError('EXPORT_CONSUMED')
      if (row.status !== 'RESERVED') throw exportStateError(row.status)
      if (!row.reserved_until || row.reserved_until <= input.now || row.expires_at <= input.now) {
        throw codeError('EXPORT_EXPIRED')
      }
      const result = await tx.query(
        `UPDATE mip_admin_export_tickets
         SET status = 'CONSUMED', consumed_at = ?, reserved_until = NULL
         WHERE app_id = ? AND id = ? AND status = 'RESERVED'`,
        [input.now, input.appId, input.ticketId],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('EXPORT_CONSUMED')
      await writeAudit(tx, input.audit)
      return { ...exportTicket({ ...row, status: 'CONSUMED', consumed_at: input.now }), consumedAt: input.now.toISOString() }
    })
  }

  async function listExportRows(ticket, maximumRows) {
    const visibility = exportVisibility(ticket)
    if (ticket.exportType === 'USERS') {
      return (await listUsers(ticket.appId, visibility, ticket.filters, maximumRows)).items
    }
    if (ticket.exportType === 'EVENT_ROSTER') {
      return (await listRoster(ticket.appId, ticket.scopeId, ticket.filters, maximumRows)).items
    }
    if (ticket.exportType === 'EVENT_ORDERS' || ticket.exportType === 'ORDERS') {
      return (await listOrders(ticket.appId, visibility, {
        ...ticket.filters,
        eventId: ticket.exportType === 'EVENT_ORDERS' ? ticket.scopeId : ticket.filters.eventId,
      }, maximumRows)).items
    }
    if (ticket.exportType === 'GROWTH_ENTRIES') {
      return (await listGrowthEntries(ticket.appId, visibility, ticket.filters, maximumRows)).items
    }
    throw codeError('EXPORT_TYPE_INVALID')
  }

  async function getEventScope(appId, eventId) {
    const row = await database.one(
      'SELECT id, scope_type, branch_id, status, version, content_safety_status FROM mip_events WHERE app_id = ? AND id = ?',
      [appId, eventId],
    )
    return row ? {
      scopeType: 'EVENT',
      scopeId: row.id,
      branchId: row.branch_id || null,
      eventScopeType: row.scope_type,
      status: row.status,
      version: Number(row.version),
      contentSafetyStatus: row.content_safety_status,
    } : null
  }

  async function getOpportunityScope(appId, opportunityId) {
    const row = await database.one(
      'SELECT id, branch_id, version, status FROM mip_opportunities WHERE app_id = ? AND id = ?',
      [appId, opportunityId],
    )
    return row ? {
      scopeType: row.branch_id ? 'BRANCH' : 'PLATFORM',
      scopeId: row.branch_id || null,
      branchId: row.branch_id || null,
      version: Number(row.version),
      status: row.status,
    } : null
  }

  async function getOrderScope(appId, orderId) {
    const row = await database.one(
      `SELECT o.id, o.order_type, o.resource_id, e.branch_id
       FROM mip_orders o
       LEFT JOIN mip_events e ON e.app_id = o.app_id AND e.id = o.resource_id
       WHERE o.app_id = ? AND o.id = ?`,
      [appId, orderId],
    )
    if (!row) return null
    if (row.order_type === 'EVENT') {
      return { scopeType: 'EVENT', scopeId: row.resource_id, branchId: row.branch_id || null }
    }
    return { scopeType: 'PLATFORM', scopeId: null, branchId: null }
  }

  async function getRefundScope(appId, refundId) {
    const row = await database.one(
      `SELECT r.id, r.status AS refund_status, o.order_type, o.resource_id, e.branch_id
       FROM mip_refunds r
       JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id
       LEFT JOIN mip_events e ON e.app_id = o.app_id AND e.id = o.resource_id
       WHERE r.app_id = ? AND r.id = ?`,
      [appId, refundId],
    )
    if (!row) return null
    return {
      scopeType: row.order_type === 'EVENT' ? 'EVENT' : 'PLATFORM',
      scopeId: row.order_type === 'EVENT' ? row.resource_id : null,
      branchId: row.branch_id || null,
      refundStatus: row.refund_status,
    }
  }

  async function recordAudit(audit) {
    return database.transaction(tx => writeAudit(tx, audit))
  }

  async function listEvents(appId, visibility, filters, pageLimit, cursor = null) {
    const visible = visibleEventsWhere(visibility)
    const clauses = ['e.app_id = ?', visible.sql]
    const params = [appId, ...visible.params]
    if (filters.status) {
      clauses.push('e.status = ?')
      params.push(filters.status)
    }
    if (filters.query) {
      clauses.push('e.title LIKE ? ESCAPE \'\\\\\'')
      params.push(`%${escapeLike(filters.query)}%`)
    }
    const cursorWhere = cursorPredicateFor('e.starts_at', cursor, 'startsAt', 'e.id')
    const rows = await database.query(
      `SELECT e.id, e.title, e.summary, e.scope_type, e.branch_id, b.name AS branch_name,
        e.status, e.content_safety_status, e.starts_at, e.ends_at, e.city_name,
        e.access_type, e.registration_policy, e.album_enabled, e.album_submission_policy,
        e.capacity, e.version,
        COUNT(r.id) AS registration_count,
        SUM(CASE WHEN r.status = 'ATTENDED' THEN 1 ELSE 0 END) AS attended_count
       FROM mip_events e
       LEFT JOIN mip_city_branches b ON b.app_id = e.app_id AND b.id = e.branch_id
       LEFT JOIN mip_event_registrations r ON r.app_id = e.app_id AND r.event_id = e.id
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql}
       GROUP BY e.id, e.title, e.summary, e.scope_type, e.branch_id, b.name, e.status,
        e.content_safety_status, e.starts_at, e.ends_at, e.city_name, e.access_type,
        e.registration_policy, e.album_enabled, e.album_submission_policy, e.capacity, e.version
       ORDER BY e.starts_at DESC, e.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      scopeType: row.scope_type,
      branchId: row.branch_id || null,
      branchName: row.branch_name || '',
      status: row.status,
      contentSafetyStatus: row.content_safety_status,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      cityName: row.city_name || '',
      accessType: row.access_type,
      registrationPolicy: row.registration_policy,
      albumEnabled: Number(row.album_enabled) === 1,
      albumSubmissionPolicy: row.album_submission_policy,
      capacity: row.capacity === null ? null : Number(row.capacity),
      registrationCount: Number(row.registration_count || 0),
      attendedCount: Number(row.attended_count || 0),
      version: Number(row.version),
    }))
    return pageRows(items, pageLimit, row => ({ startsAt: row.startsAt, id: row.id }))
  }

  async function getEvent(appId, eventId) {
    const row = await database.one(
      `SELECT e.id, e.scope_type, e.branch_id, e.title, e.summary, e.description, e.notices,
        event_type_key, event_mode, access_type, registration_policy,
        album_enabled, album_submission_policy, starts_at, ends_at,
        registration_deadline, cancellation_deadline, venue_name, address, city_name,
        latitude, longitude, online_url, capacity, waitlist_enabled, price_cents, registration_schema_json,
        e.cover_asset_id, cover.cloud_file_id AS cover_file_id,
        e.status, e.content_safety_status, e.version
       FROM mip_events e
       LEFT JOIN mip_media_assets cover
         ON cover.app_id = e.app_id AND cover.id = e.cover_asset_id AND cover.status = 'READY'
       WHERE e.app_id = ? AND e.id = ?`,
      [appId, eventId],
    )
    if (!row) return null
    return {
      id: row.id,
      scopeType: row.scope_type,
      branchId: row.branch_id || null,
      title: row.title,
      summary: row.summary,
      description: row.description,
      notices: row.notices || '',
      coverAssetId: row.cover_asset_id || null,
      coverUrl: row.cover_file_id || '',
      eventTypeKey: row.event_type_key,
      eventMode: row.event_mode,
      accessType: row.access_type,
      registrationPolicy: row.registration_policy,
      albumEnabled: Number(row.album_enabled) === 1,
      albumSubmissionPolicy: row.album_submission_policy,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      registrationDeadline: iso(row.registration_deadline),
      cancellationDeadline: iso(row.cancellation_deadline),
      venueName: row.venue_name || '',
      address: row.address || '',
      cityName: row.city_name || '',
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      onlineUrl: row.online_url || '',
      capacity: row.capacity === null ? null : Number(row.capacity),
      waitlistEnabled: Number(row.waitlist_enabled) === 1,
      priceCents: Number(row.price_cents || 0),
      registrationSchema: json(row.registration_schema_json, []),
      status: row.status,
      contentSafetyStatus: row.content_safety_status,
      version: Number(row.version),
    }
  }

  async function listEventAlbumPhotos(appId, eventId, status, pageLimit) {
    const rows = await database.query(
      `SELECT photo.id, photo.caption, photo.status, photo.moderation_reason, photo.version,
        photo.created_at, photo.reviewed_at, photo.published_at,
        asset.status AS asset_status, asset.cloud_file_id,
        profile.nickname, profile.visibility_json, avatar.cloud_file_id AS avatar_file_id
       FROM mip_event_album_photos photo
       LEFT JOIN mip_media_assets asset
         ON asset.app_id = photo.app_id AND asset.id = photo.media_asset_id
         AND asset.purpose = 'EVENT_ALBUM'
       LEFT JOIN mip_profiles profile
         ON profile.app_id = photo.app_id AND profile.user_id = photo.uploader_user_id
       LEFT JOIN mip_media_assets avatar
         ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
         AND avatar.status = 'READY'
       WHERE photo.app_id = ? AND photo.event_id = ? AND photo.status = ?
       ORDER BY photo.created_at DESC, photo.id DESC LIMIT ?`,
      [appId, eventId, status, pageLimit],
    )
    return rows.map(eventAlbumPhotoDto)
  }

  async function reviewEventAlbumPhoto(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await tx.one(
        `SELECT id, branch_id FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(event, input.eventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      const photo = await tx.one(
        `SELECT photo.id, photo.event_id, photo.status, photo.version,
          asset.status AS asset_status, asset.purpose AS asset_purpose,
          asset.object_key AS asset_object_key, asset.cloud_file_id AS asset_cloud_file_id,
          asset.content_sha256 AS asset_content_sha256,
          asset.content_type AS asset_content_type, asset.content_bytes AS asset_content_bytes,
          asset.width_px AS asset_width_px, asset.height_px AS asset_height_px
         FROM mip_event_album_photos photo
         LEFT JOIN mip_media_assets asset
           ON asset.app_id = photo.app_id AND asset.id = photo.media_asset_id
         WHERE photo.app_id = ? AND photo.event_id = ? AND photo.id = ? FOR UPDATE`,
        [input.appId, input.eventId, input.photoId],
      )
      if (!photo) throw codeError('NOT_FOUND')
      if (Number(photo.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (photo.status !== 'PENDING') throw codeError('INVALID_STATE')
      if (input.status === 'PUBLISHED' && !eventAlbumAssetReady(photo)) {
        throw codeError('EVENT_ALBUM_MEDIA_INVALID')
      }
      const result = await tx.query(
        `UPDATE mip_event_album_photos SET status = ?, moderation_reason = ?,
          reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(3),
          published_at = CASE WHEN ? = 'PUBLISHED' THEN UTC_TIMESTAMP(3) ELSE NULL END,
          version = version + 1
         WHERE app_id = ? AND event_id = ? AND id = ? AND status = 'PENDING' AND version = ?`,
        [input.status, input.reason, input.actorUserId, input.status,
          input.appId, input.eventId, input.photoId, input.expectedVersion],
      )
      if (Number(result?.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit)
      const row = await tx.one(
        `SELECT photo.id, photo.caption, photo.status, photo.moderation_reason, photo.version,
          photo.created_at, photo.reviewed_at, photo.published_at,
          asset.status AS asset_status, asset.cloud_file_id,
          profile.nickname, profile.visibility_json, avatar.cloud_file_id AS avatar_file_id
         FROM mip_event_album_photos photo
         LEFT JOIN mip_media_assets asset
           ON asset.app_id = photo.app_id AND asset.id = photo.media_asset_id
           AND asset.purpose = 'EVENT_ALBUM'
         LEFT JOIN mip_profiles profile
           ON profile.app_id = photo.app_id AND profile.user_id = photo.uploader_user_id
         LEFT JOIN mip_media_assets avatar
           ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
           AND avatar.status = 'READY'
         WHERE photo.app_id = ? AND photo.event_id = ? AND photo.id = ?`,
        [input.appId, input.eventId, input.photoId],
      )
      return eventAlbumPhotoDto(row)
    })
  }

  async function saveEvent(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const eventId = input.eventId || id()
      let status = 'DRAFT'
      let nextVersion = 1
      if (input.eventId) {
        const current = await tx.one(
          `SELECT id, scope_type, branch_id, status, version, cover_asset_id
           FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, eventId],
        )
        if (!current) throw codeError('NOT_FOUND')
        const currentScope = eventScopeFromRow(current, eventId)
        assertScope(authorization, currentScope)
        assertAuthorizedScope(currentScope, input.authorizedScope)
        if (authorization.effectiveGrant.scopeType !== 'PLATFORM') {
          const currentOwnedScope = {
            scopeType: current.scope_type,
            scopeId: current.scope_type === 'BRANCH' ? current.branch_id : null,
          }
          if (!sameScope(currentOwnedScope, draftResourceScope(input.draft))) throw codeError('FORBIDDEN')
        }
        if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
        if (!['DRAFT', 'UNPUBLISHED'].includes(current.status)) throw codeError('INVALID_STATE')
        await assertEventCover(tx, input, current.cover_asset_id || null)
        status = current.status
        nextVersion = Number(current.version) + 1
        const result = await tx.query(
          `UPDATE mip_events SET scope_type = ?, branch_id = ?,
            title = ?, summary = ?, description = ?, notices = ?,
            cover_asset_id = ?,
            starts_at = ?, ends_at = ?, registration_deadline = ?, cancellation_deadline = ?,
            venue_name = ?, address = ?, city_name = ?, latitude = ?, longitude = ?, capacity = ?,
            event_type_key = ?, event_mode = ?, access_type = ?, registration_policy = ?,
            album_enabled = ?, album_submission_policy = ?,
            online_url = ?, waitlist_enabled = ?, price_cents = ?,
            registration_schema_json = ?, form_version = form_version + 1,
            content_safety_status = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status IN ('DRAFT', 'UNPUBLISHED')`,
          [input.draft.scopeType, input.draft.branchId || null,
            input.draft.title, input.draft.summary, input.draft.description, input.draft.notices || null,
            input.draft.coverAssetId,
            input.draft.startsAt, input.draft.endsAt, input.draft.registrationDeadline || null,
            input.draft.cancellationDeadline || null, input.draft.venueName || null,
            input.draft.address || null, input.draft.cityName || null,
            input.draft.latitude, input.draft.longitude, input.draft.capacity,
            input.draft.eventTypeKey, input.draft.eventMode, input.draft.accessType,
            input.draft.registrationPolicy, input.draft.albumEnabled ? 1 : 0,
            input.draft.albumSubmissionPolicy, input.draft.onlineUrl || null,
            input.draft.waitlistEnabled ? 1 : 0, input.draft.priceCents,
            JSON.stringify(input.draft.registrationSchema), input.contentSafetyStatus,
            input.appId, eventId, input.expectedVersion],
        )
        if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        assertScope(authorization, draftResourceScope(input.draft))
        await assertEventCover(tx, input, null)
        await tx.query(
          `INSERT INTO mip_events (
            id, app_id, scope_type, branch_id, organizer_user_id, title, summary,
            description, notices, cover_asset_id, event_type_key, event_mode, access_type,
            registration_policy, album_enabled, album_submission_policy,
            status, content_safety_status, starts_at, ends_at,
            registration_deadline, cancellation_deadline, venue_name, address, city_name,
            latitude, longitude, online_url, capacity, waitlist_enabled, price_cents, currency, registration_schema_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CNY', ?)`,
          [eventId, input.appId, input.draft.scopeType, input.draft.branchId || null,
            input.actorUserId, input.draft.title, input.draft.summary, input.draft.description,
            input.draft.notices || null, input.draft.coverAssetId, input.draft.eventTypeKey, input.draft.eventMode,
            input.draft.accessType, input.draft.registrationPolicy,
            input.draft.albumEnabled ? 1 : 0, input.draft.albumSubmissionPolicy,
            input.contentSafetyStatus,
            input.draft.startsAt,
            input.draft.endsAt, input.draft.registrationDeadline || null,
            input.draft.cancellationDeadline || null, input.draft.venueName || null,
            input.draft.address || null, input.draft.cityName || null,
            input.draft.latitude, input.draft.longitude, input.draft.onlineUrl || null,
            input.draft.capacity, input.draft.waitlistEnabled ? 1 : 0, input.draft.priceCents,
            JSON.stringify(input.draft.registrationSchema || [])],
        )
      }
      await writeEventChange(tx, {
        id: id(),
        appId: input.appId,
        eventId,
        sourceVersion: nextVersion,
        changeType: input.eventId ? 'CONTENT' : 'CREATED',
        summary: input.eventId ? '活动信息已更新' : '活动已创建',
        changedFields: Object.keys(input.draft),
        actorUserId: input.actorUserId,
      })
      await writeAudit(tx, input.audit(eventId))
      await writeOutbox(tx, {
        id: id(),
        appId: input.appId,
        aggregateType: 'EVENT',
        aggregateId: eventId,
        eventType: input.eventId ? 'event.updated' : 'event.created',
        sourceVersion: nextVersion,
        payload: { eventId, status },
      })
      return { id: eventId, version: nextVersion, status }
    })
  }

  async function cloneEvent(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const source = await tx.one(
        `SELECT e.id, e.scope_type, e.branch_id, e.title, e.summary, e.description, e.notices,
          e.cover_asset_id, cover.status AS cover_status, e.event_type_key, e.event_mode,
          e.access_type, e.registration_policy, e.album_enabled, e.album_submission_policy,
          e.starts_at, e.ends_at,
          e.registration_opens_at, e.registration_deadline, e.cancellation_deadline,
          e.venue_name, e.address, e.city_name, e.latitude, e.longitude, e.online_url,
          e.capacity, e.waitlist_enabled, e.price_cents, e.currency,
          e.registration_schema_json, e.version, branch.status AS branch_status
         FROM mip_events e
         LEFT JOIN mip_media_assets cover
           ON cover.app_id = e.app_id AND cover.id = e.cover_asset_id
         LEFT JOIN mip_city_branches branch
           ON branch.app_id = e.app_id AND branch.id = e.branch_id
         WHERE e.app_id = ? AND e.id = ? FOR UPDATE`,
        [input.appId, input.sourceEventId],
      )
      if (!source) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(source, input.sourceEventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      if (Number(source.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (source.scope_type === 'BRANCH' && source.branch_status !== 'ACTIVE') {
        throw codeError('INVALID_STATE')
      }

      const operation = 'admin.events.clone'
      const requestHash = createHash('sha256')
        .update(`${input.sourceEventId}\0${input.expectedVersion}`)
        .digest('hex')
      const requestId = id()
      try {
        await tx.query(
          `INSERT INTO mip_idempotency_keys (
            id, app_id, actor_user_id, operation, idempotency_key,
            request_hash, status, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
          [requestId, input.appId, input.actorUserId, operation, input.idempotencyKey, requestHash],
        )
      }
      catch (error) {
        if (!duplicateConstraint(error)) throw error
        const stored = await tx.one(
          `SELECT request_hash, status, response_json
           FROM mip_idempotency_keys
           WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
           FOR UPDATE`,
          [input.appId, input.actorUserId, operation, input.idempotencyKey],
        )
        if (!stored || stored.request_hash !== requestHash || stored.status !== 'COMPLETED') {
          throw codeError('CONFLICT')
        }
        const replay = json(stored.response_json, null)
        if (!replay?.id || replay.status !== 'DRAFT' || Number(replay.version) !== 1) {
          throw codeError('CONFLICT')
        }
        return { ...replay, idempotent: true }
      }

      const dates = shiftedCloneDates(source, now())
      const eventId = id()
      await tx.query(
        `INSERT INTO mip_events (
          id, app_id, scope_type, branch_id, organizer_user_id, title, summary,
          description, notices, cover_asset_id, event_type_key, event_mode, access_type,
          registration_policy, album_enabled, album_submission_policy,
          status, content_safety_status, starts_at, ends_at,
          registration_opens_at, registration_deadline, cancellation_deadline,
          venue_name, address, city_name, latitude, longitude, online_url, capacity,
          waitlist_enabled, price_cents, currency, registration_schema_json,
          form_version, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [eventId, input.appId, source.scope_type, source.branch_id || null, input.actorUserId,
          input.title, source.summary, source.description, source.notices || null,
          source.cover_status === 'READY' ? source.cover_asset_id : null,
          source.event_type_key, source.event_mode, source.access_type, source.registration_policy,
          Number(source.album_enabled) === 1 ? 1 : 0, source.album_submission_policy,
          input.contentSafetyStatus, dates.startsAt, dates.endsAt, dates.registrationOpensAt,
          dates.registrationDeadline, dates.cancellationDeadline, source.venue_name || null,
          source.address || null, source.city_name || null, source.latitude ?? null,
          source.longitude ?? null, source.online_url || null, source.capacity,
          Number(source.waitlist_enabled) === 1 ? 1 : 0, Number(source.price_cents || 0),
          source.currency || 'CNY', JSON.stringify(json(source.registration_schema_json, []))],
      )
      await writeEventChange(tx, {
        id: id(),
        appId: input.appId,
        eventId,
        sourceVersion: 1,
        changeType: 'CREATED',
        summary: '活动已复制为草稿',
        changedFields: ['sourceEventId'],
        actorUserId: input.actorUserId,
      })
      await writeAudit(tx, input.audit(eventId))
      await writeOutbox(tx, {
        id: id(),
        appId: input.appId,
        aggregateType: 'EVENT',
        aggregateId: eventId,
        eventType: 'event.created',
        sourceVersion: 1,
        payload: { eventId, status: 'DRAFT', clonedFromEventId: input.sourceEventId },
      })
      const response = {
        id: eventId,
        status: 'DRAFT',
        version: 1,
        startsAt: dates.startsAt.toISOString(),
        idempotent: false,
      }
      const completed = await tx.query(
        `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
         WHERE app_id = ? AND actor_user_id = ? AND operation = ?
           AND idempotency_key = ? AND request_hash = ? AND status = 'RUNNING'`,
        [JSON.stringify(response), input.appId, input.actorUserId, operation,
          input.idempotencyKey, requestHash],
      )
      if (Number(completed.affectedRows) !== 1) throw codeError('CONFLICT')
      return response
    })
  }

  async function changeEventStatus(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await tx.one(
        `SELECT id, branch_id, status, content_safety_status, starts_at, version
         FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(event, input.eventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      if (Number(event.version) !== input.expectedVersion) throw codeError('CONFLICT')
      const allowedTransitions = {
        DRAFT: ['PUBLISHED', 'CANCELLED'],
        PUBLISHED: ['UNPUBLISHED', 'CANCELLED', 'ENDED'],
        UNPUBLISHED: ['PUBLISHED', 'CANCELLED'],
        CANCELLED: [],
        ENDED: [],
      }
      if (!allowedTransitions[event.status]?.includes(input.status)) throw codeError('INVALID_STATE')
      if (input.status === 'PUBLISHED' && event.content_safety_status !== 'PASSED') throw codeError('CONTENT_SAFETY_REQUIRED')
      const changedAt = now()
      if (input.status === 'PUBLISHED' && new Date(event.starts_at) <= changedAt) throw codeError('INVALID_STATE')
      const result = await tx.query(
        `UPDATE mip_events SET status = ?,
          published_at = CASE WHEN ? = 'PUBLISHED' THEN ? ELSE published_at END,
          unpublished_at = CASE WHEN ? = 'UNPUBLISHED' THEN ? ELSE unpublished_at END,
          cancelled_at = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelled_at END,
          ended_at = CASE WHEN ? = 'ENDED' THEN ? ELSE ended_at END,
          version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [input.status, input.status, changedAt, input.status, changedAt,
          input.status, changedAt, input.status, changedAt,
          input.appId, input.eventId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      const cancellation = input.status === 'CANCELLED'
        ? await cancelEventRegistrations(tx, input, changedAt)
        : { affectedCount: 0, refundIds: [] }
      const nextVersion = input.expectedVersion + 1
      await writeEventChange(tx, {
        id: id(),
        appId: input.appId,
        eventId: input.eventId,
        sourceVersion: nextVersion,
        changeType: 'STATUS',
        summary: `活动状态变更为 ${input.status}`,
        changedFields: ['status'],
        actorUserId: input.actorUserId,
      })
      await writeAudit(tx, input.audit)
      await writeOutbox(tx, {
        id: id(),
        appId: input.appId,
        aggregateType: 'EVENT',
        aggregateId: input.eventId,
        eventType: input.status === 'PUBLISHED' ? 'event.published' : 'event.status_changed',
        sourceVersion: nextVersion,
        payload: { eventId: input.eventId, from: event.status, to: input.status },
      })
      return {
        id: input.eventId,
        status: input.status,
        version: nextVersion,
        affectedCount: cancellation.affectedCount,
        refundIds: cancellation.refundIds,
      }
    })
  }

  async function publishEventReminder(input) {
    return database.transaction(tx => operationsPublisher.publishEventReminder(tx, input))
  }

  async function cancelEventRegistrations(tx, input, cancelledAt) {
    const registrations = await tx.query(
      `SELECT r.id, r.user_id, r.status, r.version, r.order_id,
        o.status AS order_status, o.amount_cents,
        COALESCE((SELECT SUM(ref.amount_cents) FROM mip_refunds ref
          WHERE ref.app_id = o.app_id AND ref.order_id = o.id
            AND ref.status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED')), 0) AS reserved_refund_cents,
        h.id AS seat_hold_id
       FROM mip_event_registrations r
       LEFT JOIN mip_orders o ON o.app_id = r.app_id AND o.id = r.order_id AND o.order_type = 'EVENT'
       LEFT JOIN mip_event_seat_holds h ON h.app_id = o.app_id AND h.order_id = o.id
       WHERE r.app_id = ? AND r.event_id = ?
         AND r.status IN ('PENDING_REVIEW', 'WAITLISTED', 'PAYMENT_PENDING', 'REGISTERED', 'CANCELLATION_PENDING')
       FOR UPDATE`,
      [input.appId, input.eventId],
    )
    const refundIds = []
    for (const registration of registrations) {
      const remainingRefund = Math.max(
        0,
        Number(registration.amount_cents || 0) - Number(registration.reserved_refund_cents || 0),
      )
      const shouldCreateRefund = ['PAID', 'PARTIALLY_REFUNDED'].includes(registration.order_status)
        && remainingRefund > 0
      const refundPending = shouldCreateRefund || registration.order_status === 'REFUND_PENDING'
      const registrationStatus = refundPending ? 'CANCELLATION_PENDING' : 'CANCELLED'
      await tx.query(
        `UPDATE mip_event_registrations SET status = ?, cancelled_at = ?,
          cancelled_by_type = 'EVENT', cancellation_reason = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [registrationStatus, cancelledAt, input.reason, input.appId,
          registration.id, registration.version],
      )
      let refundId = null
      if (shouldCreateRefund) {
        refundId = id()
        refundIds.push(refundId)
        await tx.query(
          `INSERT INTO mip_refunds (
            id, app_id, order_id, requested_by_user_id, merchant_refund_no,
            idempotency_key, amount_cents, reason, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [refundId, input.appId, registration.order_id, registration.user_id,
            merchantRefundNumber(refundId), `event-cancel:${input.eventId}:${registration.id}`,
            remainingRefund, input.reason],
        )
        await tx.query(
          `UPDATE mip_orders SET status = 'REFUND_PENDING', version = version + 1
           WHERE app_id = ? AND id = ? AND status IN ('PAID', 'PARTIALLY_REFUNDED')`,
          [input.appId, registration.order_id],
        )
        await writeAudit(tx, {
          ...input.audit,
          action: 'admin.refunds.submit',
          resourceType: 'REFUND',
          resourceId: refundId,
          metadata: {
            orderId: registration.order_id,
            eventId: input.eventId,
            amountCents: remainingRefund,
            source: 'EVENT_CANCELLATION',
          },
        })
      }
      else if (registration.order_id && ['CREATED', 'PAYMENT_CREATED'].includes(registration.order_status)) {
        await tx.query(
          `UPDATE mip_orders SET status = 'CLOSED', closed_at = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND status IN ('CREATED', 'PAYMENT_CREATED')`,
          [cancelledAt, input.appId, registration.order_id],
        )
      }
      if (registration.seat_hold_id && !refundPending) {
        await tx.query(
          `UPDATE mip_event_seat_holds SET status = 'CANCELLED', cancelled_at = ?
           WHERE app_id = ? AND id = ? AND status = 'ACTIVE'`,
          [cancelledAt, input.appId, registration.seat_hold_id],
        )
      }
      await writeOutbox(tx, {
        id: id(),
        appId: input.appId,
        aggregateType: 'EVENT_REGISTRATION',
        aggregateId: registration.id,
        eventType: refundPending ? 'event.registration_refund_requested' : 'event.registration_cancelled',
        sourceVersion: Number(registration.version) + 1,
        payload: {
          eventId: input.eventId,
          userId: registration.user_id,
          status: registrationStatus,
          refundId,
          eventCancelled: true,
        },
      })
    }
    return { affectedCount: registrations.length, refundIds }
  }

  async function listRoster(appId, eventId, filters, pageLimit, cursor = null) {
    const clauses = ['r.app_id = ?', 'r.event_id = ?']
    const params = [appId, eventId]
    if (filters.status) {
      clauses.push('r.status = ?')
      params.push(filters.status)
    }
    if (filters.query) {
      clauses.push('p.nickname LIKE ? ESCAPE \'\\\\\'')
      params.push(`%${escapeLike(filters.query)}%`)
    }
    const cursorWhere = cursorPredicateFor('r.registered_at', cursor, 'registeredAt', 'r.id')
    const rows = await database.query(
      `SELECT r.id, r.user_id, r.status, r.answers_json, r.registered_at, r.version,
        p.nickname, b.city_name, pp.phone_ciphertext, pp.phone_verified_at,
        c.checked_in_at
       FROM mip_event_registrations r
       LEFT JOIN mip_profiles p ON p.app_id = r.app_id AND p.user_id = r.user_id
       LEFT JOIN mip_users u ON u.app_id = r.app_id AND u.id = r.user_id
       LEFT JOIN mip_city_branches b ON b.app_id = u.app_id AND b.id = u.primary_branch_id
       LEFT JOIN mip_private_profiles pp ON pp.app_id = r.app_id AND pp.user_id = r.user_id
       LEFT JOIN mip_event_checkins c ON c.app_id = r.app_id AND c.registration_id = r.id AND c.status = 'ACTIVE'
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql} ORDER BY r.registered_at DESC, r.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      nickname: row.nickname || '未填写昵称',
      cityName: row.city_name || '',
      status: row.status,
      answers: json(row.answers_json, {}),
      phoneBound: Boolean(row.phone_verified_at),
      phoneCiphertext: row.phone_ciphertext || null,
      registeredAt: iso(row.registered_at),
      checkedInAt: iso(row.checked_in_at),
      version: Number(row.version),
    }))
    return pageRows(items, pageLimit, row => ({ registeredAt: row.registeredAt, id: row.id }))
  }

  async function reviewRegistration(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await tx.one(
        `SELECT id, branch_id, access_type, registration_policy, status, capacity, waitlist_enabled
         FROM mip_events WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(event, input.eventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      if (event.status !== 'PUBLISHED'
        || event.registration_policy !== 'APPROVAL'
        || !['FREE', 'MEMBER_INCLUDED'].includes(event.access_type)) {
        throw codeError('INVALID_STATE')
      }
      const registration = await tx.one(
        `SELECT id, user_id, order_id, status, version
         FROM mip_event_registrations
         WHERE app_id = ? AND event_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId, input.registrationId],
      )
      if (!registration) throw codeError('NOT_FOUND')
      if (Number(registration.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (registration.status !== 'PENDING_REVIEW' || registration.order_id) throw codeError('INVALID_STATE')

      let nextStatus = 'REJECTED'
      if (input.decision === 'APPROVE') {
        const reviewedAt = now()
        const capacity = await tx.one(
          `SELECT COUNT(*) AS total FROM mip_event_registrations
           WHERE app_id = ? AND event_id = ?
             AND status IN ('REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')`,
          [input.appId, input.eventId],
        )
        const holds = await tx.one(
          `SELECT COUNT(*) AS total FROM mip_event_seat_holds
           WHERE app_id = ? AND event_id = ? AND status = 'ACTIVE' AND expires_at > ?`,
          [input.appId, input.eventId, reviewedAt],
        )
        const capacityLimit = event.capacity === null ? null : Number(event.capacity)
        const full = capacityLimit !== null
          && Number(capacity?.total || 0) + Number(holds?.total || 0) >= capacityLimit
        if (full && Number(event.waitlist_enabled) !== 1) throw codeError('INVALID_STATE')
        nextStatus = full ? 'WAITLISTED' : 'REGISTERED'
        const updated = await tx.query(
          `UPDATE mip_event_registrations SET status = ?, ticket_hash = ?,
            waitlisted_at = ?, registered_at = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status = 'PENDING_REVIEW'`,
          [
            nextStatus,
            nextStatus === 'REGISTERED' ? createHash('sha256').update(bytes(24)).digest('hex') : null,
            nextStatus === 'WAITLISTED' ? reviewedAt : null,
            nextStatus === 'REGISTERED' ? reviewedAt : null,
            input.appId,
            input.registrationId,
            input.expectedVersion,
          ],
        )
        if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        const updated = await tx.query(
          `UPDATE mip_event_registrations SET status = 'REJECTED', ticket_hash = NULL,
            waitlisted_at = NULL, registered_at = NULL, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status = 'PENDING_REVIEW'`,
          [input.appId, input.registrationId, input.expectedVersion],
        )
        if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      const nextVersion = input.expectedVersion + 1
      await writeAudit(tx, input.audit(nextStatus))
      await writeOutbox(tx, {
        id: id(),
        appId: input.appId,
        aggregateType: 'EVENT_REGISTRATION',
        aggregateId: input.registrationId,
        eventType: nextStatus === 'REGISTERED'
          ? 'event.registration_confirmed'
          : nextStatus === 'WAITLISTED'
            ? 'event.registration_waitlisted'
            : 'event.registration_rejected',
        sourceVersion: nextVersion,
        payload: {
          eventId: input.eventId,
          userId: registration.user_id,
          status: nextStatus,
          reviewedByUserId: input.actorUserId,
        },
      })
      return {
        id: input.registrationId,
        status: nextStatus,
        version: nextVersion,
      }
    })
  }

  async function checkIn(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await tx.one(
        `SELECT id, branch_id FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(event, input.eventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      const registration = await tx.one(
        `SELECT id, user_id, status, version FROM mip_event_registrations
         WHERE app_id = ? AND event_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId, input.registrationId],
      )
      if (!registration) throw codeError('NOT_FOUND')
      if (Number(registration.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (registration.status === 'ATTENDED') {
        return { id: input.registrationId, status: 'ATTENDED', version: input.expectedVersion, idempotent: true }
      }
      if (registration.status !== 'REGISTERED') throw codeError('INVALID_STATE')
      const existingCheckin = await tx.one(
        `SELECT id, version FROM mip_event_checkins
         WHERE app_id = ? AND event_id = ? AND registration_id = ? FOR UPDATE`,
        [input.appId, input.eventId, input.registrationId],
      )
      const checkinId = existingCheckin?.id || id()
      const checkinVersion = existingCheckin ? Number(existingCheckin.version) + 1 : 1
      const registrationVersion = input.expectedVersion + 1
      const transitionId = id()
      const checkedInAt = now()
      if (existingCheckin) {
        const activated = await tx.query(
          `UPDATE mip_event_checkins SET source = 'ADMIN', credential_id = NULL,
             status = 'ACTIVE', checked_in_at = ?, revoked_at = NULL,
             revoked_by_user_id = NULL, revoke_reason = NULL, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status = 'REVOKED'`,
          [checkedInAt, input.appId, checkinId, existingCheckin.version],
        )
        if (Number(activated.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        await tx.query(
          `INSERT INTO mip_event_checkins (
            id, app_id, event_id, registration_id, user_id, source, status, checked_in_at
          ) VALUES (?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE', ?)`,
          [checkinId, input.appId, input.eventId, input.registrationId, registration.user_id, checkedInAt],
        )
      }
      const updated = await tx.query(
        `UPDATE mip_event_registrations SET status = 'ATTENDED', version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'REGISTERED'`,
        [input.appId, input.registrationId, input.expectedVersion],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeCheckInTransition(tx, {
        id: transitionId,
        appId: input.appId,
        checkinId,
        registrationId: input.registrationId,
        eventId: input.eventId,
        userId: registration.user_id,
        transitionType: 'CHECKED_IN',
        checkinVersion,
        registrationVersion,
        actorUserId: input.actorUserId,
        source: 'ADMIN',
        occurredAt: checkedInAt,
      })
      await writeAudit(tx, input.audit)
      await writeOutbox(tx, {
        id: transitionId,
        appId: input.appId,
        aggregateType: 'EVENT_CHECKIN_TRANSITION',
        aggregateId: transitionId,
        eventType: 'event.checked_in',
        sourceVersion: registrationVersion,
        payload: {
          eventId: input.eventId,
          registrationId: input.registrationId,
          userId: registration.user_id,
          checkinId,
        },
      })
      return { id: input.registrationId, status: 'ATTENDED', version: registrationVersion, idempotent: false }
    })
  }

  async function undoCheckIn(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await tx.one(
        `SELECT id, branch_id FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (!event) throw codeError('NOT_FOUND')
      const currentScope = eventScopeFromRow(event, input.eventId)
      assertScope(authorization, currentScope)
      assertAuthorizedScope(currentScope, input.authorizedScope)
      const registration = await tx.one(
        `SELECT id, user_id, status, version FROM mip_event_registrations
         WHERE app_id = ? AND event_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.eventId, input.registrationId],
      )
      if (!registration) throw codeError('NOT_FOUND')
      if (Number(registration.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (registration.status !== 'ATTENDED') throw codeError('INVALID_STATE')
      const checkin = await tx.one(
        `SELECT id, version FROM mip_event_checkins
         WHERE app_id = ? AND event_id = ? AND registration_id = ? AND status = 'ACTIVE' FOR UPDATE`,
        [input.appId, input.eventId, input.registrationId],
      )
      if (!checkin) throw codeError('CONFLICT')
      const recordedTransition = await tx.one(
        `SELECT id FROM mip_event_checkin_transitions
         WHERE app_id = ? AND checkin_id = ? AND transition_type = 'CHECKED_IN'
           AND checkin_version = ? FOR UPDATE`,
        [input.appId, checkin.id, checkin.version],
      )
      if (!recordedTransition) throw codeError('CONFLICT')
      const revokedAt = now()
      const transitionId = id()
      const checkinVersion = Number(checkin.version) + 1
      const registrationVersion = input.expectedVersion + 1
      const revoked = await tx.query(
        `UPDATE mip_event_checkins SET status = 'REVOKED', revoked_at = ?,
           revoked_by_user_id = ?, revoke_reason = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'ACTIVE'`,
        [revokedAt, input.actorUserId, input.reason, input.appId, checkin.id, checkin.version],
      )
      if (Number(revoked.affectedRows) !== 1) throw codeError('CONFLICT')
      const restored = await tx.query(
        `UPDATE mip_event_registrations SET status = 'REGISTERED', version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'ATTENDED'`,
        [input.appId, input.registrationId, input.expectedVersion],
      )
      if (Number(restored.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeCheckInTransition(tx, {
        id: transitionId,
        appId: input.appId,
        checkinId: checkin.id,
        registrationId: input.registrationId,
        eventId: input.eventId,
        userId: registration.user_id,
        transitionType: 'REVOKED',
        checkinVersion,
        registrationVersion,
        reversalOfTransitionId: recordedTransition.id,
        actorUserId: input.actorUserId,
        source: 'ADMIN',
        revokeReason: input.reason,
        occurredAt: revokedAt,
      })
      await writeAudit(tx, input.audit)
      await writeOutbox(tx, {
        id: transitionId,
        appId: input.appId,
        aggregateType: 'EVENT_CHECKIN_TRANSITION',
        aggregateId: transitionId,
        eventType: 'event.checkin_revoked',
        sourceVersion: registrationVersion,
        payload: {
          eventId: input.eventId,
          registrationId: input.registrationId,
          userId: registration.user_id,
          checkinId: checkin.id,
          reversalOfTransitionId: recordedTransition.id,
        },
      })
      return {
        id: input.registrationId,
        status: 'REGISTERED',
        version: registrationVersion,
      }
    })
  }

  async function listRoles(appId, visibility) {
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
    const where = visibility.platform ? '1 = 1' : clauses.length ? `(${clauses.join(' OR ')})` : '0 = 1'
    const rows = await database.query(
      `SELECT r.id, r.user_id, r.scope_type, r.scope_id, r.role_key, r.status,
        r.granted_at, r.revoked_at, p.nickname
       FROM mip_admin_role_bindings r
       LEFT JOIN mip_profiles p ON p.app_id = r.app_id AND p.user_id = r.user_id
       WHERE r.app_id = ? AND ${where}
       ORDER BY r.status, r.granted_at DESC, r.id DESC`,
      params,
    )
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      nickname: row.nickname || '未填写昵称',
      scopeType: row.scope_type,
      scopeId: row.scope_type === 'PLATFORM' ? null : row.scope_id,
      roleKey: row.role_key,
      status: row.status,
      grantedAt: iso(row.granted_at),
      revokedAt: iso(row.revoked_at),
    }))
  }

  async function searchRoleCandidates(appId, query, pageLimit) {
    if (!query) return []
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
        if (!event) throw codeError('NOT_FOUND')
        const currentScope = eventScopeFromRow(event, input.scope.scopeId)
        assertScope(authorization, currentScope)
        assertAuthorizedScope(currentScope, input.authorizedScope)
      }
      else if (input.scope.scopeType === 'BRANCH') {
        const branch = await tx.one(
          `SELECT id FROM mip_city_branches
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, input.scope.scopeId],
        )
        if (!branch) throw codeError('NOT_FOUND')
        const currentScope = { scopeType: 'BRANCH', scopeId: input.scope.scopeId }
        assertScope(authorization, currentScope)
        assertAuthorizedScope(currentScope, input.authorizedScope)
      }
      else {
        const currentScope = { scopeType: 'PLATFORM', scopeId: null }
        assertScope(authorization, currentScope)
        assertAuthorizedScope(currentScope, input.authorizedScope)
      }
      const target = await tx.one(
        'SELECT id, status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE',
        [input.appId, input.userId],
      )
      if (!target) throw codeError('NOT_FOUND')
      if (input.active && target.status !== 'ACTIVE') throw codeError('INVALID_STATE')
      if (!input.active && input.roleKey === 'PLATFORM_OWNER') {
        const owners = await tx.query(
          `SELECT id FROM mip_admin_role_bindings
           WHERE app_id = ? AND scope_type = 'PLATFORM' AND role_key = 'PLATFORM_OWNER'
             AND status = 'ACTIVE' FOR UPDATE`,
          [input.appId],
        )
        if (owners.length <= 1) throw codeError('INVALID_STATE')
      }
      if (input.active) {
        await tx.query(
          `INSERT INTO mip_admin_role_bindings (
            id, app_id, user_id, scope_type, scope_id, role_key, status, granted_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
          ON DUPLICATE KEY UPDATE status = 'ACTIVE', granted_by_user_id = VALUES(granted_by_user_id),
            granted_at = UTC_TIMESTAMP(3), revoked_at = NULL`,
          [id(), input.appId, input.userId, input.scope.scopeType, input.scope.scopeId, input.roleKey, input.actorUserId],
        )
      }
      else {
        await tx.query(
          `UPDATE mip_admin_role_bindings SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND user_id = ? AND scope_type = ? AND scope_id = ?
             AND role_key = ? AND status = 'ACTIVE'`,
          [input.appId, input.userId, input.scope.scopeType, input.scope.scopeId, input.roleKey],
        )
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

  async function listOpportunities(appId, visibility, filters, pageLimit, cursor = null) {
    const clauses = ['o.app_id = ?']
    const params = [appId]
    if (!visibility.platform) {
      if (!visibility.branchIds.length) return { items: [], nextCursor: null }
      clauses.push(`o.branch_id IN (${placeholders(visibility.branchIds)})`)
      params.push(...visibility.branchIds)
    }
    if (filters.status) {
      clauses.push('o.status = ?')
      params.push(filters.status)
    }
    if (filters.query) {
      clauses.push('o.title LIKE ? ESCAPE \'\\\\\'')
      params.push(`%${escapeLike(filters.query)}%`)
    }
    const cursorWhere = cursorPredicateFor('o.updated_at', cursor, 'updatedAt', 'o.id')
    const rows = await database.query(
      `SELECT o.id, o.title, o.value_summary, o.scope_type, o.branch_id, b.name AS branch_name,
        o.status, o.content_safety_status, o.referral_count, o.version, o.published_at, o.updated_at,
        o.moderated_at, o.moderation_reason, o.archived_at, o.archive_reason
       FROM mip_opportunities o
       LEFT JOIN mip_city_branches b ON b.app_id = o.app_id AND b.id = o.branch_id
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql} ORDER BY o.updated_at DESC, o.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: row.id,
      title: row.title,
      valueSummary: row.value_summary,
      scopeType: row.scope_type,
      branchId: row.branch_id || null,
      branchName: row.branch_name || '',
      status: row.status,
      contentSafetyStatus: row.content_safety_status,
      referralCount: Number(row.referral_count || 0),
      version: Number(row.version),
      publishedAt: iso(row.published_at),
      moderatedAt: iso(row.moderated_at),
      moderationReason: row.moderation_reason || '',
      archivedAt: iso(row.archived_at),
      archiveReason: row.archive_reason || '',
      updatedAt: iso(row.updated_at),
    }))
    return pageRows(items, pageLimit, row => ({ updatedAt: row.updatedAt, id: row.id }))
  }

  async function unpublishOpportunity(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const opportunity = await tx.one(
        `SELECT id, branch_id, status, version FROM mip_opportunities
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.opportunityId],
      )
      if (!opportunity) throw codeError('NOT_FOUND')
      const currentScope = ownedResourceScopeFromRow(opportunity)
      assertScope(authorization, currentScope)
      if (input.authorizedScope && !sameScope(currentScope, input.authorizedScope)) {
        throw codeError('CONFLICT')
      }
      if (Number(opportunity.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (!['PUBLISHED', 'ENDED'].includes(opportunity.status)) throw codeError('INVALID_STATE')
      const result = await tx.query(
        `UPDATE mip_opportunities SET status = 'UNPUBLISHED', moderated_at = UTC_TIMESTAMP(3),
          moderated_by_user_id = ?, moderation_reason = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status IN ('PUBLISHED', 'ENDED')`,
        [input.actorUserId, input.reason, input.appId, input.opportunityId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit)
      return { id: input.opportunityId, status: 'UNPUBLISHED', version: input.expectedVersion + 1 }
    })
  }

  async function listGrowthLevels(appId) {
    const rows = await database.query(
      `SELECT id, level_key, name, minimum_experience, benefits_json, status, version
       FROM mip_growth_levels WHERE app_id = ? ORDER BY minimum_experience, id`,
      [appId],
    )
    return rows.map(row => ({
      id: row.id,
      levelKey: row.level_key,
      name: row.name,
      minimumExperience: Number(row.minimum_experience),
      benefits: json(row.benefits_json, []),
      status: row.status,
      version: Number(row.version),
    }))
  }

  async function saveGrowthLevel(input) {
    return database.transaction(async (tx) => {
      await authorizeMutation(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      const levelId = input.levelId || id()
      const rows = await tx.query(
        `SELECT id, minimum_experience, status, version FROM mip_growth_levels
         WHERE app_id = ? ORDER BY minimum_experience, id FOR UPDATE`,
        [input.appId],
      )
      const current = rows.find(row => row.id === levelId)
      if (input.levelId) {
        if (!current) throw codeError('NOT_FOUND')
        if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
      }
      assertGrowthLevels(growthLevelProjection(rows, levelId, input.draft))
      if (current?.status === 'ACTIVE' && input.draft.status === 'DRAFT') throw codeError('INVALID_STATE')
      try {
        if (input.levelId) {
          const result = await tx.query(
            `UPDATE mip_growth_levels SET name = ?, minimum_experience = ?, benefits_json = ?,
              status = ?, version = version + 1 WHERE app_id = ? AND id = ? AND version = ?`,
            [input.draft.name, input.draft.minimumExperience, JSON.stringify(input.draft.benefits),
              input.draft.status, input.appId, levelId, input.expectedVersion],
          )
          if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
        }
        else {
          await tx.query(
            `INSERT INTO mip_growth_levels (
              id, app_id, level_key, name, minimum_experience, benefits_json, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [levelId, input.appId, input.draft.levelKey, input.draft.name,
              input.draft.minimumExperience, JSON.stringify(input.draft.benefits), input.draft.status],
          )
        }
      }
      catch (error) {
        const constraint = duplicateConstraint(error)
        if (constraint.includes('mip_growth_levels_threshold_uk')) {
          throw codeError('GROWTH_LEVEL_THRESHOLD_CONFLICT')
        }
        if (constraint.includes('mip_growth_levels_key_uk')) throw codeError('GROWTH_LEVEL_KEY_CONFLICT')
        if (constraint) throw codeError('CONFLICT')
        throw error
      }
      await writeAudit(tx, input.audit(levelId))
      return { id: levelId, version: input.levelId ? input.expectedVersion + 1 : 1 }
    })
  }

  async function listGrowthRules(appId) {
    const rows = await database.query(
      `SELECT id, rule_key, name, metric, delta_value, daily_limit_value,
        source_event_type, status, version FROM mip_growth_rules
       WHERE app_id = ? ORDER BY status, name, id`,
      [appId],
    )
    return rows.map(row => ({
      id: row.id,
      ruleKey: row.rule_key,
      name: row.name,
      metric: row.metric,
      deltaValue: Number(row.delta_value),
      dailyLimitValue: row.daily_limit_value === null ? null : Number(row.daily_limit_value),
      sourceEventType: row.source_event_type,
      status: row.status,
      version: Number(row.version),
    }))
  }

  async function saveGrowthRule(input) {
    return database.transaction(async (tx) => {
      await authorizeMutation(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      if (!input.ruleId) throw codeError('GROWTH_RULE_NOT_CONFIGURABLE')
      const ruleId = input.ruleId
      const rows = await tx.query(
        `SELECT id, rule_key, name, metric, source_event_type, status, version FROM mip_growth_rules
         WHERE app_id = ? ORDER BY source_event_type, metric, id FOR UPDATE`,
        [input.appId],
      )
      const current = rows.find(row => row.id === ruleId)
      if (!current) throw codeError('NOT_FOUND')
      if (Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
      assertFixedGrowthRuleUpdate({
        ruleKey: current.rule_key,
        name: current.name,
        metric: current.metric,
        sourceEventType: current.source_event_type,
      }, input.draft)
      assertGrowthRules(growthRuleProjection(rows, ruleId, input.draft))
      const result = await tx.query(
        `UPDATE mip_growth_rules SET delta_value = ?, daily_limit_value = ?,
          status = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [input.draft.deltaValue, input.draft.dailyLimitValue, input.draft.status,
          input.appId, ruleId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(ruleId))
      return { id: ruleId, version: input.expectedVersion + 1 }
    })
  }

  async function listGrowthEntries(appId, visibility, filters, pageLimit, cursor = null) {
    const users = visibleBranchesWhere(visibility, 'u')
    const clauses = ['ge.app_id = ?', users.sql]
    const params = [appId, ...users.params]
    if (filters.userId) { clauses.push('ge.user_id = ?'); params.push(filters.userId) }
    if (filters.metric) { clauses.push('ge.metric = ?'); params.push(filters.metric) }
    const cursorWhere = cursorPredicateFor('ge.created_at', cursor, 'createdAt', 'ge.id')
    const rows = await database.query(
      `SELECT ge.id, ge.user_id, p.nickname, ge.source_event_type, ge.metric,
        ge.delta_value, ge.balance_after, ge.adjustment_reason, ge.created_at
       FROM mip_growth_entries ge
       INNER JOIN mip_users u ON u.app_id = ge.app_id AND u.id = ge.user_id
       LEFT JOIN mip_profiles p ON p.app_id = ge.app_id AND p.user_id = ge.user_id
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql} ORDER BY ge.created_at DESC, ge.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      nickname: row.nickname || '未填写昵称',
      sourceEventType: row.source_event_type,
      metric: row.metric,
      deltaValue: Number(row.delta_value),
      balanceAfter: Number(row.balance_after),
      adjustmentReason: row.adjustment_reason || '',
      createdAt: iso(row.created_at),
    }))
    return pageRows(items, pageLimit, row => ({ createdAt: row.createdAt, id: row.id }))
  }

  async function adjustGrowth(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const sourceEventId = createHash('sha256')
        .update(`${input.actorUserId}\0${input.idempotencyKey}`)
        .digest('hex')
        .slice(0, 36)
      const user = await tx.one(
        'SELECT id, status, primary_branch_id FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE',
        [input.appId, input.userId],
      )
      if (!user) throw codeError('NOT_FOUND')
      assertScope(authorization, userScopeFromRow(user))
      assertAuthorizedUserScope(user, input.authorizedScope)
      if (user.status !== 'ACTIVE') throw codeError('INVALID_STATE')
      const existing = await tx.one(
        `SELECT id, delta_value, balance_after FROM mip_growth_entries
         WHERE app_id = ? AND user_id = ? AND source_event_type = 'ADMIN_ADJUSTMENT'
           AND source_event_id = ? AND metric = ? FOR UPDATE`,
        [input.appId, input.userId, sourceEventId, input.metric],
      )
      if (existing) {
        if (Number(existing.delta_value) !== input.deltaValue) throw codeError('CONFLICT')
        return {
          id: existing.id,
          userId: input.userId,
          metric: input.metric,
          deltaValue: Number(existing.delta_value),
          balanceAfter: Number(existing.balance_after),
          idempotent: true,
        }
      }
      await tx.query(
        `INSERT INTO mip_growth_accounts (app_id, user_id)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
        [input.appId, input.userId],
      )
      const account = await tx.one(
        `SELECT experience_balance, contribution_balance, coin_balance, version
         FROM mip_growth_accounts WHERE app_id = ? AND user_id = ? FOR UPDATE`,
        [input.appId, input.userId],
      )
      const column = { EXPERIENCE: 'experience_balance', CONTRIBUTION: 'contribution_balance', COIN: 'coin_balance' }[input.metric]
      const current = Number(account[column])
      const next = current + input.deltaValue
      if (next < 0) throw codeError('INSUFFICIENT_BALANCE')
      const result = await tx.query(
        `UPDATE mip_growth_accounts SET ${column} = ?, version = version + 1
         WHERE app_id = ? AND user_id = ? AND version = ?`,
        [next, input.appId, input.userId, account.version],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      const entryId = id()
      try {
        await tx.query(
          `INSERT INTO mip_growth_entries (
            id, app_id, user_id, rule_id, source_event_id, source_event_type,
            metric, delta_value, balance_after, adjustment_reason, actor_user_id
          ) VALUES (?, ?, ?, NULL, ?, 'ADMIN_ADJUSTMENT', ?, ?, ?, ?, ?)`,
          [entryId, input.appId, input.userId, sourceEventId, input.metric,
            input.deltaValue, next, input.reason, input.actorUserId],
        )
      }
      catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') throw codeError('CONFLICT')
        throw error
      }
      await writeAudit(tx, input.audit(entryId))
      await writeOutbox(tx, {
        id: id(),
        appId: input.appId,
        aggregateType: 'GROWTH_ENTRY',
        aggregateId: entryId,
        eventType: 'growth.changed',
        sourceVersion: Number(account.version) + 1,
        payload: {
          userId: input.userId,
          metric: input.metric,
          deltaValue: input.deltaValue,
        },
      })
      return {
        id: entryId,
        userId: input.userId,
        metric: input.metric,
        deltaValue: input.deltaValue,
        balanceAfter: next,
        idempotent: false,
      }
    })
  }

  async function listOrders(appId, visibility, filters, pageLimit, cursor = null) {
    const scope = orderVisibilityWhere(visibility)
    const clauses = ['o.app_id = ?', scope.sql]
    const params = [appId, ...scope.params]
    if (filters.status) { clauses.push('o.status = ?'); params.push(filters.status) }
    if (filters.orderType) { clauses.push('o.order_type = ?'); params.push(filters.orderType) }
    if (filters.eventId) { clauses.push("o.order_type = 'EVENT' AND o.resource_id = ?"); params.push(filters.eventId) }
    const cursorWhere = cursorPredicateFor('o.created_at', cursor, 'createdAt', 'o.id')
    const rows = await database.query(
      `SELECT o.id, o.user_id, p.nickname, o.order_type, o.resource_id,
        o.merchant_order_no, o.provider_transaction_id, o.amount_cents, o.currency, o.status, o.paid_at,
        o.version, o.created_at,
        COALESCE((SELECT SUM(r.amount_cents) FROM mip_refunds r
          WHERE r.app_id = o.app_id AND r.order_id = o.id AND r.status = 'SUCCEEDED'), 0) AS refunded_amount,
        (SELECT r.status FROM mip_refunds r WHERE r.app_id = o.app_id AND r.order_id = o.id
          ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS refund_status,
        (SELECT r.id FROM mip_refunds r WHERE r.app_id = o.app_id AND r.order_id = o.id
          ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS refund_id
       FROM mip_orders o
       LEFT JOIN mip_profiles p ON p.app_id = o.app_id AND p.user_id = o.user_id
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      nickname: row.nickname || '未填写昵称',
      orderType: row.order_type,
      resourceId: row.resource_id || null,
      merchantOrderNoMasked: maskIdentifier(row.merchant_order_no),
      amountCents: Number(row.amount_cents),
      refundedAmountCents: Number(row.refunded_amount || 0),
      currency: row.currency,
      status: row.status,
      refundStatus: row.refund_status || null,
      refundId: row.refund_id || null,
      paidAt: iso(row.paid_at),
      createdAt: iso(row.created_at),
      version: Number(row.version),
      merchantOrderNo: row.merchant_order_no || '',
      providerTransactionIdMasked: row.provider_transaction_id ? maskIdentifier(row.provider_transaction_id) : null,
    }))
    return pageRows(items, pageLimit, row => ({ createdAt: row.createdAt, id: row.id }))
  }

  function orderVisibilityWhere(visibility) {
    if (visibility.platform) return { sql: '1 = 1', params: [] }
    const clauses = []
    const params = []
    if (visibility.branchIds.length) {
      clauses.push(`EXISTS (SELECT 1 FROM mip_events e WHERE e.app_id = o.app_id
        AND e.id = o.resource_id AND e.branch_id IN (${placeholders(visibility.branchIds)}))`)
      params.push(...visibility.branchIds)
    }
    if (visibility.eventIds.length) {
      clauses.push(`o.resource_id IN (${placeholders(visibility.eventIds)})`)
      params.push(...visibility.eventIds)
    }
    return { sql: clauses.length ? `(o.order_type = 'EVENT' AND (${clauses.join(' OR ')}))` : '0 = 1', params }
  }

  async function listOrderSummary(appId, visibility) {
    const scope = orderVisibilityWhere(visibility)
    const row = await database.one(
      `SELECT SUM(CASE WHEN o.status = 'PAID' THEN 1 ELSE 0 END) AS paid_orders,
        SUM(CASE WHEN o.status = 'REFUND_PENDING' THEN 1 ELSE 0 END) AS pending_refunds
       FROM mip_orders o WHERE o.app_id = ? AND ${scope.sql}`,
      [appId, ...scope.params],
    )
    return { paidOrders: Number(row?.paid_orders || 0), pendingRefunds: Number(row?.pending_refunds || 0) }
  }

  async function submitRefund(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const order = await tx.one(
        `SELECT id, user_id, order_type, resource_id, amount_cents, status, version FROM mip_orders
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.orderId],
      )
      if (!order) throw codeError('NOT_FOUND')
      let currentScope = { scopeType: 'PLATFORM', scopeId: null, branchId: null }
      if (order.order_type === 'EVENT') {
        const event = await tx.one(
          `SELECT id, branch_id FROM mip_events
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, order.resource_id],
        )
        if (!event) throw codeError('NOT_FOUND')
        currentScope = eventScopeFromRow(event, order.resource_id)
      }
      assertScope(authorization, currentScope)
      if (input.authorizedScope && !sameScope(currentScope, input.authorizedScope)) {
        throw codeError('CONFLICT')
      }
      const existing = await tx.one(
        `SELECT id, amount_cents, status FROM mip_refunds
         WHERE app_id = ? AND order_id = ? AND idempotency_key = ? FOR UPDATE`,
        [input.appId, input.orderId, input.idempotencyKey],
      )
      if (existing) {
        return {
          id: existing.id,
          orderId: input.orderId,
          amountCents: Number(existing.amount_cents),
          status: existing.status,
          idempotent: true,
        }
      }
      if (!['PAID', 'PARTIALLY_REFUNDED'].includes(order.status)) throw codeError('INVALID_STATE')
      const totals = await tx.one(
        `SELECT COALESCE(SUM(amount_cents), 0) AS refunded FROM mip_refunds
         WHERE app_id = ? AND order_id = ? AND status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING', 'SUCCEEDED')`,
        [input.appId, input.orderId],
      )
      const amount = Number(order.amount_cents) - Number(totals?.refunded || 0)
      if (amount <= 0) throw codeError('INVALID_STATE')
      const refundId = id()
      const merchantRefundNo = `MIPR${Date.now()}${bytes(5).toString('hex').toUpperCase()}`.slice(0, 64)
      try {
        await tx.query(
          `INSERT INTO mip_refunds (
            id, app_id, order_id, requested_by_user_id, merchant_refund_no,
            idempotency_key, amount_cents, reason, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [refundId, input.appId, input.orderId, input.actorUserId, merchantRefundNo,
            input.idempotencyKey, amount, input.reason],
        )
      }
      catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') throw codeError('CONFLICT')
        throw error
      }
      const updated = await tx.query(
        `UPDATE mip_orders SET status = 'REFUND_PENDING', version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?
           AND status IN ('PAID', 'PARTIALLY_REFUNDED')`,
        [input.appId, input.orderId, order.version],
      )
      if (Number(updated.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(refundId, amount))
      await writeOutbox(tx, {
        id: id(),
        appId: input.appId,
        aggregateType: 'REFUND',
        aggregateId: refundId,
        eventType: 'admin.refund_requested',
        sourceVersion: 1,
        payload: { refundId, orderId: input.orderId, requestedByUserId: input.actorUserId },
      })
      return {
        id: refundId,
        orderId: input.orderId,
        amountCents: amount,
        status: 'PENDING',
        idempotent: false,
      }
    })
  }

  async function authorizeRefundRetry(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const refund = await tx.one(
        `SELECT id, order_id, status FROM mip_refunds
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.refundId],
      )
      if (!refund) throw codeError('NOT_FOUND')
      const order = await tx.one(
        `SELECT id, order_type, resource_id FROM mip_orders
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, refund.order_id],
      )
      if (!order) throw codeError('NOT_FOUND')
      let currentScope = { scopeType: 'PLATFORM', scopeId: null, branchId: null }
      if (order.order_type === 'EVENT') {
        const event = await tx.one(
          `SELECT id, branch_id FROM mip_events
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, order.resource_id],
        )
        if (!event) throw codeError('NOT_FOUND')
        currentScope = eventScopeFromRow(event, order.resource_id)
      }
      assertScope(authorization, currentScope)
      if (input.authorizedScope && !sameScope(currentScope, input.authorizedScope)) {
        throw codeError('CONFLICT')
      }
      if (!['PENDING', 'PROVIDER_CREATED', 'PROCESSING'].includes(refund.status)) {
        throw codeError('INVALID_STATE')
      }
      await writeAudit(tx, input.audit)
      return { id: input.refundId, status: refund.status }
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
    if (filters.action) { clauses.push('a.action = ?'); params.push(filters.action) }
    if (filters.resourceType) { clauses.push('a.resource_type = ?'); params.push(filters.resourceType) }
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
    ...announcementRepository,
    ...opportunityArchiveRepository,
    adjustGrowth,
    authorizeRefundRetry,
    changeBranchStatus,
    changeEventStatus,
    checkIn,
    claimCommunityReport,
    cloneEvent,
    claimExportBuild,
    consumeExportDownload,
    closeCommunityReport,
    createBranch,
    createExportTicket,
    dashboard,
    getEventScope,
    getEvent,
    getExportTicket,
    getOpportunityScope,
    getOrderScope,
    getRefundScope,
    getUserScope,
    health,
    listAudit,
    listBranches,
    listCommunityReports,
    listEventAlbumPhotos,
    listEvents,
    listExportRows,
    listGrowthEntries,
    listGrowthLevels,
    listGrowthRules,
    listOpportunities,
    listOrders,
    listOperationalExceptions,
    listRoleBindings,
    listRoles,
    listRoster,
    reviewRegistration,
    reviewEventAlbumPhoto,
    searchRoleCandidates,
    listUsers,
    issueExportDownload,
    publishEventReminder,
    recordAudit,
    resolveUser,
    saveEvent,
    saveGrowthLevel,
    saveGrowthRule,
    failExportBuild,
    finishExportBuild,
    setRole,
    setUserControl,
    submitRefund,
    unpublishOpportunity,
    undoCheckIn,
    updateBranch,
    updateUserFields,
  }
}

function exportTicket(row) {
  return {
    ticketId: String(row.id),
    appId: String(row.app_id),
    actorUserId: String(row.requested_by_user_id),
    exportType: row.export_type,
    scopeType: row.scope_type,
    scopeId: row.scope_id || null,
    filters: json(row.filters_json, {}),
    includesPhone: Number(row.includes_phone) === 1,
    objectKey: row.object_key,
    fileId: row.cloud_file_id || null,
    contentSha256: row.content_sha256 || null,
    contentBytes: row.content_bytes === null ? null : Number(row.content_bytes),
    rowCount: row.row_count === null ? null : Number(row.row_count),
    status: row.status,
    reservedUntil: iso(row.reserved_until),
    expiresAt: iso(row.expires_at),
    consumedAt: iso(row.consumed_at),
    failedReasonCode: row.failed_reason_code || null,
    createdAt: iso(row.created_at),
  }
}

async function lockedExportTicket(tx, input) {
  const row = await tx.one(
    `SELECT id, app_id, requested_by_user_id, export_type, scope_type, scope_id,
      filters_json, includes_phone, object_key, cloud_file_id, content_sha256,
      content_bytes, row_count, status, reserved_until, expires_at, consumed_at,
      failed_reason_code, created_at
     FROM mip_admin_export_tickets
     WHERE app_id = ? AND id = ? AND requested_by_user_id = ? AND token_hash = ?
     FOR UPDATE`,
    [input.appId, input.ticketId, input.actorUserId, input.tokenHash],
  )
  if (!row) throw codeError('EXPORT_NOT_FOUND')
  row.expires_at = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at)
  row.reserved_until = row.reserved_until
    ? (row.reserved_until instanceof Date ? row.reserved_until : new Date(row.reserved_until))
    : null
  return row
}

async function expireExportRow(tx, row, input) {
  if (!['CONSUMED', 'REVOKED', 'FAILED', 'EXPIRED'].includes(row.status)) {
    await tx.query(
      `UPDATE mip_admin_export_tickets SET status = 'EXPIRED', reserved_until = NULL
       WHERE app_id = ? AND id = ?`,
      [input.appId, input.ticketId],
    )
  }
}

function exportStateError(status) {
  if (status === 'CONSUMED') return codeError('EXPORT_CONSUMED')
  if (status === 'FAILED') return codeError('EXPORT_FAILED')
  if (status === 'EXPIRED' || status === 'REVOKED') return codeError('EXPORT_EXPIRED')
  if (status === 'PENDING') return codeError('EXPORT_NOT_READY')
  return codeError('EXPORT_INVALID_STATE')
}

function exportVisibility(ticket) {
  return {
    platform: ticket.scopeType === 'PLATFORM',
    branchIds: ticket.scopeType === 'BRANCH' ? [ticket.scopeId] : [],
    eventIds: ticket.scopeType === 'EVENT' ? [ticket.scopeId] : [],
  }
}

function maskIdentifier(value) {
  const text = String(value || '')
  return text.length <= 8 ? text : `${text.slice(0, 4)}…${text.slice(-4)}`
}

function merchantRefundNumber(refundId) {
  const compact = String(refundId || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 56)
  if (!compact) throw codeError('REFUND_ID_INVALID')
  return `MIPR${compact}`
}

function shiftedCloneDates(source, currentTime) {
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const sourceStart = new Date(source.starts_at)
  const sourceEnd = new Date(source.ends_at)
  if (!Number.isFinite(sourceStart.getTime()) || !Number.isFinite(sourceEnd.getTime()) || sourceEnd <= sourceStart) {
    throw codeError('INVALID_STATE')
  }
  const earliest = currentTime.getTime() + weekMs
  let startsAtMs = sourceStart.getTime() + weekMs
  if (startsAtMs < earliest) {
    startsAtMs += Math.ceil((earliest - startsAtMs) / weekMs) * weekMs
  }
  const shiftMs = startsAtMs - sourceStart.getTime()
  const shifted = value => value ? new Date(new Date(value).getTime() + shiftMs) : null
  return {
    startsAt: new Date(startsAtMs),
    endsAt: shifted(sourceEnd),
    registrationOpensAt: shifted(source.registration_opens_at),
    registrationDeadline: shifted(source.registration_deadline),
    cancellationDeadline: shifted(source.cancellation_deadline),
  }
}

async function writeEventChange(tx, change) {
  await tx.query(
    `INSERT INTO mip_event_changes (
      id, app_id, event_id, source_version, change_type, summary,
      changed_fields_json, actor_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [change.id, change.appId, change.eventId, change.sourceVersion, change.changeType,
      change.summary, JSON.stringify(change.changedFields || []), change.actorUserId],
  )
}

async function writeOutbox(tx, event) {
  await tx.query(
    `INSERT INTO mip_outbox_events (
      id, app_id, aggregate_type, aggregate_id, event_type, source_version, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [event.id, event.appId, event.aggregateType, event.aggregateId, event.eventType,
      event.sourceVersion, JSON.stringify(event.payload || {})],
  )
}

async function writeCheckInTransition(tx, transition) {
  await tx.query(
    `INSERT INTO mip_event_checkin_transitions (
      id, app_id, checkin_id, registration_id, event_id, user_id,
      transition_type, checkin_version, registration_version,
      reversal_of_transition_id, actor_user_id, source, revoke_reason, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [transition.id, transition.appId, transition.checkinId, transition.registrationId,
      transition.eventId, transition.userId, transition.transitionType,
      transition.checkinVersion, transition.registrationVersion,
      transition.reversalOfTransitionId || null, transition.actorUserId || null,
      transition.source, transition.revokeReason || null, transition.occurredAt],
  )
}

async function writeAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'ADMIN', ?, ?, ?, ?, ?, ?, ?)`,
    [audit.appId, audit.actorUserId, audit.scopeType, audit.scopeId || null,
      audit.action, audit.resourceType, audit.resourceId || null,
      audit.effectiveRole || null, JSON.stringify(audit.metadata || {})],
  )
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = { assertEventCover, createAdminRepository, writeAudit }
