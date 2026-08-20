'use strict'

const ACTIVE_REGISTRATION_STATUSES = Object.freeze([
  'REGISTERED',
  'CANCELLATION_PENDING',
  'ATTENDED',
])

function jsonArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

function iso(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function publicParticipant(row) {
  return {
    id: row.id,
    nickname: row.nickname || '社区成员',
    city: row.city || '',
    headline: row.headline || '',
    bio: row.bio || '',
    organization: row.organization || '',
    roleTitle: row.role_title || '',
    industry: row.industry || '',
    avatarUrl: row.avatar_file_id || '',
    tags: jsonArray(row.tags).slice(0, 4),
    interests: jsonArray(row.interests).slice(0, 4),
    skills: jsonArray(row.skills).slice(0, 4),
    detailLocked: false,
    registeredAt: iso(row.registered_at),
  }
}

function roleFilter(value) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized.length <= 60 ? normalized : ''
}

function uuid(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)
}

function blockFilter(userId, profileAlias = 'p') {
  if (typeof userId !== 'string' || !userId) {
    return { sql: '', params: [] }
  }
  return {
    sql: ` AND NOT EXISTS (
      SELECT 1 FROM member_blocks b
      WHERE b.app_id = ${profileAlias}.app_id
        AND (
          (b.blocker_user_id = ? AND b.blocked_user_id = ${profileAlias}.user_id)
          OR (b.blocker_user_id = ${profileAlias}.user_id AND b.blocked_user_id = ?)
        )
    )`,
    params: [userId, userId],
  }
}

async function listEventParticipants(database, input) {
  const limit = Math.min(Math.max(Number(input.limit || 20), 1), 50)
  const queryLimit = limit + 1
  const selectedRole = roleFilter(input.role)
  const cursor = uuid(input.cursor) ? input.cursor : ''
  const statuses = ACTIVE_REGISTRATION_STATUSES.map(() => '?').join(', ')
  const baseParams = [input.appId, input.eventId, ...ACTIVE_REGISTRATION_STATUSES]
  const blocks = blockFilter(input.userId)
  const [totalRow, visibleRow, roleRows] = await Promise.all([
    database.one(
      `SELECT COUNT(*) AS total
       FROM member_registrations
       WHERE app_id = ? AND event_id = ? AND status IN (${statuses})`,
      baseParams,
    ),
    database.one(
      `SELECT COUNT(*) AS total
       FROM member_registrations r
       INNER JOIN member_profiles p
         ON p.app_id = r.app_id AND p.user_id = r.user_id
         AND p.status = 'APPROVED'
       WHERE r.app_id = ? AND r.event_id = ? AND r.share_profile = 1
         AND r.status IN (${statuses})${blocks.sql}`,
      [...baseParams, ...blocks.params],
    ),
    database.query(
      `SELECT DISTINCT p.role_title
       FROM member_registrations r
       INNER JOIN member_profiles p
         ON p.app_id = r.app_id AND p.user_id = r.user_id
         AND p.status = 'APPROVED'
       WHERE r.app_id = ? AND r.event_id = ? AND r.share_profile = 1
         AND r.status IN (${statuses}) AND p.role_title <> ''${blocks.sql}
       ORDER BY p.role_title ASC LIMIT 12`,
      [...baseParams, ...blocks.params],
    ),
  ])
  const where = [
    'r.app_id = ?',
    'r.event_id = ?',
    'r.share_profile = 1',
    `r.status IN (${statuses})`,
    ...(blocks.sql ? [blocks.sql.replace(/^ AND /, '')] : []),
  ]
  const params = [...baseParams, ...blocks.params]
  if (selectedRole) {
    where.push('p.role_title = ?')
    params.push(selectedRole)
  }
  if (cursor) {
    where.push(`(
      r.registered_at < (
        SELECT registered_at FROM member_registrations
        WHERE app_id = ? AND event_id = ? AND id = ?
      )
      OR (
        r.registered_at = (
          SELECT registered_at FROM member_registrations
          WHERE app_id = ? AND event_id = ? AND id = ?
        )
        AND r.id < ?
      )
    )`)
    params.push(
      input.appId,
      input.eventId,
      cursor,
      input.appId,
      input.eventId,
      cursor,
      cursor,
    )
  }
  const rows = await database.query(
    `SELECT r.id AS registration_id, p.id, p.nickname, p.city, p.headline, p.bio, p.organization,
            p.role_title, p.industry, p.tags, p.interests, p.skills,
            avatar.cloud_file_id AS avatar_file_id, r.registered_at
     FROM member_registrations r
     INNER JOIN member_profiles p
       ON p.app_id = r.app_id AND p.user_id = r.user_id
       AND p.status = 'APPROVED'
     LEFT JOIN member_media_assets avatar
       ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id
       AND avatar.status = 'READY'
     WHERE ${where.join(' AND ')}
     ORDER BY r.registered_at DESC, r.id DESC
     LIMIT ${queryLimit}`,
    params,
  )
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  return {
    totalRegistrationCount: Number(totalRow?.total || 0),
    visibleParticipantCount: Number(visibleRow?.total || 0),
    roleFilters: roleRows.map(row => row.role_title).filter(Boolean),
    items: page.map(publicParticipant),
    nextCursor: hasMore ? page.at(-1)?.registration_id || null : null,
  }
}

async function previewEventParticipants(database, input) {
  const limit = Math.min(Math.max(Number(input.limit || 5), 1), 8)
  const statuses = ACTIVE_REGISTRATION_STATUSES.map(() => '?').join(', ')
  const blocks = blockFilter(input.userId)
  const rows = await database.query(
    `SELECT p.id, p.nickname, p.city, p.headline, p.bio, p.organization,
            p.role_title, p.industry, p.tags, p.interests, p.skills,
            avatar.cloud_file_id AS avatar_file_id, r.registered_at
     FROM member_registrations r
     INNER JOIN member_profiles p
       ON p.app_id = r.app_id AND p.user_id = r.user_id
       AND p.status = 'APPROVED'
     LEFT JOIN member_media_assets avatar
       ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id
       AND avatar.status = 'READY'
     WHERE r.app_id = ? AND r.event_id = ? AND r.share_profile = 1
       AND r.status IN (${statuses})${blocks.sql}
     ORDER BY r.registered_at DESC, r.id DESC LIMIT ${limit}`,
    [
      input.appId,
      input.eventId,
      ...ACTIVE_REGISTRATION_STATUSES,
      ...blocks.params,
    ],
  )
  return rows.map(publicParticipant)
}

module.exports = {
  ACTIVE_REGISTRATION_STATUSES,
  listEventParticipants,
  previewEventParticipants,
  publicParticipant,
}
