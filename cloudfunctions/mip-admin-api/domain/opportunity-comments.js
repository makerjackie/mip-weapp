'use strict'

const { randomUUID } = require('node:crypto')

function createOpportunityCommentAdminRepository(database, options = {}) {
  const lockMutation = options.lockMutationAuthorization
  const assertScope = options.assertMutationScope
  if (typeof lockMutation !== 'function' || typeof assertScope !== 'function') {
    throw new TypeError('Opportunity comment mutation authorization is invalid')
  }

  async function getOpportunityCommentAdminState(appId, opportunityId) {
    const [settings, comments, reports] = await Promise.all([
      database.one(
        `SELECT comments_enabled, reviews_enabled, calls_enabled, moderation_mode, version
         FROM mip_opportunity_comment_settings
         WHERE app_id = ? AND opportunity_id = ?`,
        [appId, opportunityId],
      ),
      database.query(
        `SELECT comment.id, comment.author_user_id, comment.comment_type, comment.body,
                comment.rating, comment.author_is_participant, comment.status,
                comment.call_count, comment.version, comment.created_at, comment.edited_at,
                profile.nickname AS author_nickname
         FROM mip_opportunity_comments comment
         LEFT JOIN mip_profiles profile
           ON profile.app_id = comment.app_id AND profile.user_id = comment.author_user_id
         WHERE comment.app_id = ? AND comment.opportunity_id = ? AND comment.status <> 'DELETED'
         ORDER BY CASE comment.status WHEN 'PENDING' THEN 0 WHEN 'HIDDEN' THEN 1 ELSE 2 END,
           comment.created_at DESC, comment.id DESC LIMIT 100`,
        [appId, opportunityId],
      ),
      database.query(
        `SELECT report.id, report.comment_id, report.reporter_user_id, report.category,
                report.description, report.status, report.version, report.created_at,
                reporter.nickname AS reporter_nickname
         FROM mip_opportunity_comment_reports report
         INNER JOIN mip_opportunity_comments comment
           ON comment.app_id = report.app_id AND comment.id = report.comment_id
         LEFT JOIN mip_profiles reporter
           ON reporter.app_id = report.app_id AND reporter.user_id = report.reporter_user_id
         WHERE report.app_id = ? AND comment.opportunity_id = ?
           AND report.status IN ('PENDING', 'REVIEWING')
         ORDER BY report.created_at DESC, report.id DESC LIMIT 100`,
        [appId, opportunityId],
      ),
    ])
    return {
      settings: {
        commentsEnabled: settings ? Boolean(settings.comments_enabled) : true,
        reviewsEnabled: settings ? Boolean(settings.reviews_enabled) : true,
        callsEnabled: settings ? Boolean(settings.calls_enabled) : true,
        moderationMode: settings?.moderation_mode === 'REVIEW' ? 'REVIEW' : 'AUTO',
        version: settings ? Number(settings.version) : 0,
      },
      comments: comments.map(row => ({
        id: row.id,
        authorUserId: row.author_user_id,
        authorNickname: row.author_nickname || 'MIP 用户',
        type: row.comment_type,
        body: row.body,
        rating: row.rating === null ? null : Number(row.rating),
        participant: Boolean(row.author_is_participant),
        status: row.status,
        callCount: Number(row.call_count || 0),
        version: Number(row.version),
        createdAt: iso(row.created_at),
        editedAt: iso(row.edited_at),
      })),
      reports: reports.map(row => ({
        id: row.id,
        commentId: row.comment_id,
        reporterUserId: row.reporter_user_id,
        reporterNickname: row.reporter_nickname || 'MIP 用户',
        category: row.category,
        description: row.description || '',
        status: row.status,
        version: Number(row.version),
        createdAt: iso(row.created_at),
      })),
    }
  }

  async function saveOpportunityCommentSettings(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const opportunity = await lockOpportunity(tx, input.appId, input.opportunityId)
      assertScope(authorization, resourceScope(opportunity))
      const current = await tx.one(
        `SELECT version FROM mip_opportunity_comment_settings
         WHERE app_id = ? AND opportunity_id = ? FOR UPDATE`,
        [input.appId, input.opportunityId],
      )
      if (Number(current?.version || 0) !== input.expectedVersion) throw codeError('CONFLICT')
      if (current) {
        const result = await tx.query(
          `UPDATE mip_opportunity_comment_settings
           SET comments_enabled = ?, reviews_enabled = ?, calls_enabled = ?, moderation_mode = ?,
             updated_by_user_id = ?, version = version + 1
           WHERE app_id = ? AND opportunity_id = ? AND version = ?`,
          [input.settings.commentsEnabled ? 1 : 0, input.settings.reviewsEnabled ? 1 : 0,
            input.settings.callsEnabled ? 1 : 0, input.settings.moderationMode,
            input.actorUserId, input.appId, input.opportunityId, input.expectedVersion],
        )
        if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      }
      else {
        await tx.query(
          `INSERT INTO mip_opportunity_comment_settings (
             app_id, opportunity_id, comments_enabled, reviews_enabled, calls_enabled,
             moderation_mode, updated_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [input.appId, input.opportunityId, input.settings.commentsEnabled ? 1 : 0,
            input.settings.reviewsEnabled ? 1 : 0, input.settings.callsEnabled ? 1 : 0,
            input.settings.moderationMode, input.actorUserId],
        )
      }
      await writeAudit(tx, input.audit(input.expectedVersion + 1))
      return { ...input.settings, version: input.expectedVersion + 1 }
    })
  }

  async function moderateOpportunityComment(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const comment = await tx.one(
        `SELECT comment.opportunity_id, comment.author_user_id, comment.status, comment.version,
                opportunity.branch_id, opportunity.owner_user_id
         FROM mip_opportunity_comments comment
         INNER JOIN mip_opportunities opportunity
           ON opportunity.app_id = comment.app_id AND opportunity.id = comment.opportunity_id
         WHERE comment.app_id = ? AND comment.id = ? FOR UPDATE`,
        [input.appId, input.commentId],
      )
      if (!comment || comment.status === 'DELETED') throw codeError('NOT_FOUND')
      assertScope(authorization, resourceScope(comment))
      if (Number(comment.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (input.action === 'PUBLISH' && !['PENDING', 'HIDDEN'].includes(comment.status)) {
        throw codeError('INVALID_STATE')
      }
      if (input.action === 'HIDE' && !['PENDING', 'PUBLISHED'].includes(comment.status)) {
        throw codeError('INVALID_STATE')
      }
      const status = input.action === 'PUBLISH' ? 'PUBLISHED' : 'HIDDEN'
      const result = await tx.query(
        `UPDATE mip_opportunity_comments
         SET status = ?,
           published_at = CASE WHEN ? = 'PUBLISHED' THEN COALESCE(published_at, UTC_TIMESTAMP(3)) ELSE published_at END,
           moderated_at = UTC_TIMESTAMP(3), moderated_by_user_id = ?, moderation_reason = ?,
           version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [status, status, input.actorUserId, input.reason, input.appId, input.commentId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(comment.opportunity_id, status))
      if (status === 'PUBLISHED' && comment.author_user_id !== comment.owner_user_id) {
        await tx.query(
          `INSERT INTO mip_outbox_events (
           id, app_id, aggregate_type, aggregate_id, event_type,
             source_version, payload_json
           ) VALUES (?, ?, 'OPPORTUNITY_COMMENT', ?,
             'opportunity.comment_published', ?, JSON_OBJECT())`,
          [randomUUID(), input.appId, input.commentId, input.expectedVersion + 1],
        )
      }
      return { id: input.commentId, status, version: input.expectedVersion + 1 }
    })
  }

  async function closeOpportunityCommentReport(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const report = await tx.one(
        `SELECT report.comment_id, report.status, report.version,
                comment.opportunity_id, opportunity.branch_id
         FROM mip_opportunity_comment_reports report
         INNER JOIN mip_opportunity_comments comment
           ON comment.app_id = report.app_id AND comment.id = report.comment_id
         INNER JOIN mip_opportunities opportunity
           ON opportunity.app_id = comment.app_id AND opportunity.id = comment.opportunity_id
         WHERE report.app_id = ? AND report.id = ? FOR UPDATE`,
        [input.appId, input.reportId],
      )
      if (!report) throw codeError('NOT_FOUND')
      if (report.opportunity_id !== input.opportunityId) throw codeError('CONFLICT')
      assertScope(authorization, resourceScope(report))
      if (Number(report.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (!['PENDING', 'REVIEWING'].includes(report.status)) throw codeError('INVALID_STATE')
      const result = await tx.query(
        `UPDATE mip_opportunity_comment_reports
         SET status = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(3),
           resolution_reason = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [input.decision, input.actorUserId, input.reason, input.appId, input.reportId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(report.opportunity_id, report.comment_id, input.decision))
      return { id: input.reportId, status: input.decision, version: input.expectedVersion + 1 }
    })
  }

  return {
    closeOpportunityCommentReport,
    getOpportunityCommentAdminState,
    moderateOpportunityComment,
    saveOpportunityCommentSettings,
  }
}

async function lockOpportunity(tx, appId, opportunityId) {
  const row = await tx.one(
    `SELECT id, branch_id FROM mip_opportunities
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, opportunityId],
  )
  if (!row) throw codeError('NOT_FOUND')
  return row
}

function resourceScope(row) {
  return { scopeType: row.branch_id ? 'BRANCH' : 'PLATFORM', scopeId: row.branch_id || null }
}

async function writeAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
       app_id, actor_user_id, actor_type, scope_type, scope_id, action,
       resource_type, resource_id, effective_role, metadata_json
     ) VALUES (?, ?, 'ADMIN', ?, ?, ?, ?, ?, ?, ?)`,
    [audit.appId, audit.actorUserId, audit.scopeType, audit.scopeId || null, audit.action,
      audit.resourceType, audit.resourceId || null, audit.effectiveRole || null,
      JSON.stringify(audit.metadata || {})],
  )
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

module.exports = { createOpportunityCommentAdminRepository }
