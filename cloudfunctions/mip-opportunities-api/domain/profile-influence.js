'use strict'

const { createProfileRef, readProfileRef } = require('../lib/profile-ref')
const {
  encodeCursor,
  iso,
  jsonObject,
  mutualBlockFilter,
  stringValue,
} = require('./common')

const activeMembershipSql = userAlias => `EXISTS (
  SELECT 1 FROM mip_membership_entitlements membership
  WHERE membership.app_id = ${userAlias}.app_id AND membership.user_id = ${userAlias}.id
    AND membership.status = 'ACTIVE'
    AND membership.starts_at <= UTC_TIMESTAMP(3)
    AND membership.ends_at > UTC_TIMESTAMP(3)
)`

function influencePersonDto(row, caller) {
  const visible = jsonObject(row.actor_visibility_json)
  return {
    profileRef: createProfileRef(
      { appId: caller.appId, userId: row.actor_user_id },
      caller.profileRefSecret,
    ),
    nickname: visible.nickname === false ? 'MIP 用户' : (row.actor_nickname || 'MIP 用户'),
    avatarUrl: visible.avatar === false ? undefined : (row.actor_avatar_file_id || undefined),
    headline: visible.headline === false ? undefined : (row.actor_headline || undefined),
    userKind: Number(row.is_player) === 1 ? 'PLAYER' : 'GUEST',
  }
}

function encodePersonCursor(timestamp, userId, caller) {
  return Buffer.from(JSON.stringify({
    timestamp: iso(timestamp),
    profileRef: createProfileRef({ appId: caller.appId, userId }, caller.profileRefSecret),
  }), 'utf8').toString('base64url')
}

function decodePersonCursor(value, caller) {
  if (!value) return null
  try {
    const parsed = jsonObject(Buffer.from(String(value), 'base64url').toString('utf8'))
    const timestamp = iso(parsed.timestamp)
    const profileRef = stringValue(parsed.profileRef, 200, 'VALIDATION_FAILED')
    if (!timestamp) throw new Error('VALIDATION_FAILED')
    return {
      timestamp,
      userId: readProfileRef(profileRef, caller.appId, caller.profileRefSecret),
    }
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
    throw new Error('VALIDATION_FAILED')
  }
}

function pageLimit(value) {
  const parsed = Number(value)
  return Math.min(30, Math.max(1, Number.isInteger(parsed) ? parsed : 20))
}

async function loadProfileInfluenceSummary(database, { appId, profileUserId }) {
  const guestBlock = mutualBlockFilter(profileUserId, 'guest.id', 'guest.app_id')
  const interactionBlock = mutualBlockFilter(profileUserId, 'voter.id', 'voter.app_id')
  const interestBlock = mutualBlockFilter(profileUserId, 'actor.id', 'actor.app_id')
  const visitorBlock = mutualBlockFilter(profileUserId, 'visitor.id', 'visitor.app_id')
  const [guests, interactions, interests, visitors] = await Promise.all([
    database.one(
      `SELECT COUNT(DISTINCT attribution.guest_user_id) AS count
       FROM mip_event_invitation_attributions attribution
       INNER JOIN mip_event_registrations registration
         ON registration.app_id = attribution.app_id AND registration.id = attribution.registration_id
       INNER JOIN mip_users guest
         ON guest.app_id = attribution.app_id AND guest.id = attribution.guest_user_id
          AND guest.status = 'ACTIVE'
       INNER JOIN mip_profiles guest_profile
         ON guest_profile.app_id = guest.app_id AND guest_profile.user_id = guest.id
       WHERE attribution.app_id = ? AND attribution.source_type = 'USER'
         AND attribution.inviter_user_id = ?
         AND registration.share_profile = 1
         AND registration.status IN ('REGISTERED', 'ATTENDED')
         AND NOT ${activeMembershipSql('guest')}
         AND ${guestBlock.sql}`,
      [appId, profileUserId, ...guestBlock.params],
    ),
    database.one(
      `SELECT COUNT(*) AS count
       FROM mip_event_hearts heart
       INNER JOIN mip_users voter
         ON voter.app_id = heart.app_id AND voter.id = heart.voter_user_id
          AND voter.status = 'ACTIVE'
       INNER JOIN mip_profiles voter_profile
         ON voter_profile.app_id = voter.app_id AND voter_profile.user_id = voter.id
       WHERE heart.app_id = ? AND heart.target_user_id = ? AND heart.status = 'ACTIVE'
         AND ${interactionBlock.sql}`,
      [appId, profileUserId, ...interactionBlock.params],
    ),
    database.one(
      `SELECT COUNT(*) AS count
       FROM mip_profile_interests interest
       INNER JOIN mip_users actor
         ON actor.app_id = interest.app_id AND actor.id = interest.actor_user_id
          AND actor.status = 'ACTIVE'
       INNER JOIN mip_profiles actor_profile
         ON actor_profile.app_id = actor.app_id AND actor_profile.user_id = actor.id
       WHERE interest.app_id = ? AND interest.target_user_id = ? AND interest.status = 'ACTIVE'
         AND ${interestBlock.sql}`,
      [appId, profileUserId, ...interestBlock.params],
    ),
    database.one(
      `SELECT COUNT(DISTINCT visit.visitor_user_id) AS count
       FROM mip_profile_visits visit
       INNER JOIN mip_users visitor
         ON visitor.app_id = visit.app_id AND visitor.id = visit.visitor_user_id
          AND visitor.status = 'ACTIVE'
       INNER JOIN mip_profiles visitor_profile
         ON visitor_profile.app_id = visitor.app_id AND visitor_profile.user_id = visitor.id
       WHERE visit.app_id = ? AND visit.profile_user_id = ?
         AND ${visitorBlock.sql}`,
      [appId, profileUserId, ...visitorBlock.params],
    ),
  ])
  return {
    guestCount: Number(guests?.count || 0),
    interactionCount: Number(interactions?.count || 0),
    interestCount: Number(interests?.count || 0),
    visitorCount: Number(visitors?.count || 0),
  }
}

async function getOwnProfileInfluence(database, caller) {
  if (!caller.userId) throw new Error('AUTH_REQUIRED')
  return loadProfileInfluenceSummary(database, {
    appId: caller.appId,
    profileUserId: caller.userId,
  })
}

async function listInfluenceGuests(database, caller, input = {}) {
  const limit = pageLimit(input.limit)
  const cursor = decodePersonCursor(input.cursor, caller)
  const block = mutualBlockFilter(caller.userId, 'guest.id', 'guest.app_id')
  const cursorSql = cursor
    ? 'AND (facts.last_at < ? OR (facts.last_at = ? AND facts.guest_user_id < ?))'
    : ''
  const params = [caller.appId, caller.userId, ...block.params]
  if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.userId)
  params.push(limit + 1)
  const rows = await database.query(
    `WITH mip_ranked_guest_facts AS (
       SELECT attribution.guest_user_id, attribution.registration_id,
              attribution.captured_at AS last_at, event.id AS event_id, event.title AS event_title,
              COUNT(*) OVER (PARTITION BY attribution.guest_user_id) AS invitation_count,
              ROW_NUMBER() OVER (
                PARTITION BY attribution.guest_user_id
                ORDER BY attribution.captured_at DESC, attribution.registration_id DESC
              ) AS fact_position
       FROM mip_event_invitation_attributions attribution
       INNER JOIN mip_event_registrations registration
         ON registration.app_id = attribution.app_id AND registration.id = attribution.registration_id
       INNER JOIN mip_events event
         ON event.app_id = attribution.app_id AND event.id = attribution.event_id
       WHERE attribution.app_id = ? AND attribution.source_type = 'USER'
         AND attribution.inviter_user_id = ?
         AND registration.share_profile = 1
         AND registration.status IN ('REGISTERED', 'ATTENDED')
     )
     SELECT facts.guest_user_id AS actor_user_id, facts.invitation_count, facts.last_at,
            facts.event_id, facts.event_title,
            guest_profile.nickname AS actor_nickname,
            guest_profile.headline AS actor_headline,
            guest_profile.visibility_json AS actor_visibility_json,
            guest_avatar.cloud_file_id AS actor_avatar_file_id,
            ${activeMembershipSql('guest')} AS is_player
     FROM mip_ranked_guest_facts facts
     INNER JOIN mip_users guest
       ON guest.app_id = ? AND guest.id = facts.guest_user_id AND guest.status = 'ACTIVE'
     INNER JOIN mip_profiles guest_profile
       ON guest_profile.app_id = guest.app_id AND guest_profile.user_id = guest.id
     LEFT JOIN mip_media_assets guest_avatar
       ON guest_avatar.app_id = guest_profile.app_id
        AND guest_avatar.id = guest_profile.avatar_asset_id AND guest_avatar.status = 'READY'
     WHERE facts.fact_position = 1 AND NOT ${activeMembershipSql('guest')}
       AND ${block.sql} ${cursorSql}
     ORDER BY facts.last_at DESC, facts.guest_user_id DESC LIMIT ?`,
    [params[0], params[1], caller.appId, ...params.slice(2)],
  )
  const page = rows.slice(0, limit)
  return {
    category: 'GUEST',
    items: page.map(row => ({
      kind: 'GUEST',
      status: 'ACTIVE',
      actor: influencePersonDto(row, caller),
      event: { id: row.event_id, title: row.event_title },
      invitationCount: Number(row.invitation_count || 0),
      unread: false,
      updatedAt: iso(row.last_at),
    })),
    unreadCount: 0,
    nextCursor: rows.length > limit && page.length
      ? encodePersonCursor(page.at(-1).last_at, page.at(-1).actor_user_id, caller)
      : undefined,
  }
}

async function listInfluenceInteractions(database, caller, input = {}) {
  const limit = pageLimit(input.limit)
  const cursor = input.cursor || null
  const block = mutualBlockFilter(caller.userId, 'voter.id', 'voter.app_id')
  const cursorSql = cursor
    ? 'AND (heart.updated_at < ? OR (heart.updated_at = ? AND heart.id < ?))'
    : ''
  const params = [caller.appId, caller.userId, ...block.params]
  if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.id)
  const rows = await database.query(
    `SELECT heart.id AS relation_id, heart.updated_at,
            event.id AS event_id, event.title AS event_title,
            voter.id AS actor_user_id, voter_profile.nickname AS actor_nickname,
            voter_profile.headline AS actor_headline,
            voter_profile.visibility_json AS actor_visibility_json,
            voter_avatar.cloud_file_id AS actor_avatar_file_id,
            ${activeMembershipSql('voter')} AS is_player
     FROM mip_event_hearts heart
     INNER JOIN mip_events event
       ON event.app_id = heart.app_id AND event.id = heart.event_id
     INNER JOIN mip_users voter
       ON voter.app_id = heart.app_id AND voter.id = heart.voter_user_id
        AND voter.status = 'ACTIVE'
     INNER JOIN mip_profiles voter_profile
       ON voter_profile.app_id = voter.app_id AND voter_profile.user_id = voter.id
     LEFT JOIN mip_media_assets voter_avatar
       ON voter_avatar.app_id = voter_profile.app_id
        AND voter_avatar.id = voter_profile.avatar_asset_id AND voter_avatar.status = 'READY'
     WHERE heart.app_id = ? AND heart.target_user_id = ? AND heart.status = 'ACTIVE'
       AND ${block.sql} ${cursorSql}
     ORDER BY heart.updated_at DESC, heart.id DESC LIMIT ${limit + 1}`,
    params,
  )
  const page = rows.slice(0, limit)
  return {
    category: 'INTERACTION',
    items: page.map(row => ({
      kind: 'INTERACTION',
      status: 'ACTIVE',
      actor: influencePersonDto(row, caller),
      event: { id: row.event_id, title: row.event_title },
      unread: false,
      updatedAt: iso(row.updated_at),
    })),
    unreadCount: 0,
    nextCursor: rows.length > limit && page.length
      ? encodeCursor(page.at(-1).updated_at, page.at(-1).relation_id)
      : undefined,
  }
}

async function listActiveInfluenceInterests(database, caller, input = {}) {
  const limit = pageLimit(input.limit)
  const cursor = input.cursor || null
  const block = mutualBlockFilter(caller.userId, 'actor.id', 'actor.app_id')
  const cursorSql = cursor
    ? 'AND (interest.updated_at < ? OR (interest.updated_at = ? AND interest.id < ?))'
    : ''
  const params = [caller.appId, caller.userId, ...block.params]
  if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.id)
  const rows = await database.query(
    `SELECT interest.id AS relation_id, interest.source_type, interest.updated_at,
            actor.id AS actor_user_id, actor_profile.nickname AS actor_nickname,
            actor_profile.headline AS actor_headline,
            actor_profile.visibility_json AS actor_visibility_json,
            actor_avatar.cloud_file_id AS actor_avatar_file_id,
            ${activeMembershipSql('actor')} AS is_player,
            CASE interest.source_type
              WHEN 'OPPORTUNITY' THEN opportunity.title
              WHEN 'COOPERATION_CARD' THEN cooperation.positioning
              WHEN 'SUPER_CASE' THEN super_case.project_name
              WHEN 'PROFILE' THEN '公开档案'
            END AS source_label
     FROM mip_profile_interests interest
     INNER JOIN mip_users actor
       ON actor.app_id = interest.app_id AND actor.id = interest.actor_user_id
        AND actor.status = 'ACTIVE'
     INNER JOIN mip_profiles actor_profile
       ON actor_profile.app_id = actor.app_id AND actor_profile.user_id = actor.id
     LEFT JOIN mip_media_assets actor_avatar
       ON actor_avatar.app_id = actor_profile.app_id
        AND actor_avatar.id = actor_profile.avatar_asset_id AND actor_avatar.status = 'READY'
     LEFT JOIN mip_opportunities opportunity
       ON interest.source_type = 'OPPORTUNITY' AND opportunity.app_id = interest.app_id
        AND opportunity.id = interest.source_id
     LEFT JOIN mip_cooperation_cards cooperation
       ON interest.source_type = 'COOPERATION_CARD' AND cooperation.app_id = interest.app_id
        AND cooperation.id = interest.source_id
     LEFT JOIN mip_super_cases super_case
       ON interest.source_type = 'SUPER_CASE' AND super_case.app_id = interest.app_id
        AND super_case.id = interest.source_id
     WHERE interest.app_id = ? AND interest.target_user_id = ? AND interest.status = 'ACTIVE'
       AND ${block.sql} ${cursorSql}
     ORDER BY interest.updated_at DESC, interest.id DESC LIMIT ${limit + 1}`,
    params,
  )
  const page = rows.slice(0, limit)
  return {
    category: 'ACTIVE_INTEREST',
    items: page.map(row => ({
      kind: 'ACTIVE_INTEREST',
      status: 'ACTIVE',
      actor: influencePersonDto(row, caller),
      source: {
        type: row.source_type,
        label: row.source_label || '关联内容已不可用',
      },
      unread: false,
      updatedAt: iso(row.updated_at),
    })),
    unreadCount: 0,
    nextCursor: rows.length > limit && page.length
      ? encodeCursor(page.at(-1).updated_at, page.at(-1).relation_id)
      : undefined,
  }
}

module.exports = {
  decodePersonCursor,
  encodePersonCursor,
  getOwnProfileInfluence,
  influencePersonDto,
  listActiveInfluenceInterests,
  listInfluenceGuests,
  listInfluenceInteractions,
  loadProfileInfluenceSummary,
}
