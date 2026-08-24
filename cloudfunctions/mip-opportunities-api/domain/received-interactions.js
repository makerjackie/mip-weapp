'use strict'

const { lockActiveContributor } = require('../lib/auth')
const { createProfileRef } = require('../lib/profile-ref')
const { listProfileVisitors, markProfileVisitorRead } = require('./profile-visits')
const {
  listActiveInfluenceInterests,
  listInfluenceGuests,
  listInfluenceInteractions,
} = require('./profile-influence')
const {
  appendAudit,
  decodeCursor,
  encodeCursor,
  idempotentTransaction,
  iso,
  jsonObject,
  mutualBlockFilter,
  uuid,
} = require('./common')

const categories = new Set([
  'REFERRAL',
  'PROFILE_INTEREST',
  'OUTBOUND_INTEREST',
  'VISITOR',
  'GUEST',
  'INTERACTION',
  'ACTIVE_INTEREST',
])

function normalizeListInput(value = {}) {
  const category = String(value.category || '').trim().toUpperCase()
  if (!categories.has(category)) throw new Error('VALIDATION_FAILED')
  const parsedLimit = Number(value.limit)
  return {
    category,
    cursor: ['VISITOR', 'GUEST'].includes(category) ? value.cursor : decodeCursor(value.cursor),
    limit: Math.min(30, Math.max(1, Number.isInteger(parsedLimit) ? parsedLimit : 20)),
  }
}

function publicActor(row, caller) {
  const allowed = jsonObject(row.actor_visibility_json)
  return {
    profileRef: createProfileRef(
      { appId: caller.appId, userId: row.actor_user_id },
      caller.profileRefSecret,
    ),
    nickname: allowed.nickname === false ? 'MIP 用户' : (row.actor_nickname || 'MIP 用户'),
    avatarUrl: allowed.avatar === false ? undefined : (row.actor_avatar_file_id || undefined),
    headline: allowed.headline === false ? undefined : (row.actor_headline || undefined),
  }
}

function publicInterestTarget(row, caller) {
  const allowed = jsonObject(row.target_visibility_json)
  return {
    profileRef: createProfileRef(
      { appId: caller.appId, userId: row.target_user_id },
      caller.profileRefSecret,
    ),
    nickname: allowed.nickname === false ? 'MIP 用户' : (row.target_nickname || 'MIP 用户'),
    avatarUrl: allowed.avatar === false ? undefined : (row.target_avatar_file_id || undefined),
    headline: allowed.headline === false ? undefined : (row.target_headline || undefined),
  }
}

function referralDto(row, message, caller) {
  return {
    kind: 'REFERRAL',
    status: row.status,
    note: row.note || undefined,
    actor: publicActor(row, caller),
    opportunity: {
      id: row.opportunity_id,
      title: row.opportunity_title,
      status: row.opportunity_status,
    },
    messageId: message?.id || undefined,
    unread: Boolean(message && !message.read_at),
    updatedAt: iso(row.updated_at),
  }
}

function interestDto(row, message, caller) {
  return {
    kind: 'PROFILE_INTEREST',
    status: row.status,
    actor: publicActor(row, caller),
    source: {
      type: row.source_type,
      label: row.source_label,
      status: row.source_status,
    },
    messageId: message?.id || undefined,
    unread: Boolean(message && !message.read_at),
    updatedAt: iso(row.updated_at),
  }
}

function outboundInterestDto(row, caller) {
  return {
    kind: 'OUTBOUND_INTEREST',
    status: row.status,
    target: publicInterestTarget(row, caller),
    source: {
      type: row.source_type,
      label: row.source_label,
      status: row.source_status,
    },
    unread: false,
    updatedAt: iso(row.updated_at),
  }
}

async function listReceivedInteractions(database, caller, rawInput = {}) {
  if (!caller.userId) throw new Error('AUTH_REQUIRED')
  const input = normalizeListInput(rawInput)
  if (input.category === 'VISITOR') {
    return { category: input.category, ...(await listProfileVisitors(database, caller, input)) }
  }
  if (input.category === 'GUEST') {
    return listInfluenceGuests(database, caller, input)
  }
  if (input.category === 'INTERACTION') {
    return listInfluenceInteractions(database, caller, input)
  }
  if (input.category === 'ACTIVE_INTEREST') {
    return listActiveInfluenceInterests(database, caller, input)
  }
  if (input.category === 'OUTBOUND_INTEREST') {
    const rows = await listOutboundInterests(database, caller, input)
    const pageRows = rows.slice(0, input.limit)
    return {
      category: input.category,
      items: pageRows.map(row => outboundInterestDto(row, caller)),
      unreadCount: 0,
      nextCursor: rows.length > input.limit && pageRows.length
        ? encodeCursor(pageRows.at(-1).updated_at, pageRows.at(-1).relation_id)
        : undefined,
    }
  }
  const rows = input.category === 'REFERRAL'
    ? await listReferrals(database, caller, input)
    : await listInterests(database, caller, input)
  const pageRows = rows.slice(0, input.limit)
  const relationIds = pageRows.map(row => row.relation_id)
  const [messages, unreadCount] = await Promise.all([
    loadRelationshipMessages(database, caller, input.category, relationIds),
    countRelationshipUnread(database, caller, input.category),
  ])
  const dto = input.category === 'REFERRAL' ? referralDto : interestDto
  return {
    category: input.category,
    items: pageRows.map(row => dto(row, messages.get(row.relation_id), caller)),
    unreadCount,
    nextCursor: rows.length > input.limit && pageRows.length
      ? encodeCursor(pageRows.at(-1).updated_at, pageRows.at(-1).relation_id)
      : undefined,
  }
}

async function listReferrals(database, caller, input) {
  const blockFilter = mutualBlockFilter(caller.userId, 'r.actor_user_id', 'r.app_id')
  const params = [caller.appId, caller.userId, ...blockFilter.params]
  const cursorSql = input.cursor
    ? 'AND (r.updated_at < ? OR (r.updated_at = ? AND r.id < ?))'
    : ''
  if (input.cursor) params.push(input.cursor.timestamp, input.cursor.timestamp, input.cursor.id)
  return database.query(
    `SELECT r.id AS relation_id, r.status, r.note, r.updated_at,
            o.id AS opportunity_id, o.title AS opportunity_title,
            o.status AS opportunity_status,
            actor.id AS actor_user_id, p.nickname AS actor_nickname,
            p.headline AS actor_headline, p.visibility_json AS actor_visibility_json,
            avatar.cloud_file_id AS actor_avatar_file_id
     FROM mip_referral_intents r
     INNER JOIN mip_opportunities o
       ON o.app_id = r.app_id AND o.id = r.opportunity_id
         AND o.status IN ('PUBLISHED', 'ENDED')
     INNER JOIN mip_users actor
       ON actor.app_id = r.app_id AND actor.id = r.actor_user_id AND actor.status = 'ACTIVE'
     INNER JOIN mip_profiles p
       ON p.app_id = actor.app_id AND p.user_id = actor.id
     LEFT JOIN mip_media_assets avatar
       ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id AND avatar.status = 'READY'
     WHERE r.app_id = ? AND r.target_user_id = ?
       AND ${blockFilter.sql} ${cursorSql}
     ORDER BY r.updated_at DESC, r.id DESC
     LIMIT ${input.limit + 1}`,
    params,
  )
}

async function listInterests(database, caller, input) {
  const blockFilter = mutualBlockFilter(caller.userId, 'i.actor_user_id', 'i.app_id')
  const params = [caller.appId, caller.userId, ...blockFilter.params]
  const cursorSql = input.cursor
    ? 'AND (i.updated_at < ? OR (i.updated_at = ? AND i.id < ?))'
    : ''
  if (input.cursor) params.push(input.cursor.timestamp, input.cursor.timestamp, input.cursor.id)
  return database.query(
    `SELECT i.id AS relation_id, i.status, i.source_type, i.updated_at,
            actor.id AS actor_user_id, p.nickname AS actor_nickname,
            p.headline AS actor_headline, p.visibility_json AS actor_visibility_json,
            avatar.cloud_file_id AS actor_avatar_file_id,
            CASE i.source_type
              WHEN 'OPPORTUNITY' THEN opportunity.title
              WHEN 'COOPERATION_CARD' THEN cooperation.positioning
              WHEN 'SUPER_CASE' THEN super_case.project_name
              WHEN 'PROFILE' THEN '公开档案'
            END AS source_label,
            CASE i.source_type
              WHEN 'OPPORTUNITY' THEN opportunity.status
              WHEN 'COOPERATION_CARD' THEN cooperation.status
              WHEN 'SUPER_CASE' THEN super_case.status
              WHEN 'PROFILE' THEN 'PUBLISHED'
            END AS source_status
     FROM mip_profile_interests i
     INNER JOIN mip_users actor
       ON actor.app_id = i.app_id AND actor.id = i.actor_user_id AND actor.status = 'ACTIVE'
     INNER JOIN mip_profiles p
       ON p.app_id = actor.app_id AND p.user_id = actor.id
     LEFT JOIN mip_media_assets avatar
       ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id AND avatar.status = 'READY'
     LEFT JOIN mip_opportunities opportunity
       ON i.source_type = 'OPPORTUNITY' AND opportunity.app_id = i.app_id
         AND opportunity.id = i.source_id AND opportunity.owner_user_id = i.target_user_id
     LEFT JOIN mip_cooperation_cards cooperation
       ON i.source_type = 'COOPERATION_CARD' AND cooperation.app_id = i.app_id
         AND cooperation.id = i.source_id AND cooperation.owner_user_id = i.target_user_id
     LEFT JOIN mip_super_cases super_case
       ON i.source_type = 'SUPER_CASE' AND super_case.app_id = i.app_id
         AND super_case.id = i.source_id AND super_case.owner_user_id = i.target_user_id
     LEFT JOIN mip_users profile_source
       ON i.source_type = 'PROFILE' AND profile_source.app_id = i.app_id
         AND profile_source.id = i.source_id AND profile_source.id = i.target_user_id
         AND profile_source.status = 'ACTIVE'
     WHERE i.app_id = ? AND i.target_user_id = ?
       AND COALESCE(opportunity.id, cooperation.id, super_case.id, profile_source.id) IS NOT NULL
       AND ${blockFilter.sql}
       ${cursorSql}
     ORDER BY i.updated_at DESC, i.id DESC
     LIMIT ${input.limit + 1}`,
    params,
  )
}

async function listOutboundInterests(database, caller, input) {
  const blockFilter = mutualBlockFilter(caller.userId, 'target.id', 'target.app_id')
  const params = [caller.appId, caller.userId, ...blockFilter.params]
  const cursorSql = input.cursor
    ? 'AND (i.updated_at < ? OR (i.updated_at = ? AND i.id < ?))'
    : ''
  if (input.cursor) params.push(input.cursor.timestamp, input.cursor.timestamp, input.cursor.id)
  return database.query(
    `SELECT i.id AS relation_id, i.status, i.source_type, i.updated_at,
            target.id AS target_user_id, target_profile.nickname AS target_nickname,
            target_profile.headline AS target_headline,
            target_profile.visibility_json AS target_visibility_json,
            target_avatar.cloud_file_id AS target_avatar_file_id,
            CASE i.source_type
              WHEN 'OPPORTUNITY' THEN opportunity.title
              WHEN 'COOPERATION_CARD' THEN cooperation.positioning
              WHEN 'SUPER_CASE' THEN super_case.project_name
              WHEN 'PROFILE' THEN '公开档案'
            END AS source_label,
            CASE i.source_type
              WHEN 'OPPORTUNITY' THEN opportunity.status
              WHEN 'COOPERATION_CARD' THEN cooperation.status
              WHEN 'SUPER_CASE' THEN super_case.status
              WHEN 'PROFILE' THEN 'PUBLISHED'
            END AS source_status
     FROM mip_profile_interests i
     INNER JOIN mip_users target
       ON target.app_id = i.app_id AND target.id = i.target_user_id AND target.status = 'ACTIVE'
     INNER JOIN mip_profiles target_profile
       ON target_profile.app_id = target.app_id AND target_profile.user_id = target.id
     LEFT JOIN mip_media_assets target_avatar
       ON target_avatar.app_id = target_profile.app_id
         AND target_avatar.id = target_profile.avatar_asset_id AND target_avatar.status = 'READY'
     LEFT JOIN mip_opportunities opportunity
       ON i.source_type = 'OPPORTUNITY' AND opportunity.app_id = i.app_id
         AND opportunity.id = i.source_id AND opportunity.owner_user_id = target.id
         AND opportunity.status IN ('PUBLISHED', 'ENDED')
     LEFT JOIN mip_cooperation_cards cooperation
       ON i.source_type = 'COOPERATION_CARD' AND cooperation.app_id = i.app_id
         AND cooperation.id = i.source_id AND cooperation.owner_user_id = target.id
         AND cooperation.status = 'PUBLISHED'
     LEFT JOIN mip_super_cases super_case
       ON i.source_type = 'SUPER_CASE' AND super_case.app_id = i.app_id
         AND super_case.id = i.source_id AND super_case.owner_user_id = target.id
         AND super_case.status = 'PUBLISHED'
     LEFT JOIN mip_users profile_source
       ON i.source_type = 'PROFILE' AND profile_source.app_id = i.app_id
         AND profile_source.id = i.source_id AND profile_source.id = target.id
         AND profile_source.status = 'ACTIVE'
     WHERE i.app_id = ? AND i.actor_user_id = ? AND i.status = 'ACTIVE'
       AND COALESCE(opportunity.id, cooperation.id, super_case.id, profile_source.id) IS NOT NULL
       AND ${blockFilter.sql}
       ${cursorSql}
     ORDER BY i.updated_at DESC, i.id DESC
     LIMIT ${input.limit + 1}`,
    params,
  )
}

async function loadRelationshipMessages(database, caller, category, relationIds) {
  if (!relationIds.length) return new Map()
  const placeholders = relationIds.map(() => '?').join(', ')
  const aggregateType = category === 'REFERRAL' ? 'REFERRAL_INTENT' : 'PROFILE_INTEREST'
  const eventType = category === 'REFERRAL'
    ? 'opportunity.referral_changed'
    : 'profile.interest_changed'
  const suffixSql = category === 'REFERRAL'
    ? "m.dedupe_key = CONCAT('outbox:', e.id, ':referral')"
    : `m.dedupe_key IN (
        CONCAT('outbox:', e.id, ':opportunity-interest'),
        CONCAT('outbox:', e.id, ':cooperation-interest'),
        CONCAT('outbox:', e.id, ':case-interest'),
        CONCAT('outbox:', e.id, ':profile-interest')
      )`
  const rows = await database.query(
    `SELECT e.aggregate_id AS relation_id, m.id, m.read_at, m.created_at
     FROM mip_outbox_events e
     INNER JOIN mip_inbox_messages m
       ON m.app_id = e.app_id AND m.recipient_user_id = ? AND ${suffixSql}
     WHERE e.app_id = ? AND e.aggregate_type = ? AND e.event_type = ?
       AND e.aggregate_id IN (${placeholders})
     ORDER BY m.created_at DESC, m.id DESC`,
    [caller.userId, caller.appId, aggregateType, eventType, ...relationIds],
  )
  const messages = new Map()
  for (const row of rows) {
    if (!messages.has(row.relation_id)) messages.set(row.relation_id, row)
  }
  return messages
}

async function countRelationshipUnread(database, caller, category) {
  const referral = category === 'REFERRAL'
  const aggregateType = referral ? 'REFERRAL_INTENT' : 'PROFILE_INTEREST'
  const eventType = referral ? 'opportunity.referral_changed' : 'profile.interest_changed'
  const suffixSql = referral
    ? "m.dedupe_key = CONCAT('outbox:', e.id, ':referral')"
    : `m.dedupe_key IN (
        CONCAT('outbox:', e.id, ':opportunity-interest'),
        CONCAT('outbox:', e.id, ':cooperation-interest'),
        CONCAT('outbox:', e.id, ':case-interest'),
        CONCAT('outbox:', e.id, ':profile-interest')
      )`
  const blockFilter = mutualBlockFilter(
    caller.userId,
    referral ? 'r.actor_user_id' : 'i.actor_user_id',
    referral ? 'r.app_id' : 'i.app_id',
  )
  const ownershipSql = referral
    ? `EXISTS (
        SELECT 1 FROM mip_referral_intents r
        INNER JOIN mip_opportunities o
          ON o.app_id = r.app_id AND o.id = r.opportunity_id
            AND o.status IN ('PUBLISHED', 'ENDED')
        INNER JOIN mip_users actor
          ON actor.app_id = r.app_id AND actor.id = r.actor_user_id AND actor.status = 'ACTIVE'
        WHERE r.app_id = e.app_id AND r.id = e.aggregate_id AND r.target_user_id = ?
          AND ${blockFilter.sql}
      )`
    : `EXISTS (
        SELECT 1 FROM mip_profile_interests i
        INNER JOIN mip_users actor
          ON actor.app_id = i.app_id AND actor.id = i.actor_user_id AND actor.status = 'ACTIVE'
        WHERE i.app_id = e.app_id AND i.id = e.aggregate_id AND i.target_user_id = ?
          AND ${blockFilter.sql}
          AND (
            (i.source_type = 'OPPORTUNITY' AND EXISTS (
              SELECT 1 FROM mip_opportunities o
              WHERE o.app_id = i.app_id AND o.id = i.source_id
                AND o.owner_user_id = i.target_user_id
            ))
            OR
            (i.source_type = 'COOPERATION_CARD' AND EXISTS (
              SELECT 1 FROM mip_cooperation_cards c
              WHERE c.app_id = i.app_id AND c.id = i.source_id
                AND c.owner_user_id = i.target_user_id
            ))
            OR
            (i.source_type = 'SUPER_CASE' AND EXISTS (
              SELECT 1 FROM mip_super_cases s
              WHERE s.app_id = i.app_id AND s.id = i.source_id
                AND s.owner_user_id = i.target_user_id
            ))
            OR (i.source_type = 'PROFILE' AND i.source_id = i.target_user_id)
          )
      )`
  const row = await database.one(
    `SELECT COUNT(*) AS count FROM (
       SELECT m.read_at,
              ROW_NUMBER() OVER (
                PARTITION BY e.aggregate_id ORDER BY m.created_at DESC, m.id DESC
              ) AS message_position
       FROM mip_outbox_events e
       INNER JOIN mip_inbox_messages m
         ON m.app_id = e.app_id AND m.recipient_user_id = ? AND ${suffixSql}
       WHERE e.app_id = ? AND e.aggregate_type = ? AND e.event_type = ?
         AND ${ownershipSql}
     ) latest
     WHERE latest.message_position = 1 AND latest.read_at IS NULL`,
    [
      caller.userId,
      caller.appId,
      aggregateType,
      eventType,
      caller.userId,
      ...blockFilter.params,
    ],
  )
  return Number(row?.count || 0)
}

async function markReceivedInteractionRead(database, caller, input = {}) {
  if (!caller.userId) throw new Error('AUTH_REQUIRED')
  if (String(input.category || '').trim().toUpperCase() === 'VISITOR') {
    return markProfileVisitorRead(database, caller, input)
  }
  const messageId = String(input.messageId || '')
  if (!uuid(messageId)) throw new Error('VALIDATION_FAILED')
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'received-interaction.mark-read',
    idempotencyKey: input.idempotencyKey,
    request: { messageId },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const referralBlock = mutualBlockFilter(caller.userId, 'r.actor_user_id', 'r.app_id')
    const interestBlock = mutualBlockFilter(caller.userId, 'i.actor_user_id', 'i.app_id')
    const row = await tx.one(
      `SELECT m.id, m.read_at, e.aggregate_type, e.aggregate_id
       FROM mip_inbox_messages m
       INNER JOIN mip_outbox_events e ON e.app_id = m.app_id AND (
         (e.aggregate_type = 'REFERRAL_INTENT'
           AND e.event_type = 'opportunity.referral_changed'
           AND m.dedupe_key = CONCAT('outbox:', e.id, ':referral'))
         OR
         (e.aggregate_type = 'PROFILE_INTEREST'
           AND e.event_type = 'profile.interest_changed'
           AND m.dedupe_key IN (
             CONCAT('outbox:', e.id, ':opportunity-interest'),
             CONCAT('outbox:', e.id, ':cooperation-interest'),
             CONCAT('outbox:', e.id, ':case-interest'),
             CONCAT('outbox:', e.id, ':profile-interest')
           ))
       )
       WHERE m.app_id = ? AND m.recipient_user_id = ? AND m.id = ?
         AND (
           (e.aggregate_type = 'REFERRAL_INTENT' AND EXISTS (
             SELECT 1 FROM mip_referral_intents r
             INNER JOIN mip_opportunities o
               ON o.app_id = r.app_id AND o.id = r.opportunity_id
                 AND o.status IN ('PUBLISHED', 'ENDED')
             WHERE r.app_id = e.app_id AND r.id = e.aggregate_id AND r.target_user_id = ?
               AND ${referralBlock.sql}
           ))
           OR
           (e.aggregate_type = 'PROFILE_INTEREST' AND EXISTS (
             SELECT 1 FROM mip_profile_interests i
             WHERE i.app_id = e.app_id AND i.id = e.aggregate_id AND i.target_user_id = ?
               AND ${interestBlock.sql}
           ))
         )
       FOR UPDATE`,
      [
        caller.appId,
        caller.userId,
        messageId,
        caller.userId,
        ...referralBlock.params,
        caller.userId,
        ...interestBlock.params,
      ],
    )
    if (!row) throw new Error('NOT_FOUND')
    let readAt = row.read_at
    if (!readAt) {
      const update = await tx.query(
        `UPDATE mip_inbox_messages SET read_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND recipient_user_id = ? AND id = ? AND read_at IS NULL`,
        [caller.appId, caller.userId, messageId],
      )
      const current = await tx.one(
        `SELECT read_at FROM mip_inbox_messages
         WHERE app_id = ? AND recipient_user_id = ? AND id = ?`,
        [caller.appId, caller.userId, messageId],
      )
      readAt = current?.read_at
      if (Number(update.affectedRows) === 1) {
        await appendAudit(tx, {
          appId: caller.appId,
          actorUserId: caller.userId,
          action: 'RECEIVED_INTERACTION_READ',
          resourceType: row.aggregate_type,
          resourceId: row.aggregate_id,
          metadata: { messageId },
        })
      }
    }
    if (!readAt) throw new Error('SERVICE_UNAVAILABLE')
    return { messageId, readAt: iso(readAt) }
  })
}

module.exports = {
  countRelationshipUnread,
  interestDto,
  listOutboundInterests,
  listReceivedInteractions,
  loadRelationshipMessages,
  markReceivedInteractionRead,
  normalizeListInput,
  outboundInterestDto,
  publicActor,
  publicInterestTarget,
  referralDto,
}
