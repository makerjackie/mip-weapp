'use strict'

const { randomUUID } = require('node:crypto')
const { createProfileRef } = require('../lib/profile-ref')
const { lockActiveContributor } = require('../lib/auth')
const {
  decodeCursor,
  encodeCursor,
  idempotentTransaction,
  iso,
  jsonObject,
  mutualBlockFilter,
  stringValue,
  uuid,
} = require('./common')

const REPORT_CATEGORIES = new Set([
  'SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER',
])

function pageLimit(value) {
  const parsed = Number(value)
  return Math.min(30, Math.max(1, Number.isInteger(parsed) ? parsed : 20))
}

function normalizeComment(value = {}) {
  const type = value.type === 'REVIEW' ? 'REVIEW' : 'COMMENT'
  const rating = type === 'REVIEW' ? Number(value.rating) : null
  if (type === 'REVIEW' && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new Error('VALIDATION_FAILED')
  }
  const commentId = value.commentId ? stringValue(value.commentId, 36, 'VALIDATION_FAILED') : null
  if (commentId && !uuid(commentId)) throw new Error('VALIDATION_FAILED')
  const expectedVersion = commentId ? Number(value.expectedVersion) : null
  if (commentId && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    commentId,
    expectedVersion,
    type,
    body: stringValue(value.body, 800, 'VALIDATION_FAILED'),
    rating,
  }
}

function settingsDto(row) {
  return {
    commentsEnabled: row ? Boolean(row.comments_enabled) : true,
    reviewsEnabled: row ? Boolean(row.reviews_enabled) : true,
    callsEnabled: row ? Boolean(row.calls_enabled) : true,
    moderationMode: row?.moderation_mode === 'REVIEW' ? 'REVIEW' : 'AUTO',
    canCall: Number(row?.caller_can_call || 0) === 1,
  }
}

function commentDto(row, caller) {
  const visibility = jsonObject(row.visibility_json)
  const mine = row.author_user_id === caller.userId
  return {
    id: row.id,
    type: row.comment_type,
    body: row.body,
    rating: row.rating === null || row.rating === undefined ? undefined : Number(row.rating),
    author: {
      profileRef: createProfileRef(
        { appId: caller.appId, userId: row.author_user_id },
        caller.profileRefSecret,
      ),
      nickname: visibility.nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
      avatarUrl: visibility.avatar === false ? undefined : (row.avatar_file_id || undefined),
      headline: visibility.headline === false ? undefined : (row.headline || undefined),
      participant: Boolean(row.author_is_participant),
    },
    status: row.status,
    callCount: Number(row.call_count || 0),
    callActive: Boolean(row.call_active),
    mine,
    canEdit: mine && ['PENDING', 'PUBLISHED'].includes(row.status) && Boolean(row.within_edit_window),
    canDelete: mine && ['PENDING', 'PUBLISHED'].includes(row.status),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    editedAt: iso(row.edited_at) || undefined,
  }
}

async function getOpportunityCommentSettings(database, caller, input = {}) {
  if (!uuid(input.opportunityId)) throw new Error('NOT_FOUND')
  const opportunity = await database.one(
    `SELECT o.id, o.status,
            (
              o.owner_user_id = ? OR EXISTS (
                SELECT 1 FROM mip_opportunity_team_members member
                WHERE member.app_id = o.app_id AND member.opportunity_id = o.id
                  AND member.user_id = ? AND member.status = 'ACTIVE'
              )
            ) AS caller_can_call
     FROM mip_opportunities o
     WHERE o.app_id = ? AND o.id = ? AND o.status IN ('PUBLISHED', 'ENDED')`,
    [caller.userId, caller.userId, caller.appId, input.opportunityId],
  )
  if (!opportunity) throw new Error('NOT_FOUND')
  const row = await database.one(
    `SELECT comments_enabled, reviews_enabled, calls_enabled, moderation_mode
     FROM mip_opportunity_comment_settings
     WHERE app_id = ? AND opportunity_id = ?`,
    [caller.appId, input.opportunityId],
  )
  return {
    ...settingsDto({ ...row, caller_can_call: opportunity.caller_can_call }),
    opportunityStatus: opportunity.status,
  }
}

async function listOpportunityComments(database, caller, input = {}) {
  if (!uuid(input.opportunityId)) throw new Error('NOT_FOUND')
  const cursor = decodeCursor(input.cursor)
  const limit = pageLimit(input.limit)
  const settings = await getOpportunityCommentSettings(database, caller, input)
  const block = mutualBlockFilter(caller.userId, 'comment.author_user_id', 'comment.app_id')
  const clauses = [
    'comment.app_id = ?',
    'comment.opportunity_id = ?',
    "(comment.status = 'PUBLISHED' OR (comment.author_user_id = ? AND comment.status = 'PENDING'))",
  ]
  const params = [caller.appId, input.opportunityId, caller.userId]
  if (block.sql) {
    clauses.push(block.sql)
    params.push(...block.params)
  }
  if (cursor) {
    clauses.push('(comment.created_at < ? OR (comment.created_at = ? AND comment.id < ?))')
    params.push(cursor.timestamp, cursor.timestamp, cursor.id)
  }
  const rows = await database.query(
    `SELECT comment.id, comment.author_user_id, comment.comment_type, comment.body,
            comment.rating, comment.author_is_participant, comment.status,
            comment.call_count, comment.version, comment.created_at, comment.edited_at,
            profile.nickname, profile.headline, profile.visibility_json,
            avatar.cloud_file_id AS avatar_file_id,
            EXISTS (
              SELECT 1 FROM mip_opportunity_comment_calls own_call
              WHERE own_call.app_id = comment.app_id AND own_call.comment_id = comment.id
                AND own_call.actor_user_id = ? AND own_call.status = 'ACTIVE'
            ) AS call_active,
            (comment.created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE)) AS within_edit_window
     FROM mip_opportunity_comments comment
     INNER JOIN mip_users author
       ON author.app_id = comment.app_id AND author.id = comment.author_user_id AND author.status = 'ACTIVE'
     INNER JOIN mip_profiles profile
       ON profile.app_id = author.app_id AND profile.user_id = author.id
     LEFT JOIN mip_media_assets avatar
       ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id AND avatar.status = 'READY'
     WHERE ${clauses.join(' AND ')}
     ORDER BY comment.created_at DESC, comment.id DESC
     LIMIT ${limit + 1}`,
    [caller.userId, ...params],
  )
  const page = rows.slice(0, limit)
  return {
    settings,
    items: page.map(row => commentDto(row, caller)),
    nextCursor: rows.length > limit && page.length
      ? encodeCursor(page.at(-1).created_at, page.at(-1).id)
      : undefined,
  }
}

async function opportunityFacts(tx, caller, opportunityId) {
  const row = await tx.one(
    `SELECT o.id, o.owner_user_id, o.status,
            COALESCE(settings.comments_enabled, 1) AS comments_enabled,
            COALESCE(settings.reviews_enabled, 1) AS reviews_enabled,
            COALESCE(settings.calls_enabled, 1) AS calls_enabled,
            COALESCE(settings.moderation_mode, 'AUTO') AS moderation_mode,
            (
              o.owner_user_id = ? OR EXISTS (
                SELECT 1 FROM mip_opportunity_team_members member
                WHERE member.app_id = o.app_id AND member.opportunity_id = o.id
                  AND member.user_id = ?
              )
            ) AS caller_is_participant
     FROM mip_opportunities o
     LEFT JOIN mip_opportunity_comment_settings settings
       ON settings.app_id = o.app_id AND settings.opportunity_id = o.id
     WHERE o.app_id = ? AND o.id = ?
     FOR UPDATE`,
    [caller.userId, caller.userId, caller.appId, opportunityId],
  )
  if (!row || !['PUBLISHED', 'ENDED'].includes(row.status)) throw new Error('NOT_FOUND')
  return row
}

async function saveOpportunityComment(database, contentSafety, caller, input = {}) {
  const draft = normalizeComment(input)
  if (!uuid(input.opportunityId)) throw new Error('NOT_FOUND')
  await contentSafety.assertSafe(caller, [draft.body])
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: draft.commentId ? 'opportunity.comment.edit' : 'opportunity.comment.create',
    idempotencyKey: input.idempotencyKey,
    request: { opportunityId: input.opportunityId, ...draft },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const facts = await opportunityFacts(tx, caller, input.opportunityId)
    if (draft.type === 'COMMENT' && !Number(facts.comments_enabled)) throw new Error('COMMENTS_DISABLED')
    if (draft.type === 'REVIEW' && (!Number(facts.reviews_enabled) || facts.status !== 'ENDED')) {
      throw new Error('REVIEWS_DISABLED')
    }
    if (draft.commentId) {
      const stored = await tx.one(
        `SELECT author_user_id, comment_type, status, version, created_at
         FROM mip_opportunity_comments
         WHERE app_id = ? AND id = ? AND opportunity_id = ? FOR UPDATE`,
        [caller.appId, draft.commentId, input.opportunityId],
      )
      if (!stored) throw new Error('NOT_FOUND')
      if (stored.author_user_id !== caller.userId) throw new Error('FORBIDDEN')
      if (!['PENDING', 'PUBLISHED'].includes(stored.status)) throw new Error('CONFLICT')
      if (stored.comment_type !== draft.type || Number(stored.version) !== draft.expectedVersion) {
        throw new Error('CONFLICT')
      }
      const update = await tx.query(
        `UPDATE mip_opportunity_comments
         SET body = ?, rating = ?, edited_at = UTC_TIMESTAMP(3), version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?
           AND created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE)`,
        [draft.body, draft.rating, caller.appId, draft.commentId, draft.expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw new Error('COMMENT_EDIT_WINDOW_CLOSED')
      return {
        id: draft.commentId,
        status: stored.status,
        version: draft.expectedVersion + 1,
        participant: Boolean(facts.caller_is_participant),
      }
    }
    const id = randomUUID()
    const published = facts.moderation_mode !== 'REVIEW'
    const status = published ? 'PUBLISHED' : 'PENDING'
    await tx.query(
      `INSERT INTO mip_opportunity_comments (
         id, app_id, opportunity_id, author_user_id, comment_type, body, rating,
         author_is_participant, status, content_safety_status, published_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PASSED',
         CASE WHEN ? = 'PUBLISHED' THEN UTC_TIMESTAMP(3) ELSE NULL END)`,
      [id, caller.appId, input.opportunityId, caller.userId, draft.type, draft.body,
        draft.rating, Number(facts.caller_is_participant) ? 1 : 0, status, status],
    )
    return { id, status, version: 1, participant: Boolean(facts.caller_is_participant) }
  })
}

async function deleteOpportunityComment(database, caller, input = {}) {
  if (!uuid(input.commentId) || !Number.isInteger(Number(input.expectedVersion))) {
    throw new Error('VALIDATION_FAILED')
  }
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'opportunity.comment.delete',
    idempotencyKey: input.idempotencyKey,
    request: { commentId: input.commentId, expectedVersion: Number(input.expectedVersion) },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const row = await tx.one(
      `SELECT author_user_id, status, version
       FROM mip_opportunity_comments WHERE app_id = ? AND id = ? FOR UPDATE`,
      [caller.appId, input.commentId],
    )
    if (!row) throw new Error('NOT_FOUND')
    if (row.author_user_id !== caller.userId) throw new Error('FORBIDDEN')
    if (row.status === 'DELETED') return { id: input.commentId, status: 'DELETED', version: Number(row.version) }
    if (!['PENDING', 'PUBLISHED'].includes(row.status)
      || Number(row.version) !== Number(input.expectedVersion)) throw new Error('CONFLICT')
    await tx.query(
      `UPDATE mip_opportunity_comments
       SET status = 'DELETED', body = '[已删除]', deleted_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE app_id = ? AND id = ? AND version = ?`,
      [caller.appId, input.commentId, input.expectedVersion],
    )
    return { id: input.commentId, status: 'DELETED', version: Number(input.expectedVersion) + 1 }
  })
}

async function setOpportunityCommentCall(database, caller, input = {}) {
  if (!uuid(input.commentId)) throw new Error('NOT_FOUND')
  const active = Boolean(input.active)
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'opportunity.comment.call',
    idempotencyKey: input.idempotencyKey,
    request: { commentId: input.commentId, active },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const comment = await tx.one(
      `SELECT comment.author_user_id, comment.status, comment.call_count,
              COALESCE(settings.calls_enabled, 1) AS calls_enabled,
              (
                opportunity.owner_user_id = ? OR EXISTS (
                  SELECT 1 FROM mip_opportunity_team_members member
                  WHERE member.app_id = opportunity.app_id
                    AND member.opportunity_id = opportunity.id
                    AND member.user_id = ? AND member.status = 'ACTIVE'
                )
              ) AS caller_can_call
       FROM mip_opportunity_comments comment
       INNER JOIN mip_opportunities opportunity
         ON opportunity.app_id = comment.app_id AND opportunity.id = comment.opportunity_id
       LEFT JOIN mip_opportunity_comment_settings settings
         ON settings.app_id = comment.app_id AND settings.opportunity_id = comment.opportunity_id
       WHERE comment.app_id = ? AND comment.id = ? FOR UPDATE`,
      [caller.userId, caller.userId, caller.appId, input.commentId],
    )
    if (!comment || comment.status !== 'PUBLISHED') throw new Error('NOT_FOUND')
    if (!Number(comment.calls_enabled)) throw new Error('CALLS_DISABLED')
    if (!Number(comment.caller_can_call)) throw new Error('CALL_PARTICIPANT_REQUIRED')
    if (comment.author_user_id === caller.userId) throw new Error('SELF_CALL_FORBIDDEN')
    const block = mutualBlockFilter(caller.userId, 'comment.author_user_id', 'comment.app_id')
    const visible = await tx.one(
      `SELECT 1 AS visible FROM mip_opportunity_comments comment
       WHERE comment.app_id = ? AND comment.id = ? AND ${block.sql}`,
      [caller.appId, input.commentId, ...block.params],
    )
    if (!visible) throw new Error('NOT_FOUND')
    const stored = await tx.one(
      `SELECT status, version FROM mip_opportunity_comment_calls
       WHERE app_id = ? AND comment_id = ? AND actor_user_id = ? FOR UPDATE`,
      [caller.appId, input.commentId, caller.userId],
    )
    const wasActive = stored?.status === 'ACTIVE'
    if (wasActive !== active) {
      if (stored) {
        await tx.query(
          `UPDATE mip_opportunity_comment_calls
           SET status = ?, called_at = CASE WHEN ? = 'ACTIVE' THEN UTC_TIMESTAMP(3) ELSE called_at END,
             cancelled_at = CASE WHEN ? = 'CANCELLED' THEN UTC_TIMESTAMP(3) ELSE NULL END,
             version = version + 1
           WHERE app_id = ? AND comment_id = ? AND actor_user_id = ?`,
          [active ? 'ACTIVE' : 'CANCELLED', active ? 'ACTIVE' : 'CANCELLED',
            active ? 'ACTIVE' : 'CANCELLED', caller.appId, input.commentId, caller.userId],
        )
      }
      else if (active) {
        await tx.query(
          `INSERT INTO mip_opportunity_comment_calls (app_id, comment_id, actor_user_id)
           VALUES (?, ?, ?)`,
          [caller.appId, input.commentId, caller.userId],
        )
      }
      await tx.query(
        `UPDATE mip_opportunity_comments
         SET call_count = call_count ${active ? '+ 1' : '- 1'}
         WHERE app_id = ? AND id = ? AND call_count ${active ? '>= 0' : '> 0'}`,
        [caller.appId, input.commentId],
      )
    }
    return {
      id: input.commentId,
      active,
      callCount: Math.max(0, Number(comment.call_count) + (wasActive === active ? 0 : active ? 1 : -1)),
    }
  })
}

async function reportOpportunityComment(database, caller, input = {}) {
  if (!uuid(input.commentId)) throw new Error('NOT_FOUND')
  const category = String(input.category || '')
  if (!REPORT_CATEGORIES.has(category)) throw new Error('VALIDATION_FAILED')
  const description = stringValue(input.description, 300, 'VALIDATION_FAILED', false) || null
  const requestId = stringValue(input.requestId, 128, 'VALIDATION_FAILED')
  if (requestId.length < 12) throw new Error('VALIDATION_FAILED')
  return idempotentTransaction(database, {
    appId: caller.appId,
    userId: caller.userId,
    operation: 'opportunity.comment.report',
    idempotencyKey: input.idempotencyKey,
    request: { commentId: input.commentId, category, description, requestId },
  }, async (tx) => {
    await lockActiveContributor(tx, caller)
    const block = mutualBlockFilter(caller.userId, 'comment.author_user_id', 'comment.app_id')
    const comment = await tx.one(
      `SELECT comment.author_user_id FROM mip_opportunity_comments comment
       WHERE comment.app_id = ? AND comment.id = ? AND comment.status = 'PUBLISHED'
         AND ${block.sql} FOR UPDATE`,
      [caller.appId, input.commentId, ...block.params],
    )
    if (!comment) throw new Error('NOT_FOUND')
    if (comment.author_user_id === caller.userId) throw new Error('SELF_REPORT_FORBIDDEN')
    const reportId = randomUUID()
    await tx.query(
      `INSERT INTO mip_opportunity_comment_reports (
         id, app_id, comment_id, reporter_user_id, category, description, request_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reportId, caller.appId, input.commentId, caller.userId, category, description, requestId],
    )
    return { reportId, status: 'PENDING' }
  })
}

module.exports = {
  deleteOpportunityComment,
  getOpportunityCommentSettings,
  listOpportunityComments,
  normalizeComment,
  reportOpportunityComment,
  saveOpportunityComment,
  setOpportunityCommentCall,
}
