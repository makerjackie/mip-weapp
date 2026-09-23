'use strict'

const { DomainError } = require('./rules')
const { createProfileRef } = require('../lib/profile-ref')
const { requireActiveUserForMutation } = require('./registration-lifecycle')

function createHeartHistory({ iso, limitOf, mutualBlockFilter, parseJson }) {
  function encodeHeartCursor(row) {
    return Buffer.from(JSON.stringify({
      updatedAt: iso(row.updated_at),
      id: row.id,
    })).toString('base64url')
  }

  function decodeHeartCursor(value) {
    if (!value) return null
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
      if (typeof parsed.updatedAt === 'string'
        && Number.isFinite(Date.parse(parsed.updatedAt))
        && typeof parsed.id === 'string'
        && /^[0-9a-f-]{36}$/i.test(parsed.id)) {
        return parsed
      }
    }
    catch {}
    throw new DomainError('VALIDATION_FAILED', '分页参数无效')
  }

  async function listHeartHistory(db, {
    appId,
    userId,
    kind = 'SENT',
    cursor,
    limit = 20,
    profileRefSecret,
  }) {
    if (!['SENT', 'RECEIVED'].includes(kind)) {
      throw new DomainError('VALIDATION_FAILED', '心动记录类型无效')
    }
    const pageLimit = limitOf(limit)
    const decoded = decodeHeartCursor(cursor)
    const personSql = kind === 'SENT' ? 'h.target_user_id' : 'h.voter_user_id'
    const ownerSql = kind === 'SENT' ? 'h.voter_user_id' : 'h.target_user_id'
    const blockFilter = mutualBlockFilter(userId, personSql, 'h.app_id')
    const cursorClause = decoded
      ? 'AND (h.updated_at < ? OR (h.updated_at = ? AND h.id < ?))'
      : ''
    const params = [appId, userId, ...blockFilter.params]
    if (decoded) {
      params.push(decoded.updatedAt, decoded.updatedAt, decoded.id)
    }
    params.push(pageLimit + 1)
    const rows = await db.query(
      `SELECT h.id, h.updated_at, e.id AS event_id, e.title AS event_title,
         e.starts_at, e.ends_at, p.user_id AS person_user_id, p.nickname, p.headline,
         p.visibility_json, a.cloud_file_id AS avatar_file_id
       FROM mip_event_hearts h
       JOIN mip_events e ON e.app_id = h.app_id AND e.id = h.event_id
       JOIN mip_profiles p ON p.app_id = h.app_id AND p.user_id = ${personSql}
       JOIN mip_users person ON person.app_id = p.app_id AND person.id = p.user_id AND person.status = 'ACTIVE'
       LEFT JOIN mip_media_assets a
         ON a.app_id = p.app_id AND a.id = p.avatar_asset_id AND a.status = 'READY'
       WHERE h.app_id = ? AND ${ownerSql} = ? AND h.status = 'ACTIVE'
         AND ${blockFilter.sql} ${cursorClause}
       ORDER BY h.updated_at DESC, h.id DESC LIMIT ?`,
      params,
    )
    const totals = await db.one(
      `SELECT COUNT(*) AS total_count,
         COALESCE(SUM(h.received_read_at IS NULL), 0) AS unread_count,
         UTC_TIMESTAMP(3) AS read_through_at
       FROM mip_event_hearts h
       JOIN mip_profiles p ON p.app_id = h.app_id AND p.user_id = ${personSql}
       JOIN mip_users person ON person.app_id = p.app_id AND person.id = p.user_id AND person.status = 'ACTIVE'
       WHERE h.app_id = ? AND ${ownerSql} = ? AND h.status = 'ACTIVE' AND ${blockFilter.sql}`,
      [appId, userId, ...blockFilter.params],
    )
    const hasMore = rows.length > pageLimit
    const pageRows = rows.slice(0, pageLimit)
    return {
      kind,
      totalCount: Number(totals?.total_count || 0),
      unreadCount: kind === 'RECEIVED' ? Number(totals?.unread_count || 0) : 0,
      readThroughAt: iso(totals?.read_through_at),
      items: pageRows.map(row => ({
        event: {
          id: row.event_id,
          title: row.event_title,
          startsAt: iso(row.starts_at),
          endsAt: iso(row.ends_at),
        },
        person: {
          profileRef: createProfileRef({ appId, userId: row.person_user_id }, profileRefSecret),
          nickname: parseJson(row.visibility_json, {}).nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
          avatarUrl: parseJson(row.visibility_json, {}).avatar === false ? undefined : (row.avatar_file_id || undefined),
          headline: parseJson(row.visibility_json, {}).headline === false ? undefined : (row.headline || undefined),
        },
        updatedAt: iso(row.updated_at),
      })),
      nextCursor: hasMore && pageRows.length
        ? encodeHeartCursor(pageRows[pageRows.length - 1])
        : undefined,
    }
  }

  async function markHeartHistoryRead(db, { appId, userId, readThroughAt }) {
    if (typeof readThroughAt !== 'string' || !Number.isFinite(Date.parse(readThroughAt))) {
      throw new DomainError('VALIDATION_FAILED', '心动记录阅读时间无效')
    }
    return db.transaction(async (tx) => {
      await requireActiveUserForMutation(tx, appId, userId)
      await tx.query(
        `UPDATE mip_event_hearts
         SET received_read_at = UTC_TIMESTAMP(3), updated_at = updated_at
         WHERE app_id = ? AND target_user_id = ? AND status = 'ACTIVE'
           AND received_read_at IS NULL AND updated_at <= LEAST(?, UTC_TIMESTAMP(3))`,
        [appId, userId, new Date(readThroughAt)],
      )
      return { readAt: iso(readThroughAt) }
    })
  }

  return { listHeartHistory, markHeartHistoryRead }
}

module.exports = { createHeartHistory }
