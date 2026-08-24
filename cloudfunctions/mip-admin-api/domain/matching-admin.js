'use strict'

function createMatchingAdminRepository(database, options = {}) {
  const lockMutation = options.lockMutationAuthorization
  const assertScope = options.assertMutationScope
  if (typeof lockMutation !== 'function' || typeof assertScope !== 'function') {
    throw new TypeError('Matching mutation authorization is invalid')
  }

  async function getMatchingAdminState(appId, visibility, input = {}) {
    const branchId = input.branchId || null
    assertVisible(visibility, branchId)
    const scopeKey = branchId ? `BRANCH:${branchId}` : 'PLATFORM'
    const [settings, requests] = await Promise.all([
      database.one(
        `SELECT scope_key, scope_type, scope_id, talent_min_score, project_min_score,
                maximum_candidates, external_provider_enabled, version, updated_at
         FROM mip_matching_settings WHERE app_id = ? AND scope_key = ?`,
        [appId, scopeKey],
      ),
      database.query(
        `SELECT request.id, request.source_opportunity_id, source.title AS source_title,
                request.requested_by_type, request.provider_key,
                request.provider_fallback_reason, request.settings_version,
                request.source_version, request.result_version, request.result_count,
                request.created_at
         FROM mip_matching_requests request
         INNER JOIN mip_opportunities source
           ON source.app_id = request.app_id AND source.id = request.source_opportunity_id
         WHERE request.app_id = ? AND request.status = 'COMPLETED'
           ${branchId ? 'AND source.branch_id = ?' : ''}
         ORDER BY request.created_at DESC, request.id DESC LIMIT 50`,
        branchId ? [appId, branchId] : [appId],
      ),
    ])
    return {
      settings: settingDto(settings, branchId),
      requests: requests.map(requestDto),
    }
  }

  async function saveMatchingSettings(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      assertScope(authorization, input.scope)
      const scopeKey = input.scope.scopeType === 'BRANCH'
        ? `BRANCH:${input.scope.scopeId}`
        : 'PLATFORM'
      const current = await tx.one(
        `SELECT version FROM mip_matching_settings
         WHERE app_id = ? AND scope_key = ? FOR UPDATE`,
        [input.appId, scopeKey],
      )
      if (Number(current?.version || 0) !== input.expectedVersion) { throw codeError('CONFLICT') }
      if (current) {
        const result = await tx.query(
          `UPDATE mip_matching_settings
           SET talent_min_score = ?, project_min_score = ?, maximum_candidates = ?,
             external_provider_enabled = ?, updated_by_user_id = ?, version = version + 1
           WHERE app_id = ? AND scope_key = ? AND version = ?`,
          [input.settings.talentMinScore, input.settings.projectMinScore, input.settings.maximumCandidates, input.settings.externalProviderEnabled ? 1 : 0, input.actorUserId, input.appId, scopeKey, input.expectedVersion],
        )
        if (Number(result.affectedRows) !== 1) { throw codeError('CONFLICT') }
      }
      else {
        await tx.query(
          `INSERT INTO mip_matching_settings (
             app_id, scope_key, scope_type, scope_id, talent_min_score,
             project_min_score, maximum_candidates, external_provider_enabled,
             updated_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [input.appId, scopeKey, input.scope.scopeType, input.scope.scopeId || null, input.settings.talentMinScore, input.settings.projectMinScore, input.settings.maximumCandidates, input.settings.externalProviderEnabled ? 1 : 0, input.actorUserId],
        )
      }
      await writeAudit(tx, input.audit(input.expectedVersion + 1))
      return {
        scopeKey,
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeId || undefined,
        ...input.settings,
        version: input.expectedVersion + 1,
      }
    })
  }

  async function getMatchingRecalculationTarget(appId, opportunityId) {
    return database.one(
      `SELECT id, owner_user_id, branch_id, status, version
       FROM mip_opportunities WHERE app_id = ? AND id = ?`,
      [appId, opportunityId],
    )
  }

  async function authorizeMatchingRecalculation(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const target = await tx.one(
        `SELECT id, owner_user_id, branch_id, status, version
         FROM mip_opportunities WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.opportunityId],
      )
      if (!target) { throw codeError('NOT_FOUND') }
      assertScope(authorization, target.branch_id
        ? { scopeType: 'BRANCH', scopeId: target.branch_id }
        : { scopeType: 'PLATFORM', scopeId: null })
      if (Number(target.version) !== input.expectedVersion) { throw codeError('CONFLICT') }
      if (target.status !== 'PUBLISHED') { throw codeError('INVALID_STATE') }
      return target
    })
  }

  return {
    authorizeMatchingRecalculation,
    getMatchingAdminState,
    getMatchingRecalculationTarget,
    saveMatchingSettings,
  }
}

function settingDto(row, branchId) {
  return row
    ? {
        scopeKey: row.scope_key,
        scopeType: row.scope_type,
        scopeId: row.scope_id || undefined,
        talentMinScore: Number(row.talent_min_score),
        projectMinScore: Number(row.project_min_score),
        maximumCandidates: Number(row.maximum_candidates),
        externalProviderEnabled: Boolean(row.external_provider_enabled),
        version: Number(row.version),
        updatedAt: iso(row.updated_at),
      }
    : {
        scopeKey: branchId ? `BRANCH:${branchId}` : 'PLATFORM',
        scopeType: branchId ? 'BRANCH' : 'PLATFORM',
        scopeId: branchId || undefined,
        talentMinScore: 35,
        projectMinScore: 30,
        maximumCandidates: 100,
        externalProviderEnabled: false,
        version: 0,
      }
}

function requestDto(row) {
  return {
    id: row.id,
    sourceOpportunity: { id: row.source_opportunity_id, title: row.source_title },
    requestedByType: row.requested_by_type,
    provider: row.provider_key,
    fallbackReason: row.provider_fallback_reason || undefined,
    settingsVersion: Number(row.settings_version),
    sourceVersion: Number(row.source_version),
    resultVersion: Number(row.result_version),
    resultCount: Number(row.result_count),
    createdAt: iso(row.created_at),
  }
}

function assertVisible(visibility, branchId) {
  if (visibility?.platform) { return }
  if (branchId && Array.isArray(visibility?.branchIds) && visibility.branchIds.includes(branchId)) { return }
  throw codeError('FORBIDDEN')
}

async function writeAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
       app_id, actor_user_id, actor_type, scope_type, scope_id, action,
       resource_type, resource_id, effective_role, metadata_json
     ) VALUES (?, ?, 'ADMIN', ?, ?, ?, ?, ?, ?, ?)`,
    [audit.appId, audit.actorUserId, audit.scopeType, audit.scopeId || null, audit.action, audit.resourceType, audit.resourceId || null, audit.effectiveRole || null, JSON.stringify(audit.metadata || {})],
  )
}

function iso(value) {
  if (!value) { return null }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = { createMatchingAdminRepository }
