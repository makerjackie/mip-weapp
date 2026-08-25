'use strict'

const { createHash, randomUUID } = require('node:crypto')

const REPORT_CATEGORIES = new Set([
  'SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER',
])

function createEventCommentsService(database, options = {}) {
  const assertReady = options.assertReady
  const assertSafe = options.assertSafe || (async () => true)
  const agreementRequirements = options.agreementRequirements
  const createId = options.id || randomUUID
  const createProfileRef = options.createProfileRef
  const profileRefSecret = options.profileRefSecret

  async function requireReady(queryable, caller) {
    if (typeof assertReady !== 'function') throw new Error('SERVICE_UNAVAILABLE')
    await assertReady(queryable, caller, agreementRequirements)
  }

  async function listEventComments(caller, input = {}) {
    const eventId = requiredUuid(input.eventId)
    const limit = pageLimit(input.limit)
    const cursor = decodeCursor(input.cursor)
    await requireReady(database, caller)
    const event = await visibleEvent(database, caller.appId, eventId)
    const clauses = [
      'comment.app_id = ?',
      "comment.target_type = 'EVENT'",
      'comment.target_id = ?',
      "(comment.status = 'PUBLISHED' OR (comment.author_user_id = ? AND comment.status = 'PENDING'))",
      `NOT EXISTS (
        SELECT 1 FROM mip_user_blocks block
        WHERE block.app_id = comment.app_id AND block.status = 'ACTIVE'
          AND ((block.blocker_user_id = ? AND block.blocked_user_id = comment.author_user_id)
            OR (block.blocker_user_id = comment.author_user_id AND block.blocked_user_id = ?))
      )`,
    ]
    const params = [caller.appId, eventId, caller.userId, caller.userId, caller.userId]
    if (cursor) {
      clauses.push('(comment.created_at < ? OR (comment.created_at = ? AND comment.id < ?))')
      params.push(cursor.timestamp, cursor.timestamp, cursor.id)
    }
    const rows = await database.query(
      `SELECT comment.id, comment.author_user_id, comment.body, comment.status,
              comment.version, comment.created_at, comment.edited_at,
              profile.nickname, profile.headline, profile.visibility_json,
              avatar.cloud_file_id AS avatar_file_id,
              (comment.created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE)) AS within_edit_window
       FROM mip_content_comments comment
       INNER JOIN mip_users author
         ON author.app_id = comment.app_id AND author.id = comment.author_user_id
           AND author.status = 'ACTIVE'
       LEFT JOIN mip_profiles profile
         ON profile.app_id = author.app_id AND profile.user_id = author.id
       LEFT JOIN mip_media_assets avatar
         ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id
           AND avatar.status = 'READY'
       WHERE ${clauses.join(' AND ')}
       ORDER BY comment.created_at DESC, comment.id DESC
       LIMIT ${limit + 1}`,
      params,
    )
    const page = rows.slice(0, limit)
    return {
      event: eventDto(event),
      settings: settingsDto(event),
      items: page.map(row => commentDto(
        row,
        caller,
        createProfileRef,
        profileRefSecret,
      )),
      nextCursor: rows.length > limit && page.length
        ? encodeCursor(page.at(-1).created_at, page.at(-1).id)
        : undefined,
    }
  }

  async function saveEventComment(caller, input = {}) {
    const eventId = requiredUuid(input.eventId)
    const draft = normalizeDraft(input)
    const operation = draft.commentId ? 'event.comment.edit' : 'event.comment.create'
    return idempotentMutation(database, caller, operation, input.idempotencyKey, {
      eventId,
      commentId: draft.commentId,
      expectedVersion: draft.expectedVersion,
      body: draft.body,
    }, async (tx) => {
      const event = await visibleEvent(tx, caller.appId, eventId, { lock: true })
      if (!Number(event.comments_enabled)) throw new Error('COMMENTS_DISABLED')
      if (draft.commentId) {
        const stored = await tx.one(
          `SELECT author_user_id, status, version
           FROM mip_content_comments
           WHERE app_id = ? AND id = ? AND target_type = 'EVENT' AND target_id = ?
           FOR UPDATE`,
          [caller.appId, draft.commentId, eventId],
        )
        if (!stored) throw new Error('COMMENT_NOT_FOUND')
        if (stored.author_user_id !== caller.userId) throw new Error('FORBIDDEN')
        if (!['PENDING', 'PUBLISHED'].includes(stored.status)
          || Number(stored.version) !== draft.expectedVersion) {
          throw new Error('CONFLICT')
        }
        const status = event.moderation_mode === 'REVIEW' ? 'PENDING' : stored.status
        const update = await tx.query(
          `UPDATE mip_content_comments
           SET body = ?, status = ?, content_safety_status = 'PASSED',
               published_at = CASE WHEN ? = 'PENDING' THEN NULL ELSE published_at END,
               moderated_at = CASE WHEN ? = 'PENDING' THEN NULL ELSE moderated_at END,
               moderated_by_user_id = CASE WHEN ? = 'PENDING' THEN NULL ELSE moderated_by_user_id END,
               moderation_reason = CASE WHEN ? = 'PENDING' THEN NULL ELSE moderation_reason END,
               edited_at = UTC_TIMESTAMP(3), version = version + 1
           WHERE app_id = ? AND id = ? AND target_type = 'EVENT' AND target_id = ?
             AND version = ?
             AND created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE)`,
          [draft.body, status, status, status, status, status,
            caller.appId, draft.commentId, eventId, draft.expectedVersion],
        )
        if (Number(update.affectedRows) !== 1) throw new Error('COMMENT_EDIT_WINDOW_CLOSED')
        return {
          id: draft.commentId,
          status,
          version: draft.expectedVersion + 1,
        }
      }
      const commentId = createId()
      const status = event.moderation_mode === 'REVIEW' ? 'PENDING' : 'PUBLISHED'
      await tx.query(
        `INSERT INTO mip_content_comments (
          id, app_id, target_type, target_id, author_user_id,
          body, status, content_safety_status, published_at
        ) VALUES (?, ?, 'EVENT', ?, ?, ?, ?, 'PASSED',
          CASE WHEN ? = 'PUBLISHED' THEN UTC_TIMESTAMP(3) ELSE NULL END)`,
        [commentId, caller.appId, eventId, caller.userId, draft.body, status, status],
      )
      return { id: commentId, status, version: 1 }
    }, {
      authorize: queryable => requireReady(queryable, caller),
      preflight: () => assertSafe(caller, draft.body),
    })
  }

  async function deleteEventComment(caller, input = {}) {
    const eventId = requiredUuid(input.eventId)
    const commentId = requiredUuid(input.commentId)
    const expectedVersion = positiveInteger(input.expectedVersion)
    return idempotentMutation(database, caller, 'event.comment.delete', input.idempotencyKey, {
      eventId, commentId, expectedVersion,
    }, async (tx) => {
      await visibleEvent(tx, caller.appId, eventId, { lock: true })
      const stored = await tx.one(
        `SELECT author_user_id, status, version
         FROM mip_content_comments
         WHERE app_id = ? AND id = ? AND target_type = 'EVENT' AND target_id = ?
         FOR UPDATE`,
        [caller.appId, commentId, eventId],
      )
      if (!stored) throw new Error('COMMENT_NOT_FOUND')
      if (stored.author_user_id !== caller.userId) throw new Error('FORBIDDEN')
      if (stored.status === 'DELETED') {
        return { id: commentId, status: 'DELETED', version: Number(stored.version) }
      }
      if (!['PENDING', 'PUBLISHED'].includes(stored.status)
        || Number(stored.version) !== expectedVersion) throw new Error('CONFLICT')
      const update = await tx.query(
        `UPDATE mip_content_comments
         SET status = 'DELETED', body = '[已删除]', deleted_at = UTC_TIMESTAMP(3),
             version = version + 1
         WHERE app_id = ? AND id = ? AND target_type = 'EVENT' AND target_id = ?
           AND version = ?`,
        [caller.appId, commentId, eventId, expectedVersion],
      )
      if (Number(update.affectedRows) !== 1) throw new Error('CONFLICT')
      return { id: commentId, status: 'DELETED', version: expectedVersion + 1 }
    }, {
      authorize: queryable => requireReady(queryable, caller),
    })
  }

  async function reportEventComment(caller, input = {}) {
    const eventId = requiredUuid(input.eventId)
    const commentId = requiredUuid(input.commentId)
    const expectedVersion = positiveInteger(input.expectedVersion)
    const category = String(input.category || '').trim().toUpperCase()
    if (!REPORT_CATEGORIES.has(category)) throw new Error('VALIDATION_FAILED')
    const description = optionalText(input.description, 300)
    const requestId = requiredKey(input.requestId)
    return idempotentMutation(database, caller, 'event.comment.report', input.idempotencyKey, {
      eventId, commentId, expectedVersion, category, description, requestId,
    }, async (tx) => {
      await visibleEvent(tx, caller.appId, eventId, { lock: true })
      const comment = await tx.one(
        `SELECT comment.author_user_id, comment.status, comment.version
         FROM mip_content_comments comment
         WHERE comment.app_id = ? AND comment.id = ?
           AND comment.target_type = 'EVENT' AND comment.target_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM mip_user_blocks block
             WHERE block.app_id = comment.app_id AND block.status = 'ACTIVE'
               AND ((block.blocker_user_id = ? AND block.blocked_user_id = comment.author_user_id)
                 OR (block.blocker_user_id = comment.author_user_id AND block.blocked_user_id = ?))
           )
         FOR UPDATE`,
        [caller.appId, commentId, eventId, caller.userId, caller.userId],
      )
      if (!comment) throw new Error('COMMENT_NOT_FOUND')
      if (comment.status !== 'PUBLISHED') throw new Error('COMMENT_NOT_FOUND')
      if (Number(comment.version) !== expectedVersion) throw new Error('CONFLICT')
      if (comment.author_user_id === caller.userId) throw new Error('SELF_REPORT_FORBIDDEN')
      const reportId = createId()
      await tx.query(
        `INSERT INTO mip_content_comment_reports (
          id, app_id, comment_id, reporter_user_id, category, description, request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [reportId, caller.appId, commentId, caller.userId, category, description || null, requestId],
      )
      return { reportId, status: 'PENDING' }
    }, {
      authorize: queryable => requireReady(queryable, caller),
    })
  }

  return {
    deleteEventComment,
    listEventComments,
    reportEventComment,
    saveEventComment,
  }
}

async function visibleEvent(queryable, appId, eventId, { lock = false } = {}) {
  const row = await queryable.one(
    `SELECT event.id, event.title, event.status, event.published_at,
            COALESCE(settings.comments_enabled, 1) AS comments_enabled,
            COALESCE(settings.moderation_mode, 'AUTO') AS moderation_mode,
            COALESCE(settings.version, 0) AS settings_version
     FROM mip_events event
     LEFT JOIN mip_content_comment_settings settings
       ON settings.app_id = event.app_id AND settings.target_type = 'EVENT'
         AND settings.target_id = event.id
     WHERE event.app_id = ? AND event.id = ?
       AND (event.status = 'PUBLISHED'
         OR (event.published_at IS NOT NULL AND event.status IN ('CANCELLED', 'ENDED')))
     LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
    [appId, eventId],
  )
  if (!row) throw new Error('EVENT_NOT_FOUND')
  return row
}

function normalizeDraft(input = {}) {
  const commentId = input.commentId ? requiredUuid(input.commentId) : null
  const expectedVersion = commentId ? positiveInteger(input.expectedVersion) : null
  return {
    body: requiredText(input.body, 800),
    commentId,
    expectedVersion,
  }
}

function eventDto(row) {
  return {
    id: row.id,
    title: String(row.title || ''),
    status: row.status,
  }
}

function settingsDto(row) {
  return {
    commentsEnabled: Boolean(Number(row.comments_enabled)),
    moderationMode: row.moderation_mode === 'REVIEW' ? 'REVIEW' : 'AUTO',
    version: Number(row.settings_version || 0),
  }
}

function commentDto(row, caller, createProfileRef, secret) {
  const visibility = parseJson(row.visibility_json)
  const mine = row.author_user_id === caller.userId
  return {
    id: row.id,
    body: String(row.body || ''),
    status: row.status,
    author: {
      profileRef: createProfileRef({ appId: caller.appId, userId: row.author_user_id }, secret),
      nickname: visibility.nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
      headline: visibility.headline === false ? '' : (row.headline || ''),
      avatarUrl: visibility.avatar === false ? '' : (row.avatar_file_id || ''),
    },
    mine,
    canEdit: mine && ['PENDING', 'PUBLISHED'].includes(row.status) && Boolean(row.within_edit_window),
    canDelete: mine && ['PENDING', 'PUBLISHED'].includes(row.status),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    editedAt: iso(row.edited_at),
  }
}

async function idempotentMutation(database, caller, operation, rawKey, request, work, options = {}) {
  const key = requiredKey(rawKey)
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  const replay = await database.one(
    `SELECT request_hash, status, response_json
     FROM mip_idempotency_keys
     WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?`,
    [caller.appId, caller.userId, operation, key],
  )
  if (replay) return replayResult(replay, requestHash)
  if (typeof options.authorize === 'function') await options.authorize(database)
  if (typeof options.preflight === 'function') await options.preflight()
  try {
    return await database.transaction(async (tx) => {
      const existing = await tx.one(
        `SELECT request_hash, status, response_json
         FROM mip_idempotency_keys
         WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?`,
        [caller.appId, caller.userId, operation, key],
      )
      if (existing) return replayResult(existing, requestHash)
      const id = randomUUID()
      await tx.query(
        `INSERT INTO mip_idempotency_keys (
          id, app_id, actor_user_id, operation, idempotency_key, request_hash,
          status, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING',
          DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
        [id, caller.appId, caller.userId, operation, key, requestHash],
      )
      if (typeof options.authorize === 'function') await options.authorize(tx)
      const result = await work(tx)
      await tx.query(
        `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
         WHERE app_id = ? AND id = ?`,
        [JSON.stringify(result), caller.appId, id],
      )
      return result
    })
  }
  catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error
    const concurrent = await database.one(
      `SELECT request_hash, status, response_json
       FROM mip_idempotency_keys
       WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?`,
      [caller.appId, caller.userId, operation, key],
    )
    if (!concurrent) throw error
    return replayResult(concurrent, requestHash)
  }
}

function replayResult(existing, requestHash) {
  if (existing.request_hash !== requestHash) throw new Error('IDEMPOTENCY_CONFLICT')
  if (existing.status !== 'COMPLETED') throw new Error('CONFLICT')
  return parseJson(existing.response_json)
}

function encodeCursor(value, id) {
  const timestamp = iso(value)
  return Buffer.from(JSON.stringify({ timestamp, id }), 'utf8').toString('base64url')
}

function decodeCursor(value) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value)
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(text)) throw new Error('VALIDATION_FAILED')
  try {
    const parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'))
    if (!parsed || !requiredUuid(parsed.id) || !iso(parsed.timestamp)) {
      throw new Error('VALIDATION_FAILED')
    }
    return { id: parsed.id, timestamp: new Date(parsed.timestamp) }
  }
  catch (error) {
    if (error?.message === 'VALIDATION_FAILED') throw error
    throw new Error('VALIDATION_FAILED')
  }
}

function pageLimit(value) {
  const number = Number(value || 20)
  return Number.isInteger(number) && number >= 1 && number <= 30 ? number : 20
}

function requiredUuid(value) {
  const text = String(value || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error('VALIDATION_FAILED')
  }
  return text
}

function requiredText(value, maximum) {
  const text = String(value || '').trim()
  if (!text || text.length > maximum) throw new Error('VALIDATION_FAILED')
  return text
}

function optionalText(value, maximum) {
  if (value === undefined || value === null || value === '') return ''
  const text = String(value).trim()
  if (text.length > maximum) throw new Error('VALIDATION_FAILED')
  return text
}

function requiredKey(value) {
  const text = String(value || '').trim()
  if (text.length < 12 || text.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(text)) {
    throw new Error('VALIDATION_FAILED')
  }
  return text
}

function positiveInteger(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error('VALIDATION_FAILED')
  return number
}

function parseJson(value) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(value || '{}') }
  catch { return {} }
}

function iso(value) {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

module.exports = {
  createEventCommentsService,
  decodeCursor,
  normalizeDraft,
  visibleEvent,
}
