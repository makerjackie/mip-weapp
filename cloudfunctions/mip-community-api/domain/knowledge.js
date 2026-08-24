'use strict'

const { createHash, randomUUID } = require('node:crypto')

const CONTENT_TYPES = new Set(['HOT_NEWS', 'ARTICLE', 'WEB', 'VIDEO', 'PRIVATE_CHANNEL', 'EXPERT_SHARE'])
const REPORT_CATEGORIES = new Set([
  'SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER',
])

function createKnowledgeService(database, options = {}) {
  const catalogStage = options.catalogStage === 'LIVE' ? 'LIVE' : 'TEST'
  const createId = options.id || randomUUID
  const createProfileRef = options.createProfileRef
  const profileRefSecret = options.profileRefSecret
  const assertSafe = options.assertSafe || (async () => true)

  async function optionalUser(identity, queryable = database) {
    if (identity?.userId) return identity.userId
    if (!identity?.identityKey) return null
    const row = await queryable.one(
      `SELECT user.id
       FROM mip_user_identities identity
       INNER JOIN mip_users user
         ON user.app_id = identity.app_id AND user.id = identity.user_id AND user.status = 'ACTIVE'
       WHERE identity.app_id = ? AND identity.provider = 'WECHAT_MINIPROGRAM'
         AND identity.identity_key = ? LIMIT 1`,
      [identity.appId, identity.identityKey],
    )
    return row?.id || null
  }

  async function listKnowledgeCategories(caller) {
    const rows = await database.query(
      `SELECT category.id, category.category_key, category.name, category.summary, category.sort_order,
              COUNT(content.id) AS published_count
       FROM mip_knowledge_categories category
       LEFT JOIN mip_knowledge_contents content
         ON content.app_id = category.app_id AND content.category_id = category.id
        AND content.status = 'PUBLISHED' AND content.published_at <= UTC_TIMESTAMP(3)
       WHERE category.app_id = ? AND category.status = 'ACTIVE'
       GROUP BY category.id, category.category_key, category.name, category.summary, category.sort_order
       ORDER BY category.sort_order ASC, category.id ASC`,
      [caller.appId],
    )
    return { items: rows.map(categoryDto) }
  }

  async function listKnowledgeContents(caller, input = {}) {
    const limit = pageLimit(input.limit)
    const offset = offsetCursor(input.cursor)
    const categoryId = optionalUuid(input.categoryId)
    const type = input.contentType ? String(input.contentType) : null
    if (type && !CONTENT_TYPES.has(type)) throw new Error('VALIDATION_FAILED')
    const query = optionalText(input.query, 80)
    const accessType = input.accessType ? String(input.accessType) : null
    if (accessType && !['FREE', 'MEMBER', 'MEMBER_OR_PAID'].includes(accessType)) {
      throw new Error('VALIDATION_FAILED')
    }
    const clauses = [
      'content.app_id = ?',
      "content.status = 'PUBLISHED'",
      'content.published_at <= UTC_TIMESTAMP(3)',
      "category.status = 'ACTIVE'",
    ]
    const params = [caller.appId]
    if (categoryId) { clauses.push('content.category_id = ?'); params.push(categoryId) }
    if (type) { clauses.push('content.content_type = ?'); params.push(type) }
    if (accessType) { clauses.push('content.access_type = ?'); params.push(accessType) }
    if (query) {
      clauses.push('(content.title LIKE ? OR content.summary LIKE ? OR content.author_name LIKE ?)')
      params.push(`%${escapeLike(query)}%`, `%${escapeLike(query)}%`, `%${escapeLike(query)}%`)
    }
    const rows = await database.query(
      `SELECT content.id, content.content_type, content.title, content.summary,
              content.author_name, content.access_type, content.published_at,
              category.id AS category_id, category.name AS category_name,
              source.name AS source_name, cover.cloud_file_id AS cover_file_id,
              product.id AS product_id, product.name AS product_name,
              product.price_cents, product.currency, product.catalog_stage
       FROM mip_knowledge_contents content
       INNER JOIN mip_knowledge_categories category
         ON category.app_id = content.app_id AND category.id = content.category_id
       LEFT JOIN mip_knowledge_sources source
         ON source.app_id = content.app_id AND source.id = content.source_id
       LEFT JOIN mip_media_assets cover
         ON cover.app_id = content.app_id AND cover.id = content.cover_asset_id AND cover.status = 'READY'
       LEFT JOIN mip_knowledge_products product
         ON product.app_id = content.app_id AND product.content_id = content.id
        AND product.catalog_stage = ? AND product.status = 'ACTIVE'
       WHERE ${clauses.join(' AND ')}
       ORDER BY content.published_at DESC, content.id DESC
       LIMIT ? OFFSET ?`,
      [catalogStage, ...params, limit + 1, offset],
    )
    return {
      items: rows.slice(0, limit).map(contentSummaryDto),
      nextCursor: rows.length > limit ? String(offset + limit) : undefined,
    }
  }

  async function getKnowledgeContent(caller, input = {}) {
    const contentId = requiredUuid(input.contentId)
    return database.transaction(async (tx) => {
      const userId = await lockOptionalActiveUser(tx, caller)
      const row = await tx.one(
        `SELECT content.*, category.name AS category_name, source.name AS source_name,
                cover.cloud_file_id AS cover_file_id,
                product.id AS product_id, product.name AS product_name,
                product.price_cents, product.currency, product.catalog_stage,
                product.unlock_days, product.refund_policy, product.refund_window_hours,
                EXISTS(
                  SELECT 1 FROM mip_membership_entitlements membership
                  WHERE membership.app_id = content.app_id AND membership.user_id = ?
                    AND membership.status = 'ACTIVE'
                    AND membership.starts_at <= UTC_TIMESTAMP(3)
                    AND membership.ends_at > UTC_TIMESTAMP(3)
                ) AS has_membership,
                entitlement.id AS content_entitlement_id,
                entitlement.first_accessed_at AS entitlement_first_accessed_at,
                entitlement.ends_at AS entitlement_ends_at
         FROM mip_knowledge_contents content
         INNER JOIN mip_knowledge_categories category
           ON category.app_id = content.app_id AND category.id = content.category_id
         LEFT JOIN mip_knowledge_sources source
           ON source.app_id = content.app_id AND source.id = content.source_id
         LEFT JOIN mip_media_assets cover
           ON cover.app_id = content.app_id AND cover.id = content.cover_asset_id AND cover.status = 'READY'
         LEFT JOIN mip_knowledge_products product
           ON product.app_id = content.app_id AND product.content_id = content.id
          AND product.catalog_stage = ? AND product.status = 'ACTIVE'
         LEFT JOIN mip_knowledge_entitlements entitlement
           ON entitlement.app_id = content.app_id AND entitlement.content_id = content.id
          AND entitlement.user_id = ? AND entitlement.status = 'ACTIVE'
          AND (entitlement.ends_at IS NULL OR entitlement.ends_at > UTC_TIMESTAMP(3))
         WHERE content.app_id = ? AND content.id = ? AND content.status = 'PUBLISHED'
           AND content.published_at <= UTC_TIMESTAMP(3)
         LIMIT 1 FOR UPDATE`,
        [userId || '', catalogStage, userId || '', caller.appId, contentId],
      )
      if (!row) throw new Error('KNOWLEDGE_CONTENT_NOT_FOUND')
      const access = knowledgeAccess(row)
      if (access.unlocked && row.content_entitlement_id && !row.entitlement_first_accessed_at) {
        await tx.query(
          `UPDATE mip_knowledge_entitlements
           SET first_accessed_at = UTC_TIMESTAMP(3), version = version + 1
           WHERE app_id = ? AND id = ? AND first_accessed_at IS NULL`,
          [caller.appId, row.content_entitlement_id],
        )
      }
      return contentDetailDto(row, access)
    })
  }

  async function lockOptionalActiveUser(tx, caller) {
    let userId = caller?.userId || null
    if (!userId && caller?.identityKey) {
      const identity = await tx.one(
        `SELECT user_id FROM mip_user_identities
         WHERE app_id = ? AND provider = 'WECHAT_MINIPROGRAM' AND identity_key = ?
         LIMIT 1 FOR UPDATE`,
        [caller.appId, caller.identityKey],
      )
      userId = identity?.user_id || null
    }
    if (!userId) return null
    const user = await tx.one(
      `SELECT id, status FROM mip_users
       WHERE app_id = ? AND id = ? LIMIT 1 FOR UPDATE`,
      [caller.appId, userId],
    )
    return user?.status === 'ACTIVE' ? user.id : null
  }

  async function listKnowledgeComments(caller, input = {}) {
    const contentId = requiredUuid(input.contentId)
    const userId = await optionalUser(caller)
    const limit = pageLimit(input.limit)
    const offset = offsetCursor(input.cursor)
    const target = await database.one(
      `SELECT id FROM mip_knowledge_contents
       WHERE app_id = ? AND id = ? AND status = 'PUBLISHED'`,
      [caller.appId, contentId],
    )
    if (!target) throw new Error('KNOWLEDGE_CONTENT_NOT_FOUND')
    const rows = await database.query(
      `SELECT comment.id, comment.parent_comment_id, comment.author_user_id,
              comment.body, comment.status, comment.version, comment.created_at, comment.edited_at,
              profile.nickname, profile.headline, profile.visibility_json,
              avatar.cloud_file_id AS avatar_file_id
       FROM mip_content_comments comment
       INNER JOIN mip_users author
         ON author.app_id = comment.app_id AND author.id = comment.author_user_id AND author.status = 'ACTIVE'
       LEFT JOIN mip_profiles profile
         ON profile.app_id = author.app_id AND profile.user_id = author.id
       LEFT JOIN mip_media_assets avatar
         ON avatar.app_id = profile.app_id AND avatar.id = profile.avatar_asset_id AND avatar.status = 'READY'
       WHERE comment.app_id = ? AND comment.target_type = 'KNOWLEDGE' AND comment.target_id = ?
         AND (comment.status = 'PUBLISHED' OR (comment.author_user_id = ? AND comment.status = 'PENDING'))
         AND NOT EXISTS (
           SELECT 1 FROM mip_user_blocks block
           WHERE block.app_id = comment.app_id AND block.status = 'ACTIVE'
             AND ((block.blocker_user_id = ? AND block.blocked_user_id = comment.author_user_id)
               OR (block.blocker_user_id = comment.author_user_id AND block.blocked_user_id = ?))
         )
       ORDER BY comment.created_at DESC, comment.id DESC LIMIT ? OFFSET ?`,
      [caller.appId, contentId, userId || '', userId || '', userId || '', limit + 1, offset],
    )
    const settings = await database.one(
      `SELECT comments_enabled, moderation_mode, version
       FROM mip_content_comment_settings
       WHERE app_id = ? AND target_type = 'KNOWLEDGE' AND target_id = ?`,
      [caller.appId, contentId],
    )
    return {
      settings: commentSettingsDto(settings),
      items: rows.slice(0, limit).map(row => commentDto(row, caller.appId, userId, createProfileRef, profileRefSecret)),
      nextCursor: rows.length > limit ? String(offset + limit) : undefined,
    }
  }

  async function createKnowledgeComment(caller, input = {}) {
    const contentId = requiredUuid(input.contentId)
    const body = requiredText(input.body, 800)
    const parentCommentId = optionalUuid(input.parentCommentId)
    const idempotencyKey = requiredKey(input.idempotencyKey)
    await assertSafe(caller, body)
    return idempotentMutation(database, caller, 'knowledge.comment.create', idempotencyKey, {
      contentId, body, parentCommentId,
    }, async (tx) => {
      await lockActiveUser(tx, caller)
      const content = await tx.one(
        `SELECT content.id, COALESCE(settings.comments_enabled, 1) AS comments_enabled,
                COALESCE(settings.moderation_mode, 'AUTO') AS moderation_mode
         FROM mip_knowledge_contents content
         LEFT JOIN mip_content_comment_settings settings
           ON settings.app_id = content.app_id AND settings.target_type = 'KNOWLEDGE'
          AND settings.target_id = content.id
         WHERE content.app_id = ? AND content.id = ? AND content.status = 'PUBLISHED' FOR UPDATE`,
        [caller.appId, contentId],
      )
      if (!content) throw new Error('KNOWLEDGE_CONTENT_NOT_FOUND')
      if (!Number(content.comments_enabled)) throw new Error('COMMENTS_DISABLED')
      if (parentCommentId) {
        const parent = await tx.one(
          `SELECT id FROM mip_content_comments
           WHERE app_id = ? AND id = ? AND target_type = 'KNOWLEDGE'
             AND target_id = ? AND status = 'PUBLISHED' FOR UPDATE`,
          [caller.appId, parentCommentId, contentId],
        )
        if (!parent) throw new Error('COMMENT_NOT_FOUND')
      }
      const commentId = createId()
      const status = content.moderation_mode === 'REVIEW' ? 'PENDING' : 'PUBLISHED'
      await tx.query(
        `INSERT INTO mip_content_comments (
          id, app_id, target_type, target_id, author_user_id, parent_comment_id,
          body, status, content_safety_status, published_at
        ) VALUES (?, ?, 'KNOWLEDGE', ?, ?, ?, ?, ?, 'PASSED',
          CASE WHEN ? = 'PUBLISHED' THEN UTC_TIMESTAMP(3) ELSE NULL END)`,
        [commentId, caller.appId, contentId, caller.userId, parentCommentId, body, status, status],
      )
      if (status === 'PUBLISHED') {
        await appendOutbox(tx, caller.appId, commentId, 'knowledge.comment_published')
      }
      return { id: commentId, status, version: 1 }
    })
  }

  async function deleteKnowledgeComment(caller, input = {}) {
    const commentId = requiredUuid(input.commentId)
    const expectedVersion = positiveInteger(input.expectedVersion)
    const idempotencyKey = requiredKey(input.idempotencyKey)
    return idempotentMutation(database, caller, 'knowledge.comment.delete', idempotencyKey, {
      commentId, expectedVersion,
    }, async (tx) => {
      await lockActiveUser(tx, caller)
      const row = await tx.one(
        `SELECT author_user_id, status, version FROM mip_content_comments
         WHERE app_id = ? AND id = ? AND target_type = 'KNOWLEDGE' FOR UPDATE`,
        [caller.appId, commentId],
      )
      if (!row) throw new Error('COMMENT_NOT_FOUND')
      if (row.author_user_id !== caller.userId) throw new Error('FORBIDDEN')
      if (row.status === 'DELETED') return { id: commentId, status: 'DELETED', version: Number(row.version) }
      if (!['PENDING', 'PUBLISHED'].includes(row.status) || Number(row.version) !== expectedVersion) {
        throw new Error('CONFLICT')
      }
      await tx.query(
        `UPDATE mip_content_comments SET status = 'DELETED', body = '[已删除]',
          deleted_at = UTC_TIMESTAMP(3), version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [caller.appId, commentId, expectedVersion],
      )
      return { id: commentId, status: 'DELETED', version: expectedVersion + 1 }
    })
  }

  async function reportKnowledgeComment(caller, input = {}) {
    const commentId = requiredUuid(input.commentId)
    const category = String(input.category || '')
    if (!REPORT_CATEGORIES.has(category)) throw new Error('VALIDATION_FAILED')
    const description = optionalText(input.description, 300)
    const requestId = requiredKey(input.requestId)
    const idempotencyKey = requiredKey(input.idempotencyKey)
    return idempotentMutation(database, caller, 'knowledge.comment.report', idempotencyKey, {
      commentId, category, description, requestId,
    }, async (tx) => {
      await lockActiveUser(tx, caller)
      const comment = await tx.one(
        `SELECT author_user_id FROM mip_content_comments
         WHERE app_id = ? AND id = ? AND target_type = 'KNOWLEDGE' AND status = 'PUBLISHED'
         FOR UPDATE`,
        [caller.appId, commentId],
      )
      if (!comment) throw new Error('COMMENT_NOT_FOUND')
      if (comment.author_user_id === caller.userId) throw new Error('SELF_REPORT_FORBIDDEN')
      const reportId = createId()
      await tx.query(
        `INSERT INTO mip_content_comment_reports (
          id, app_id, comment_id, reporter_user_id, category, description, request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [reportId, caller.appId, commentId, caller.userId, category, description || null, requestId],
      )
      return { reportId, status: 'PENDING' }
    })
  }

  return {
    createKnowledgeComment,
    deleteKnowledgeComment,
    getKnowledgeContent,
    listKnowledgeCategories,
    listKnowledgeComments,
    listKnowledgeContents,
    reportKnowledgeComment,
  }
}

function knowledgeAccess(row) {
  const accessType = row.access_type
  const hasMembership = Number(row.has_membership) === 1
  const hasEntitlement = Boolean(row.content_entitlement_id)
  const unlocked = accessType === 'FREE'
    || accessType === 'MEMBER' && hasMembership
    || accessType === 'MEMBER_OR_PAID' && (hasMembership || hasEntitlement)
  return {
    accessType,
    unlocked,
    reason: unlocked
      ? (hasEntitlement ? 'PURCHASED' : hasMembership ? 'MEMBERSHIP' : 'FREE')
      : accessType === 'MEMBER' ? 'MEMBERSHIP_REQUIRED' : 'PURCHASE_REQUIRED',
  }
}

function categoryDto(row) {
  return {
    id: row.id,
    categoryKey: row.category_key,
    name: row.name,
    summary: row.summary || '',
    sortOrder: Number(row.sort_order),
    publishedCount: Number(row.published_count || 0),
  }
}

function contentSummaryDto(row) {
  return {
    id: row.id,
    contentType: row.content_type,
    title: row.title,
    summary: row.summary,
    authorName: row.author_name || '',
    accessType: row.access_type,
    category: { id: row.category_id, name: row.category_name },
    sourceName: row.source_name || '',
    coverUrl: row.cover_file_id || '',
    product: row.product_id ? {
      id: row.product_id,
      name: row.product_name,
      priceCents: Number(row.price_cents),
      currency: row.currency,
      catalogStage: row.catalog_stage,
    } : null,
    publishedAt: iso(row.published_at),
  }
}

function contentDetailDto(row, access) {
  const summary = contentSummaryDto({
    ...row,
    category_id: row.category_id,
    category_name: row.category_name,
  })
  return {
    ...summary,
    access,
    body: access.unlocked ? (row.body_text || '') : '',
    externalUrl: access.unlocked ? (row.external_url || '') : '',
    channel: access.unlocked && row.content_type === 'PRIVATE_CHANNEL' ? {
      finderUserName: row.channel_finder_username || '',
      feedId: row.channel_feed_id || '',
    } : null,
    entitlement: row.content_entitlement_id ? {
      id: row.content_entitlement_id,
      endsAt: iso(row.entitlement_ends_at),
      firstAccessedAt: iso(row.entitlement_first_accessed_at),
    } : null,
    refundPolicy: row.product_id ? {
      policy: row.refund_policy,
      windowHours: Number(row.refund_window_hours),
      unlockDays: row.unlock_days === null ? null : Number(row.unlock_days),
    } : null,
  }
}

function commentSettingsDto(row) {
  return {
    commentsEnabled: row ? Boolean(row.comments_enabled) : true,
    moderationMode: row?.moderation_mode === 'REVIEW' ? 'REVIEW' : 'AUTO',
    version: Number(row?.version || 0),
  }
}

function commentDto(row, appId, userId, createProfileRef, secret) {
  const visibility = parseJson(row.visibility_json)
  const mine = Boolean(userId) && row.author_user_id === userId
  return {
    id: row.id,
    parentCommentId: row.parent_comment_id || undefined,
    body: row.body,
    status: row.status,
    author: {
      profileRef: createProfileRef({ appId, userId: row.author_user_id }, secret),
      nickname: visibility.nickname === false ? 'MIP 用户' : (row.nickname || 'MIP 用户'),
      headline: visibility.headline === false ? '' : (row.headline || ''),
      avatarUrl: visibility.avatar === false ? '' : (row.avatar_file_id || ''),
    },
    mine,
    canDelete: mine && ['PENDING', 'PUBLISHED'].includes(row.status),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    editedAt: iso(row.edited_at),
  }
}

async function lockActiveUser(tx, caller) {
  const row = await tx.one(
    'SELECT status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE',
    [caller.appId, caller.userId],
  )
  if (!row || row.status !== 'ACTIVE') throw new Error('FORBIDDEN')
}

async function idempotentMutation(database, caller, operation, key, request, work) {
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  return database.transaction(async (tx) => {
    const existing = await tx.one(
      `SELECT request_hash, status, response_json FROM mip_idempotency_keys
       WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ? FOR UPDATE`,
      [caller.appId, caller.userId, operation, key],
    )
    if (existing) {
      if (existing.request_hash !== requestHash) throw new Error('IDEMPOTENCY_CONFLICT')
      if (existing.status === 'COMPLETED') return parseJson(existing.response_json)
      throw new Error('CONFLICT')
    }
    const id = randomUUID()
    await tx.query(
      `INSERT INTO mip_idempotency_keys (
        id, app_id, actor_user_id, operation, idempotency_key, request_hash, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [id, caller.appId, caller.userId, operation, key, requestHash],
    )
    const result = await work(tx)
    await tx.query(
      `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
       WHERE app_id = ? AND id = ?`,
      [JSON.stringify(result), caller.appId, id],
    )
    return result
  })
}

async function appendOutbox(tx, appId, aggregateId, eventType) {
  await tx.query(
    `INSERT INTO mip_outbox_events (
      id, app_id, aggregate_type, aggregate_id, event_type, source_version, payload_json
    ) VALUES (?, ?, 'KNOWLEDGE_COMMENT', ?, ?, 1, JSON_OBJECT())`,
    [randomUUID(), appId, aggregateId, eventType],
  )
}

function requiredUuid(value) {
  const text = String(value || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error('VALIDATION_FAILED')
  }
  return text
}

function optionalUuid(value) {
  return value ? requiredUuid(value) : null
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

function pageLimit(value) {
  const number = Number(value || 20)
  return Number.isInteger(number) && number >= 1 && number <= 50 ? number : 20
}

function offsetCursor(value) {
  if (value === undefined || value === null || value === '') return 0
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 100000) throw new Error('VALIDATION_FAILED')
  return number
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, character => `\\${character}`)
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
  contentDetailDto,
  createKnowledgeService,
  knowledgeAccess,
}
