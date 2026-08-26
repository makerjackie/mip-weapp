'use strict'

const { createHash, randomBytes, randomUUID } = require('node:crypto')
const { createAnnouncementRepository } = require('./announcements')
const { createAdminPrdExtensions } = require('./admin-prd-extensions')
const { createBadgeAdminRepository } = require('./badges')
const { createEventCommentAdminRepository } = require('./event-comment-governance')
const { createEventInsightsRepository } = require('./event-insights')
const { createFullAccessPolicy } = require('./full-access')
const { appendLevelTransition } = require('./level-transitions')
const { assertFixedGrowthRuleUpdate } = require('./growth-rule-catalog')
const { createMessageCampaignRepository } = require('./message-campaigns')
const { createMessageDeliveryReviewRepository } = require('./message-delivery-reviews')
const { createMessageDeliveryRecordRepository } = require('./message-delivery-records')
const { createMessageTemplateRepository } = require('./message-templates')
const { createMatchingAdminRepository } = require('./matching-admin')
const { createOpportunityArchiveRepository } = require('./opportunity-archive')
const { createOpportunityCommentAdminRepository } = require('./opportunity-comments')
const { createAdminAccessRepository } = require('./repositories/access')
const { createDashboardOverviewRepository } = require('./repositories/dashboard-overview')
const { createEventCatalogRepository } = require('./repositories/event-catalogs')
const { createAdminEventRepository } = require('./repositories/events')
const { createMembershipRepository } = require('./repositories/memberships')
const { createAdminOrderRepository } = require('./repositories/orders')
const { createAdminPaymentAttemptRepository } = require('./repositories/payment-attempts')
const { createAdminUserRepository } = require('./repositories/users')
const { createAdminUserContentRepository } = require('./repositories/user-content')
const { createRoleCapabilityPolicyRepository } = require('./role-capability-policies')
const { listOperationalExceptions: readOperationalExceptions } = require('./operational-exceptions')
const { cursorPredicateFor, pageRows } = require('./pagination')
const {
  assertMutationAuthorization,
  assertMutationScope,
  lockMutationAuthorization,
} = require('./mutation-authorization')
const { capabilitiesForBinding } = require('./capabilities')

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
        scopeType: draft.scopeType,
        scopeId: draft.scopeId,
        status: draft.status,
      }
    : {
        id: row.id,
        metric: row.metric,
        sourceEventType: row.source_event_type,
        scopeType: row.scope_type || 'PLATFORM',
        scopeId: row.scope_id || null,
        status: row.status,
      })
  if (!rows.some(row => row.id === ruleId)) {
    next.push({
      id: ruleId,
      metric: draft.metric,
      sourceEventType: draft.sourceEventType,
      scopeType: draft.scopeType,
      scopeId: draft.scopeId,
      status: draft.status,
    })
  }
  return next
}

function assertGrowthRules(rules) {
  const activeKeys = new Set()
  for (const rule of rules) {
    if (rule.status !== 'ACTIVE') continue
    const key = `${rule.sourceEventType}\0${rule.metric}\0${rule.scopeType || 'PLATFORM'}\0${rule.scopeId || ''}`
    if (activeKeys.has(key)) throw codeError('GROWTH_RULE_ACTIVE_CONFLICT')
    activeKeys.add(key)
  }
}

function duplicateConstraint(error) {
  if (error?.code !== 'ER_DUP_ENTRY' && Number(error?.errno) !== 1062) return ''
  return `${error?.message || ''} ${error?.sqlMessage || ''}`
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
  const badgeAdminRepository = createBadgeAdminRepository(database, { createId: id })
  const eventCommentAdminRepository = createEventCommentAdminRepository(database, {
    assertMutationScope: assertScope,
    lockMutationAuthorization: lockMutation,
  })
  const eventInsightsRepository = createEventInsightsRepository(database)
  const dashboardOverviewRepository = createDashboardOverviewRepository(database)
  const opportunityArchiveRepository = createOpportunityArchiveRepository(database, {
    assertScope,
    lockMutation,
    now,
  })
  const opportunityCommentAdminRepository = createOpportunityCommentAdminRepository(database, {
    assertMutationScope: assertScope,
    lockMutationAuthorization: lockMutation,
  })
  const matchingAdminRepository = createMatchingAdminRepository(database, {
    assertMutationScope: assertScope,
    lockMutationAuthorization: lockMutation,
  })
  const roleCapabilityPolicyRepository = createRoleCapabilityPolicyRepository(database, {
    id,
    lockMutation,
  })
  const userContentRepository = createAdminUserContentRepository(database, {
    assertMutationScope: assertScope,
    lockMutationAuthorization: lockMutation,
    writeAudit,
  })
  const adminPrdExtensions = createAdminPrdExtensions(database, {
    assertMutationScope: assertScope,
    id,
    lockMutation,
    now,
  })
  const eventRepository = createAdminEventRepository(database, {
    assertAuthorizedScope,
    assertMutationScope: assertScope,
    authorizeMutation,
    createId: id,
    eventScopeFromRow,
    lockMutationAuthorization: lockMutation,
    maximumEventReminderRecipients: options.maximumEventReminderRecipients,
    now,
    randomBytes: bytes,
    repositorySupport: {
      codeError,
      duplicateConstraint,
      escapeLike,
      iso,
      json,
    },
    sameScope,
    visibleEventsWhere,
    writeAudit,
    writeOutbox,
  })
  const eventCatalogRepository = createEventCatalogRepository(database, {
    assertMutationScope: assertScope,
    createId: id,
    lockMutationAuthorization: lockMutation,
    repositorySupport: { codeError, escapeLike, iso },
    writeAudit,
  })
  const messageCampaignRepository = createMessageCampaignRepository(database, {
    assertMutationScope: assertScope,
    createId: id,
    lockMutationAuthorization: lockMutation,
    maximumRecipients: options.maximumMessageCampaignRecipients,
    now,
  })
  const messageDeliveryReviewRepository = createMessageDeliveryReviewRepository(database, {
    assertMutationScope: assertScope,
    createId: id,
    lockMutationAuthorization: lockMutation,
    now,
  })
  const messageDeliveryRecordRepository = createMessageDeliveryRecordRepository(database)
  const messageTemplateRepository = createMessageTemplateRepository(database, {
    assertMutationScope: assertScope,
    createId: id,
    lockMutationAuthorization: lockMutation,
  })
  const membershipRepository = createMembershipRepository(database, {
    assertMutationScope: assertScope,
    createId: id,
    lockMutationAuthorization: lockMutation,
    now,
    repositorySupport: { codeError, duplicateConstraint, escapeLike, iso },
    writeAudit,
    writeOutbox,
  })
  const {
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
  } = createAdminAccessRepository(database, {
    assertAuthorizedScope,
    assertMutationScope: assertScope,
    authorizeMutation,
    capabilitiesForBinding,
    createId: id,
    eventScopeFromRow,
    lockMutationAuthorization: lockMutation,
    repositorySupport: {
      codeError,
      duplicateConstraint,
      escapeLike,
      iso,
      json,
      placeholders,
    },
    resolveIdentity: caller => fullAccess.loadByIdentity(database, caller),
    writeAudit,
  })
  const {
    changeUserPrimaryBranch,
    getUserDetail,
    getUserScope,
    listPrimaryBranchOptions,
    listUserInfluence,
    listUsers,
    setUserControl,
    updateUserFields,
  } = createAdminUserRepository(database, {
    assertMutationScope: assertScope,
    assertUserMutationScope(authorization, row, authorizedScope) {
      assertScope(authorization, userScopeFromRow(row))
      assertAuthorizedUserScope(row, authorizedScope)
    },
    createId: id,
    lockMutationAuthorization: lockMutation,
    repositorySupport: { codeError, escapeLike, iso, json },
    visibleBranchesWhere,
    writeAudit,
  })
  const {
    authorizeRefundRetry,
    getOrderDetail,
    getOrderScope,
    getRefundScope,
    listOrders,
    listOrderSummary,
    submitRefund,
    summarizeOrders,
  } = createAdminOrderRepository(database, {
    assertMutationScope: assertScope,
    createId: id,
    lockMutationAuthorization: lockMutation,
    now,
    randomBytes: bytes,
  })
  const { listPaymentAttempts } = createAdminPaymentAttemptRepository(database, {
    escapeLike,
    iso,
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
          ) THEN 1 ELSE 0 END) AS active_players,
          SUM(CASE WHEN EXISTS (
            SELECT 1 FROM mip_membership_entitlements me
            WHERE me.app_id = u.app_id AND me.user_id = u.id AND me.status = 'ACTIVE'
              AND me.starts_at <= UTC_TIMESTAMP(3) AND me.ends_at > UTC_TIMESTAMP(3)
          ) AND (
            EXISTS (
              SELECT 1 FROM mip_profile_visits visit
              WHERE visit.app_id = u.app_id AND visit.visitor_user_id = u.id
                AND visit.visited_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
            ) OR EXISTS (
              SELECT 1 FROM mip_profile_interests interest
              WHERE interest.app_id = u.app_id AND interest.actor_user_id = u.id
                AND interest.updated_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
            ) OR EXISTS (
              SELECT 1 FROM mip_referral_intents referral
              WHERE referral.app_id = u.app_id AND referral.actor_user_id = u.id
                AND referral.updated_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
            ) OR EXISTS (
              SELECT 1 FROM mip_event_hearts heart
              WHERE heart.app_id = u.app_id AND heart.voter_user_id = u.id
                AND heart.updated_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
            )
          ) THEN 1 ELSE 0 END) AS interacting_players_30d
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
          SUM(CASE WHEN o.status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published_opportunities,
          SUM(CASE WHEN o.published_at IS NOT NULL THEN 1 ELSE 0 END) AS published_lifecycle_opportunities,
          SUM(CASE WHEN o.published_at IS NOT NULL AND EXISTS (
            SELECT 1 FROM mip_opportunity_team_members member
            WHERE member.app_id = o.app_id AND member.opportunity_id = o.id
              AND member.status = 'ACTIVE'
          ) THEN 1 ELSE 0 END) AS converted_opportunities
         FROM mip_opportunities o
         WHERE o.app_id = ? ${opportunities.platform
          ? ''
          : opportunities.branchIds.length
            ? `AND o.branch_id IN (${placeholders(opportunities.branchIds)})`
            : 'AND 0 = 1'}`,
        [appId, ...(opportunities.platform ? [] : opportunities.branchIds)],
      ),
    ])
    const activePlayers = Number(userCounts?.active_players || 0)
    const interactingPlayers30d = Number(userCounts?.interacting_players_30d || 0)
    const publishedLifecycleOpportunities = Number(opportunityCounts?.published_lifecycle_opportunities || 0)
    const convertedOpportunities = Number(opportunityCounts?.converted_opportunities || 0)
    return {
      totalUsers: Number(userCounts?.total_users || 0),
      newUsers7d: Number(userCounts?.new_users_7d || 0),
      activePlayers,
      interactingPlayers30d,
      playerInteractionRate30d: activePlayers ? Math.round(interactingPlayers30d * 1000 / activePlayers) / 10 : 0,
      totalEvents: Number(eventCounts?.total_events || 0),
      publishedEvents: Number(eventCounts?.published_events || 0),
      pendingRegistrations: Number(eventCounts?.pending_registrations || 0),
      paidOrders: Number(orderCounts.paidOrders || 0),
      pendingRefunds: Number(orderCounts.pendingRefunds || 0),
      totalOpportunities: Number(opportunityCounts?.total_opportunities || 0),
      publishedOpportunities: Number(opportunityCounts?.published_opportunities || 0),
      publishedLifecycleOpportunities,
      convertedOpportunities,
      opportunityConversionRate: publishedLifecycleOpportunities
        ? Math.round(convertedOpportunities * 1000 / publishedLifecycleOpportunities) / 10
        : 0,
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
      return (await eventRepository.listRoster(
        ticket.appId,
        ticket.scopeId,
        ticket.filters,
        maximumRows,
      )).items
    }
    if (ticket.exportType === 'EVENT_ROSTER_ALL') {
      return (await adminPrdExtensions.listRosterAll(
        ticket.appId,
        visibility,
        ticket.filters,
        maximumRows,
      )).items
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
    if (ticket.exportType === 'OPPORTUNITIES') {
      return (await adminPrdExtensions.listOpportunitiesV2(
        ticket.appId,
        visibility,
        ticket.filters,
        maximumRows,
      )).items
    }
    throw codeError('EXPORT_TYPE_INVALID')
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

  async function recordAudit(audit) {
    return database.transaction(tx => writeAudit(tx, audit))
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
      clauses.push(`(o.title LIKE ? ESCAPE '\\\\' OR o.value_summary LIKE ? ESCAPE '\\\\'
        OR o.target_summary LIKE ? ESCAPE '\\\\' OR o.description LIKE ? ESCAPE '\\\\')`)
      const query = `%${escapeLike(filters.query)}%`
      params.push(query, query, query, query)
    }
    if (filters.ownerQuery) {
      clauses.push('owner_profile.nickname LIKE ? ESCAPE \'\\\\\'')
      params.push(`%${escapeLike(filters.ownerQuery)}%`)
    }
    if (filters.cityQuery) {
      clauses.push('(b.city_name LIKE ? ESCAPE \'\\\\\' OR city_tag.label LIKE ? ESCAPE \'\\\\\')')
      const cityQuery = `%${escapeLike(filters.cityQuery)}%`
      params.push(cityQuery, cityQuery)
    }
    if (filters.updatedFrom) { clauses.push('o.updated_at >= ?'); params.push(filters.updatedFrom) }
    if (filters.updatedTo) { clauses.push('o.updated_at <= ?'); params.push(filters.updatedTo) }
    const cursorWhere = cursorPredicateFor('o.updated_at', cursor, 'updatedAt', 'o.id')
    const rows = await database.query(
      `SELECT o.id, o.title, o.value_summary, o.target_summary, o.description,
        o.scope_type, o.branch_id, b.name AS branch_name,
        COALESCE(b.city_name, city_tag.label, '') AS city_name,
        owner_profile.nickname AS owner_nickname,
        o.status, o.content_safety_status, o.referral_count, o.version, o.published_at, o.updated_at,
        o.moderated_at, o.moderation_reason, o.archived_at, o.archive_reason,
        (SELECT GROUP_CONCAT(role.role_key ORDER BY role.role_key SEPARATOR ',')
          FROM mip_opportunity_roles role
          WHERE role.app_id = o.app_id AND role.opportunity_id = o.id) AS role_keys,
        (SELECT GROUP_CONCAT(REPLACE(tag.label, ',', '，') ORDER BY relation.relation, tag.sort_order, tag.id SEPARATOR ',')
          FROM mip_opportunity_tags relation
          INNER JOIN mip_tags tag ON tag.app_id = relation.app_id AND tag.id = relation.tag_id
          WHERE relation.app_id = o.app_id AND relation.opportunity_id = o.id) AS tag_labels
       FROM mip_opportunities o
       LEFT JOIN mip_city_branches b ON b.app_id = o.app_id AND b.id = o.branch_id
       LEFT JOIN mip_tags city_tag ON city_tag.app_id = o.app_id AND city_tag.id = o.city_tag_id
       LEFT JOIN mip_profiles owner_profile ON owner_profile.app_id = o.app_id AND owner_profile.user_id = o.owner_user_id
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
      cityName: row.city_name || '',
      ownerNickname: row.owner_nickname || '未填写昵称',
      targetSummary: row.target_summary || '',
      description: row.description || '',
      roleKeys: row.role_keys ? String(row.role_keys).split(',') : [],
      tags: row.tag_labels ? String(row.tag_labels).split(',') : [],
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
        source_event_type, scope_type, scope_id, effective_from, effective_to,
        status, version FROM mip_growth_rules
       WHERE app_id = ? AND metric IN ('EXPERIENCE', 'CONTRIBUTION')
       ORDER BY status, name, id`,
      [appId],
    )
    return rows
      .filter(row => row.metric === 'EXPERIENCE' || row.metric === 'CONTRIBUTION')
      .map(row => ({
        id: row.id,
        ruleKey: row.rule_key,
        name: row.name,
        metric: row.metric,
        deltaValue: Number(row.delta_value),
        dailyLimitValue: row.daily_limit_value === null ? null : Number(row.daily_limit_value),
        sourceEventType: row.source_event_type,
        scopeType: row.scope_type || 'PLATFORM',
        scopeId: row.scope_id || null,
        effectiveFrom: iso(row.effective_from),
        effectiveTo: iso(row.effective_to),
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
        `SELECT id, rule_key, name, metric, source_event_type, scope_type, scope_id,
                effective_from, effective_to, status, version FROM mip_growth_rules
         WHERE app_id = ? AND metric IN ('EXPERIENCE', 'CONTRIBUTION')
         ORDER BY source_event_type, metric, id FOR UPDATE`,
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
          scope_type = ?, scope_id = ?, effective_from = ?, effective_to = ?,
          status = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [input.draft.deltaValue, input.draft.dailyLimitValue, input.draft.scopeType,
          input.draft.scopeId, input.draft.effectiveFrom,
          input.draft.effectiveTo, input.draft.status, input.appId, ruleId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(ruleId))
      return { id: ruleId, version: input.expectedVersion + 1 }
    })
  }

  async function listGrowthEntries(appId, visibility, filters, pageLimit, cursor = null) {
    const users = visibleBranchesWhere(visibility, 'u')
    const clauses = ["ge.app_id = ?", "ge.metric IN ('EXPERIENCE', 'CONTRIBUTION', 'COIN')", users.sql]
    const params = [appId, ...users.params]
    if (filters.userId) { clauses.push('ge.user_id = ?'); params.push(filters.userId) }
    if (filters.metric) { clauses.push('ge.metric = ?'); params.push(filters.metric) }
    if (filters.sourceEventType) { clauses.push('ge.source_event_type = ?'); params.push(filters.sourceEventType) }
    if (filters.createdFrom) { clauses.push('ge.created_at >= ?'); params.push(filters.createdFrom) }
    if (filters.createdTo) { clauses.push('ge.created_at <= ?'); params.push(filters.createdTo) }
    const cursorWhere = cursorPredicateFor('ge.created_at', cursor, 'createdAt', 'ge.id')
    const rows = await database.query(
      `SELECT ge.id, ge.user_id, p.nickname, ge.source_event_id, ge.source_event_type, ge.metric,
        ge.delta_value, ge.balance_after, ge.adjustment_reason, ge.created_at
       FROM mip_growth_entries ge
       INNER JOIN mip_users u ON u.app_id = ge.app_id AND u.id = ge.user_id
       LEFT JOIN mip_profiles p ON p.app_id = ge.app_id AND p.user_id = ge.user_id
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql} ORDER BY ge.created_at DESC, ge.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows
      .filter(row => ['EXPERIENCE', 'CONTRIBUTION', 'COIN'].includes(row.metric))
      .map(row => ({
        id: row.id,
        userId: row.user_id,
        nickname: row.nickname || '未填写昵称',
        sourceEventId: row.source_event_id,
        sourceEventType: row.source_event_type,
        metric: row.metric,
        deltaValue: Number(row.delta_value),
        balanceBefore: Number(row.balance_after) - Number(row.delta_value),
        balanceAfter: Number(row.balance_after),
        adjustmentReason: row.adjustment_reason || '',
        createdAt: iso(row.created_at),
      }))
    return pageRows(items, pageLimit, row => ({ createdAt: row.createdAt, id: row.id }))
  }

  async function listUnifiedBenefitLedger(input) {
    const membershipUsers = visibleBranchesWhere(input.membershipVisibility, 'membership_user')
    const growthUsers = visibleBranchesWhere(input.growthVisibility, 'growth_user')
    const benefitUsers = visibleBranchesWhere(input.growthVisibility, 'benefit_user')
    const projection = `
      SELECT entitlement.id AS source_id, 'MEMBERSHIP' AS source_kind,
        entitlement.app_id, entitlement.user_id, membership_profile.nickname,
        lifecycle.player_number, COALESCE(plan.name, '会员权益') AS benefit_name,
        entitlement.status, entitlement.starts_at, entitlement.ends_at,
        entitlement.created_at AS occurred_at, entitlement.source_type,
        NULL AS metric, NULL AS delta_value,
        order_row.status AS order_status, order_row.order_type,
        order_row.amount_cents, order_row.paid_at
      FROM mip_membership_entitlements entitlement
      INNER JOIN mip_users membership_user
        ON membership_user.app_id = entitlement.app_id AND membership_user.id = entitlement.user_id
      LEFT JOIN mip_profiles membership_profile
        ON membership_profile.app_id = entitlement.app_id AND membership_profile.user_id = entitlement.user_id
      LEFT JOIN mip_player_lifecycles lifecycle
        ON lifecycle.app_id = entitlement.app_id AND lifecycle.user_id = entitlement.user_id
      LEFT JOIN mip_membership_plans plan
        ON plan.app_id = entitlement.app_id AND plan.id = entitlement.plan_id
      LEFT JOIN mip_orders order_row
        ON order_row.app_id = entitlement.app_id AND order_row.id = entitlement.order_id
      WHERE entitlement.app_id = ? AND ${membershipUsers.sql}
      UNION ALL
      SELECT entry.id AS source_id, 'GROWTH' AS source_kind,
        entry.app_id, entry.user_id, growth_profile.nickname,
        growth_lifecycle.player_number, COALESCE(rule.name, entry.metric) AS benefit_name,
        'RECORDED' AS status, NULL AS starts_at, NULL AS ends_at,
        entry.created_at AS occurred_at, 'GROWTH_ENTRY' AS source_type,
        entry.metric, entry.delta_value,
        NULL AS order_status, NULL AS order_type, NULL AS amount_cents, NULL AS paid_at
      FROM mip_growth_entries entry
      INNER JOIN mip_users growth_user
        ON growth_user.app_id = entry.app_id AND growth_user.id = entry.user_id
      LEFT JOIN mip_profiles growth_profile
        ON growth_profile.app_id = entry.app_id AND growth_profile.user_id = entry.user_id
      LEFT JOIN mip_player_lifecycles growth_lifecycle
        ON growth_lifecycle.app_id = entry.app_id AND growth_lifecycle.user_id = entry.user_id
      LEFT JOIN mip_growth_rules rule
        ON rule.app_id = entry.app_id AND rule.id = entry.rule_id
      WHERE entry.app_id = ? AND ${growthUsers.sql}
      UNION ALL
      SELECT CONCAT('benefit:', benefit_user.id, ':', growth_benefit.id) AS source_id,
        'GROWTH' AS source_kind, growth_benefit.app_id, benefit_user.id,
        benefit_profile.nickname, benefit_lifecycle.player_number,
        growth_benefit.name AS benefit_name, 'ACTIVE' AS status,
        NULL AS starts_at, NULL AS ends_at, growth_benefit.updated_at AS occurred_at,
        'GROWTH_BENEFIT' AS source_type, NULL AS metric, NULL AS delta_value,
        NULL AS order_status, NULL AS order_type, NULL AS amount_cents, NULL AS paid_at
      FROM mip_users benefit_user
      INNER JOIN mip_growth_accounts account
        ON account.app_id = benefit_user.app_id AND account.user_id = benefit_user.id
      INNER JOIN mip_growth_levels current_level
        ON current_level.app_id = benefit_user.app_id AND current_level.status = 'ACTIVE'
       AND current_level.minimum_experience = (
         SELECT MAX(level.minimum_experience)
         FROM mip_growth_levels level
         WHERE level.app_id = benefit_user.app_id AND level.status = 'ACTIVE'
           AND level.minimum_experience <= account.experience_balance
       )
      INNER JOIN mip_growth_level_benefits level_benefit
        ON level_benefit.app_id = current_level.app_id AND level_benefit.level_id = current_level.id
      INNER JOIN mip_growth_benefits growth_benefit
        ON growth_benefit.app_id = level_benefit.app_id AND growth_benefit.id = level_benefit.benefit_id
       AND growth_benefit.status = 'ACTIVE'
      LEFT JOIN mip_profiles benefit_profile
        ON benefit_profile.app_id = benefit_user.app_id AND benefit_profile.user_id = benefit_user.id
      LEFT JOIN mip_player_lifecycles benefit_lifecycle
        ON benefit_lifecycle.app_id = benefit_user.app_id AND benefit_lifecycle.user_id = benefit_user.id
      WHERE benefit_user.app_id = ? AND ${benefitUsers.sql}`
    const clauses = ['projection.app_id = ?']
    const params = [input.appId, ...membershipUsers.params, input.appId, ...growthUsers.params, input.appId, ...benefitUsers.params, input.appId]
    if (input.filters.benefitType) {
      clauses.push('projection.source_kind = ?')
      params.push(input.filters.benefitType)
    }
    if (input.filters.createdFrom) {
      clauses.push('projection.occurred_at >= ?')
      params.push(input.filters.createdFrom)
    }
    if (input.filters.createdTo) {
      clauses.push('projection.occurred_at <= ?')
      params.push(input.filters.createdTo)
    }
    if (input.filters.query) {
      clauses.push('(projection.nickname LIKE ? ESCAPE \'\\\\\' OR CAST(projection.player_number AS CHAR) LIKE ? ESCAPE \'\\\\\')')
      const query = `%${escapeLike(input.filters.query)}%`
      params.push(query, query)
    }
    const cursor = input.cursor ? { ...input.cursor, id: input.cursor.sourceId } : null
    const cursorWhere = cursorPredicateFor('projection.occurred_at', cursor, 'createdAt', 'projection.source_id')
    const rows = await database.query(
      `WITH projection AS (${projection})
       SELECT projection.source_id, projection.source_kind, projection.nickname,
          projection.player_number, projection.benefit_name, projection.status,
          projection.starts_at, projection.ends_at, projection.occurred_at,
          projection.source_type, projection.metric, projection.delta_value,
          projection.order_status, projection.order_type, projection.amount_cents,
          projection.paid_at
       FROM projection
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql}
       ORDER BY projection.occurred_at DESC, projection.source_id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, input.pageSize + 1],
    )
    const page = pageRows(rows.map(row => ({
      sourceId: String(row.source_id),
      benefitType: row.source_kind,
      nickname: row.nickname || '未填写昵称',
      playerNumber: row.player_number === null || row.player_number === undefined ? null : Number(row.player_number),
      benefitName: row.benefit_name || '未提供权益名称',
      status: row.status,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      occurredAt: iso(row.occurred_at),
      sourceType: row.source_type,
      metric: row.metric || null,
      deltaValue: row.delta_value === null || row.delta_value === undefined ? null : Number(row.delta_value),
      order: row.order_status ? {
        status: row.order_status,
        orderType: row.order_type,
        amountCents: Number(row.amount_cents),
        paidAt: iso(row.paid_at),
      } : null,
    })), input.pageSize, row => ({ createdAt: row.occurredAt, sourceId: row.sourceId }))
    return {
      ...page,
      items: page.items.map(({ sourceId, ...item }) => item),
    }
  }

  async function listGrowthLevelTransitions(appId, visibility, filters, pageLimit, cursor = null) {
    const users = visibleBranchesWhere(visibility, 'u')
    const clauses = ['transition.app_id = ?', users.sql]
    const params = [appId, ...users.params]
    if (filters.userId) { clauses.push('transition.user_id = ?'); params.push(filters.userId) }
    if (filters.fromLevelId) { clauses.push('transition.from_level_id = ?'); params.push(filters.fromLevelId) }
    if (filters.toLevelId) { clauses.push('transition.to_level_id = ?'); params.push(filters.toLevelId) }
    if (filters.createdFrom) { clauses.push('transition.created_at >= ?'); params.push(filters.createdFrom) }
    if (filters.createdTo) { clauses.push('transition.created_at <= ?'); params.push(filters.createdTo) }
    const cursorWhere = cursorPredicateFor('transition.created_at', cursor, 'createdAt', 'transition.id')
    const rows = await database.query(
      `SELECT transition.id, transition.user_id, profile.nickname,
         transition.from_level_id, transition.from_level_key, transition.from_level_name,
         transition.to_level_id, transition.to_level_key, transition.to_level_name,
         transition.source_event_id, transition.source_event_type,
         transition.experience_before, transition.experience_after, transition.created_at
       FROM mip_growth_level_transitions transition
       INNER JOIN mip_users u ON u.app_id = transition.app_id AND u.id = transition.user_id
       LEFT JOIN mip_profiles profile ON profile.app_id = transition.app_id AND profile.user_id = transition.user_id
       WHERE ${clauses.join(' AND ')}${cursorWhere.sql}
       ORDER BY transition.created_at DESC, transition.id DESC LIMIT ?`,
      [...params, ...cursorWhere.params, pageLimit + 1],
    )
    const items = rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      nickname: row.nickname || '未填写昵称',
      fromLevel: row.from_level_id ? {
        id: row.from_level_id, levelKey: row.from_level_key || '', name: row.from_level_name || '',
      } : null,
      toLevel: row.to_level_id ? {
        id: row.to_level_id, levelKey: row.to_level_key || '', name: row.to_level_name || '',
      } : null,
      sourceEventId: row.source_event_id,
      sourceEventType: row.source_event_type,
      experienceBefore: Number(row.experience_before),
      experienceAfter: Number(row.experience_after),
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
           AND source_event_id = ? AND metric = ?`,
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
      const column = {
        EXPERIENCE: 'experience_balance',
        CONTRIBUTION: 'contribution_balance',
        COIN: 'coin_balance',
      }[input.metric]
      if (!column) throw codeError('VALIDATION_FAILED')
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
      if (input.metric === 'EXPERIENCE') {
        await appendLevelTransition(tx, {
          createId: id,
          appId: input.appId,
          userId: input.userId,
          sourceEventId,
          sourceEventType: 'ADMIN_ADJUSTMENT',
          experienceBefore: current,
          experienceAfter: next,
        })
      }
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

  return {
    ...announcementRepository,
    ...adminPrdExtensions,
    ...badgeAdminRepository,
    ...eventCommentAdminRepository,
    ...eventCatalogRepository,
    ...eventInsightsRepository,
    ...eventRepository,
    ...dashboardOverviewRepository,
    ...messageCampaignRepository,
    ...messageDeliveryReviewRepository,
    ...messageDeliveryRecordRepository,
    ...messageTemplateRepository,
    ...membershipRepository,
    ...opportunityArchiveRepository,
    ...opportunityCommentAdminRepository,
    ...matchingAdminRepository,
    ...roleCapabilityPolicyRepository,
    ...userContentRepository,
    adjustGrowth,
    authorizeRefundRetry,
    changeBranchStatus,
    claimCommunityReport,
    claimExportBuild,
    consumeExportDownload,
    closeCommunityReport,
    changeUserPrimaryBranch,
    createBranch,
    createExportTicket,
    dashboard,
    getExportTicket,
    getOpportunityScope,
    getOrderDetail,
    getOrderScope,
    getRefundScope,
    getUserScope,
    getUserDetail,
    health,
    listAudit,
    listBranches,
    listCommunityReports,
    listExportRows,
    listGrowthEntries,
    listUnifiedBenefitLedger,
    listGrowthLevelTransitions,
    listGrowthLevels,
    listGrowthRules,
    listOpportunities,
    listOrders,
    listPaymentAttempts,
    listOperationalExceptions,
    listPrimaryBranchOptions,
    listRoleBindings,
    listRoles,
    searchRoleCandidates,
    listUserInfluence,
    listUsers,
    issueExportDownload,
    recordAudit,
    resolveUser,
    saveGrowthLevel,
    saveGrowthRule,
    failExportBuild,
    finishExportBuild,
    setRole,
    setUserControl,
    submitRefund,
    summarizeOrders,
    unpublishOpportunity,
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

async function writeOutbox(tx, event) {
  await tx.query(
    `INSERT INTO mip_outbox_events (
      id, app_id, aggregate_type, aggregate_id, event_type, source_version, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [event.id, event.appId, event.aggregateType, event.aggregateId, event.eventType,
      event.sourceVersion, JSON.stringify(event.payload || {})],
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

module.exports = { createAdminRepository, writeAudit }
