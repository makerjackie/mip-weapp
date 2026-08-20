'use strict'

const { randomUUID } = require('node:crypto')

const TEMPLATE_KEYS = new Set([
  'registration',
  'event_update',
  'event_reminder',
  'event_cancel',
  'refund',
])
const RESULT_STATUSES = new Set(['ACCEPTED', 'REJECTED', 'BANNED', 'FILTERED'])

function parseTemplateIds(raw = process.env.MEMBERSHIP_SUBSCRIBE_TEMPLATES_JSON || '') {
  if (!raw || !String(raw).trim()) {
    return {}
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    throw new Error('SUBSCRIBE_TEMPLATE_CONFIG_INVALID')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SUBSCRIBE_TEMPLATE_CONFIG_INVALID')
  }
  const result = {}
  for (const key of TEMPLATE_KEYS) {
    const entry = parsed[key]
    if (entry === undefined) continue
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.templateId !== 'string' || !entry.templateId.trim()) {
      throw new Error('SUBSCRIBE_TEMPLATE_CONFIG_INVALID')
    }
    result[key] = entry.templateId.trim()
  }
  return result
}

function normalizeResults(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    throw new Error('SUBSCRIPTION_RESULTS_INVALID')
  }
  const seen = new Set()
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !TEMPLATE_KEYS.has(item.templateKey)
      || !RESULT_STATUSES.has(item.status)
      || seen.has(item.templateKey)) {
      throw new Error('SUBSCRIPTION_RESULTS_INVALID')
    }
    seen.add(item.templateKey)
    return {
      templateKey: item.templateKey,
      status: item.status,
    }
  })
}

async function recordSubscriptions(database, input) {
  const config = parseTemplateIds()
  const results = normalizeResults(input.results)
  const registration = await database.one(
    `SELECT id FROM member_registrations
     WHERE app_id = ? AND user_id = ? AND event_id = ?
       AND status IN ('PENDING_REVIEW', 'WAITLISTED', 'REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED')
     LIMIT 1`,
    [input.appId, input.userId, input.eventId],
  )
  if (!registration) {
    throw new Error('REGISTRATION_NOT_FOUND')
  }
  let saved = 0
  for (const item of results) {
    const templateId = config[item.templateKey]
    if (!templateId) {
      continue
    }
    await database.query(
      `INSERT INTO member_notification_subscriptions (
         id, app_id, user_id, event_id, template_key, template_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.appId,
        input.userId,
        item.templateKey === 'refund' ? null : input.eventId,
        item.templateKey,
        templateId,
        item.status,
      ],
    )
    saved += 1
  }
  return {
    configured: Object.keys(config).length,
    saved,
    accepted: results.filter(item => item.status === 'ACCEPTED' && config[item.templateKey]).length,
  }
}

function publicNotification(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    pagePath: row.page_path,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

async function listNotifications(database, input) {
  const requestedLimit = Number(input.limit || 30)
  const limit = Math.min(
    Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 30, 1),
    50,
  )
  const rows = await database.query(
    `SELECT id, kind, title, summary, page_path, status, created_at
     FROM member_notifications
     WHERE app_id = ? AND user_id = ? AND status <> 'DISMISSED'
     ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
    [input.appId, input.userId],
  )
  return rows.map(publicNotification)
}

async function markNotificationsRead(database, input) {
  const ids = Array.isArray(input.ids)
    ? [...new Set(input.ids.filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 50)
    : []
  if (input.all === true) {
    const result = await database.query(
      `UPDATE member_notifications
       SET status = 'READ', read_at = COALESCE(read_at, UTC_TIMESTAMP(3))
       WHERE app_id = ? AND user_id = ? AND status = 'UNREAD'`,
      [input.appId, input.userId],
    )
    return { updated: Number(result?.affectedRows || 0) }
  }
  if (!ids.length) {
    throw new Error('NOTIFICATION_IDS_REQUIRED')
  }
  const result = await database.query(
    `UPDATE member_notifications
     SET status = 'READ', read_at = COALESCE(read_at, UTC_TIMESTAMP(3))
     WHERE app_id = ? AND user_id = ? AND status = 'UNREAD'
       AND id IN (${ids.map(() => '?').join(', ')})`,
    [input.appId, input.userId, ...ids],
  )
  return { updated: Number(result?.affectedRows || 0) }
}

module.exports = {
  listNotifications,
  markNotificationsRead,
  normalizeResults,
  parseTemplateIds,
  recordSubscriptions,
}
