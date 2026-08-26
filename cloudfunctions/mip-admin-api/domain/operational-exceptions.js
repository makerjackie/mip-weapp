'use strict'

const EXCEPTION_TYPES = Object.freeze([
  'OUTBOX',
  'REFUND',
  'PAYMENT',
  'MEDIA',
  'DELIVERY',
  'AI',
])

const EXCEPTION_STATUSES = Object.freeze([
  'FAILED',
  'STALLED',
  'REJECTED',
  'EXPIRED',
  'CLEANUP_PENDING',
])

const SOURCE_COPY = Object.freeze({
  OUTBOX: {
    FAILED: ['业务事件处理失败', '一项业务事件未完成后续处理。'],
    STALLED: ['业务事件处理超时', '一项业务事件的处理时间超过预期。'],
  },
  REFUND: {
    FAILED: ['退款处理失败', '一笔退款未完成处理。'],
    STALLED: ['退款处理超时', '一笔退款的处理时间超过预期。'],
  },
  PAYMENT: {
    FAILED: ['支付处理失败', '一笔支付未完成处理。'],
    STALLED: ['支付处理超时', '一笔支付的处理时间超过预期。'],
  },
  MEDIA: {
    REJECTED: ['图片审核未通过', '一张图片未通过内容审核。'],
    STALLED: ['图片处理超时', '一张图片的处理时间超过预期。'],
  },
  DELIVERY: {
    FAILED: ['通知发送失败', '一条外部通知未完成发送。'],
    STALLED: ['通知发送超时', '一条外部通知的处理时间超过预期。'],
  },
  AI: {
    FAILED: ['AI 草稿处理失败', '一份 AI 草稿未完成处理。'],
    EXPIRED: ['AI 草稿处理超时', '一份 AI 草稿已超过有效期但仍处于处理中。'],
    CLEANUP_PENDING: ['AI 音频待清理', '一份已结束草稿的音频仍待清理。'],
  },
})

async function listOperationalExceptions(database, input) {
  const appId = typeof input?.appId === 'string' ? input.appId.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(appId)) {
    throw new Error('OPERATIONAL_EXCEPTION_APP_INVALID')
  }
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now())
  const pageLimit = input.unbounded === true
    ? null
    : Math.min(100, Math.max(1, Number(input.limit) || 50))
  const selectedTypes = normalizedSelection(input.types, EXCEPTION_TYPES)
  const selectedStatuses = normalizedSelection(input.statuses, EXCEPTION_STATUSES)
  const readers = {
    OUTBOX: readOutbox,
    REFUND: readRefunds,
    PAYMENT: readPayments,
    MEDIA: readMedia,
    DELIVERY: readDeliveries,
    AI: readAi,
  }
  const pages = await Promise.all(selectedTypes.map(type => readers[type](
    database,
    appId,
    now,
    selectedStatuses,
    pageLimit,
  )))
  const items = pages.flat().sort((left, right) => compareExceptions(left, right))
  return pageLimit === null ? items : items.slice(0, pageLimit)
}

function normalizedSelection(value, allowed) {
  const values = Array.isArray(value) ? value : []
  const selected = values.filter(item => allowed.includes(item))
  return selected.length ? [...new Set(selected)] : [...allowed]
}

async function readOutbox(database, appId, now, statuses, limit) {
  const conditions = []
  const params = [appId]
  if (statuses.includes('FAILED')) {
    conditions.push("(status = 'FAILED' OR (status = 'CANCELLED' AND attempts >= 5 AND last_error_code IS NOT NULL))")
  }
  if (statuses.includes('STALLED')) {
    conditions.push(`(status = 'PROCESSING' AND (
      (lease_expires_at IS NOT NULL AND lease_expires_at < ?)
      OR (lease_expires_at IS NULL AND updated_at < DATE_SUB(?, INTERVAL 30 MINUTE))
    ))`)
    params.push(now, now)
  }
  if (!conditions.length) return []
  const rows = await limitedQuery(database,
    `SELECT id, aggregate_type, aggregate_id, status, attempts, updated_at
     FROM mip_outbox_events
     WHERE app_id = ? AND (${conditions.join(' OR ')})
     ORDER BY updated_at DESC, id DESC`,
    params,
    limit,
  )
  return rows.map(row => exceptionDto({
    id: row.id,
    source: 'OUTBOX',
    status: row.status === 'PROCESSING' ? 'STALLED' : 'FAILED',
    occurredAt: row.updated_at,
    target: targetFor(row.aggregate_type, row.aggregate_id),
  }))
}

async function readRefunds(database, appId, now, statuses, limit) {
  const conditions = []
  const params = [appId]
  if (statuses.includes('FAILED')) conditions.push("status = 'FAILED'")
  if (statuses.includes('STALLED')) {
    conditions.push("(status IN ('PENDING', 'PROVIDER_CREATED', 'PROCESSING') AND updated_at < DATE_SUB(?, INTERVAL 30 MINUTE))")
    params.push(now)
  }
  if (!conditions.length) return []
  const rows = await limitedQuery(database,
    `SELECT id, order_id, status, updated_at
     FROM mip_refunds
     WHERE app_id = ? AND (${conditions.join(' OR ')})
     ORDER BY updated_at DESC, id DESC`,
    params,
    limit,
  )
  return rows.map(row => exceptionDto({
    id: row.id,
    source: 'REFUND',
    status: row.status === 'FAILED' ? 'FAILED' : 'STALLED',
    occurredAt: row.updated_at,
    target: targetFor('ORDER', row.order_id),
  }))
}

async function readPayments(database, appId, now, statuses, limit) {
  const conditions = []
  const params = [appId]
  if (statuses.includes('FAILED')) conditions.push("status = 'FAILED'")
  if (statuses.includes('STALLED')) {
    conditions.push("(status IN ('CREATED', 'PARAMETERS_ISSUED', 'PENDING') AND updated_at < DATE_SUB(?, INTERVAL 30 MINUTE))")
    params.push(now)
  }
  if (!conditions.length) return []
  const rows = await limitedQuery(database,
    `SELECT id, order_id, status, updated_at
     FROM mip_payment_attempts
     WHERE app_id = ? AND (${conditions.join(' OR ')})
     ORDER BY updated_at DESC, id DESC`,
    params,
    limit,
  )
  return rows.map(row => exceptionDto({
    id: row.id,
    source: 'PAYMENT',
    status: row.status === 'FAILED' ? 'FAILED' : 'STALLED',
    occurredAt: row.updated_at,
    target: targetFor('ORDER', row.order_id),
  }))
}

async function readMedia(database, appId, now, statuses, limit) {
  const conditions = []
  const params = [appId]
  if (statuses.includes('REJECTED')) conditions.push("status = 'REJECTED'")
  if (statuses.includes('STALLED')) {
    conditions.push("(status = 'PENDING' AND updated_at < DATE_SUB(?, INTERVAL 30 MINUTE))")
    params.push(now)
  }
  if (!conditions.length) return []
  const rows = await limitedQuery(database,
    `SELECT id, status, updated_at
     FROM mip_media_assets
     WHERE app_id = ? AND (${conditions.join(' OR ')})
     ORDER BY updated_at DESC, id DESC`,
    params,
    limit,
  )
  return rows.map(row => exceptionDto({
    id: row.id,
    source: 'MEDIA',
    status: row.status === 'REJECTED' ? 'REJECTED' : 'STALLED',
    occurredAt: row.updated_at,
    target: null,
  }))
}

async function readDeliveries(database, appId, now, statuses, limit) {
  const conditions = []
  const params = [appId]
  if (statuses.includes('FAILED')) {
    conditions.push("(task.status = 'FAILED' OR (task.status = 'CANCELLED' AND task.last_error_code IS NOT NULL))")
  }
  if (statuses.includes('STALLED')) {
    conditions.push(`(task.status = 'PROCESSING' AND (
      (task.lease_expires_at IS NOT NULL AND task.lease_expires_at < ?)
      OR (task.lease_expires_at IS NULL AND task.updated_at < DATE_SUB(?, INTERVAL 30 MINUTE))
    ))`)
    params.push(now, now)
  }
  if (!conditions.length) return []
  const rows = await limitedQuery(database,
    `SELECT task.id, task.status, task.last_error_code, task.updated_at,
            message.target_type, message.target_id
     FROM mip_delivery_tasks task
     INNER JOIN mip_inbox_messages message
       ON message.app_id = task.app_id AND message.id = task.inbox_message_id
     WHERE task.app_id = ? AND (${conditions.join(' OR ')})
     ORDER BY task.updated_at DESC, task.id DESC`,
    params,
    limit,
  )
  return rows.map(row => exceptionDto({
    id: row.id,
    source: 'DELIVERY',
    status: row.status === 'PROCESSING' ? 'STALLED' : 'FAILED',
    reasonCode: row.last_error_code || null,
    occurredAt: row.updated_at,
    target: targetFor(row.target_type, row.target_id),
  }))
}

async function readAi(database, appId, now, statuses, limit) {
  const conditions = []
  const params = [appId]
  if (statuses.includes('FAILED')) conditions.push("draft.status = 'FAILED'")
  if (statuses.includes('EXPIRED')) {
    conditions.push("(draft.status IN ('UPLOADED', 'TRANSCRIBING', 'STRUCTURING', 'DRAFT_READY') AND draft.expires_at <= ?)")
    params.push(now)
  }
  if (statuses.includes('CLEANUP_PENDING')) {
    conditions.push(`(draft.status IN ('CONFIRMED', 'EXPIRED', 'DELETED')
      AND asset.status = 'READY' AND asset.purpose = 'AI_AUDIO'
      AND asset.owner_user_id = draft.user_id)`)
  }
  if (!conditions.length) return []
  const rows = await limitedQuery(database,
    `SELECT draft.id, draft.status, draft.expires_at, draft.updated_at,
            asset.status AS audio_status
     FROM mip_ai_drafts draft
     LEFT JOIN mip_media_assets asset
       ON asset.app_id = draft.app_id AND asset.id = draft.audio_asset_id
     WHERE draft.app_id = ? AND (${conditions.join(' OR ')})
     ORDER BY draft.updated_at DESC, draft.id DESC`,
    params,
    limit,
  )
  return rows.map((row) => {
    const status = ['CONFIRMED', 'EXPIRED', 'DELETED'].includes(row.status)
      && row.audio_status === 'READY'
      ? 'CLEANUP_PENDING'
      : row.status === 'FAILED'
        ? 'FAILED'
        : 'EXPIRED'
    return exceptionDto({
      id: row.id,
      source: 'AI',
      status,
      occurredAt: status === 'EXPIRED' ? row.expires_at : row.updated_at,
      target: null,
    })
  })
}

function limitedQuery(database, sql, params, rowLimit) {
  return database.query(
    rowLimit === null ? sql : `${sql} LIMIT ?`,
    rowLimit === null ? params : [...params, rowLimit],
  )
}

function exceptionDto(input) {
  const copy = SOURCE_COPY[input.source]?.[input.status]
  if (!copy) throw new Error('OPERATIONAL_EXCEPTION_MAPPING_INVALID')
  return {
    id: `${input.source}:${String(input.id)}`,
    source: input.source,
    status: input.status,
    title: copy[0],
    summary: copy[1],
    occurredAt: iso(input.occurredAt),
    reasonCode: input.reasonCode || null,
    target: input.target,
  }
}

function targetFor(type, id) {
  const targetType = typeof type === 'string' ? type.toUpperCase() : ''
  const targetId = typeof id === 'string' && uuid(id) ? id : ''
  if (!targetId) return null
  const routes = {
    EVENT: `/packages/admin/event-console/index?eventId=${encodeURIComponent(targetId)}`,
    ORDER: '/packages/admin/orders/index',
    REFUND: '/packages/admin/orders/index',
    PAYMENT: '/packages/admin/orders/index',
    OPPORTUNITY: '/packages/admin/opportunities/index',
    USER: '/packages/admin/profiles/index',
    GROWTH: '/packages/admin/growth-entries/index',
  }
  const route = routes[targetType]
  return route ? { type: targetType, id: targetId, route } : null
}

function compareExceptions(left, right) {
  const time = Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
  return time || right.id.localeCompare(left.id)
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString()
}

function uuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

module.exports = {
  EXCEPTION_STATUSES,
  EXCEPTION_TYPES,
  exceptionDto,
  listOperationalExceptions,
  targetFor,
}
