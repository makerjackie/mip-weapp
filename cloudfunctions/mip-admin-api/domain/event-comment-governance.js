'use strict'

function createEventCommentAdminRepository(database, options = {}) {
  const lockMutation = options.lockMutationAuthorization
  const assertScope = options.assertMutationScope
  if (!database || typeof lockMutation !== 'function' || typeof assertScope !== 'function') {
    throw new TypeError('Event comment administration repository is invalid')
  }

  async function getEventCommentAdminState(appId, eventId) {
    const event = await database.one(
      `SELECT id, title, status, version
       FROM mip_events
       WHERE app_id = ? AND id = ?`,
      [appId, eventId],
    )
    if (!event) {
      throw codeError('NOT_FOUND')
    }

    const [settings, comments, reports] = await Promise.all([
      database.one(
        `SELECT comments_enabled, moderation_mode, version
         FROM mip_content_comment_settings
         WHERE app_id = ? AND target_type = 'EVENT' AND target_id = ?`,
        [appId, eventId],
      ),
      database.query(
        `SELECT comment.id, comment.body, comment.status, comment.version,
                comment.created_at, comment.edited_at,
                profile.nickname AS author_nickname
         FROM mip_content_comments comment
         LEFT JOIN mip_profiles profile
           ON profile.app_id = comment.app_id AND profile.user_id = comment.author_user_id
         WHERE comment.app_id = ? AND comment.target_type = 'EVENT'
           AND comment.target_id = ? AND comment.status <> 'DELETED'
         ORDER BY CASE comment.status WHEN 'PENDING' THEN 0 WHEN 'HIDDEN' THEN 1 ELSE 2 END,
           comment.created_at DESC, comment.id DESC
         LIMIT 100`,
        [appId, eventId],
      ),
      database.query(
        `SELECT report.id, report.comment_id, report.category, report.description,
                report.status, report.version, report.reviewed_by_user_id,
                report.created_at, report.reviewed_at,
                reporter.nickname AS reporter_nickname,
                comment.body AS comment_body, comment.status AS comment_status,
                comment_author.nickname AS comment_author_nickname
         FROM mip_content_comment_reports report
         INNER JOIN mip_content_comments comment
           ON comment.app_id = report.app_id AND comment.id = report.comment_id
             AND comment.target_type = 'EVENT' AND comment.target_id = ?
         LEFT JOIN mip_profiles reporter
           ON reporter.app_id = report.app_id AND reporter.user_id = report.reporter_user_id
         LEFT JOIN mip_profiles comment_author
           ON comment_author.app_id = comment.app_id
             AND comment_author.user_id = comment.author_user_id
         WHERE report.app_id = ? AND report.status IN ('PENDING', 'REVIEWING')
         ORDER BY CASE report.status WHEN 'PENDING' THEN 0 ELSE 1 END,
           report.created_at DESC, report.id DESC
         LIMIT 100`,
        [eventId, appId],
      ),
    ])

    return {
      event: {
        id: event.id,
        title: String(event.title || ''),
        status: event.status,
        version: Number(event.version),
      },
      settings: {
        commentsEnabled: settings ? Boolean(settings.comments_enabled) : true,
        moderationMode: settings?.moderation_mode === 'REVIEW' ? 'REVIEW' : 'AUTO',
        version: settings ? Number(settings.version) : 0,
      },
      comments: comments.map(commentDto),
      reports: reports.map(reportDto),
    }
  }

  async function saveEventCommentSettings(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await lockEvent(tx, input.appId, input.eventId)
      assertScope(authorization, eventScope(event))
      const current = await tx.one(
        `SELECT version
         FROM mip_content_comment_settings
         WHERE app_id = ? AND target_type = 'EVENT' AND target_id = ?
         FOR UPDATE`,
        [input.appId, input.eventId],
      )
      if (Number(current?.version || 0) !== input.expectedVersion) {
        throw codeError('CONFLICT')
      }

      if (current) {
        const update = await tx.query(
          `UPDATE mip_content_comment_settings
           SET comments_enabled = ?, moderation_mode = ?, updated_by_user_id = ?,
             version = version + 1
           WHERE app_id = ? AND target_type = 'EVENT' AND target_id = ? AND version = ?`,
          [input.settings.commentsEnabled ? 1 : 0, input.settings.moderationMode, input.actorUserId, input.appId, input.eventId, input.expectedVersion],
        )
        if (Number(update.affectedRows) !== 1) {
          throw codeError('CONFLICT')
        }
      }
      else {
        try {
          const insert = await tx.query(
            `INSERT INTO mip_content_comment_settings (
               app_id, target_type, target_id, comments_enabled, moderation_mode,
               updated_by_user_id
             ) VALUES (?, 'EVENT', ?, ?, ?, ?)`,
            [input.appId, input.eventId, input.settings.commentsEnabled ? 1 : 0, input.settings.moderationMode, input.actorUserId],
          )
          if (Number(insert.affectedRows) !== 1) {
            throw codeError('CONFLICT')
          }
        }
        catch (error) {
          if (error?.code === 'ER_DUP_ENTRY') {
            throw codeError('CONFLICT')
          }
          throw error
        }
      }
      const version = input.expectedVersion + 1
      await writeAudit(tx, input.audit(version))
      return { ...input.settings, version }
    })
  }

  async function moderateEventComment(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await lockEvent(tx, input.appId, input.eventId)
      assertScope(authorization, eventScope(event))
      const comment = await tx.one(
        `SELECT id, status, version
         FROM mip_content_comments
         WHERE app_id = ? AND id = ? AND target_type = 'EVENT' AND target_id = ?
         FOR UPDATE`,
        [input.appId, input.commentId, input.eventId],
      )
      if (!comment || comment.status === 'DELETED') {
        throw codeError('NOT_FOUND')
      }
      if (Number(comment.version) !== input.expectedVersion) {
        throw codeError('CONFLICT')
      }
      if (input.action === 'PUBLISH' && !['PENDING', 'HIDDEN'].includes(comment.status)) {
        throw codeError('INVALID_STATE')
      }
      if (input.action === 'HIDE' && !['PENDING', 'PUBLISHED'].includes(comment.status)) {
        throw codeError('INVALID_STATE')
      }

      const status = input.action === 'PUBLISH' ? 'PUBLISHED' : 'HIDDEN'
      const update = await tx.query(
        `UPDATE mip_content_comments
         SET status = ?,
           published_at = CASE WHEN ? = 'PUBLISHED' THEN COALESCE(published_at, UTC_TIMESTAMP(3)) ELSE published_at END,
           moderated_at = UTC_TIMESTAMP(3), moderated_by_user_id = ?, moderation_reason = ?,
           version = version + 1
         WHERE app_id = ? AND id = ? AND target_type = 'EVENT' AND target_id = ?
           AND version = ?`,
        [status, status, input.actorUserId, input.reason, input.appId, input.commentId, input.eventId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) {
        throw codeError('CONFLICT')
      }
      const version = input.expectedVersion + 1
      await writeAudit(tx, input.audit(status, version))
      return { id: input.commentId, status, version }
    })
  }

  async function claimEventCommentReport(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await lockEvent(tx, input.appId, input.eventId)
      assertScope(authorization, eventScope(event))
      const report = await lockEventReport(tx, input)
      if (!report) {
        throw codeError('NOT_FOUND')
      }
      if (Number(report.version) !== input.expectedVersion) {
        throw codeError('CONFLICT')
      }
      if (report.status !== 'PENDING') {
        throw codeError('INVALID_STATE')
      }

      const update = await tx.query(
        `UPDATE mip_content_comment_reports report
         SET status = 'REVIEWING', reviewed_by_user_id = ?,
           reviewed_at = UTC_TIMESTAMP(3), version = version + 1
         WHERE report.app_id = ? AND report.id = ? AND report.status = 'PENDING'
           AND report.version = ?
           AND EXISTS (
             SELECT 1 FROM mip_content_comments comment
             WHERE comment.app_id = report.app_id AND comment.id = report.comment_id
               AND comment.target_type = 'EVENT' AND comment.target_id = ?
           )`,
        [input.actorUserId, input.appId, input.reportId, input.expectedVersion, input.eventId],
      )
      if (Number(update.affectedRows) !== 1) {
        throw codeError('CONFLICT')
      }
      const version = input.expectedVersion + 1
      await writeAudit(tx, input.audit(report.comment_id, 'REVIEWING', version))
      return { id: input.reportId, status: 'REVIEWING', version }
    })
  }

  async function closeEventCommentReport(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const event = await lockEvent(tx, input.appId, input.eventId)
      assertScope(authorization, eventScope(event))
      const report = await lockEventReport(tx, input)
      if (!report) {
        throw codeError('NOT_FOUND')
      }
      if (Number(report.version) !== input.expectedVersion) {
        throw codeError('CONFLICT')
      }
      if (report.status !== 'REVIEWING') {
        throw codeError('INVALID_STATE')
      }
      if (report.reviewed_by_user_id !== input.actorUserId) {
        throw codeError('CONFLICT')
      }

      const update = await tx.query(
        `UPDATE mip_content_comment_reports report
         SET status = ?, reviewed_at = UTC_TIMESTAMP(3),
           resolution_reason = ?, version = version + 1
         WHERE report.app_id = ? AND report.id = ? AND report.status = 'REVIEWING'
           AND report.reviewed_by_user_id = ? AND report.version = ?
           AND EXISTS (
             SELECT 1 FROM mip_content_comments comment
             WHERE comment.app_id = report.app_id AND comment.id = report.comment_id
               AND comment.target_type = 'EVENT' AND comment.target_id = ?
           )`,
        [input.decision, input.reason, input.appId, input.reportId, input.actorUserId, input.expectedVersion, input.eventId],
      )
      if (Number(update.affectedRows) !== 1) {
        throw codeError('CONFLICT')
      }
      const version = input.expectedVersion + 1
      await writeAudit(tx, input.audit(report.comment_id, input.decision, version))
      return { id: input.reportId, status: input.decision, version }
    })
  }

  return {
    claimEventCommentReport,
    closeEventCommentReport,
    getEventCommentAdminState,
    moderateEventComment,
    saveEventCommentSettings,
  }
}

async function lockEvent(tx, appId, eventId) {
  const event = await tx.one(
    `SELECT id, branch_id
     FROM mip_events
     WHERE app_id = ? AND id = ?
     FOR UPDATE`,
    [appId, eventId],
  )
  if (!event) {
    throw codeError('NOT_FOUND')
  }
  return event
}

function eventScope(event) {
  return { scopeType: 'EVENT', scopeId: event.id, branchId: event.branch_id || null }
}

async function lockEventReport(tx, input) {
  return tx.one(
    `SELECT report.comment_id, report.status, report.version, report.reviewed_by_user_id
     FROM mip_content_comment_reports report
     INNER JOIN mip_content_comments comment
       ON comment.app_id = report.app_id AND comment.id = report.comment_id
         AND comment.target_type = 'EVENT' AND comment.target_id = ?
     WHERE report.app_id = ? AND report.id = ?
     FOR UPDATE`,
    [input.eventId, input.appId, input.reportId],
  )
}

function commentDto(row) {
  return {
    id: row.id,
    authorNickname: row.author_nickname || 'MIP 用户',
    body: String(row.body || ''),
    status: row.status,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    editedAt: iso(row.edited_at),
  }
}

function reportDto(row) {
  return {
    id: row.id,
    commentId: row.comment_id,
    commentAuthorNickname: row.comment_author_nickname || 'MIP 用户',
    commentBody: String(row.comment_body || ''),
    commentStatus: row.comment_status,
    reporterNickname: row.reporter_nickname || 'MIP 用户',
    category: row.category,
    description: row.description || '',
    status: row.status,
    version: Number(row.version),
    reviewedByUserId: row.reviewed_by_user_id || null,
    createdAt: iso(row.created_at),
    reviewedAt: iso(row.reviewed_at),
  }
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
  if (!value) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = { createEventCommentAdminRepository }
