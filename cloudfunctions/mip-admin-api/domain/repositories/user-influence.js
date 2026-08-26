'use strict'

const { pageRows } = require('../pagination')

const counterpartMembershipSql = `EXISTS (
  SELECT 1 FROM mip_membership_entitlements membership
  WHERE membership.app_id = counterpart.app_id
    AND membership.user_id = counterpart.id
    AND membership.status = 'ACTIVE'
    AND membership.starts_at <= UTC_TIMESTAMP(3)
    AND membership.ends_at > UTC_TIMESTAMP(3)
)`

function createUserInfluenceRepository(database, { iso, json }) {
  async function listUserInfluence(appId, userId, filters, pageLimit) {
    if (filters.kind === 'INVITATION') {
      return listInvitations(appId, userId, filters, pageLimit)
    }
    if (filters.kind === 'HEART') {
      return listHearts(appId, userId, filters, pageLimit)
    }
    return listVisits(appId, userId, filters, pageLimit)
  }

  async function listInvitations(appId, userId, filters, pageLimit) {
    const clauses = ['attribution.app_id = ?']
    const params = [userId, appId]
    if (filters.direction === 'INCOMING') {
      clauses.push('attribution.guest_user_id = subject.id')
    }
    else if (filters.direction === 'OUTGOING') {
      clauses.push('attribution.inviter_user_id = subject.id')
    }
    else {
      clauses.push('(attribution.guest_user_id = subject.id OR attribution.inviter_user_id = subject.id)')
    }
    addTimeAndCursor(
      clauses,
      params,
      'attribution.captured_at',
      'attribution.registration_id',
      filters,
    )
    const rows = await database.query(
      `SELECT attribution.registration_id AS fact_id,
              attribution.source_type, attribution.captured_at AS occurred_at,
              registration.status, event.title AS event_title,
              CASE WHEN attribution.inviter_user_id = subject.id
                THEN 'OUTGOING' ELSE 'INCOMING' END AS direction,
              counterpart.id AS counterpart_id,
              counterpart.status AS counterpart_status,
              counterpart_profile.user_id AS counterpart_profile_user_id,
              counterpart_profile.nickname AS counterpart_nickname,
              counterpart_profile.visibility_json AS counterpart_visibility_json,
              ${counterpartMembershipSql} AS counterpart_is_player
       FROM mip_event_invitation_attributions attribution
       INNER JOIN mip_users subject
         ON subject.app_id = attribution.app_id AND subject.id = ?
       INNER JOIN mip_event_registrations registration
         ON registration.app_id = attribution.app_id
          AND registration.id = attribution.registration_id
       INNER JOIN mip_events event
         ON event.app_id = attribution.app_id AND event.id = attribution.event_id
       LEFT JOIN mip_users counterpart
         ON counterpart.app_id = attribution.app_id
        AND counterpart.id = CASE
          WHEN attribution.inviter_user_id = subject.id THEN attribution.guest_user_id
          ELSE attribution.inviter_user_id
        END
       LEFT JOIN mip_profiles counterpart_profile
         ON counterpart_profile.app_id = counterpart.app_id
          AND counterpart_profile.user_id = counterpart.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY attribution.captured_at DESC, attribution.registration_id DESC
       LIMIT ?`,
      [...params, pageLimit + 1],
    )
    return page(rows.map(row => factDto(row, 'INVITATION')), filters, pageLimit)
  }

  async function listHearts(appId, userId, filters, pageLimit) {
    const clauses = ['heart.app_id = ?']
    const params = [userId, appId]
    if (filters.direction === 'INCOMING') {
      clauses.push('heart.target_user_id = subject.id')
    }
    else if (filters.direction === 'OUTGOING') {
      clauses.push('heart.voter_user_id = subject.id')
    }
    else {
      clauses.push('(heart.target_user_id = subject.id OR heart.voter_user_id = subject.id)')
    }
    addTimeAndCursor(clauses, params, 'heart.updated_at', 'heart.id', filters)
    const rows = await database.query(
      `SELECT heart.id AS fact_id, heart.status, heart.updated_at AS occurred_at,
              event.title AS event_title,
              CASE WHEN heart.voter_user_id = subject.id
                THEN 'OUTGOING' ELSE 'INCOMING' END AS direction,
              counterpart.id AS counterpart_id,
              counterpart.status AS counterpart_status,
              counterpart_profile.user_id AS counterpart_profile_user_id,
              counterpart_profile.nickname AS counterpart_nickname,
              counterpart_profile.visibility_json AS counterpart_visibility_json,
              ${counterpartMembershipSql} AS counterpart_is_player
       FROM mip_event_hearts heart
       INNER JOIN mip_users subject
         ON subject.app_id = heart.app_id AND subject.id = ?
       INNER JOIN mip_events event
         ON event.app_id = heart.app_id AND event.id = heart.event_id
       LEFT JOIN mip_users counterpart
         ON counterpart.app_id = heart.app_id
        AND counterpart.id = CASE
          WHEN heart.voter_user_id = subject.id THEN heart.target_user_id
          ELSE heart.voter_user_id
        END
       LEFT JOIN mip_profiles counterpart_profile
         ON counterpart_profile.app_id = counterpart.app_id
          AND counterpart_profile.user_id = counterpart.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY heart.updated_at DESC, heart.id DESC
       LIMIT ?`,
      [...params, pageLimit + 1],
    )
    return page(rows.map(row => factDto(row, 'HEART')), filters, pageLimit)
  }

  async function listVisits(appId, userId, filters, pageLimit) {
    const clauses = ['visit.app_id = ?']
    const params = [userId, appId]
    if (filters.direction === 'INCOMING') {
      clauses.push('visit.profile_user_id = subject.id')
    }
    else if (filters.direction === 'OUTGOING') {
      clauses.push('visit.visitor_user_id = subject.id')
    }
    else {
      clauses.push('(visit.profile_user_id = subject.id OR visit.visitor_user_id = subject.id)')
    }
    addTimeAndCursor(clauses, params, 'visit.visited_at', 'visit.id', filters)
    const rows = await database.query(
      `SELECT visit.id AS fact_id, visit.visited_at AS occurred_at, visit.read_at,
              CASE WHEN visit.visitor_user_id = subject.id
                THEN 'OUTGOING' ELSE 'INCOMING' END AS direction,
              counterpart.id AS counterpart_id,
              counterpart.status AS counterpart_status,
              counterpart_profile.user_id AS counterpart_profile_user_id,
              counterpart_profile.nickname AS counterpart_nickname,
              counterpart_profile.visibility_json AS counterpart_visibility_json,
              ${counterpartMembershipSql} AS counterpart_is_player
       FROM mip_profile_visits visit
       INNER JOIN mip_users subject
         ON subject.app_id = visit.app_id AND subject.id = ?
       LEFT JOIN mip_users counterpart
         ON counterpart.app_id = visit.app_id
        AND counterpart.id = CASE
          WHEN visit.visitor_user_id = subject.id THEN visit.profile_user_id
          ELSE visit.visitor_user_id
        END
       LEFT JOIN mip_profiles counterpart_profile
         ON counterpart_profile.app_id = counterpart.app_id
          AND counterpart_profile.user_id = counterpart.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY visit.visited_at DESC, visit.id DESC
       LIMIT ?`,
      [...params, pageLimit + 1],
    )
    return page(rows.map(row => factDto(row, 'VISIT')), filters, pageLimit)
  }

  function page(items, filters, pageLimit) {
    return pageRows(items, pageLimit, item => ({
      ...filters.cursorContext,
      occurredAt: item.cursorOccurredAt,
      id: item.id,
    }))
  }

  function factDto(row, kind) {
    const direction = row.direction
    const counterpart = counterpartDto(row, {
      notApplicable: kind === 'INVITATION' && row.source_type === 'PLATFORM',
      notRetained: kind === 'HEART' && row.status === 'CANCELLED' && direction === 'OUTGOING',
    })
    return {
      id: String(row.fact_id),
      cursorOccurredAt: sqlDateTime(row.occurred_at),
      kind,
      direction,
      status: kind === 'VISIT' ? (row.read_at ? 'READ' : 'UNREAD') : row.status,
      occurredAt: iso(row.occurred_at),
      eventTitle: row.event_title || null,
      counterpartNickname: counterpart.nickname,
      counterpartKind: counterpart.kind,
      counterpartState: counterpart.state,
      sourceType: kind === 'INVITATION' ? row.source_type : null,
    }
  }

  function counterpartDto(row, { notApplicable, notRetained }) {
    if (!row.counterpart_id) {
      return {
        nickname: null,
        kind: null,
        state: notApplicable ? 'NOT_APPLICABLE' : notRetained ? 'NOT_RETAINED' : 'UNAVAILABLE',
      }
    }
    if (row.counterpart_status !== 'ACTIVE' || !row.counterpart_profile_user_id) {
      return { nickname: null, kind: null, state: 'UNAVAILABLE' }
    }
    const visibility = json(row.counterpart_visibility_json, {})
    return {
      nickname: visibility.nickname === false
        ? 'MIP 用户'
        : (row.counterpart_nickname || '未填写昵称'),
      kind: Number(row.counterpart_is_player) === 1 ? 'PLAYER' : 'GUEST',
      state: visibility.nickname === false ? 'REDACTED' : 'AVAILABLE',
    }
  }

  return { listUserInfluence }
}

function addTimeAndCursor(clauses, params, timeColumn, idColumn, filters) {
  if (filters.occurredFrom) {
    clauses.push(`${timeColumn} >= ?`)
    params.push(filters.occurredFrom)
  }
  if (filters.occurredTo) {
    clauses.push(`${timeColumn} <= ?`)
    params.push(filters.occurredTo)
  }
  if (filters.cursor) {
    clauses.push(`(${timeColumn} < ? OR (${timeColumn} = ? AND ${idColumn} < ?))`)
    params.push(filters.cursor.occurredAt, filters.cursor.occurredAt, filters.cursor.id)
  }
}

function sqlDateTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 23).replace('T', ' ')
    : ''
}

module.exports = { createUserInfluenceRepository }
