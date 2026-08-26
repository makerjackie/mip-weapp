'use strict'

const { createHash } = require('node:crypto')
const { decodeCursor, pageRows } = require('./pagination')
const { AdminError, limit, text } = require('./validation')

const CHANNELS = Object.freeze([
  'WECHAT_SUBSCRIPTION',
  'WECHAT_CUSTOMER_SERVICE',
  'WECHAT_SERVICE_ACCOUNT',
])
const STATUSES = Object.freeze(['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'CANCELLED'])

function createMessageDeliveryRecordRepository(database) {
  async function listMessageDeliveryRecords(input) {
    const clauses = ['task.app_id = ?']
    const params = [input.appId]
    const visibility = input.visibility
    if (!visibility.platform) {
      if (!visibility.branchIds.length) return { items: [], nextCursor: null }
      const placeholders = visibility.branchIds.map(() => '?').join(', ')
      clauses.push(`(user.primary_branch_id IN (${placeholders})
        OR operation.branch_id IN (${placeholders})
        OR event.branch_id IN (${placeholders}))`)
      params.push(...visibility.branchIds, ...visibility.branchIds, ...visibility.branchIds)
    }
    if (input.query) {
      const pattern = `%${escapeLike(input.query)}%`
      clauses.push(`(inbox.title LIKE ? ESCAPE '\\\\'
        OR campaign.name LIKE ? ESCAPE '\\\\'
        OR campaign.title LIKE ? ESCAPE '\\\\'
        OR event.title LIKE ? ESCAPE '\\\\'
        OR profile.nickname LIKE ? ESCAPE '\\\\'
        OR CAST(lifecycle.player_number AS CHAR) LIKE ? ESCAPE '\\\\')`)
      params.push(pattern, pattern, pattern, pattern, pattern, pattern)
    }
    if (input.channel) {
      clauses.push('task.channel = ?')
      params.push(input.channel)
    }
    if (input.status) {
      clauses.push('task.status = ?')
      params.push(input.status)
    }
    if (input.from) {
      clauses.push('task.created_at >= ?')
      params.push(input.from)
    }
    if (input.to) {
      clauses.push('task.created_at < ?')
      params.push(input.to)
    }
    if (input.cursor) {
      clauses.push('(task.updated_at < ? OR (task.updated_at = ? AND task.id < ?))')
      params.push(input.cursor.occurredAt, input.cursor.occurredAt, input.cursor.id)
    }
    const rows = await database.query(
      `SELECT task.id, task.channel, task.status, task.attempts,
        task.last_error_code, task.available_at, task.delivered_at,
        task.created_at, task.updated_at,
        inbox.title, inbox.target_type, inbox.target_id,
        profile.nickname, lifecycle.player_number,
        branch.name AS branch_name,
        event.title AS event_title,
        campaign.name AS campaign_name
       FROM mip_delivery_tasks task
       INNER JOIN mip_inbox_messages inbox
         ON inbox.app_id = task.app_id AND inbox.id = task.inbox_message_id
       INNER JOIN mip_users user
         ON user.app_id = task.app_id AND user.id = inbox.recipient_user_id
       LEFT JOIN mip_profiles profile
         ON profile.app_id = user.app_id AND profile.user_id = user.id
       LEFT JOIN mip_player_lifecycles lifecycle
         ON lifecycle.app_id = user.app_id AND lifecycle.user_id = user.id
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = user.app_id AND branch.id = user.primary_branch_id
       LEFT JOIN mip_outbox_events outbox
         ON outbox.app_id = inbox.app_id
        AND outbox.event_type = 'operations.notification_published'
        AND inbox.dedupe_key = CONCAT('outbox:', outbox.id, ':operations')
       LEFT JOIN mip_operations_messages operation
         ON operation.app_id = outbox.app_id AND operation.id = outbox.aggregate_id
       LEFT JOIN mip_events event
         ON event.app_id = inbox.app_id
        AND event.id = CASE
          WHEN operation.event_id IS NOT NULL THEN operation.event_id
          WHEN inbox.target_type = 'EVENT' THEN inbox.target_id
          ELSE NULL END
       LEFT JOIN mip_message_campaigns campaign
         ON campaign.app_id = operation.app_id AND campaign.id = operation.publication_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY task.updated_at DESC, task.id DESC
       LIMIT ?`,
      [...params, input.limit + 1],
    )
    const page = pageRows(rows.map(row => deliveryRecordDto(row)), input.limit, item => ({
      occurredAt: item.occurredAt,
      id: item.sortKey,
    }))
    return { ...page, items: page.items.map(({ sortKey: _sortKey, ...item }) => item) }
  }

  return { listMessageDeliveryRecords }
}

function deliveryRecordDto(row) {
  return {
    recordKey: createHash('sha256').update(String(row.id)).digest('hex').slice(0, 20),
    channel: String(row.channel),
    status: String(row.status),
    attempts: Number(row.attempts || 0),
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    availableAt: iso(row.available_at),
    deliveredAt: iso(row.delivered_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    occurredAt: iso(row.updated_at) || iso(row.created_at),
    title: String(row.title || ''),
    eventTitle: row.event_title ? String(row.event_title) : null,
    campaignName: row.campaign_name ? String(row.campaign_name) : null,
    nickname: row.nickname ? String(row.nickname) : '未填写昵称',
    playerNumber: row.player_number === null || row.player_number === undefined
      ? null : Number(row.player_number),
    branchName: row.branch_name ? String(row.branch_name) : '',
    sortKey: String(row.id),
  }
}

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function normalizeMessageDeliveryRecordList(input = {}) {
  assertObject(input, ['query', 'channel', 'status', 'from', 'to', 'cursor', 'limit'])
  const query = input.query === undefined || input.query === '' ? null : text(input.query, 100, { label: '搜索条件' })
  const channel = enumOrNull(input.channel, CHANNELS, '消息渠道')
  const status = enumOrNull(input.status, STATUSES, '投递状态')
  const from = dateOrNull(input.from, '开始时间')
  const to = dateOrNull(input.to, '结束时间')
  if (from && to && new Date(from).getTime() >= new Date(to).getTime()) {
    throw new AdminError('VALIDATION_FAILED', '时间范围无效')
  }
  const cursor = input.cursor ? decodeCursor(input.cursor, ['occurredAt', 'id']) : null
  return { query, channel, status, from, to, cursor, limit: limit(input.limit || 20, 100) }
}

function enumOrNull(value, allowed, label) {
  if (value === undefined || value === null || value === '') return null
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!allowed.includes(normalized)) throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  return normalized
}

function dateOrNull(value, label) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  return value
}

function assertObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new AdminError('VALIDATION_FAILED', '消息投递记录请求格式无效')
  }
}

module.exports = {
  CHANNELS,
  STATUSES,
  createMessageDeliveryRecordRepository,
  normalizeMessageDeliveryRecordList,
}
