'use strict'

const { randomUUID } = require('node:crypto')

const REPORT_CATEGORIES = new Set([
  'HARASSMENT',
  'SPAM',
  'FRAUD',
  'INAPPROPRIATE',
  'PRIVACY',
  'OTHER',
])

function uuid(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)
}

function iso(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function announcementSummary(row) {
  return {
    id: row.id,
    title: row.title || '',
    summary: row.summary || '',
    isPinned: Boolean(Number(row.is_pinned)),
    publishedAt: iso(row.published_at),
  }
}

async function listAnnouncements(database, input) {
  const limit = Math.min(Math.max(Number(input.limit || 30), 1), 50)
  const rows = await database.query(
    `SELECT id, title, summary, is_pinned, published_at
     FROM member_announcements
     WHERE app_id = ? AND status = 'PUBLISHED'
       AND (visible_from IS NULL OR visible_from <= UTC_TIMESTAMP(3))
       AND (visible_until IS NULL OR visible_until > UTC_TIMESTAMP(3))
     ORDER BY is_pinned DESC, published_at DESC, id DESC
     LIMIT ${limit}`,
    [input.appId],
  )
  return rows.map(announcementSummary)
}

async function getAnnouncement(database, input) {
  if (!uuid(input.announcementId)) {
    throw new Error('ANNOUNCEMENT_NOT_FOUND')
  }
  const row = await database.one(
    `SELECT id, title, summary, body, is_pinned, published_at
     FROM member_announcements
     WHERE app_id = ? AND id = ? AND status = 'PUBLISHED'
       AND (visible_from IS NULL OR visible_from <= UTC_TIMESTAMP(3))
       AND (visible_until IS NULL OR visible_until > UTC_TIMESTAMP(3))`,
    [input.appId, input.announcementId],
  )
  if (!row) {
    throw new Error('ANNOUNCEMENT_NOT_FOUND')
  }
  return {
    ...announcementSummary(row),
    body: row.body || '',
  }
}

async function findVisibleTarget(database, input) {
  if (!uuid(input.memberId)) {
    throw new Error('MEMBER_NOT_FOUND')
  }
  const target = await database.one(
    `SELECT id, user_id, nickname, city, headline, avatar_asset_id
     FROM member_profiles
     WHERE app_id = ? AND id = ?
       AND status ${input.requireApproved === false ? "<> 'DELETED'" : "= 'APPROVED'"}`,
    [input.appId, input.memberId],
  )
  if (!target?.user_id || target.user_id === input.userId) {
    throw new Error('MEMBER_NOT_FOUND')
  }
  return target
}

async function assertNoBlockRelationship(database, input) {
  const row = await database.one(
    `SELECT 1 AS blocked
     FROM member_blocks
     WHERE app_id = ?
       AND (
         (blocker_user_id = ? AND blocked_user_id = ?)
         OR (blocker_user_id = ? AND blocked_user_id = ?)
       )
     LIMIT 1`,
    [input.appId, input.userId, input.targetUserId, input.targetUserId, input.userId],
  )
  if (row) {
    throw new Error('MEMBER_NOT_FOUND')
  }
}

async function setMemberBlock(database, input) {
  const target = await findVisibleTarget(database, {
    ...input,
    requireApproved: input.blocked,
  })
  return database.transaction(async (tx) => {
    if (input.blocked) {
      await tx.query(
        `INSERT IGNORE INTO member_blocks (
           app_id, blocker_user_id, blocked_user_id
         ) VALUES (?, ?, ?)`,
        [input.appId, input.userId, target.user_id],
      )
      await tx.query(
        `DELETE FROM member_follows
         WHERE app_id = ?
           AND (
             (follower_user_id = ? AND followee_user_id = ?)
             OR (follower_user_id = ? AND followee_user_id = ?)
           )`,
        [input.appId, input.userId, target.user_id, target.user_id, input.userId],
      )
    }
    else {
      await tx.query(
        `DELETE FROM member_blocks
         WHERE app_id = ? AND blocker_user_id = ? AND blocked_user_id = ?`,
        [input.appId, input.userId, target.user_id],
      )
    }
    await tx.query(
      `INSERT INTO member_audit_logs (
         app_id, actor_id, actor_role, action, resource_type, resource_id, metadata
       ) VALUES (?, ?, 'member', ?, 'profile', ?, ?)`,
      [
        input.appId,
        input.userId,
        input.blocked ? 'MEMBER_BLOCKED' : 'MEMBER_UNBLOCKED',
        target.id,
        JSON.stringify({ memberId: target.id }),
      ],
    )
    return { memberId: target.id, blocked: Boolean(input.blocked) }
  })
}

async function listBlockedMembers(database, input) {
  const rows = await database.query(
    `SELECT p.id, p.nickname, p.city, p.headline,
            avatar.cloud_file_id AS avatar_file_id, b.created_at
     FROM member_blocks b
     INNER JOIN member_profiles p
       ON p.app_id = b.app_id AND p.user_id = b.blocked_user_id
       AND p.status <> 'DELETED'
     LEFT JOIN member_media_assets avatar
       ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id
       AND avatar.status = 'READY'
     WHERE b.app_id = ? AND b.blocker_user_id = ?
     ORDER BY b.created_at DESC LIMIT 100`,
    [input.appId, input.userId],
  )
  return rows.map(row => ({
    id: row.id,
    nickname: row.nickname || '社区成员',
    city: row.city || '',
    headline: row.headline || '',
    avatarUrl: row.avatar_file_id || '',
    blockedAt: iso(row.created_at),
  }))
}

function normalizeReport(input) {
  if (!REPORT_CATEGORIES.has(input.category)) {
    throw new Error('REPORT_CATEGORY_INVALID')
  }
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description.length > 200) {
    throw new Error('REPORT_DESCRIPTION_INVALID')
  }
  const idempotencyKey = typeof input.idempotencyKey === 'string'
    ? input.idempotencyKey.trim()
    : ''
  if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new Error('REPORT_IDEMPOTENCY_INVALID')
  }
  return {
    category: input.category,
    description,
    idempotencyKey,
  }
}

async function createMemberReport(database, input) {
  const normalized = normalizeReport(input)
  const target = await findVisibleTarget(database, input)
  const reportId = randomUUID()
  const inserted = await database.query(
    `INSERT IGNORE INTO member_reports (
       id, app_id, reporter_user_id, target_user_id, category, description,
       idempotency_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      reportId,
      input.appId,
      input.userId,
      target.user_id,
      normalized.category,
      normalized.description,
      normalized.idempotencyKey,
    ],
  )
  const stored = await database.one(
    `SELECT id, target_user_id, category, description, status
     FROM member_reports
     WHERE app_id = ? AND reporter_user_id = ? AND idempotency_key = ?`,
    [input.appId, input.userId, normalized.idempotencyKey],
  )
  if (!stored
    || stored.target_user_id !== target.user_id
    || stored.category !== normalized.category
    || stored.description !== normalized.description) {
    throw new Error('REPORT_IDEMPOTENCY_CONFLICT')
  }
  return {
    id: stored.id,
    status: stored.status,
    idempotent: Number(inserted?.affectedRows || 0) !== 1,
  }
}

module.exports = {
  REPORT_CATEGORIES,
  announcementSummary,
  assertNoBlockRelationship,
  createMemberReport,
  getAnnouncement,
  listAnnouncements,
  listBlockedMembers,
  normalizeReport,
  setMemberBlock,
}
