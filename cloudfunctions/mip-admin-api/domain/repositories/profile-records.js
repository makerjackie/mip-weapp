'use strict'

const { cursorPredicateFor, pageRows } = require('../pagination')
const iso = value => value ? new Date(value).toISOString() : null
const memberSql = alias => `EXISTS (SELECT 1 FROM mip_membership_entitlements m WHERE m.app_id = ${alias}.app_id AND m.user_id = ${alias}.id AND m.status = 'ACTIVE' AND m.starts_at <= UTC_TIMESTAMP(3) AND m.ends_at > UTC_TIMESTAMP(3))`

function createProfileRecordsRepository(database) {
  async function listInvitedGuests(appId, userId, input) {
    const cursor = cursorPredicateFor('a.captured_at', input.cursor, 'createdAt', 'a.registration_id')
    const rows = await database.query(
      `SELECT a.registration_id AS id, a.guest_user_id AS user_id, a.event_id, a.captured_at,
        u.primary_branch_id, u.status AS user_status, p.nickname, e.title AS event_title,
        r.status AS registration_status, ${memberSql('u')} AS is_player
       FROM mip_event_invitation_attributions a
       JOIN mip_users u ON u.app_id = a.app_id AND u.id = a.guest_user_id
       LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
       JOIN mip_events e ON e.app_id = a.app_id AND e.id = a.event_id
       JOIN mip_event_registrations r ON r.app_id = a.app_id AND r.id = a.registration_id
       WHERE a.app_id = ? AND a.source_type = 'USER' AND a.inviter_user_id = ? ${cursor.sql}
       ORDER BY a.captured_at DESC, a.registration_id DESC LIMIT ?`,
      [appId, userId, ...cursor.params, input.limit + 1],
    )
    return pageRows(rows.map(row => ({
      id: row.id, userId: row.user_id, primaryBranchId: row.primary_branch_id,
      nickname: row.nickname || '未填写昵称', userStatus: row.user_status,
      kind: Number(row.is_player) ? 'PLAYER' : 'GUEST', eventId: row.event_id,
      eventTitle: row.event_title, registrationStatus: row.registration_status, createdAt: iso(row.captured_at),
    })), input.limit, item => ({ createdAt: item.createdAt, id: item.id }))
  }

  async function listLikeRelations(appId, userId, input) {
    const where = ['h.app_id = ?', 'h.position = 1']
    const params = [appId]
    if (input.direction === 'INCOMING') { where.push('h.target_user_id = ?'); params.push(userId) }
    else if (input.direction === 'OUTGOING') { where.push('h.voter_user_id = ?'); params.push(userId) }
    else { where.push('(h.voter_user_id = ? OR h.target_user_id = ?)'); params.push(userId, userId) }
    if (input.direction === 'MUTUAL') {
      where.push(`h.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM mip_event_hearts reverse_heart
        WHERE reverse_heart.app_id = h.app_id AND reverse_heart.event_id = h.event_id
          AND reverse_heart.voter_user_id = h.target_user_id AND reverse_heart.target_user_id = h.voter_user_id
          AND reverse_heart.status = 'ACTIVE')`)
    }
    if (input.eventId) { where.push('h.event_id = ?'); params.push(input.eventId) }
    if (input.sinceTime) { where.push('h.occurred_at >= ?'); params.push(input.sinceTime) }
    const status = `CASE WHEN h.status = 'ACTIVE' AND (u.status <> 'ACTIVE' OR self_user.status <> 'ACTIVE') THEN 'INVALID' ELSE h.status END`
    if (input.status) { where.push(`${status} = ?`); params.push(input.status) }
    const cursor = cursorPredicateFor('h.occurred_at', input.cursor, 'createdAt', 'h.id')
    const rows = await database.query(
      `WITH history AS (SELECT fact.*, ROW_NUMBER() OVER (
         PARTITION BY fact.app_id, fact.heart_id, fact.target_user_id ORDER BY fact.source_version DESC, fact.id DESC
       ) AS position FROM mip_event_heart_history fact WHERE fact.app_id = ?)
       SELECT h.id, h.event_id, e.title AS event_title, h.occurred_at, ${status} AS status,
         CASE WHEN h.voter_user_id = ? THEN 'OUTGOING' ELSE 'INCOMING' END AS direction,
         u.id AS user_id, u.primary_branch_id, u.status AS user_status, p.nickname,
         ${memberSql('u')} AS is_player
       FROM history h
       JOIN mip_events e ON e.app_id = h.app_id AND e.id = h.event_id
       JOIN mip_users self_user ON self_user.app_id = h.app_id AND self_user.id = ?
       LEFT JOIN mip_users u ON u.app_id = h.app_id AND u.id = CASE WHEN h.voter_user_id = ? THEN h.target_user_id ELSE h.voter_user_id END
       LEFT JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
       WHERE ${where.join(' AND ')} ${cursor.sql}
       ORDER BY h.occurred_at DESC, h.id DESC LIMIT ?`,
      [appId, userId, userId, userId, ...params, ...cursor.params, input.limit + 1],
    )
    return pageRows(rows.map(row => ({
      id: row.id, userId: row.user_id || null, primaryBranchId: row.primary_branch_id,
      nickname: row.nickname || (row.user_id ? '未填写昵称' : '历史对象未保留'),
      userStatus: row.user_status, kind: Number(row.is_player) ? 'PLAYER' : 'GUEST',
      direction: row.direction, status: row.status, eventId: row.event_id,
      eventTitle: row.event_title, createdAt: iso(row.occurred_at), updatedAt: iso(row.occurred_at),
    })), input.limit, item => ({ createdAt: item.createdAt, id: item.id }))
  }

  async function listResourceOperationLogs(appId, resourceType, resourceId, input) {
    const cursor = cursorPredicateFor('a.created_at', input.cursor, 'createdAt', 'a.id')
    const userRelated = resourceType === 'USER' ? `OR (a.resource_type IN ('COOPERATION_CARD', 'SUPER_CASE', 'BADGE_AWARD')
      AND JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.ownerUserId')) = ?)
      OR (a.resource_type = 'BADGE_AWARD' AND JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.userId')) = ?)` : ''
    const rows = await database.query(
      `SELECT a.id, a.action, a.actor_type, a.actor_user_id, a.effective_role,
         a.metadata_json, a.created_at, p.nickname AS actor_nickname
       FROM mip_audit_logs a LEFT JOIN mip_profiles p ON p.app_id = a.app_id AND p.user_id = a.actor_user_id
       WHERE a.app_id = ? AND ((a.resource_type = ? AND a.resource_id = ?) ${userRelated}) ${cursor.sql}
       ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      [appId, resourceType, resourceId, ...(resourceType === 'USER' ? [resourceId, resourceId] : []), ...cursor.params, input.limit + 1],
    )
    return pageRows(rows.map(row => {
      const metadata = typeof row.metadata_json === 'string'
        ? (() => { try { return JSON.parse(row.metadata_json) } catch { return {} } })()
        : row.metadata_json || {}
      return {
        id: String(row.id), action: row.action, actorType: row.actor_type,
        actorUserId: row.actor_user_id || null,
        actorNickname: row.actor_nickname || (row.actor_type === 'SYSTEM' ? '系统' : '运营账号'),
        effectiveRole: row.effective_role, createdAt: iso(row.created_at),
        ...(resourceType === 'OPPORTUNITY' ? {
          fromStatus: metadata.fromStatus || null, toStatus: metadata.toStatus || null,
          summary: metadata.summary || null, snapshotRef: metadata.snapshotRef || null,
        } : {}),
      }
    }), input.limit, item => ({ createdAt: item.createdAt, id: item.id }))
  }

  async function listOpportunityReferrals(appId, opportunityId, input) {
    const cursor = cursorPredicateFor('r.updated_at', input.cursor, 'createdAt', 'r.id')
    const rows = await database.query(
      `SELECT r.id, r.status, r.updated_at, r.note, actor.nickname AS actor_nickname, target.nickname AS target_nickname
       FROM mip_referral_intents r
       LEFT JOIN mip_profiles actor ON actor.app_id = r.app_id AND actor.user_id = r.actor_user_id
       LEFT JOIN mip_profiles target ON target.app_id = r.app_id AND target.user_id = r.target_user_id
       WHERE r.app_id = ? AND r.opportunity_id = ? ${cursor.sql}
       ORDER BY r.updated_at DESC, r.id DESC LIMIT ?`,
      [appId, opportunityId, ...cursor.params, input.limit + 1],
    )
    return pageRows(rows.map(row => ({ id: row.id, status: row.status, actorNickname: row.actor_nickname || '未填写昵称',
      targetNickname: row.target_nickname || '未指定', note: row.note || '', createdAt: iso(row.updated_at) })),
    input.limit, item => ({ createdAt: item.createdAt, id: item.id }))
  }

  return { listInvitedGuests, listLikeRelations, listResourceOperationLogs, listOpportunityReferrals }
}
module.exports = { createProfileRecordsRepository }
