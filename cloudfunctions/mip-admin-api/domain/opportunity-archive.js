'use strict'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ARCHIVE_BLOCKER_KEYS = Object.freeze([
  'REFERRAL_INTENTS',
  'PROFILE_INTERESTS',
  'ORDERS',
  'ANNOUNCEMENTS',
  'OUTBOX_EVENTS',
])

const ARCHIVE_ROLE_KEYS = new Set(['PLATFORM_OWNER', 'PLATFORM_OPERATIONS'])

class OpportunityArchiveError extends Error {
  constructor(code, details = null) {
    super(code)
    this.name = 'OpportunityArchiveError'
    this.code = code
    if (details) this.details = details
  }
}

function codeError(code, details) {
  return new OpportunityArchiveError(code, details)
}

function normalizeContext(context) {
  const caller = context?.caller || context || {}
  const appId = typeof caller.appId === 'string' ? caller.appId.trim() : ''
  const userId = typeof caller.userId === 'string' ? caller.userId.trim() : ''
  if (!appId || appId.length > 64 || !UUID_PATTERN.test(userId)) {
    throw codeError('FORBIDDEN')
  }
  return { appId, userId }
}

function normalizeArchiveRequest(input = {}) {
  const opportunityId = typeof input.opportunityId === 'string'
    ? input.opportunityId.trim()
    : ''
  const expectedVersion = Number(input.expectedVersion)
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!UUID_PATTERN.test(opportunityId)
    || !Number.isInteger(expectedVersion)
    || expectedVersion < 1
    || !reason
    || reason.length > 240) {
    throw codeError('VALIDATION_FAILED')
  }
  return { opportunityId, expectedVersion, reason }
}

function scopeFromRow(row) {
  return {
    scopeType: row.scope_type,
    scopeId: row.branch_id || null,
    branchId: row.branch_id || null,
  }
}

function sameScope(left, right) {
  return left?.scopeType === right?.scopeType
    && (left?.scopeId || null) === (right?.scopeId || null)
}

function createOpportunityArchiveRepository(database, {
  assertScope,
  lockMutation,
  now = () => new Date(),
} = {}) {
  if (!database || typeof database.transaction !== 'function') {
    throw new TypeError('Opportunity archive database adapter is invalid')
  }
  if (typeof assertScope !== 'function' || typeof lockMutation !== 'function') {
    throw new TypeError('Opportunity archive authorization is invalid')
  }

  async function getOpportunityArchiveScope(appId, opportunityId) {
    if (typeof database.one !== 'function') throw codeError('SERVICE_UNAVAILABLE')
    const row = await database.one(
      `SELECT scope_type, branch_id, status, version
       FROM mip_opportunities WHERE app_id = ? AND id = ?`,
      [appId, opportunityId],
    )
    return row ? {
      ...scopeFromRow(row),
      status: row.status,
      version: Number(row.version),
    } : null
  }

  async function archiveOpportunity(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const row = await tx.one(
        `SELECT id, scope_type, branch_id, status, version, referral_count
         FROM mip_opportunities
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.opportunityId],
      )
      if (!row) throw codeError('NOT_FOUND')
      if (Number(row.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (!['DRAFT', 'UNPUBLISHED', 'ENDED'].includes(row.status)) throw codeError('INVALID_STATE')

      const lockedScope = scopeFromRow(row)
      assertScope(authorization, lockedScope)
      if (!sameScope(lockedScope, input.authorizedScope)) throw codeError('CONFLICT')

      const archivedAt = now()
      if (!(archivedAt instanceof Date) || !Number.isFinite(archivedAt.getTime())) {
        throw codeError('SERVICE_UNAVAILABLE')
      }
      const update = await tx.query(
        `UPDATE mip_opportunities
         SET status = 'ARCHIVED', archived_at = ?, archived_by_user_id = ?,
           archive_reason = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?
           AND status IN ('DRAFT', 'UNPUBLISHED', 'ENDED')`,
        [archivedAt, input.actorUserId, input.reason, input.appId,
          input.opportunityId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')

      await writeArchiveAudit(tx, {
        appId: input.appId,
        actorUserId: input.actorUserId,
        scope: lockedScope,
        resourceId: input.opportunityId,
        effectiveRole: input.effectiveRole,
        expectedVersion: input.expectedVersion,
        reasonLength: input.reason.length,
      })
      return {
        id: input.opportunityId,
        status: 'ARCHIVED',
        version: input.expectedVersion + 1,
        archivedAt: archivedAt.toISOString(),
      }
    })
  }

  return { archiveOpportunity, getOpportunityArchiveScope }
}

function createOpportunityArchiveService({ repository, authorize }) {
  if (!repository
    || typeof repository.getOpportunityArchiveScope !== 'function'
    || typeof repository.archiveOpportunity !== 'function'
    || typeof authorize !== 'function') {
    throw new TypeError('Opportunity archive service dependencies are invalid')
  }

  async function archiveOpportunity(context, input) {
    const caller = normalizeContext(context)
    const request = normalizeArchiveRequest(input)
    const scope = await repository.getOpportunityArchiveScope(caller.appId, request.opportunityId)
    if (!scope) throw codeError('NOT_FOUND')
    const grant = await authorize(context, scope)
    if (!grant || grant.scopeType !== 'PLATFORM' || !ARCHIVE_ROLE_KEYS.has(grant.roleKey)) {
      throw codeError('FORBIDDEN')
    }
    return repository.archiveOpportunity({
      appId: caller.appId,
      actorUserId: caller.userId,
      opportunityId: request.opportunityId,
      expectedVersion: request.expectedVersion,
      reason: request.reason,
      authorizedScope: {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      },
      effectiveRole: grant.roleKey,
      authorization: {
        capability: 'opportunities.archive',
        effectiveGrant: {
          roleKey: grant.roleKey,
          scopeType: grant.scopeType,
          scopeId: grant.scopeType === 'PLATFORM' ? null : grant.scopeId,
        },
      },
    })
  }

  return { archiveOpportunity }
}

async function writeArchiveAudit(tx, input) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'ADMIN', ?, ?, 'admin.opportunities.archive',
      'OPPORTUNITY', ?, ?, ?)`,
    [
      input.appId,
      input.actorUserId,
      input.scope.scopeType,
      input.scope.scopeId,
      input.resourceId,
      input.effectiveRole,
      JSON.stringify({
        expectedVersion: input.expectedVersion,
        reasonLength: input.reasonLength,
      }),
    ],
  )
}

module.exports = {
  ARCHIVE_BLOCKER_KEYS,
  OpportunityArchiveError,
  createOpportunityArchiveRepository,
  createOpportunityArchiveService,
  normalizeArchiveRequest,
}
