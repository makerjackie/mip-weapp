'use strict'

function createNotificationsRepository(database) {
  async function listInbox(appId, userId, options = {}) {
    const limit = Math.min(30, Math.max(1, Number(options.limit) || 20))
    const cursor = decodeCursor(options.cursor)
    const params = [appId, userId]
    let cursorSql = ''
    if (cursor) {
      cursorSql = 'AND (created_at < ? OR (created_at = ? AND id < ?))'
      params.push(cursor.createdAt, cursor.createdAt, cursor.id)
    }
    params.push(limit + 1)
    const [rows, unread] = await Promise.all([
      database.query(
        `SELECT id, recipient_user_id, message_type, title, body, target_type,
                target_id, target_route, read_at, created_at
         FROM mip_inbox_messages
         WHERE app_id = ? AND recipient_user_id = ? ${cursorSql}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
        params,
      ),
      database.one(
        `SELECT (
           SELECT COUNT(*)
           FROM mip_inbox_messages
           WHERE app_id = ? AND recipient_user_id = ? AND read_at IS NULL
         ) + (
           SELECT COUNT(*) FROM (
             SELECT visit.visitor_user_id
             FROM mip_profile_visits visit
             INNER JOIN mip_users visitor
               ON visitor.app_id = visit.app_id
               AND visitor.id = visit.visitor_user_id
               AND visitor.status = 'ACTIVE'
             WHERE visit.app_id = ? AND visit.profile_user_id = ? AND visit.read_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM mip_user_blocks block
                 WHERE block.app_id = visit.app_id AND block.status = 'ACTIVE'
                   AND (
                     (block.blocker_user_id = ? AND block.blocked_user_id = visit.visitor_user_id)
                     OR (block.blocker_user_id = visit.visitor_user_id AND block.blocked_user_id = ?)
                   )
               )
             GROUP BY visit.visitor_user_id
           ) visitor_unread
         ) AS count`,
        [appId, userId, appId, userId, userId, userId],
      ),
    ])
    const page = rows.slice(0, limit)
    return {
      items: page.map(messageDto),
      unreadCount: Number(unread?.count || 0),
      nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : undefined,
    }
  }

  async function markRead(appId, userId, messageId) {
    if (!isUuid(messageId)) throw new Error('VALIDATION_FAILED')
    return database.transaction(async (tx) => {
      await lockActiveUser(tx, appId, userId)
      await tx.query(
        `UPDATE mip_inbox_messages SET read_at = COALESCE(read_at, UTC_TIMESTAMP(3))
         WHERE app_id = ? AND recipient_user_id = ? AND id = ?`,
        [appId, userId, messageId],
      )
      const row = await tx.one(
        `SELECT id, read_at FROM mip_inbox_messages
         WHERE app_id = ? AND recipient_user_id = ? AND id = ?`,
        [appId, userId, messageId],
      )
      if (!row) throw new Error('NOT_FOUND')
      return { messageId: row.id, readAt: iso(row.read_at) }
    })
  }

  async function createGrant(input) {
    return database.transaction(async (tx) => {
      await lockActiveUser(tx, input.appId, input.userId)
      await tx.query(
        `INSERT INTO mip_notification_grants (
           id, app_id, user_id, channel, template_key, status,
           recipient_hash, recipient_ciphertext, granted_at, expires_at
         ) VALUES (?, ?, ?, 'WECHAT_SUBSCRIPTION', ?, 'AVAILABLE', ?, ?, UTC_TIMESTAMP(3), ?)`,
        [
          input.id,
          input.appId,
          input.userId,
          input.templateKey,
          input.recipientHash,
          input.recipientCiphertext,
          input.expiresAt || null,
        ],
      )
      return {
        templateKey: input.templateKey,
        decision: 'ACCEPTED',
        grantAvailable: true,
      }
    })
  }

  async function revokeGrants(appId, userId, templateKey) {
    return database.transaction(async (tx) => {
      await lockActiveUser(tx, appId, userId)
      await tx.query(
        `UPDATE mip_notification_grants
         SET status = 'REVOKED'
         WHERE app_id = ? AND user_id = ? AND channel = 'WECHAT_SUBSCRIPTION'
           AND template_key = ? AND status = 'AVAILABLE'`,
        [appId, userId, templateKey],
      )
    })
  }

  return { createGrant, listInbox, markRead, revokeGrants }
}

async function lockActiveUser(adapter, appId, userId) {
  const user = await adapter.one(
    `SELECT id, status FROM mip_users
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, userId],
  )
  if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
}

function messageDto(row) {
  const target = row.target_type && row.target_id && row.target_route
    ? { type: row.target_type, id: row.target_id, route: row.target_route }
    : undefined
  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    messageType: row.message_type,
    title: row.title,
    body: row.body,
    target,
    readAt: row.read_at ? iso(row.read_at) : undefined,
    createdAt: iso(row.created_at),
  }
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function iso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function encodeCursor(row) {
  if (!row) return undefined
  return Buffer.from(JSON.stringify({ createdAt: iso(row.created_at), id: row.id })).toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!isUuid(parsed.id) || !Number.isFinite(Date.parse(parsed.createdAt))) throw new Error()
    return parsed
  }
  catch {
    throw new Error('VALIDATION_FAILED')
  }
}

module.exports = { createNotificationsRepository, decodeCursor, encodeCursor, messageDto }
