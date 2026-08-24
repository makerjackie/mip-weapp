'use strict'

const { randomUUID } = require('node:crypto')

function createAnnouncementRepository(database, options = {}) {
  const assertScope = options.assertScope
  const lockMutation = options.lockMutation
  const id = options.id || randomUUID
  const now = options.now || (() => new Date())
  if (typeof assertScope !== 'function' || typeof lockMutation !== 'function') {
    throw new TypeError('Announcement mutation authorization is invalid')
  }

  async function listAnnouncementScopes(appId, visibility) {
    const rows = visibility.platform
      ? await database.query(
          `SELECT id, name FROM mip_city_branches
           WHERE app_id = ? AND status = 'ACTIVE' ORDER BY city_name, name, id`,
          [appId],
        )
      : visibility.branchIds.length
        ? await database.query(
            `SELECT id, name FROM mip_city_branches
             WHERE app_id = ? AND status = 'ACTIVE'
               AND id IN (${placeholders(visibility.branchIds)})
             ORDER BY city_name, name, id`,
            [appId, ...visibility.branchIds],
          )
        : []
    return {
      platform: visibility.platform,
      branches: rows.map(row => ({ id: row.id, name: row.name })),
    }
  }

  async function listAnnouncements(appId, visibility, filters, pageLimit) {
    const scope = visibleAnnouncementsWhere(visibility)
    const clauses = ['announcement.app_id = ?', scope.sql]
    const params = [appId, ...scope.params]
    if (filters.status) {
      clauses.push('announcement.status = ?')
      params.push(filters.status)
    }
    if (filters.scopeType === 'PLATFORM') {
      clauses.push("announcement.scope_type = 'PLATFORM'")
    }
    if (filters.branchId) {
      clauses.push("announcement.scope_type = 'BRANCH' AND announcement.branch_id = ?")
      params.push(filters.branchId)
    }
    if (filters.query) {
      clauses.push('(announcement.title LIKE ? OR announcement.summary LIKE ?)')
      const query = `%${escapeLike(filters.query)}%`
      params.push(query, query)
    }
    const rows = await database.query(
      `${announcementSelect(false)}
       WHERE ${clauses.join(' AND ')}
       ORDER BY announcement.updated_at DESC, announcement.id DESC LIMIT ?`,
      [...params, pageLimit],
    )
    return rows.map(announcementDto)
  }

  async function getAnnouncement(appId, announcementId, adapter = database, lock = false) {
    const row = await adapter.one(
      `${announcementSelect(true)}
       WHERE announcement.app_id = ? AND announcement.id = ?${lock ? ' FOR UPDATE' : ''}`,
      [appId, announcementId],
    )
    return row ? announcementDto(row) : null
  }

  async function getAnnouncementScope(appId, announcementId) {
    const row = await database.one(
      `SELECT scope_type, branch_id, status
       FROM mip_announcements WHERE app_id = ? AND id = ?`,
      [appId, announcementId],
    )
    return row
      ? {
          scopeType: row.scope_type,
          scopeId: row.scope_type === 'BRANCH' ? row.branch_id : null,
          status: row.status,
        }
      : null
  }

  async function saveAnnouncement(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      if (!input.announcementId) {
        assertScope(authorization, announcementScope(input.draft))
        await assertReferences(tx, input.appId, input.draft, false)
        const announcementId = id()
        await tx.query(
          `INSERT INTO mip_announcements (
             id, app_id, scope_type, branch_id, title, summary, body,
             target_type, target_id, visible_from, visible_until,
             content_safety_status, created_by_user_id, updated_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            announcementId,
            input.appId,
            input.draft.scopeType,
            input.draft.branchId,
            input.draft.title,
            input.draft.summary,
            input.draft.body,
            input.draft.targetType,
            input.draft.targetId,
            input.draft.visibleFrom,
            input.draft.visibleUntil,
            input.contentSafetyStatus,
            input.actorUserId,
            input.actorUserId,
          ],
        )
        await writeAudit(tx, input.audit(announcementId, 'admin.announcements.create', {
          status: 'DRAFT',
          contentSafetyStatus: input.contentSafetyStatus,
        }))
        return getAnnouncement(input.appId, announcementId, tx)
      }

      const current = await getAnnouncement(input.appId, input.announcementId, tx, true)
      if (!current) throw codeError('NOT_FOUND')
      const currentScope = announcementScope(current)
      assertScope(authorization, currentScope)
      if (input.authorizedExistingScope && !sameScope(currentScope, input.authorizedExistingScope)) {
        throw codeError('CONFLICT')
      }
      assertScope(authorization, announcementScope(input.draft))
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status === 'PUBLISHED') throw codeError('INVALID_STATE')
      await assertReferences(tx, input.appId, input.draft, false)
      const update = await tx.query(
        `UPDATE mip_announcements
         SET scope_type = ?, branch_id = ?, title = ?, summary = ?, body = ?,
           target_type = ?, target_id = ?, visible_from = ?, visible_until = ?,
           content_safety_status = ?, updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status IN ('DRAFT', 'WITHDRAWN')`,
        [
          input.draft.scopeType,
          input.draft.branchId,
          input.draft.title,
          input.draft.summary,
          input.draft.body,
          input.draft.targetType,
          input.draft.targetId,
          input.draft.visibleFrom,
          input.draft.visibleUntil,
          input.contentSafetyStatus,
          input.actorUserId,
          input.appId,
          input.announcementId,
          input.expectedVersion,
        ],
      )
      if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.announcementId, 'admin.announcements.update', {
        expectedVersion: input.expectedVersion,
        contentSafetyStatus: input.contentSafetyStatus,
      }))
      return getAnnouncement(input.appId, input.announcementId, tx)
    })
  }

  async function publishAnnouncement(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const current = await getAnnouncement(input.appId, input.announcementId, tx, true)
      if (!current) throw codeError('NOT_FOUND')
      const currentScope = announcementScope(current)
      assertScope(authorization, currentScope)
      if (input.authorizedScope && !sameScope(currentScope, input.authorizedScope)) throw codeError('CONFLICT')
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (!['DRAFT', 'WITHDRAWN'].includes(current.status)) throw codeError('INVALID_STATE')
      if (current.contentSafetyStatus !== 'PASSED') throw codeError('CONTENT_SAFETY_REQUIRED')
      await assertReferences(tx, input.appId, current, true)
      const publishedAt = now()
      if (!current.visibleFrom || new Date(current.visibleFrom).getTime() > publishedAt.getTime() + 366 * 24 * 60 * 60 * 1000) {
        throw codeError('VALIDATION_FAILED')
      }
      if (current.visibleUntil && new Date(current.visibleUntil) <= publishedAt) {
        throw codeError('INVALID_STATE')
      }
      const update = await tx.query(
        `UPDATE mip_announcements
         SET status = 'PUBLISHED', is_pinned = 0, published_at = ?, withdrawn_at = NULL,
           updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status IN ('DRAFT', 'WITHDRAWN')`,
        [publishedAt, input.actorUserId, input.appId, input.announcementId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.announcementId, 'admin.announcements.publish', {
        expectedVersion: input.expectedVersion,
      }))
      await writeOutbox(tx, {
        id: id(),
        appId: input.appId,
        aggregateId: input.announcementId,
        eventType: 'announcement.published',
        sourceVersion: input.expectedVersion + 1,
      })
      return getAnnouncement(input.appId, input.announcementId, tx)
    })
  }

  async function withdrawAnnouncement(input) {
    return database.transaction(async (tx) => {
      const authorization = await lockMutation(tx, input)
      const current = await getAnnouncement(input.appId, input.announcementId, tx, true)
      if (!current) throw codeError('NOT_FOUND')
      const currentScope = announcementScope(current)
      assertScope(authorization, currentScope)
      if (input.authorizedScope && !sameScope(currentScope, input.authorizedScope)) throw codeError('CONFLICT')
      if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
      if (current.status !== 'PUBLISHED') throw codeError('INVALID_STATE')
      const withdrawnAt = now()
      const update = await tx.query(
        `UPDATE mip_announcements
         SET status = 'WITHDRAWN', is_pinned = 0, withdrawn_at = ?,
           updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'PUBLISHED'`,
        [withdrawnAt, input.actorUserId, input.appId, input.announcementId, input.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.announcementId, 'admin.announcements.withdraw', {
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }))
      await writeOutbox(tx, {
        id: id(),
        appId: input.appId,
        aggregateId: input.announcementId,
        eventType: 'announcement.withdrawn',
        sourceVersion: input.expectedVersion + 1,
      })
      return getAnnouncement(input.appId, input.announcementId, tx)
    })
  }

  async function setAnnouncementPinned(input) {
    try {
      return await database.transaction(async (tx) => {
        const authorization = await lockMutation(tx, input)
        const current = await getAnnouncement(input.appId, input.announcementId, tx, true)
        if (!current) throw codeError('NOT_FOUND')
        const currentScope = announcementScope(current)
        assertScope(authorization, currentScope)
        if (input.authorizedScope && !sameScope(currentScope, input.authorizedScope)) throw codeError('CONFLICT')
        if (current.version !== input.expectedVersion) throw codeError('CONFLICT')
        if (current.status !== 'PUBLISHED') throw codeError('INVALID_STATE')
        if (current.isPinned === input.pinned) return current

        const replaced = []
        if (input.pinned) {
          const scopeClause = current.scopeType === 'PLATFORM'
            ? "scope_type = 'PLATFORM' AND branch_id IS NULL"
            : "scope_type = 'BRANCH' AND branch_id = ?"
          const params = current.scopeType === 'PLATFORM'
            ? [input.appId, input.announcementId]
            : [input.appId, input.announcementId, current.branchId]
          const rows = await tx.query(
            `SELECT id FROM mip_announcements
             WHERE app_id = ? AND id <> ? AND ${scopeClause}
               AND status = 'PUBLISHED' AND is_pinned = 1 FOR UPDATE`,
            params,
          )
          replaced.push(...rows.map(row => row.id))
          if (replaced.length) {
            await tx.query(
              `UPDATE mip_announcements
               SET is_pinned = 0, updated_by_user_id = ?, version = version + 1
               WHERE app_id = ? AND id IN (${placeholders(replaced)})`,
              [input.actorUserId, input.appId, ...replaced],
            )
          }
        }
        const update = await tx.query(
          `UPDATE mip_announcements
           SET is_pinned = ?, updated_by_user_id = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status = 'PUBLISHED'`,
          [input.pinned ? 1 : 0, input.actorUserId, input.appId,
            input.announcementId, input.expectedVersion],
        )
        if (Number(update.affectedRows) !== 1) throw codeError('CONFLICT')
        await writeAudit(tx, input.audit(input.announcementId, 'admin.announcements.pin', {
          expectedVersion: input.expectedVersion,
          pinned: input.pinned,
          replacedAnnouncementIds: replaced,
        }))
        return getAnnouncement(input.appId, input.announcementId, tx)
      })
    }
    catch (error) {
      if (error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062) {
        throw codeError('CONFLICT')
      }
      throw error
    }
  }

  return {
    getAnnouncement,
    getAnnouncementScope,
    listAnnouncements,
    listAnnouncementScopes,
    publishAnnouncement,
    saveAnnouncement,
    setAnnouncementPinned,
    withdrawAnnouncement,
  }
}

function announcementSelect(includeBody) {
  return `SELECT announcement.id, announcement.scope_type, announcement.branch_id,
    branch.name AS branch_name, announcement.title, announcement.summary,
    ${includeBody ? 'announcement.body,' : ''}
    announcement.target_type, announcement.target_id, announcement.status,
    announcement.content_safety_status, announcement.is_pinned,
    announcement.visible_from, announcement.visible_until,
    announcement.published_at, announcement.withdrawn_at,
    announcement.version, announcement.updated_at
    FROM mip_announcements announcement
    LEFT JOIN mip_city_branches branch
      ON branch.app_id = announcement.app_id AND branch.id = announcement.branch_id`
}

function announcementDto(row) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    branchId: row.branch_id || null,
    branchName: row.branch_name || '',
    title: row.title,
    summary: row.summary,
    ...(Object.hasOwn(row, 'body') ? { body: row.body } : {}),
    targetType: row.target_type || null,
    targetId: row.target_id || null,
    status: row.status,
    contentSafetyStatus: row.content_safety_status,
    isPinned: Boolean(row.is_pinned),
    visibleFrom: iso(row.visible_from),
    visibleUntil: iso(row.visible_until),
    publishedAt: iso(row.published_at),
    withdrawnAt: iso(row.withdrawn_at),
    version: Number(row.version),
    updatedAt: iso(row.updated_at),
  }
}

function announcementScope(value) {
  return {
    scopeType: value.scopeType,
    scopeId: value.scopeType === 'BRANCH' ? value.branchId : null,
  }
}

function sameScope(left, right) {
  return left?.scopeType === right?.scopeType
    && (left?.scopeId || null) === (right?.scopeId || null)
}

async function assertReferences(tx, appId, draft, publicOnly) {
  if (draft.scopeType === 'BRANCH') {
    const branch = await tx.one(
      `SELECT id FROM mip_city_branches
       WHERE app_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE`,
      [appId, draft.branchId],
    )
    if (!branch) throw codeError('VALIDATION_FAILED')
  }
  if (!draft.targetType) return
  const target = draft.targetType === 'EVENT'
    ? await tx.one(
        `SELECT scope_type, branch_id, status FROM mip_events
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [appId, draft.targetId],
      )
    : await tx.one(
        `SELECT scope_type, branch_id, status FROM mip_opportunities
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [appId, draft.targetId],
      )
  if (!target) throw codeError('VALIDATION_FAILED')
  if (draft.scopeType === 'BRANCH'
    && (target.scope_type !== 'BRANCH' || target.branch_id !== draft.branchId)) {
    throw codeError('VALIDATION_FAILED')
  }
  if (draft.targetType === 'OPPORTUNITY' && target.status === 'ARCHIVED') {
    throw codeError('INVALID_STATE')
  }
  const publicStatuses = draft.targetType === 'EVENT'
    ? ['PUBLISHED', 'ENDED', 'CANCELLED']
    : ['PUBLISHED', 'ENDED']
  if (publicOnly && !publicStatuses.includes(target.status)) throw codeError('INVALID_STATE')
}

function visibleAnnouncementsWhere(visibility) {
  if (visibility.platform) return { sql: '1 = 1', params: [] }
  if (!visibility.branchIds.length) return { sql: '0 = 1', params: [] }
  return {
    sql: `(announcement.scope_type = 'BRANCH'
      AND announcement.branch_id IN (${placeholders(visibility.branchIds)}))`,
    params: [...visibility.branchIds],
  }
}

async function writeAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'ADMIN', ?, ?, ?, 'ANNOUNCEMENT', ?, ?, ?)`,
    [audit.appId, audit.actorUserId, audit.scopeType, audit.scopeId || null,
      audit.action, audit.resourceId, audit.effectiveRole || null,
      JSON.stringify(audit.metadata || {})],
  )
}

async function writeOutbox(tx, event) {
  await tx.query(
    `INSERT INTO mip_outbox_events (
      id, app_id, aggregate_type, aggregate_id, event_type, source_version, payload_json
    ) VALUES (?, ?, 'ANNOUNCEMENT', ?, ?, ?, JSON_OBJECT())`,
    [event.id, event.appId, event.aggregateId, event.eventType, event.sourceVersion],
  )
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&')
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

module.exports = {
  announcementDto,
  createAnnouncementRepository,
}
