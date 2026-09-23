'use strict'

const { randomUUID } = require('node:crypto')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')
const { lockActiveContributor } = require('../lib/auth')
const {
  appendAudit,
  decodeCursor,
  encodeCursor,
  idempotentTransaction,
  iso,
  jsonObject,
  mutualBlockFilter,
  stringValue,
  uuid,
} = require('./common')

function normalizeVisitInput(value = {}, caller) {
  const profileRef = stringValue(value.profileRef, 200, 'VALIDATION_FAILED')
  const visitKey = stringValue(value.visitKey, 128, 'VALIDATION_FAILED')
  if (visitKey.length < 12) throw new Error('VALIDATION_FAILED')
  const profileUserId = readProfileRef(profileRef, caller.appId, caller.profileRefSecret)
  return { profileRef, profileUserId, visitKey }
}

function decodeVisitorCursor(value) {
  return decodeCursor(value)
}

function encodeVisitorCursor(timestamp, visitId) {
  return encodeCursor(timestamp, visitId)
}

function visitorDto(row, caller) {
  const allowed = jsonObject(row.visibility_json)
  return {
    visitId: row.visit_id,
    profileRef: createProfileRef(
      { appId: caller.appId, userId: row.visitor_user_id },
      caller.profileRefSecret,
    ),
    nickname: allowed.nickname === false ? 'MIP 用户' : (row.visitor_nickname || 'MIP 用户'),
    avatarUrl: allowed.avatar === false ? undefined : (row.visitor_avatar_file_id || undefined),
    headline: allowed.headline === false ? undefined : (row.visitor_headline || undefined),
    userKind: Number(row.is_player) === 1 ? 'PLAYER' : 'GUEST',
    visitCount: 1,
    lastVisitedAt: iso(row.last_visited_at),
    unread: Boolean(row.has_unread),
  }
}

async function assertVisibleTarget(database, caller, profileUserId) {
  const blockFilter = mutualBlockFilter(caller.userId, 'target.id', 'target.app_id')
  const row = await database.one(
    `SELECT target.id
     FROM mip_users target
     INNER JOIN mip_profiles target_profile
       ON target_profile.app_id = target.app_id AND target_profile.user_id = target.id
     WHERE target.app_id = ? AND target.id = ? AND target.status = 'ACTIVE'
       AND ${blockFilter.sql || '1 = 1'}
     LIMIT 1`,
    [caller.appId, profileUserId, ...blockFilter.params],
  )
  if (!row) throw new Error('NOT_FOUND')
}

async function recordProfileVisit(database, caller, rawInput = {}) {
  if (!caller.userId) throw new Error('AUTH_REQUIRED')
  const input = normalizeVisitInput(rawInput, caller)
  if (caller.userId === input.profileUserId) return { recorded: false }
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'profile-visit.record',
    idempotencyKey: input.visitKey,
    request: { profileRef: input.profileRef, visitKey: input.visitKey },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const visitorProfile = await tx.one(
      `SELECT profile.user_id
       FROM mip_users visitor
       INNER JOIN mip_profiles profile
         ON profile.app_id = visitor.app_id AND profile.user_id = visitor.id
       WHERE visitor.app_id = ? AND visitor.id = ? AND visitor.status = 'ACTIVE'
       LIMIT 1`,
      [caller.appId, caller.userId],
    )
    if (!visitorProfile) return { recorded: false }
    const blockFilter = mutualBlockFilter(caller.userId, 'target.id', 'target.app_id')
    const target = await tx.one(
      `SELECT target.id
       FROM mip_users target
       INNER JOIN mip_profiles target_profile
         ON target_profile.app_id = target.app_id AND target_profile.user_id = target.id
       WHERE target.app_id = ? AND target.id = ? AND target.status = 'ACTIVE'
         AND ${blockFilter.sql || '1 = 1'}
       LIMIT 1`,
      [caller.appId, input.profileUserId, ...blockFilter.params],
    )
    if (!target || target.id === caller.userId) return { recorded: false }
    await tx.query(
      `INSERT INTO mip_profile_visits (
         id, app_id, visitor_user_id, profile_user_id, visit_key
       ) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [randomUUID(), caller.appId, caller.userId, target.id, input.visitKey],
    )
    return { recorded: true }
  })
}

async function listProfileVisitors(database, caller, rawInput = {}) {
  if (!caller.userId) throw new Error('AUTH_REQUIRED')
  const limitValue = Number(rawInput.limit)
  const limit = Math.min(30, Math.max(1, Number.isInteger(limitValue) ? limitValue : 20))
  const cursor = decodeVisitorCursor(rawInput.cursor)
  const blockFilter = mutualBlockFilter(caller.userId, 'visitor.id', 'visitor.app_id')
  const params = [caller.appId, caller.userId, ...blockFilter.params]
  const cursorSql = cursor
    ? 'AND (visit.visited_at < ? OR (visit.visited_at = ? AND visit.id < ?))'
    : ''
  if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.id)
  const rows = await database.query(
    `SELECT visit.id AS visit_id, visit.visited_at AS last_visited_at,
            (visit.read_at IS NULL) AS has_unread, visitor.id AS visitor_id,
            visitor_profile.nickname AS visitor_nickname,
            visitor_profile.headline AS visitor_headline,
            visitor_profile.visibility_json,
            visitor_avatar.cloud_file_id AS visitor_avatar_file_id,
            ${`EXISTS (
              SELECT 1 FROM mip_membership_entitlements entitlement
              WHERE entitlement.app_id = visitor.app_id AND entitlement.user_id = visitor.id
                AND entitlement.status = 'ACTIVE'
                AND entitlement.starts_at <= UTC_TIMESTAMP(3)
                AND entitlement.ends_at > UTC_TIMESTAMP(3)
            )`} AS is_player
     FROM mip_profile_visits visit
     INNER JOIN mip_users visitor
       ON visitor.app_id = visit.app_id AND visitor.id = visit.visitor_user_id
       AND visitor.status = 'ACTIVE'
     INNER JOIN mip_profiles visitor_profile
       ON visitor_profile.app_id = visitor.app_id AND visitor_profile.user_id = visitor.id
     LEFT JOIN mip_media_assets visitor_avatar
       ON visitor_avatar.app_id = visitor.app_id
       AND visitor_avatar.id = visitor_profile.avatar_asset_id AND visitor_avatar.status = 'READY'
     WHERE visit.app_id = ? AND visit.profile_user_id = ?
       AND ${blockFilter.sql || '1 = 1'} ${cursorSql}
     ORDER BY visit.visited_at DESC, visit.id DESC
     LIMIT ${limit + 1}`,
    params,
  )
  const page = rows.slice(0, limit)
  const [unread, total] = await Promise.all([
    database.one(
      `SELECT COUNT(*) AS count
       FROM mip_profile_visits visit
       INNER JOIN mip_users visitor
         ON visitor.app_id = visit.app_id AND visitor.id = visit.visitor_user_id AND visitor.status = 'ACTIVE'
       INNER JOIN mip_profiles visitor_profile
         ON visitor_profile.app_id = visitor.app_id AND visitor_profile.user_id = visitor.id
       WHERE visit.app_id = ? AND visit.profile_user_id = ? AND visit.read_at IS NULL
         AND ${blockFilter.sql || '1 = 1'}`,
      [caller.appId, caller.userId, ...blockFilter.params],
    ),
    database.one(
      `SELECT COUNT(*) AS count, UTC_TIMESTAMP(3) AS read_through_at
       FROM mip_profile_visits visit
       INNER JOIN mip_users visitor
         ON visitor.app_id = visit.app_id AND visitor.id = visit.visitor_user_id
          AND visitor.status = 'ACTIVE'
       INNER JOIN mip_profiles visitor_profile
         ON visitor_profile.app_id = visitor.app_id AND visitor_profile.user_id = visitor.id
       WHERE visit.app_id = ? AND visit.profile_user_id = ?
         AND ${blockFilter.sql || '1 = 1'}`,
      [caller.appId, caller.userId, ...blockFilter.params],
    ),
  ])
  return {
    items: page.map(row => visitorDto({ ...row, visitor_user_id: row.visitor_id }, caller)),
    unreadCount: Number(unread?.count || 0),
    totalViewCount: Number(total?.count || 0),
    readThroughAt: iso(total?.read_through_at) || undefined,
    nextCursor: rows.length > limit && page.length
      ? encodeVisitorCursor(page.at(-1).last_visited_at, page.at(-1).visit_id)
      : undefined,
  }
}

async function markProfileVisitorRead(database, caller, rawInput = {}) {
  if (!caller.userId) throw new Error('AUTH_REQUIRED')
  if (rawInput.readThroughAt !== undefined) {
    const readThroughAt = iso(rawInput.readThroughAt)
    if (!readThroughAt) throw new Error('VALIDATION_FAILED')
    return idempotentTransaction(database, {
      appId: caller.appId, userId: caller.userId, operation: 'profile-visit.mark-all-read',
      idempotencyKey: rawInput.idempotencyKey, request: { readThroughAt },
    }, async (tx) => {
      await lockActiveContributor(tx, caller)
      // Opening the visible list acknowledges all visits known at that load, including
      // later pages. A visit arriving after the watermark remains unread.
      await tx.query(
        `UPDATE mip_profile_visits SET read_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND profile_user_id = ? AND read_at IS NULL
           AND visited_at <= LEAST(?, UTC_TIMESTAMP(3))`,
        [caller.appId, caller.userId, new Date(readThroughAt)],
      )
      await appendAudit(tx, {
        appId: caller.appId, actorUserId: caller.userId, action: 'PROFILE_VISITORS_READ',
        resourceType: 'PROFILE', resourceId: caller.userId, metadata: { readThroughAt },
      })
      return { messageId: 'visitors', readAt: readThroughAt }
    })
  }
  const profileRef = stringValue(rawInput.profileRef, 200, 'VALIDATION_FAILED')
  const visitorUserId = readProfileRef(profileRef, caller.appId, caller.profileRefSecret)
  if (visitorUserId === caller.userId) throw new Error('VALIDATION_FAILED')
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'profile-visit.mark-read',
    idempotencyKey: rawInput.idempotencyKey,
    request: { profileRef },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const blockFilter = mutualBlockFilter(caller.userId, 'visitor.id', 'visitor.app_id')
    const row = await tx.one(
      `SELECT MAX(v.visited_at) AS last_visited_at
       FROM mip_profile_visits v
       INNER JOIN mip_users visitor
         ON visitor.app_id = v.app_id AND visitor.id = v.visitor_user_id AND visitor.status = 'ACTIVE'
       INNER JOIN mip_profiles visitor_profile
         ON visitor_profile.app_id = visitor.app_id AND visitor_profile.user_id = visitor.id
       WHERE v.app_id = ? AND v.profile_user_id = ? AND v.visitor_user_id = ?
         AND ${blockFilter.sql || '1 = 1'}`,
      [caller.appId, caller.userId, visitorUserId, ...blockFilter.params],
    )
    if (!row?.last_visited_at) throw new Error('NOT_FOUND')
    await tx.query(
      `UPDATE mip_profile_visits
       SET read_at = COALESCE(read_at, UTC_TIMESTAMP(3))
       WHERE app_id = ? AND profile_user_id = ? AND visitor_user_id = ? AND read_at IS NULL`,
      [caller.appId, caller.userId, visitorUserId],
    )
    const readAt = await tx.one(
      `SELECT MAX(read_at) AS read_at
       FROM mip_profile_visits
       WHERE app_id = ? AND profile_user_id = ? AND visitor_user_id = ?`,
      [caller.appId, caller.userId, visitorUserId],
    )
    await appendAudit(tx, {
      appId: caller.appId,
      actorUserId: caller.userId,
      action: 'PROFILE_VISITOR_READ',
      resourceType: 'PROFILE_VISIT_GROUP',
      resourceId: visitorUserId,
      metadata: { profileRef },
    })
    return { messageId: profileRef, profileRef, readAt: iso(readAt?.read_at) }
  })
}

module.exports = {
  assertVisibleTarget,
  decodeVisitorCursor,
  encodeVisitorCursor,
  listProfileVisitors,
  markProfileVisitorRead,
  normalizeVisitInput,
  recordProfileVisit,
  visitorDto,
}
