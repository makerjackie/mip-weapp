'use strict'

const { randomUUID } = require('node:crypto')
const { createKnowledgeService } = require('./knowledge')

const REPORT_CATEGORIES = new Set([
  'SPAM',
  'HARASSMENT',
  'FRAUD',
  'INAPPROPRIATE_CONTENT',
  'IMPERSONATION',
  'OTHER',
])

async function lockActiveCaller(adapter, caller) {
  const user = await adapter.one(
    `SELECT id, status FROM mip_users
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [caller.appId, caller.userId],
  )
  if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
}

function createCommunityService(database, options) {
  const id = options.id || randomUUID
  const readProfileRef = options.readProfileRef
  const createProfileRef = options.createProfileRef
  const profileRefSecret = options.profileRefSecret
  const knowledge = createKnowledgeService(database, {
    assertSafe: options.assertKnowledgeSafe,
    catalogStage: options.catalogStage,
    createProfileRef,
    id: options.id,
    profileRefSecret,
  })

  function targetUserId(profileRef, appId) {
    const normalized = typeof profileRef === 'string' ? profileRef.trim() : ''
    return readProfileRef(normalized, appId, profileRefSecret)
  }

  async function targetUser(adapter, caller, profileRef, {
    lock = false,
    allowSelf = false,
    activeOnly = true,
  } = {}) {
    const targetId = targetUserId(profileRef, caller.appId)
    if (!allowSelf && targetId === caller.userId) throw new Error('SELF_TARGET')
    const user = await adapter.one(
      `SELECT id FROM mip_users
       WHERE app_id = ? AND id = ? ${activeOnly ? `AND status = 'ACTIVE'` : ''}
       ${lock ? 'FOR UPDATE' : ''}`,
      [caller.appId, targetId],
    )
    if (!user) throw new Error('TARGET_NOT_FOUND')
    return user.id
  }

  async function getRelationship(caller, input) {
    const targetId = await targetUser(database, caller, input?.profileRef, { allowSelf: true })
    if (targetId === caller.userId) {
      return { profileRef: String(input.profileRef).trim(), isSelf: true, blocked: false }
    }
    const block = await database.one(
      `SELECT status FROM mip_user_blocks
       WHERE app_id = ? AND blocker_user_id = ? AND blocked_user_id = ?`,
      [caller.appId, caller.userId, targetId],
    )
    return {
      profileRef: String(input.profileRef).trim(),
      isSelf: false,
      blocked: block?.status === 'ACTIVE',
    }
  }

  async function setBlock(caller, input, blocked) {
    const profileRef = typeof input?.profileRef === 'string' ? input.profileRef.trim() : ''
    return database.transaction(async (tx) => {
      await lockActiveCaller(tx, caller)
      const targetId = await targetUser(tx, caller, profileRef, { lock: true, activeOnly: blocked })
      const existing = await tx.one(
        `SELECT status, version FROM mip_user_blocks
         WHERE app_id = ? AND blocker_user_id = ? AND blocked_user_id = ?
         FOR UPDATE`,
        [caller.appId, caller.userId, targetId],
      )
      const desired = blocked ? 'ACTIVE' : 'INACTIVE'
      if (!existing && !blocked) {
        return { profileRef, blocked: false, changed: false, version: 0 }
      }
      if (existing?.status === desired) {
        return { profileRef, blocked, changed: false, version: Number(existing.version) }
      }
      if (existing) {
        await tx.query(
          `UPDATE mip_user_blocks
           SET status = ?, version = version + 1,
               blocked_at = CASE WHEN ? = 'ACTIVE' THEN UTC_TIMESTAMP(3) ELSE blocked_at END,
               unblocked_at = CASE WHEN ? = 'INACTIVE' THEN UTC_TIMESTAMP(3) ELSE NULL END
           WHERE app_id = ? AND blocker_user_id = ? AND blocked_user_id = ?`,
          [desired, desired, desired, caller.appId, caller.userId, targetId],
        )
        return { profileRef, blocked, changed: true, version: Number(existing.version) + 1 }
      }
      await tx.query(
        `INSERT INTO mip_user_blocks (
           app_id, blocker_user_id, blocked_user_id, status, version, blocked_at, unblocked_at
         ) VALUES (?, ?, ?, 'ACTIVE', 1, UTC_TIMESTAMP(3), NULL)`,
        [caller.appId, caller.userId, targetId],
      )
      return { profileRef, blocked: true, changed: true, version: 1 }
    })
  }

  async function listBlocked(caller, input = {}) {
    const offset = normalizeOffset(input.cursor)
    const limit = normalizeLimit(input.limit)
    const rows = await database.query(
      `SELECT block.blocked_user_id, block.blocked_at,
              profile.nickname, profile.headline, profile.visibility_json,
              avatar.cloud_file_id AS avatar_file_id,
              branch.city_name
       FROM mip_user_blocks block
       INNER JOIN mip_users target
         ON target.app_id = block.app_id AND target.id = block.blocked_user_id
       LEFT JOIN mip_profiles profile
         ON profile.app_id = target.app_id AND profile.user_id = target.id
       LEFT JOIN mip_media_assets avatar
         ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
           AND avatar.status = 'READY'
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = target.app_id AND branch.id = target.primary_branch_id
       WHERE block.app_id = ? AND block.blocker_user_id = ? AND block.status = 'ACTIVE'
       ORDER BY block.blocked_at DESC, block.blocked_user_id DESC
       LIMIT ? OFFSET ?`,
      [caller.appId, caller.userId, limit + 1, offset],
    )
    const pageRows = rows.slice(0, limit)
    return {
      items: pageRows.map((row) => blockedProfileDto(row, caller.appId, createProfileRef, profileRefSecret)),
      nextCursor: rows.length > limit ? String(offset + limit) : undefined,
    }
  }

  async function reportProfile(caller, input) {
    const normalized = normalizeReportInput(input)
    const targetId = targetUserId(normalized.profileRef, caller.appId)
    if (targetId === caller.userId) throw new Error('SELF_TARGET')
    try {
      return await database.transaction(async (tx) => {
        await lockActiveCaller(tx, caller)
        const target = await tx.one(
          `SELECT id FROM mip_users
           WHERE app_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE`,
          [caller.appId, targetId],
        )
        if (!target) throw new Error('TARGET_NOT_FOUND')
        const existing = await loadReportByRequest(tx, caller.appId, caller.userId, normalized.requestId)
        if (existing) return reportReplay(existing, targetId, normalized)
        const reportId = id()
        await tx.query(
          `INSERT INTO mip_reports (
             id, app_id, reporter_user_id, target_user_id,
             category, description, request_id, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [
            reportId,
            caller.appId,
            caller.userId,
            targetId,
            normalized.category,
            normalized.description || null,
            normalized.requestId,
          ],
        )
        return { reportId, status: 'PENDING', idempotent: false }
      })
    }
    catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error
      const existing = await loadReportByRequest(database, caller.appId, caller.userId, normalized.requestId)
      if (!existing) throw error
      return reportReplay(existing, targetId, normalized)
    }
  }

  async function listAnnouncements(caller, input = {}) {
    const branchId = optionalUuid(input.branchId)
    const offset = normalizeOffset(input.cursor)
    const limit = normalizeLimit(input.limit)
    const rows = await database.query(
      `SELECT announcement.id, announcement.title, announcement.summary,
              announcement.is_pinned, announcement.published_at,
              announcement.visible_until, announcement.target_type,
              announcement.target_id, announcement.scope_type,
              branch.name AS branch_name
       FROM mip_announcements announcement
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = announcement.app_id AND branch.id = announcement.branch_id
       WHERE announcement.app_id = ? AND announcement.status = 'PUBLISHED'
         AND announcement.visible_from <= UTC_TIMESTAMP(3)
         AND (announcement.visible_until IS NULL
           OR announcement.visible_until > UTC_TIMESTAMP(3))
         AND (announcement.scope_type = 'PLATFORM'
           OR (? IS NOT NULL AND announcement.scope_type = 'BRANCH'
             AND announcement.branch_id = ?))
       ORDER BY announcement.is_pinned DESC,
         announcement.published_at DESC, announcement.id DESC
       LIMIT ? OFFSET ?`,
      [caller.appId, branchId, branchId, limit + 1, offset],
    )
    return {
      items: rows.slice(0, limit).map(announcementSummaryDto),
      nextCursor: rows.length > limit ? String(offset + limit) : undefined,
    }
  }

  async function getAnnouncement(caller, input = {}) {
    const announcementId = requiredUuid(input.announcementId)
    const row = await database.one(
      `SELECT announcement.id, announcement.title, announcement.summary,
              announcement.body, announcement.is_pinned,
              announcement.published_at, announcement.visible_until,
              announcement.target_type, announcement.target_id,
              announcement.scope_type, branch.name AS branch_name
       FROM mip_announcements announcement
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = announcement.app_id AND branch.id = announcement.branch_id
       WHERE announcement.app_id = ? AND announcement.id = ?
         AND announcement.status = 'PUBLISHED'
         AND announcement.visible_from <= UTC_TIMESTAMP(3)
         AND (announcement.visible_until IS NULL
           OR announcement.visible_until > UTC_TIMESTAMP(3))`,
      [caller.appId, announcementId],
    )
    if (!row) throw new Error('ANNOUNCEMENT_NOT_FOUND')
    return { ...announcementSummaryDto(row), body: String(row.body || '') }
  }

  return {
    ...knowledge,
    blockProfile: (caller, input) => setBlock(caller, input, true),
    getAnnouncement,
    getRelationship,
    listAnnouncements,
    listBlocked,
    reportProfile,
    unblockProfile: (caller, input) => setBlock(caller, input, false),
  }
}

function announcementSummaryDto(row) {
  return {
    id: row.id,
    title: String(row.title || ''),
    summary: String(row.summary || ''),
    isPinned: Boolean(row.is_pinned),
    publishedAt: iso(row.published_at),
    visibleUntil: row.visible_until ? iso(row.visible_until) : undefined,
    scopeType: row.scope_type,
    branchName: row.branch_name || undefined,
    targetType: row.target_type || undefined,
    targetId: row.target_id || undefined,
  }
}

function optionalUuid(value) {
  if (value === undefined || value === null || value === '') return null
  return requiredUuid(value)
}

function requiredUuid(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

function normalizeReportInput(input = {}) {
  const profileRef = typeof input.profileRef === 'string' ? input.profileRef.trim() : ''
  const category = typeof input.category === 'string' ? input.category.trim().toUpperCase() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : ''
  if (!profileRef || !REPORT_CATEGORIES.has(category)
    || description.length > 300
    || !/^[A-Za-z0-9:_-]{12,128}$/.test(requestId)) {
    throw new Error('VALIDATION_FAILED')
  }
  return { profileRef, category, description, requestId }
}

function normalizeOffset(value) {
  if (value === undefined || value === null || value === '') return 0
  const result = Number(value)
  if (!Number.isInteger(result) || result < 0 || result > 10_000) throw new Error('VALIDATION_FAILED')
  return result
}

function normalizeLimit(value) {
  const result = Number(value)
  return Math.min(30, Math.max(1, Number.isInteger(result) ? result : 20))
}

function jsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

function blockedProfileDto(row, appId, createProfileRef, profileRefSecret) {
  const allowed = jsonObject(row.visibility_json)
  return {
    profileRef: createProfileRef({ appId, userId: row.blocked_user_id }, profileRefSecret),
    nickname: allowed.nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
    avatarUrl: allowed.avatar === false ? undefined : (row.avatar_file_id || undefined),
    headline: allowed.headline === false ? undefined : (row.headline || undefined),
    cityName: allowed.primaryBranch === false ? undefined : (row.city_name || undefined),
    blockedAt: iso(row.blocked_at),
  }
}

async function loadReportByRequest(adapter, appId, reporterUserId, requestId) {
  return adapter.one(
    `SELECT id, target_user_id, category, description, status
     FROM mip_reports
     WHERE app_id = ? AND reporter_user_id = ? AND request_id = ?`,
    [appId, reporterUserId, requestId],
  )
}

function reportReplay(existing, targetUserId, input) {
  if (existing.target_user_id !== targetUserId
    || existing.category !== input.category
    || String(existing.description || '') !== input.description) {
    throw new Error('IDEMPOTENCY_CONFLICT')
  }
  return { reportId: existing.id, status: existing.status, idempotent: true }
}

function iso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

module.exports = {
  REPORT_CATEGORIES,
  announcementSummaryDto,
  createCommunityService,
  normalizeReportInput,
}
