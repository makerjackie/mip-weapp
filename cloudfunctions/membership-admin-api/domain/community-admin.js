'use strict'

const { randomUUID } = require('node:crypto')

function uuid(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)
}

function iso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function requiredText(value, max, errorCode) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > max) {
    throw new Error(errorCode)
  }
  return text
}

function optionalDate(value, errorCode) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(errorCode)
  }
  return date
}

function normalizeAnnouncement(value) {
  const visibleFrom = optionalDate(value?.visibleFrom, 'INVALID_ANNOUNCEMENT_WINDOW')
  const visibleUntil = optionalDate(value?.visibleUntil, 'INVALID_ANNOUNCEMENT_WINDOW')
  if (visibleFrom && visibleUntil && visibleUntil <= visibleFrom) {
    throw new Error('INVALID_ANNOUNCEMENT_WINDOW')
  }
  return {
    id: value?.id === undefined || value?.id === '' ? null : value.id,
    title: requiredText(value?.title, 80, 'INVALID_ANNOUNCEMENT_TITLE'),
    summary: requiredText(value?.summary, 160, 'INVALID_ANNOUNCEMENT_SUMMARY'),
    body: requiredText(value?.body, 5000, 'INVALID_ANNOUNCEMENT_BODY'),
    visibleFrom,
    visibleUntil,
    expectedVersion: Number(value?.version),
  }
}

function publicAdminAnnouncement(row) {
  return {
    id: row.id,
    title: row.title || '',
    summary: row.summary || '',
    body: row.body || '',
    status: row.status,
    isPinned: Boolean(Number(row.is_pinned)),
    visibleFrom: iso(row.visible_from),
    visibleUntil: iso(row.visible_until),
    publishedAt: iso(row.published_at),
    version: Number(row.version || 1),
    updatedAt: iso(row.updated_at),
  }
}

async function listAdminAnnouncements(database, input) {
  const selectedStatus = ['DRAFT', 'PUBLISHED', 'WITHDRAWN'].includes(input.status)
    ? input.status
    : ''
  const query = typeof input.query === 'string' ? input.query.trim().slice(0, 40) : ''
  const conditions = ['app_id = ?']
  const params = [input.appId]
  if (selectedStatus) {
    conditions.push('status = ?')
    params.push(selectedStatus)
  }
  if (query) {
    conditions.push('(title LIKE ? OR summary LIKE ?)')
    params.push(`%${query.replace(/[%_\\]/g, '\\$&')}%`, `%${query.replace(/[%_\\]/g, '\\$&')}%`)
  }
  const rows = await database.query(
    `SELECT * FROM member_announcements
     WHERE ${conditions.join(' AND ')}
     ORDER BY is_pinned DESC, updated_at DESC, id DESC LIMIT 100`,
    params,
  )
  return rows.map(publicAdminAnnouncement)
}

async function getAdminAnnouncement(database, input) {
  if (!uuid(input.announcementId)) {
    throw new Error('ANNOUNCEMENT_NOT_FOUND')
  }
  const row = await database.one(
    'SELECT * FROM member_announcements WHERE app_id = ? AND id = ?',
    [input.appId, input.announcementId],
  )
  if (!row) {
    throw new Error('ANNOUNCEMENT_NOT_FOUND')
  }
  return publicAdminAnnouncement(row)
}

async function saveAnnouncement(database, input) {
  const value = normalizeAnnouncement(input.announcement)
  if (!value.id) {
    const id = randomUUID()
    await database.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO member_announcements (
           id, app_id, title, summary, body, status, visible_from, visible_until,
           created_by, updated_by
         ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`,
        [
          id,
          input.appId,
          value.title,
          value.summary,
          value.body,
          value.visibleFrom,
          value.visibleUntil,
          input.actorId,
          input.actorId,
        ],
      )
      await tx.query(
        `INSERT INTO member_audit_logs (
           app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
         ) VALUES (?, ?, ?, 'ANNOUNCEMENT_CREATED', 'announcement', ?, ?)`,
        [input.appId, input.actorId, input.actorRole, id, JSON.stringify({ version: 1 })],
      )
    })
    return getAdminAnnouncement(database, { appId: input.appId, announcementId: id })
  }
  if (!uuid(value.id) || !Number.isInteger(value.expectedVersion) || value.expectedVersion < 1) {
    throw new Error('INVALID_ANNOUNCEMENT_VERSION')
  }
  await database.transaction(async (tx) => {
    const stored = await tx.one(
      `SELECT status, version FROM member_announcements
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [input.appId, value.id],
    )
    if (!stored) {
      throw new Error('ANNOUNCEMENT_NOT_FOUND')
    }
    if (Number(stored.version) !== value.expectedVersion) {
      throw new Error('ANNOUNCEMENT_VERSION_CONFLICT')
    }
    const updated = await tx.query(
      `UPDATE member_announcements
       SET title = ?, summary = ?, body = ?, visible_from = ?, visible_until = ?,
           updated_by = ?, version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [
        value.title,
        value.summary,
        value.body,
        value.visibleFrom,
        value.visibleUntil,
        input.actorId,
        input.appId,
        value.id,
        value.expectedVersion,
      ],
    )
    if (Number(updated?.affectedRows || 0) !== 1) {
      throw new Error('ANNOUNCEMENT_VERSION_CONFLICT')
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, 'ANNOUNCEMENT_UPDATED', 'announcement', ?, ?)`,
      [
        input.appId,
        input.actorId,
        input.actorRole,
        value.id,
        JSON.stringify({ fromVersion: value.expectedVersion, toVersion: value.expectedVersion + 1 }),
      ],
    )
  })
  return getAdminAnnouncement(database, { appId: input.appId, announcementId: value.id })
}

async function setAnnouncementState(database, input) {
  if (!uuid(input.announcementId)
    || !Number.isInteger(Number(input.expectedVersion))
    || Number(input.expectedVersion) < 1
    || !['PUBLISH', 'WITHDRAW', 'PIN', 'UNPIN'].includes(input.action)) {
    throw new Error('INVALID_ANNOUNCEMENT_TRANSITION')
  }
  const expectedVersion = Number(input.expectedVersion)
  await database.transaction(async (tx) => {
    const stored = await tx.one(
      `SELECT status, is_pinned, version FROM member_announcements
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [input.appId, input.announcementId],
    )
    if (!stored) {
      throw new Error('ANNOUNCEMENT_NOT_FOUND')
    }
    if (Number(stored.version) !== expectedVersion) {
      throw new Error('ANNOUNCEMENT_VERSION_CONFLICT')
    }
    if (input.action === 'PUBLISH' && !['DRAFT', 'PUBLISHED', 'WITHDRAWN'].includes(stored.status)) {
      throw new Error('INVALID_ANNOUNCEMENT_TRANSITION')
    }
    if (input.action === 'WITHDRAW' && stored.status !== 'PUBLISHED') {
      throw new Error('INVALID_ANNOUNCEMENT_TRANSITION')
    }
    if (['PIN', 'UNPIN'].includes(input.action) && stored.status !== 'PUBLISHED') {
      throw new Error('INVALID_ANNOUNCEMENT_TRANSITION')
    }
    if (input.action === 'PIN') {
      await tx.query(
        `UPDATE member_announcements
         SET is_pinned = 0, updated_by = ?, version = version + 1
         WHERE app_id = ? AND status = 'PUBLISHED' AND is_pinned = 1 AND id <> ?`,
        [input.actorId, input.appId, input.announcementId],
      )
    }
    const status = input.action === 'PUBLISH'
      ? 'PUBLISHED'
      : input.action === 'WITHDRAW' ? 'WITHDRAWN' : stored.status
    const pinned = input.action === 'PIN'
      ? 1
      : ['UNPIN', 'WITHDRAW'].includes(input.action) ? 0 : Number(stored.is_pinned)
    const updated = await tx.query(
      `UPDATE member_announcements
       SET status = ?, is_pinned = ?, updated_by = ?, version = version + 1,
           published_at = CASE
             WHEN ? = 'PUBLISH' THEN COALESCE(published_at, UTC_TIMESTAMP(3))
             ELSE published_at
           END,
           withdrawn_at = CASE
             WHEN ? = 'WITHDRAW' THEN UTC_TIMESTAMP(3)
             WHEN ? = 'PUBLISH' THEN NULL
             ELSE withdrawn_at
           END
       WHERE app_id = ? AND id = ? AND version = ?`,
      [
        status,
        pinned,
        input.actorId,
        input.action,
        input.action,
        input.action,
        input.appId,
        input.announcementId,
        expectedVersion,
      ],
    )
    if (Number(updated?.affectedRows || 0) !== 1) {
      throw new Error('ANNOUNCEMENT_VERSION_CONFLICT')
    }
    const auditAction = {
      PUBLISH: 'ANNOUNCEMENT_PUBLISHED',
      WITHDRAW: 'ANNOUNCEMENT_WITHDRAWN',
      PIN: 'ANNOUNCEMENT_PINNED',
      UNPIN: 'ANNOUNCEMENT_UNPINNED',
    }[input.action]
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, ?, 'announcement', ?, ?)`,
      [
        input.appId,
        input.actorId,
        input.actorRole,
        auditAction,
        input.announcementId,
        JSON.stringify({ fromVersion: expectedVersion, toVersion: expectedVersion + 1 }),
      ],
    )
  })
  return getAdminAnnouncement(database, {
    appId: input.appId,
    announcementId: input.announcementId,
  })
}

function publicReport(row) {
  return {
    id: row.id,
    targetMemberId: row.target_member_id,
    targetNickname: row.target_nickname || '社区成员',
    targetAvatarUrl: row.target_avatar_url || '',
    category: row.category,
    description: row.description || '',
    status: row.status,
    priorReportCount: Number(row.prior_report_count || 0),
    resolutionAction: row.resolution_action || null,
    resolutionReason: row.resolution_reason || '',
    version: Number(row.version || 1),
    createdAt: iso(row.created_at),
    handledAt: iso(row.handled_at),
  }
}

async function listMemberReports(database, input) {
  const selectedStatus = ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'].includes(input.status)
    ? input.status
    : ''
  const rows = await database.query(
    `SELECT report.*, profile.id AS target_member_id,
            profile.nickname AS target_nickname,
            avatar.cloud_file_id AS target_avatar_url,
            (
              SELECT COUNT(*) FROM member_reports previous
              WHERE previous.app_id = report.app_id
                AND previous.target_user_id = report.target_user_id
                AND previous.created_at <= report.created_at
            ) AS prior_report_count
     FROM member_reports report
     INNER JOIN member_profiles profile
       ON profile.app_id = report.app_id AND profile.user_id = report.target_user_id
     LEFT JOIN member_media_assets avatar
       ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
       AND avatar.status = 'READY'
     WHERE report.app_id = ?${selectedStatus ? ' AND report.status = ?' : ''}
     ORDER BY report.created_at ASC, report.id ASC LIMIT 100`,
    selectedStatus ? [input.appId, selectedStatus] : [input.appId],
  )
  return rows.map(publicReport)
}

async function resolveMemberReport(database, input) {
  if (!uuid(input.reportId)
    || !Number.isInteger(Number(input.expectedVersion))
    || Number(input.expectedVersion) < 1
    || !['DISMISS', 'HIDE_PROFILE'].includes(input.decision)) {
    throw new Error('INVALID_REPORT_DECISION')
  }
  const reason = requiredText(input.reason, 200, 'INVALID_REPORT_REASON')
  const expectedVersion = Number(input.expectedVersion)
  return database.transaction(async (tx) => {
    const report = await tx.one(
      `SELECT id, target_user_id, status, version
       FROM member_reports
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [input.appId, input.reportId],
    )
    if (!report) {
      throw new Error('REPORT_NOT_FOUND')
    }
    if (Number(report.version) !== expectedVersion
      || !['PENDING', 'REVIEWING'].includes(report.status)) {
      throw new Error('REPORT_VERSION_CONFLICT')
    }
    const nextStatus = input.decision === 'DISMISS' ? 'DISMISSED' : 'RESOLVED'
    const resolutionAction = input.decision === 'DISMISS' ? 'NONE' : 'HIDE_PROFILE'
    if (input.decision === 'HIDE_PROFILE') {
      await tx.query(
        `UPDATE member_profiles
         SET status = 'SUSPENDED', approved_at = NULL, updated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND user_id = ? AND status <> 'DELETED'`,
        [input.appId, report.target_user_id],
      )
    }
    const updated = await tx.query(
      `UPDATE member_reports
       SET status = ?, resolution_action = ?, resolution_reason = ?,
           handled_by = ?, handled_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [
        nextStatus,
        resolutionAction,
        reason,
        input.actorId,
        input.appId,
        input.reportId,
        expectedVersion,
      ],
    )
    if (Number(updated?.affectedRows || 0) !== 1) {
      throw new Error('REPORT_VERSION_CONFLICT')
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, ?, 'MEMBER_REPORT_RESOLVED', 'member_report', ?, ?)`,
      [
        input.appId,
        input.actorId,
        input.actorRole,
        input.reportId,
        JSON.stringify({
          decision: input.decision,
          reason,
          fromVersion: expectedVersion,
          toVersion: expectedVersion + 1,
        }),
      ],
    )
    return {
      id: input.reportId,
      status: nextStatus,
      resolutionAction,
      version: expectedVersion + 1,
    }
  })
}

module.exports = {
  getAdminAnnouncement,
  listAdminAnnouncements,
  listMemberReports,
  normalizeAnnouncement,
  publicAdminAnnouncement,
  resolveMemberReport,
  saveAnnouncement,
  setAnnouncementState,
}
