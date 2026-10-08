'use strict'

const { DomainError } = require('./rules')
const { createProfileRef } = require('../lib/profile-ref')
const { requireActiveUserForMutation } = require('./registration-lifecycle')
const { loadPublicPersonDetails, loadHeartInviters } = require('./public-person-details')

function createHeartHistory({ iso, limitOf, mutualBlockFilter, parseJson }) {
  // 列表按人聚合（产品口径：同一个人多点几次心动则累计展示"2次"，最新互动排最前），
  // 游标 = (最近互动时间, 人)。
  function encodeHeartCursor(row) {
    return Buffer.from(JSON.stringify({
      lastAt: iso(row.last_at),
      personUserId: row.person_user_id,
    })).toString('base64url')
  }

  function decodeHeartCursor(value) {
    if (!value) return null
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
      if (typeof parsed.lastAt === 'string'
        && Number.isFinite(Date.parse(parsed.lastAt))
        && typeof parsed.personUserId === 'string'
        && /^[0-9a-f-]{36}$/i.test(parsed.personUserId)) {
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
      ? 'HAVING last_at < ? OR (last_at = ? AND person_user_id < ?)'
      : ''
    const params = [appId, userId, ...blockFilter.params]
    if (decoded) {
      params.push(decoded.lastAt, decoded.lastAt, decoded.personUserId)
    }
    params.push(pageLimit + 1)
    const rows = await db.query(
      `SELECT ${personSql} AS person_user_id,
         COUNT(*) AS heart_count,
         MAX(h.updated_at) AS last_at,
         COALESCE(SUM(h.received_read_at IS NULL), 0) AS person_unread_count,
         p.nickname, p.headline, p.visibility_json, a.cloud_file_id AS avatar_file_id
       FROM mip_event_hearts h
       JOIN mip_profiles p ON p.app_id = h.app_id AND p.user_id = ${personSql}
       JOIN mip_users person ON person.app_id = p.app_id AND person.id = p.user_id AND person.status = 'ACTIVE'
       LEFT JOIN mip_media_assets a
         ON a.app_id = p.app_id AND a.id = p.avatar_asset_id AND a.status = 'READY'
       WHERE h.app_id = ? AND ${ownerSql} = ? AND h.status = 'ACTIVE'
         AND ${blockFilter.sql}
       GROUP BY ${personSql}, p.nickname, p.headline, p.visibility_json, a.cloud_file_id
       ${cursorClause}
       ORDER BY last_at DESC, person_user_id DESC
       LIMIT ?`,
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
    // MIW-52 统一竖版用户卡：心动值列表与嘉宾卡同口径，person 补公开详情
    // （城市/代表行业/身份状态/等级/佩戴勋章）与邀请人标注；不造值，缺什么省什么。
    const personUserIds = [...new Set(pageRows.map(row => row.person_user_id))]
    const [details, inviters] = personUserIds.length
      ? await Promise.all([
          loadPublicPersonDetails(db, appId, personUserIds),
          loadHeartInviters(db, appId, personUserIds),
        ])
      : [new Map(), new Map()]
    return {
      kind,
      totalCount: Number(totals?.total_count || 0),
      unreadCount: kind === 'RECEIVED' ? Number(totals?.unread_count || 0) : 0,
      readThroughAt: iso(totals?.read_through_at),
      items: pageRows.map((row) => {
        const detail = details.get(row.person_user_id) || {}
        const inviter = inviters.get(row.person_user_id)
        return {
          person: {
            profileRef: createProfileRef({ appId, userId: row.person_user_id }, profileRefSecret),
            nickname: parseJson(row.visibility_json, {}).nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
            avatarUrl: parseJson(row.visibility_json, {}).avatar === false ? undefined : (row.avatar_file_id || undefined),
            headline: parseJson(row.visibility_json, {}).headline === false ? undefined : (row.headline || undefined),
            // 累计心动次数（跨所有活动）；RECEIVED 侧标注该人是否有未读心动。
            heartCount: Number(row.heart_count || 0),
            ...(kind === 'RECEIVED' && Number(row.person_unread_count) > 0 ? { unread: true } : {}),
            ...(detail.cityName ? { cityName: detail.cityName } : {}),
            ...(detail.industryLabel ? { industryLabel: detail.industryLabel } : {}),
            ...(detail.identityStatus ? { identityStatus: detail.identityStatus } : {}),
            ...(detail.level ? { level: detail.level } : {}),
            ...(Array.isArray(detail.badges) && detail.badges.length ? { badges: detail.badges } : {}),
            ...(inviter ? { inviter } : {}),
          },
          updatedAt: iso(row.last_at),
        }
      }),
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
