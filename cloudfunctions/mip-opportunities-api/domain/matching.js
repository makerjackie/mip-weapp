'use strict'

const { createHash, randomUUID } = require('node:crypto')
const {
  assertCandidateRef,
  candidateRefEquals,
  createCandidateRef,
} = require('../lib/matching-candidate-ref')
const { createProfileRef } = require('../lib/profile-ref')
const {
  appendAudit,
  appendOutbox,
  iso,
  jsonObject,
  mutualBlockFilter,
  normalizeIdempotencyKey,
  stringValue,
  uuid,
} = require('./common')

const FEEDBACK_TYPES = new Set(['HELPFUL', 'NOT_RELEVANT', 'CONTACTED', 'DISMISSED'])
const MATCH_TYPES = new Set(['ALL', 'TALENT', 'PROJECT'])
const MATCH_SCOPES = new Set(['PLATFORM', 'PRIMARY_BRANCH'])
const DEFAULT_SETTINGS = Object.freeze({
  scopeKey: 'PLATFORM',
  scopeType: 'PLATFORM',
  scopeId: null,
  talentMinScore: 35,
  projectMinScore: 30,
  maximumCandidates: 100,
  externalProviderEnabled: false,
  version: 0,
})

function preferencesDto(notification, opportunity) {
  return {
    notifications: {
      commentsEnabled: notification ? Boolean(notification.comment_notifications_enabled) : true,
      opportunityMatchingEnabled: notification
        ? Boolean(notification.opportunity_matching_notifications_enabled)
        : true,
      hotspotsEnabled: notification ? Boolean(notification.hotspot_notifications_enabled) : false,
      version: Number(notification?.version || 0),
    },
    opportunities: {
      matchingEnabled: opportunity ? Boolean(opportunity.matching_enabled) : true,
      talentRecommendationsEnabled: opportunity
        ? Boolean(opportunity.talent_recommendations_enabled)
        : true,
      projectRecommendationsEnabled: opportunity
        ? Boolean(opportunity.project_recommendations_enabled)
        : true,
      discoverableForMatching: opportunity ? Boolean(opportunity.discoverable_for_matching) : true,
      matchingScope: MATCH_SCOPES.has(opportunity?.matching_scope)
        ? opportunity.matching_scope
        : 'PRIMARY_BRANCH',
      version: Number(opportunity?.version || 0),
    },
  }
}

async function getMatchingPreferences(database, caller) {
  assertAuthenticated(caller)
  const [notification, opportunity] = await Promise.all([
    database.one(
      `SELECT comment_notifications_enabled, opportunity_matching_notifications_enabled,
              hotspot_notifications_enabled, version
       FROM mip_user_notification_preferences WHERE app_id = ? AND user_id = ?`,
      [caller.appId, caller.userId],
    ),
    database.one(
      `SELECT matching_enabled, talent_recommendations_enabled,
              project_recommendations_enabled, discoverable_for_matching,
              matching_scope, version
       FROM mip_user_opportunity_preferences WHERE app_id = ? AND user_id = ?`,
      [caller.appId, caller.userId],
    ),
  ])
  return preferencesDto(notification, opportunity)
}

async function saveMatchingPreferences(database, caller, input = {}) {
  assertAuthenticated(caller)
  const draft = normalizePreferences(input.preferences)
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
  const requestHash = hash({ draft })
  return database.transaction(async (tx) => {
    await lockActiveUser(tx, caller.appId, caller.userId)
    const replay = await lockIdempotency(tx, caller, 'matching.preferences.save', idempotencyKey, requestHash)
    if (replay) { return replay }
    const [notification, opportunity] = await Promise.all([
      tx.one(
        `SELECT version FROM mip_user_notification_preferences
         WHERE app_id = ? AND user_id = ? FOR UPDATE`,
        [caller.appId, caller.userId],
      ),
      tx.one(
        `SELECT version FROM mip_user_opportunity_preferences
         WHERE app_id = ? AND user_id = ? FOR UPDATE`,
        [caller.appId, caller.userId],
      ),
    ])
    if (Number(notification?.version || 0) !== draft.notificationVersion
      || Number(opportunity?.version || 0) !== draft.opportunityVersion) {
      throw new Error('CONFLICT')
    }
    await upsertNotificationPreferences(tx, caller, draft, Boolean(notification))
    await upsertOpportunityPreferences(tx, caller, draft, Boolean(opportunity))
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: 'matching.preferences.updated',
      resourceType: 'USER_MATCHING_PREFERENCES',
      resourceId: caller.userId,
      metadata: {
        notificationVersion: draft.notificationVersion + 1,
        opportunityVersion: draft.opportunityVersion + 1,
      },
    })
    const response = {
      notifications: {
        commentsEnabled: draft.commentsEnabled,
        opportunityMatchingEnabled: draft.opportunityMatchingNotificationsEnabled,
        hotspotsEnabled: draft.hotspotsEnabled,
        version: draft.notificationVersion + 1,
      },
      opportunities: {
        matchingEnabled: draft.matchingEnabled,
        talentRecommendationsEnabled: draft.talentRecommendationsEnabled,
        projectRecommendationsEnabled: draft.projectRecommendationsEnabled,
        discoverableForMatching: draft.discoverableForMatching,
        matchingScope: draft.matchingScope,
        version: draft.opportunityVersion + 1,
      },
    }
    await completeIdempotency(tx, caller, 'matching.preferences.save', idempotencyKey, response)
    return response
  })
}

async function createMatchingRequest(database, provider, caller, input = {}, options = {}) {
  assertAuthenticated(caller)
  const sourceId = stringValue(input.opportunityId, 36, 'VALIDATION_FAILED')
  if (!uuid(sourceId)) { throw new Error('VALIDATION_FAILED') }
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
  const requestedByType = options.requestedByType === 'ADMIN' ? 'ADMIN' : 'USER'
  const requesterUserId = options.requesterUserId || caller.userId
  const requestHash = hash({ sourceId, requestedByType, requesterUserId })
  const source = await loadSource(database, caller.appId, requesterUserId, sourceId, requestedByType === 'USER')
  if (options.expectedSourceVersion !== undefined
    && Number(source.version) !== Number(options.expectedSourceVersion)) {
    throw new Error('CONFLICT')
  }
  if (typeof options.authorize === 'function') { await options.authorize(database, source) }
  const replay = await database.one(
    `SELECT id, request_hash FROM mip_matching_requests
     WHERE app_id = ? AND requested_by_user_id = ? AND idempotency_key = ?`,
    [caller.appId, caller.userId, idempotencyKey],
  )
  if (replay) {
    if (replay.request_hash !== requestHash) { throw new Error('CONFLICT') }
    return matchingRequestSummary(database, caller, replay.id)
  }
  const preferences = await loadOpportunityPreferences(database, caller.appId, requesterUserId)
  if (!preferences.matchingEnabled) { throw new Error('MATCHING_DISABLED') }
  const settings = await loadSettings(database, caller.appId, source.branch_id)
  const requestId = randomUUID()
  const features = await loadCandidates(database, caller, source, preferences, settings)
  const localCandidates = rankLocalCandidates(source, features).map(candidate => ({
    ...candidate,
    candidateRef: createCandidateRef({
      appId: caller.appId,
      requestId,
      resultVersion: 1,
      candidateType: candidate.type,
      candidateId: candidate.id,
    }, caller.matchingReferenceSecret),
  }))
  const providerResult = settings.externalProviderEnabled && provider?.configured
    ? await provider.rank({ candidates: localCandidates })
    : { providerKey: 'LOCAL', candidates: localCandidates }
  const candidates = applyLimits(providerResult.candidates, settings, preferences)
  return database.transaction(async (tx) => {
    if (typeof options.authorizeFinal === 'function') { await options.authorizeFinal(tx, source) }
    await lockActiveUser(tx, caller.appId, requesterUserId)
    const stored = await tx.one(
      `SELECT id, request_hash FROM mip_matching_requests
       WHERE app_id = ? AND requested_by_user_id = ? AND idempotency_key = ?`,
      [caller.appId, caller.userId, idempotencyKey],
    )
    if (stored) {
      if (stored.request_hash !== requestHash) { throw new Error('CONFLICT') }
      return matchingRequestSummary(tx, caller, stored.id)
    }
    const current = await lockCurrentSource(
      tx,
      caller.appId,
      requesterUserId,
      sourceId,
      requestedByType === 'USER',
    )
    if (!current || current.owner_user_id !== source.owner_user_id
      || (current.branch_id || null) !== (source.branch_id || null)
      || Number(current.version) !== Number(source.version)
      || (options.expectedSourceVersion !== undefined
        && Number(current.version) !== Number(options.expectedSourceVersion))) {
      throw new Error('CONFLICT')
    }
    const currentPreferences = await loadOpportunityPreferences(tx, caller.appId, requesterUserId, true)
    if (!samePreferences(preferences, currentPreferences) || !currentPreferences.matchingEnabled) {
      throw new Error('CONFLICT')
    }
    const currentSettings = await loadSettings(tx, caller.appId, current.branch_id, true)
    if (!sameSettings(settings, currentSettings)) { throw new Error('CONFLICT') }
    await tx.query(
      `INSERT INTO mip_matching_requests (
         id, app_id, requester_user_id, source_opportunity_id, requested_by_type,
         requested_by_user_id, idempotency_key, request_hash, status, provider_key,
         provider_fallback_reason, settings_scope_key, settings_version,
         source_version, result_version, result_count, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, 1, ?, UTC_TIMESTAMP(3))`,
      [requestId, caller.appId, requesterUserId, sourceId, requestedByType, caller.userId, idempotencyKey, requestHash, providerResult.providerKey, providerResult.fallbackReason || null, settings.scopeKey, settings.version, source.version, candidates.length],
    )
    const counters = { TALENT: 0, PROJECT: 0 }
    for (const candidate of candidates) {
      counters[candidate.type] += 1
      await tx.query(
        `INSERT INTO mip_matching_results (
           app_id, request_id, result_version, candidate_type, candidate_id,
           rank_no, score, explanation_json
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
        [caller.appId, requestId, candidate.type, candidate.id, counters[candidate.type], candidate.score, JSON.stringify(candidate.explanation)],
      )
    }
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      actorType: requestedByType,
      action: requestedByType === 'ADMIN' ? 'matching.request.recomputed' : 'matching.request.completed',
      resourceType: 'MATCHING_REQUEST',
      resourceId: requestId,
      metadata: {
        sourceOpportunityId: sourceId,
        providerKey: providerResult.providerKey,
        fallbackReason: providerResult.fallbackReason || null,
        resultCount: candidates.length,
        settingsScopeKey: settings.scopeKey,
        settingsVersion: settings.version,
        sourceVersion: Number(source.version),
      },
    })
    if (preferences.matchingNotificationsEnabled && candidates.length) {
      await appendOutbox(tx, {
        appId: caller.appId,
        aggregateType: 'MATCHING_REQUEST',
        aggregateId: requestId,
        eventType: 'matching.recommendation_ready',
        sourceVersion: 1,
        payload: {},
      })
    }
    return matchingRequestSummary(tx, caller, requestId)
  })
}

async function listMatchingRequests(database, caller, input = {}) {
  assertAuthenticated(caller)
  const limit = pageLimit(input.limit)
  const cursor = decodeRankCursor(input.cursor)
  const where = ['request.app_id = ?', 'request.requester_user_id = ?', 'request.status = \'COMPLETED\'']
  const params = [caller.appId, caller.userId]
  if (cursor) {
    where.push('(request.created_at < ? OR (request.created_at = ? AND request.id < ?))')
    params.push(cursor.createdAt, cursor.createdAt, cursor.id)
  }
  const rows = await database.query(
    `SELECT request.id, request.source_opportunity_id, request.provider_key,
            request.provider_fallback_reason, request.source_version,
            request.result_version, request.result_count, request.created_at,
            source.title AS source_title
     FROM mip_matching_requests request
     INNER JOIN mip_opportunities source
       ON source.app_id = request.app_id AND source.id = request.source_opportunity_id
     WHERE ${where.join(' AND ')}
     ORDER BY request.created_at DESC, request.id DESC LIMIT ${limit + 1}`,
    params,
  )
  const page = rows.slice(0, limit)
  return {
    items: page.map(requestDto),
    nextCursor: rows.length > limit && page.length
      ? encodeRankCursor({ createdAt: iso(page.at(-1).created_at), id: page.at(-1).id })
      : undefined,
  }
}

async function listMatchingResults(database, caller, input = {}) {
  assertAuthenticated(caller)
  if (!uuid(input.requestId)) { throw new Error('NOT_FOUND') }
  const type = String(input.type || 'ALL').toUpperCase()
  if (!MATCH_TYPES.has(type)) { throw new Error('VALIDATION_FAILED') }
  const cursor = decodeResultCursor(input.cursor)
  const limit = pageLimit(input.limit)
  const request = await database.one(
    `SELECT id, requester_user_id, source_opportunity_id, result_version, status
     FROM mip_matching_requests WHERE app_id = ? AND id = ?`,
    [caller.appId, input.requestId],
  )
  if (!request || request.requester_user_id !== caller.userId || request.status !== 'COMPLETED') {
    throw new Error('NOT_FOUND')
  }
  const clauses = [
    'result.app_id = ?',
    'result.request_id = ?',
    'result.result_version = ?',
  ]
  const params = [caller.appId, request.id, request.result_version]
  if (type !== 'ALL') {
    clauses.push('result.candidate_type = ?')
    params.push(type)
  }
  if (cursor) {
    clauses.push('(result.candidate_type > ? OR (result.candidate_type = ? AND result.rank_no > ?))')
    params.push(cursor.type, cursor.type, cursor.rank)
  }
  const rows = await database.query(
    `SELECT result.candidate_type, result.candidate_id, result.rank_no, result.score,
            result.explanation_json,
            profile.nickname, profile.headline, profile.visibility_json,
            avatar.cloud_file_id AS avatar_file_id,
            project.title AS project_title, project.value_summary AS project_value_summary,
            project.target_summary AS project_target_summary, project.status AS project_status,
            project.owner_user_id AS project_owner_user_id,
            feedback.feedback_type, feedback.reason AS feedback_reason
     FROM mip_matching_results result
     INNER JOIN mip_matching_requests matching_request
       ON matching_request.app_id = result.app_id AND matching_request.id = result.request_id
         AND matching_request.status = 'COMPLETED'
     INNER JOIN mip_opportunities source
       ON source.app_id = matching_request.app_id
         AND source.id = matching_request.source_opportunity_id AND source.status = 'PUBLISHED'
     INNER JOIN mip_users requester
       ON requester.app_id = matching_request.app_id
         AND requester.id = matching_request.requester_user_id AND requester.status = 'ACTIVE'
     LEFT JOIN mip_user_opportunity_preferences requester_preference
       ON requester_preference.app_id = requester.app_id
         AND requester_preference.user_id = requester.id
     LEFT JOIN mip_users candidate_user
       ON result.candidate_type = 'TALENT' AND candidate_user.app_id = result.app_id
         AND candidate_user.id = result.candidate_id AND candidate_user.status = 'ACTIVE'
     LEFT JOIN mip_profiles profile
       ON profile.app_id = candidate_user.app_id AND profile.user_id = candidate_user.id
     LEFT JOIN mip_user_opportunity_preferences candidate_preference
       ON candidate_preference.app_id = candidate_user.app_id
         AND candidate_preference.user_id = candidate_user.id
     LEFT JOIN mip_media_assets avatar
       ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id AND avatar.status = 'READY'
     LEFT JOIN mip_opportunities project
       ON result.candidate_type = 'PROJECT' AND project.app_id = result.app_id
         AND project.id = result.candidate_id AND project.status = 'PUBLISHED'
     LEFT JOIN mip_matching_feedback feedback
       ON feedback.app_id = result.app_id AND feedback.request_id = result.request_id
         AND feedback.result_version = result.result_version
         AND feedback.candidate_type = result.candidate_type
         AND feedback.candidate_id = result.candidate_id
         AND feedback.id = (
           SELECT latest.id FROM mip_matching_feedback latest
           WHERE latest.app_id = result.app_id AND latest.request_id = result.request_id
             AND latest.result_version = result.result_version
             AND latest.candidate_type = result.candidate_type
             AND latest.candidate_id = result.candidate_id
             AND latest.actor_user_id = ?
           ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
         )
     WHERE ${clauses.join(' AND ')}
       AND COALESCE(requester_preference.matching_enabled, 1) = 1
       AND ((result.candidate_type = 'TALENT'
           AND COALESCE(requester_preference.talent_recommendations_enabled, 1) = 1
           AND candidate_user.id IS NOT NULL
           AND COALESCE(candidate_preference.discoverable_for_matching, 1) = 1
           AND (
             COALESCE(candidate_preference.matching_scope, 'PRIMARY_BRANCH') = 'PLATFORM'
             OR (
               COALESCE(
                 JSON_UNQUOTE(JSON_EXTRACT(profile.visibility_json, '$.primaryBranch')),
                 'true'
               ) <> 'false'
               AND
               COALESCE(
                 source.branch_id,
                 CASE
                   WHEN COALESCE(requester_preference.matching_scope, 'PRIMARY_BRANCH') = 'PRIMARY_BRANCH'
                     THEN requester.primary_branch_id
                   ELSE NULL
                 END
               ) IS NOT NULL
               AND candidate_user.primary_branch_id = COALESCE(
                 source.branch_id,
                 CASE
                   WHEN COALESCE(requester_preference.matching_scope, 'PRIMARY_BRANCH') = 'PRIMARY_BRANCH'
                     THEN requester.primary_branch_id
                   ELSE NULL
                 END
               )
             )
           ))
         OR (result.candidate_type = 'PROJECT'
           AND COALESCE(requester_preference.project_recommendations_enabled, 1) = 1
           AND project.id IS NOT NULL
           AND (
             COALESCE(
               source.branch_id,
               CASE
                 WHEN COALESCE(requester_preference.matching_scope, 'PRIMARY_BRANCH') = 'PRIMARY_BRANCH'
                   THEN requester.primary_branch_id
                 ELSE NULL
               END
             ) IS NULL
             OR project.branch_id IS NULL
             OR project.branch_id = COALESCE(
               source.branch_id,
               CASE
                 WHEN COALESCE(requester_preference.matching_scope, 'PRIMARY_BRANCH') = 'PRIMARY_BRANCH'
                   THEN requester.primary_branch_id
                 ELSE NULL
               END
             )
           )))
       AND NOT EXISTS (
         SELECT 1 FROM mip_user_blocks block
         WHERE block.app_id = result.app_id AND block.status = 'ACTIVE'
           AND (
             (block.blocker_user_id = ? AND block.blocked_user_id = CASE
               WHEN result.candidate_type = 'TALENT' THEN result.candidate_id ELSE project.owner_user_id END)
             OR (block.blocked_user_id = ? AND block.blocker_user_id = CASE
               WHEN result.candidate_type = 'TALENT' THEN result.candidate_id ELSE project.owner_user_id END)
           )
       )
     ORDER BY result.candidate_type, result.rank_no LIMIT ${limit + 1}`,
    [caller.userId, ...params, caller.userId, caller.userId],
  )
  const page = rows.slice(0, limit)
  return {
    requestId: request.id,
    resultVersion: Number(request.result_version),
    items: page.map(row => resultDto(row, caller, request)),
    nextCursor: rows.length > limit && page.length
      ? encodeResultCursor({ type: page.at(-1).candidate_type, rank: Number(page.at(-1).rank_no) })
      : undefined,
  }
}

async function saveMatchingFeedback(database, caller, input = {}) {
  assertAuthenticated(caller)
  if (!uuid(input.requestId)) { throw new Error('VALIDATION_FAILED') }
  const candidateRef = assertCandidateRef(input.candidateRef)
  const candidateType = String(input.candidateType || '').toUpperCase()
  if (!['TALENT', 'PROJECT'].includes(candidateType)) { throw new Error('VALIDATION_FAILED') }
  const feedbackType = String(input.feedbackType || '').toUpperCase()
  if (!FEEDBACK_TYPES.has(feedbackType)) { throw new Error('VALIDATION_FAILED') }
  const reason = stringValue(input.reason, 240, 'VALIDATION_FAILED', false) || null
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
  return database.transaction(async (tx) => {
    await lockActiveUser(tx, caller.appId, caller.userId)
    const request = await tx.one(
      `SELECT requester_user_id, result_version FROM mip_matching_requests
       WHERE app_id = ? AND id = ? AND status = 'COMPLETED'`,
      [caller.appId, input.requestId],
    )
    if (!request || request.requester_user_id !== caller.userId) { throw new Error('NOT_FOUND') }
    const candidateRows = await tx.query(
      `SELECT candidate_id FROM mip_matching_results
       WHERE app_id = ? AND request_id = ? AND result_version = ?
         AND candidate_type = ? ORDER BY candidate_id`,
      [caller.appId, input.requestId, request.result_version, candidateType],
    )
    const candidateId = resolveCandidateId(candidateRows, {
      appId: caller.appId,
      requestId: input.requestId,
      resultVersion: Number(request.result_version),
      candidateType,
      candidateRef,
    }, caller.matchingReferenceSecret)
    const requestHash = hash({
      requestId: input.requestId,
      resultVersion: Number(request.result_version),
      candidateType,
      candidateId,
      feedbackType,
      reason,
    })
    const stored = await tx.one(
      `SELECT id, request_hash, feedback_type, reason FROM mip_matching_feedback
       WHERE app_id = ? AND actor_user_id = ? AND idempotency_key = ?`,
      [caller.appId, caller.userId, idempotencyKey],
    )
    if (stored) {
      if (stored.request_hash !== requestHash) { throw new Error('CONFLICT') }
      return { id: stored.id, feedbackType: stored.feedback_type, reason: stored.reason || undefined }
    }
    const id = randomUUID()
    await tx.query(
      `INSERT INTO mip_matching_feedback (
         id, app_id, request_id, result_version, candidate_type, candidate_id,
         actor_user_id, feedback_type, reason, idempotency_key, request_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, caller.appId, input.requestId, request.result_version, candidateType, candidateId, caller.userId, feedbackType, reason, idempotencyKey, requestHash],
    )
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: 'matching.feedback.recorded',
      resourceType: 'MATCHING_REQUEST',
      resourceId: input.requestId,
      metadata: { candidateType, candidateRef, feedbackType },
    })
    return { id, feedbackType, reason: reason || undefined }
  })
}

async function loadSource(database, appId, requesterUserId, opportunityId, enforceAccess) {
  const row = await database.one(
    `SELECT opportunity.id, opportunity.owner_user_id, opportunity.branch_id,
            opportunity.city_tag_id, opportunity.title, opportunity.version,
            requester.primary_branch_id,
            JSON_ARRAYAGG(DISTINCT role.role_key) AS role_keys
     FROM mip_opportunities opportunity
     INNER JOIN mip_users requester
       ON requester.app_id = opportunity.app_id AND requester.id = ? AND requester.status = 'ACTIVE'
     LEFT JOIN mip_opportunity_roles role
       ON role.app_id = opportunity.app_id AND role.opportunity_id = opportunity.id
     WHERE opportunity.app_id = ? AND opportunity.id = ? AND opportunity.status = 'PUBLISHED'
       AND (? = 0 OR opportunity.owner_user_id = ? OR EXISTS (
         SELECT 1 FROM mip_opportunity_team_members member
         WHERE member.app_id = opportunity.app_id AND member.opportunity_id = opportunity.id
           AND member.user_id = ? AND member.status = 'ACTIVE'
       ))
     GROUP BY opportunity.id, opportunity.owner_user_id, opportunity.branch_id,
       opportunity.city_tag_id, opportunity.title, opportunity.version, requester.primary_branch_id`,
    [requesterUserId, appId, opportunityId, enforceAccess ? 1 : 0, requesterUserId, requesterUserId],
  )
  if (!row) { throw new Error('NOT_FOUND') }
  const tags = await database.query(
    `SELECT relation, tag_id FROM mip_opportunity_tags
     WHERE app_id = ? AND opportunity_id = ? ORDER BY relation, tag_id`,
    [appId, opportunityId],
  )
  return {
    ...row,
    requester_user_id: requesterUserId,
    roleKeys: jsonArray(row.role_keys),
    industryTagIds: tags.filter(item => item.relation === 'INDUSTRY').map(item => item.tag_id),
    abilityTagIds: tags.filter(item => item.relation === 'ABILITY').map(item => item.tag_id),
  }
}

async function loadOpportunityPreferences(database, appId, userId, lock = false) {
  const [opportunity, notification] = await Promise.all([
    database.one(
      `SELECT matching_enabled, talent_recommendations_enabled,
              project_recommendations_enabled, matching_scope, version
       FROM mip_user_opportunity_preferences WHERE app_id = ? AND user_id = ?${lock ? ' FOR UPDATE' : ''}`,
      [appId, userId],
    ),
    database.one(
      `SELECT opportunity_matching_notifications_enabled, version
       FROM mip_user_notification_preferences WHERE app_id = ? AND user_id = ?${lock ? ' FOR UPDATE' : ''}`,
      [appId, userId],
    ),
  ])
  return {
    matchingEnabled: opportunity ? Boolean(opportunity.matching_enabled) : true,
    talentEnabled: opportunity ? Boolean(opportunity.talent_recommendations_enabled) : true,
    projectEnabled: opportunity ? Boolean(opportunity.project_recommendations_enabled) : true,
    matchingScope: MATCH_SCOPES.has(opportunity?.matching_scope)
      ? opportunity.matching_scope
      : 'PRIMARY_BRANCH',
    matchingNotificationsEnabled: notification
      ? Boolean(notification.opportunity_matching_notifications_enabled)
      : true,
    opportunityVersion: Number(opportunity?.version || 0),
    notificationVersion: Number(notification?.version || 0),
  }
}

async function loadSettings(database, appId, branchId, lock = false) {
  const rows = await database.query(
    `SELECT scope_key, scope_type, scope_id, talent_min_score, project_min_score,
            maximum_candidates, external_provider_enabled, version
     FROM mip_matching_settings
     WHERE app_id = ? AND scope_key IN ('PLATFORM', ?)
     ORDER BY CASE WHEN scope_key = ? THEN 0 ELSE 1 END LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [appId, branchId ? `BRANCH:${branchId}` : 'PLATFORM', branchId ? `BRANCH:${branchId}` : 'PLATFORM'],
  )
  const row = rows[0]
  return row
    ? {
        scopeKey: row.scope_key,
        scopeType: row.scope_type,
        scopeId: row.scope_id || null,
        talentMinScore: Number(row.talent_min_score),
        projectMinScore: Number(row.project_min_score),
        maximumCandidates: Number(row.maximum_candidates),
        externalProviderEnabled: Boolean(row.external_provider_enabled),
        version: Number(row.version),
      }
    : { ...DEFAULT_SETTINGS }
}

async function loadCandidates(database, caller, source, preferences, settings) {
  const effectiveBranchId = source.branch_id || (preferences.matchingScope === 'PRIMARY_BRANCH'
    ? source.primary_branch_id
    : null)
  const block = mutualBlockFilter(source.requester_user_id, 'candidate.id', 'candidate.app_id')
  const talentRows = preferences.talentEnabled
    ? await database.query(
        `SELECT candidate.id, candidate.primary_branch_id, profile.visibility_json,
            JSON_ARRAYAGG(DISTINCT card.role_key) AS role_keys
     FROM mip_users candidate
     INNER JOIN mip_profiles profile
       ON profile.app_id = candidate.app_id AND profile.user_id = candidate.id
     INNER JOIN mip_cooperation_cards card
       ON card.app_id = candidate.app_id AND card.owner_user_id = candidate.id
         AND card.status = 'PUBLISHED'
     LEFT JOIN mip_user_opportunity_preferences preference
       ON preference.app_id = candidate.app_id AND preference.user_id = candidate.id
     WHERE candidate.app_id = ? AND candidate.status = 'ACTIVE' AND candidate.id <> ?
       AND COALESCE(preference.discoverable_for_matching, 1) = 1
       AND (COALESCE(preference.matching_scope, 'PRIMARY_BRANCH') = 'PLATFORM'
         OR (
           COALESCE(
             JSON_UNQUOTE(JSON_EXTRACT(profile.visibility_json, '$.primaryBranch')),
             'true'
           ) <> 'false'
           AND ? IS NOT NULL AND candidate.primary_branch_id = ?
         ))
       ${block.sql ? `AND ${block.sql}` : ''}
     GROUP BY candidate.id, candidate.primary_branch_id, profile.visibility_json
     ORDER BY candidate.id
     LIMIT ${Math.max(10, settings.maximumCandidates * 3)}`,
        [caller.appId, source.requester_user_id, effectiveBranchId, effectiveBranchId, ...block.params],
      )
    : []
  const talentIds = talentRows.map(row => row.id)
  const talentTags = talentIds.length
    ? await database.query(
        `SELECT relation.user_id, relation.relation, relation.tag_id
     FROM mip_profile_tags relation
     WHERE relation.app_id = ? AND relation.user_id IN (${talentIds.map(() => '?').join(', ')})
       AND relation.relation IN ('PRIMARY_INDUSTRY', 'ABILITY')
     ORDER BY relation.user_id, relation.relation, relation.tag_id`,
        [caller.appId, ...talentIds],
      )
    : []
  const tagsByUser = groupCandidateTags(talentTags)
  const talents = talentRows.map((row) => {
    const visibility = jsonObject(row.visibility_json)
    const tags = tagsByUser.get(row.id) || { industry: [], ability: [] }
    return {
      id: row.id,
      type: 'TALENT',
      roleKeys: jsonArray(row.role_keys),
      industryTagIds: visibility.industry === false ? [] : tags.industry,
      abilityTagIds: visibility.abilities === false ? [] : tags.ability,
      branchMatched: Boolean(
        visibility.primaryBranch !== false
        && effectiveBranchId
        && row.primary_branch_id === effectiveBranchId,
      ),
      cityMatched: false,
    }
  })
  const projectBlock = mutualBlockFilter(source.requester_user_id, 'project.owner_user_id', 'project.app_id')
  const projectRows = preferences.projectEnabled
    ? await database.query(
        `SELECT project.id, project.branch_id, project.city_tag_id,
            JSON_ARRAYAGG(DISTINCT role.role_key) AS role_keys
     FROM mip_opportunities project
     LEFT JOIN mip_opportunity_roles role
       ON role.app_id = project.app_id AND role.opportunity_id = project.id
     WHERE project.app_id = ? AND project.status = 'PUBLISHED'
       AND project.id <> ? AND project.owner_user_id <> ?
       AND (? IS NULL OR project.branch_id IS NULL OR project.branch_id = ?)
       ${projectBlock.sql ? `AND ${projectBlock.sql}` : ''}
     GROUP BY project.id, project.branch_id, project.city_tag_id
     ORDER BY project.id
     LIMIT ${Math.max(10, settings.maximumCandidates * 3)}`,
        [caller.appId, source.id, source.requester_user_id, effectiveBranchId, effectiveBranchId, ...projectBlock.params],
      )
    : []
  const projectIds = projectRows.map(row => row.id)
  const projectTags = projectIds.length
    ? await database.query(
        `SELECT opportunity_id, relation, tag_id FROM mip_opportunity_tags
     WHERE app_id = ? AND opportunity_id IN (${projectIds.map(() => '?').join(', ')})
     ORDER BY opportunity_id, relation, tag_id`,
        [caller.appId, ...projectIds],
      )
    : []
  const tagsByProject = groupOpportunityTags(projectTags)
  const projects = projectRows.map((row) => {
    const tags = tagsByProject.get(row.id) || { industry: [], ability: [] }
    return {
      id: row.id,
      type: 'PROJECT',
      roleKeys: jsonArray(row.role_keys),
      industryTagIds: tags.industry,
      abilityTagIds: tags.ability,
      branchMatched: Boolean(effectiveBranchId && row.branch_id === effectiveBranchId),
      cityMatched: Boolean(source.city_tag_id && row.city_tag_id === source.city_tag_id),
    }
  })
  return [...talents, ...projects]
}

function rankLocalCandidates(source, candidates) {
  return candidates.map((candidate) => {
    const weights = candidate.type === 'TALENT'
      ? { role: 45, industry: 20, ability: 20, location: 15 }
      : { role: 35, industry: 25, ability: 25, location: 15 }
    const explanation = []
    let score = 0
    if (overlaps(source.roleKeys, candidate.roleKeys)) {
      score += weights.role
      explanation.push({ key: 'ROLE', label: '合作角色符合机会需求', weight: weights.role })
    }
    if (overlaps(source.industryTagIds, candidate.industryTagIds)) {
      score += weights.industry
      explanation.push({ key: 'INDUSTRY', label: '行业标签相符', weight: weights.industry })
    }
    if (overlaps(source.abilityTagIds, candidate.abilityTagIds)) {
      score += weights.ability
      explanation.push({ key: 'ABILITY', label: '能力标签相符', weight: weights.ability })
    }
    if (candidate.branchMatched || candidate.cityMatched) {
      score += weights.location
      explanation.push({
        key: candidate.branchMatched ? 'BRANCH' : 'CITY',
        label: candidate.branchMatched ? '城市分会范围相符' : '城市范围相符',
        weight: weights.location,
      })
    }
    return { ...candidate, score, explanation }
  }).sort(compareCandidate)
}

function applyLimits(candidates, settings, preferences) {
  const limits = { TALENT: settings.talentMinScore, PROJECT: settings.projectMinScore }
  const enabled = { TALENT: preferences.talentEnabled, PROJECT: preferences.projectEnabled }
  return candidates
    .filter(candidate => enabled[candidate.type] && candidate.score >= limits[candidate.type])
    .sort(compareCandidate)
    .slice(0, settings.maximumCandidates)
}

async function matchingRequestSummary(database, caller, requestId) {
  const row = await database.one(
    `SELECT request.id, request.source_opportunity_id, request.provider_key,
            request.provider_fallback_reason, request.source_version,
            request.result_version, request.result_count, request.created_at,
            source.title AS source_title
     FROM mip_matching_requests request
     INNER JOIN mip_opportunities source
       ON source.app_id = request.app_id AND source.id = request.source_opportunity_id
     WHERE request.app_id = ? AND request.id = ? AND request.status = 'COMPLETED'`,
    [caller.appId, requestId],
  )
  if (!row) { throw new Error('CONFLICT') }
  return requestDto(row)
}

function requestDto(row) {
  return {
    id: row.id,
    sourceOpportunity: { id: row.source_opportunity_id, title: row.source_title },
    provider: row.provider_key,
    fallbackReason: row.provider_fallback_reason || undefined,
    sourceVersion: Number(row.source_version),
    resultVersion: Number(row.result_version),
    resultCount: Number(row.result_count),
    createdAt: iso(row.created_at),
  }
}

function resultDto(row, caller, request) {
  const storedExplanation = explanationArray(row.explanation_json)
  const candidateRef = createCandidateRef({
    appId: caller.appId,
    requestId: request.id,
    resultVersion: Number(request.result_version),
    candidateType: row.candidate_type,
    candidateId: row.candidate_id,
  }, caller.matchingReferenceSecret)
  if (row.candidate_type === 'PROJECT') {
    return {
      type: 'PROJECT',
      candidateRef,
      rank: Number(row.rank_no),
      score: Number(row.score),
      explanation: storedExplanation,
      project: {
        id: row.candidate_id,
        title: row.project_title,
        valueSummary: row.project_value_summary,
        targetSummary: row.project_target_summary,
      },
      feedback: feedbackDto(row),
    }
  }
  const visibility = jsonObject(row.visibility_json)
  const explanation = storedExplanation.filter((item) => {
    if (item.key === 'INDUSTRY') { return visibility.industry !== false }
    if (item.key === 'ABILITY') { return visibility.abilities !== false }
    if (item.key === 'BRANCH') { return visibility.primaryBranch !== false }
    return true
  })
  return {
    type: 'TALENT',
    candidateRef,
    rank: Number(row.rank_no),
    score: explanation.reduce((sum, item) => sum + Number(item.weight || 0), 0),
    explanation,
    talent: {
      profileRef: createProfileRef(
        { appId: caller.appId, userId: row.candidate_id },
        caller.profileRefSecret,
      ),
      nickname: visibility.nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
      avatarUrl: visibility.avatar === false ? undefined : (row.avatar_file_id || undefined),
      headline: visibility.headline === false ? undefined : (row.headline || undefined),
    },
    feedback: feedbackDto(row),
  }
}

function explanationArray(value) {
  if (Array.isArray(value)) { return value }
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

function feedbackDto(row) {
  return row.feedback_type ? { type: row.feedback_type, reason: row.feedback_reason || undefined } : undefined
}

async function lockActiveUser(database, appId, userId) {
  const user = await database.one(
    `SELECT id, status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, userId],
  )
  if (!user || user.status !== 'ACTIVE') { throw new Error('AUTH_REQUIRED') }
  return user
}

async function lockCurrentSource(database, appId, requesterUserId, sourceId, enforceAccess) {
  return database.one(
    `SELECT opportunity.id, opportunity.owner_user_id, opportunity.branch_id,
            opportunity.version, opportunity.status
     FROM mip_opportunities opportunity
     INNER JOIN mip_users requester
       ON requester.app_id = opportunity.app_id AND requester.id = ? AND requester.status = 'ACTIVE'
     WHERE opportunity.app_id = ? AND opportunity.id = ? AND opportunity.status = 'PUBLISHED'
       AND (? = 0 OR opportunity.owner_user_id = ? OR EXISTS (
         SELECT 1 FROM mip_opportunity_team_members member
         WHERE member.app_id = opportunity.app_id AND member.opportunity_id = opportunity.id
           AND member.user_id = ? AND member.status = 'ACTIVE'
       ))
     FOR UPDATE`,
    [requesterUserId, appId, sourceId, enforceAccess ? 1 : 0, requesterUserId, requesterUserId],
  )
}

function samePreferences(left, right) {
  return left.matchingEnabled === right.matchingEnabled
    && left.talentEnabled === right.talentEnabled
    && left.projectEnabled === right.projectEnabled
    && left.matchingScope === right.matchingScope
    && left.matchingNotificationsEnabled === right.matchingNotificationsEnabled
    && left.opportunityVersion === right.opportunityVersion
    && left.notificationVersion === right.notificationVersion
}

function sameSettings(left, right) {
  return left.scopeKey === right.scopeKey
    && left.scopeType === right.scopeType
    && left.scopeId === right.scopeId
    && left.talentMinScore === right.talentMinScore
    && left.projectMinScore === right.projectMinScore
    && left.maximumCandidates === right.maximumCandidates
    && left.externalProviderEnabled === right.externalProviderEnabled
    && left.version === right.version
}

function resolveCandidateId(rows, input, secret) {
  for (const row of rows) {
    const expected = createCandidateRef({
      appId: input.appId,
      requestId: input.requestId,
      resultVersion: input.resultVersion,
      candidateType: input.candidateType,
      candidateId: row.candidate_id,
    }, secret)
    if (candidateRefEquals(expected, input.candidateRef)) { return row.candidate_id }
  }
  throw new Error('NOT_FOUND')
}

function normalizePreferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('VALIDATION_FAILED') }
  const notificationVersion = Number(value.notificationVersion)
  const opportunityVersion = Number(value.opportunityVersion)
  if (!Number.isInteger(notificationVersion) || notificationVersion < 0
    || !Number.isInteger(opportunityVersion) || opportunityVersion < 0
    || !MATCH_SCOPES.has(value.matchingScope)) {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    notificationVersion,
    opportunityVersion,
    commentsEnabled: value.commentsEnabled !== false,
    opportunityMatchingNotificationsEnabled: value.opportunityMatchingNotificationsEnabled !== false,
    hotspotsEnabled: value.hotspotsEnabled === true,
    matchingEnabled: value.matchingEnabled !== false,
    talentRecommendationsEnabled: value.talentRecommendationsEnabled !== false,
    projectRecommendationsEnabled: value.projectRecommendationsEnabled !== false,
    discoverableForMatching: value.discoverableForMatching !== false,
    matchingScope: value.matchingScope,
  }
}

async function upsertNotificationPreferences(tx, caller, draft, exists) {
  if (exists) {
    await tx.query(
      `UPDATE mip_user_notification_preferences
       SET comment_notifications_enabled = ?, opportunity_matching_notifications_enabled = ?,
         hotspot_notifications_enabled = ?, version = version + 1
       WHERE app_id = ? AND user_id = ? AND version = ?`,
      [draft.commentsEnabled ? 1 : 0, draft.opportunityMatchingNotificationsEnabled ? 1 : 0, draft.hotspotsEnabled ? 1 : 0, caller.appId, caller.userId, draft.notificationVersion],
    )
  }
  else {
    await tx.query(
      `INSERT INTO mip_user_notification_preferences (
         app_id, user_id, comment_notifications_enabled,
         opportunity_matching_notifications_enabled, hotspot_notifications_enabled
       ) VALUES (?, ?, ?, ?, ?)`,
      [caller.appId, caller.userId, draft.commentsEnabled ? 1 : 0, draft.opportunityMatchingNotificationsEnabled ? 1 : 0, draft.hotspotsEnabled ? 1 : 0],
    )
  }
}

async function upsertOpportunityPreferences(tx, caller, draft, exists) {
  if (exists) {
    await tx.query(
      `UPDATE mip_user_opportunity_preferences
       SET matching_enabled = ?, talent_recommendations_enabled = ?,
         project_recommendations_enabled = ?, discoverable_for_matching = ?,
         matching_scope = ?, version = version + 1
       WHERE app_id = ? AND user_id = ? AND version = ?`,
      [draft.matchingEnabled ? 1 : 0, draft.talentRecommendationsEnabled ? 1 : 0, draft.projectRecommendationsEnabled ? 1 : 0, draft.discoverableForMatching ? 1 : 0, draft.matchingScope, caller.appId, caller.userId, draft.opportunityVersion],
    )
  }
  else {
    await tx.query(
      `INSERT INTO mip_user_opportunity_preferences (
         app_id, user_id, matching_enabled, talent_recommendations_enabled,
         project_recommendations_enabled, discoverable_for_matching, matching_scope
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [caller.appId, caller.userId, draft.matchingEnabled ? 1 : 0, draft.talentRecommendationsEnabled ? 1 : 0, draft.projectRecommendationsEnabled ? 1 : 0, draft.discoverableForMatching ? 1 : 0, draft.matchingScope],
    )
  }
}

async function lockIdempotency(tx, caller, operation, key, requestHash) {
  const stored = await tx.one(
    `SELECT request_hash, status, response_json FROM mip_idempotency_keys
     WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ? FOR UPDATE`,
    [caller.appId, caller.userId, operation, key],
  )
  if (stored) {
    if (stored.request_hash !== requestHash || stored.status !== 'COMPLETED') { throw new Error('CONFLICT') }
    return jsonObject(stored.response_json)
  }
  await tx.query(
    `INSERT INTO mip_idempotency_keys (
       id, app_id, actor_user_id, operation, idempotency_key,
       request_hash, status, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
    [randomUUID(), caller.appId, caller.userId, operation, key, requestHash],
  )
  return null
}

async function completeIdempotency(tx, caller, operation, key, response) {
  await tx.query(
    `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
     WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?`,
    [JSON.stringify(response), caller.appId, caller.userId, operation, key],
  )
}

function groupCandidateTags(rows) {
  const result = new Map()
  for (const row of rows) {
    const current = result.get(row.user_id) || { industry: [], ability: [] }
    current[row.relation === 'ABILITY' ? 'ability' : 'industry'].push(row.tag_id)
    result.set(row.user_id, current)
  }
  return result
}

function groupOpportunityTags(rows) {
  const result = new Map()
  for (const row of rows) {
    const current = result.get(row.opportunity_id) || { industry: [], ability: [] }
    current[row.relation === 'ABILITY' ? 'ability' : 'industry'].push(row.tag_id)
    result.set(row.opportunity_id, current)
  }
  return result
}

function jsonArray(value) {
  if (Array.isArray(value)) { return value.filter(item => typeof item === 'string') }
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  }
  catch {
    return []
  }
}

function overlaps(left, right) {
  const values = new Set(left)
  return right.some(item => values.has(item))
}

function compareCandidate(left, right) {
  return right.score - left.score || left.type.localeCompare(right.type) || left.id.localeCompare(right.id)
}

function pageLimit(value) {
  const number = Number(value)
  return Math.min(30, Math.max(1, Number.isInteger(number) ? number : 20))
}

function encodeRankCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeRankCursor(value) {
  if (!value) { return null }
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!uuid(parsed.id) || !iso(parsed.createdAt)) { throw new Error('INVALID') }
    return { id: parsed.id, createdAt: iso(parsed.createdAt) }
  }
  catch {
    throw new Error('VALIDATION_FAILED')
  }
}

function encodeResultCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeResultCursor(value) {
  if (!value) { return null }
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!['TALENT', 'PROJECT'].includes(parsed.type)
      || !Number.isInteger(Number(parsed.rank)) || Number(parsed.rank) < 1) {
      throw new Error('INVALID')
    }
    return { type: parsed.type, rank: Number(parsed.rank) }
  }
  catch {
    throw new Error('VALIDATION_FAILED')
  }
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function assertAuthenticated(caller) {
  if (!caller?.userId) { throw new Error('AUTH_REQUIRED') }
}

module.exports = {
  DEFAULT_SETTINGS,
  applyLimits,
  createMatchingRequest,
  getMatchingPreferences,
  listMatchingRequests,
  listMatchingResults,
  normalizePreferences,
  rankLocalCandidates,
  saveMatchingFeedback,
  saveMatchingPreferences,
}
