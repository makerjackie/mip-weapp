'use strict'

const { createHash, randomUUID } = require('node:crypto')

const ROLE_KEYS = new Set([
  'connector',
  'business_builder',
  'capital_operator',
  'strategist',
  'visual_designer',
  'delivery_lead',
])
const ABILITY_KEYS = new Set([
  'business_development',
  'resource_integration',
  'capital_operation',
  'strategy_planning',
  'visual_design',
  'delivery_management',
])

function iso(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function uuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function stringValue(value, maximum, code, required = true) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) {
    throw new Error(code)
  }
  return result
}

function stringList(value, maximum, code, predicate = () => true) {
  const result = Array.isArray(value)
    ? [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
    : []
  if (result.length > maximum || !result.every(item => item.length <= 64 && predicate(item))) {
    throw new Error(code)
  }
  return result
}

function mutualBlockFilter(viewerUserId, subjectSql, appSql) {
  if (!viewerUserId) return { sql: '', params: [] }
  return {
    sql: `NOT EXISTS (
      SELECT 1 FROM mip_user_blocks visibility_block
      WHERE visibility_block.app_id = ${appSql} AND visibility_block.status = 'ACTIVE'
        AND (
          (visibility_block.blocker_user_id = ? AND visibility_block.blocked_user_id = ${subjectSql})
          OR
          (visibility_block.blocker_user_id = ${subjectSql} AND visibility_block.blocked_user_id = ?)
        )
    )`,
    params: [viewerUserId, viewerUserId],
  }
}

function jsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    }
    catch {
      return {}
    }
  }
  return {}
}

function encodeCursor(timestamp, id) {
  return Buffer.from(JSON.stringify({ timestamp: iso(timestamp), id }), 'utf8').toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!uuid(parsed.id) || !iso(parsed.timestamp)) throw new Error('INVALID')
    return { timestamp: iso(parsed.timestamp), id: parsed.id }
  }
  catch {
    throw new Error('VALIDATION_FAILED')
  }
}

function requestHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function normalizeIdempotencyKey(value) {
  const result = stringValue(value, 128, 'VALIDATION_FAILED')
  if (result.length < 12) throw new Error('VALIDATION_FAILED')
  return result
}

async function idempotentTransaction(database, input, work) {
  const key = normalizeIdempotencyKey(input.idempotencyKey)
  const hash = requestHash(input.request)
  return database.transaction(async (tx) => {
    const stored = await tx.one(
      `SELECT request_hash, status, response_json
       FROM mip_idempotency_keys
       WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
       FOR UPDATE`,
      [input.appId, input.userId, input.operation, key],
    )
    if (stored) {
      if (stored.request_hash !== hash) throw new Error('CONFLICT')
      if (stored.status === 'COMPLETED') return jsonObject(stored.response_json)
      throw new Error('CONFLICT')
    }
    await tx.query(
      `INSERT INTO mip_idempotency_keys (
         id, app_id, actor_user_id, operation, idempotency_key,
         request_hash, status, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [randomUUID(), input.appId, input.userId, input.operation, key, hash],
    )
    const response = await work(tx)
    await tx.query(
      `UPDATE mip_idempotency_keys
       SET status = 'COMPLETED', response_json = ?
       WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?`,
      [JSON.stringify(response), input.appId, input.userId, input.operation, key],
    )
    return response
  })
}

async function appendAudit(tx, input) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
       app_id, actor_user_id, actor_type, scope_type, scope_id, action,
       resource_type, resource_id, effective_role, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.appId,
      input.actorUserId || null,
      input.actorType || 'USER',
      input.scopeType || 'RESOURCE',
      input.scopeId || null,
      input.action,
      input.resourceType,
      input.resourceId || null,
      input.effectiveRole || null,
      JSON.stringify(input.metadata || {}),
    ],
  )
}

async function appendOutbox(tx, input) {
  await tx.query(
    `INSERT INTO mip_outbox_events (
       id, app_id, aggregate_type, aggregate_id, event_type,
       source_version, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.appId,
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      input.sourceVersion,
      JSON.stringify(input.payload || {}),
    ],
  )
}

module.exports = {
  ABILITY_KEYS,
  ROLE_KEYS,
  appendAudit,
  appendOutbox,
  decodeCursor,
  encodeCursor,
  idempotentTransaction,
  iso,
  jsonObject,
  mutualBlockFilter,
  stringList,
  stringValue,
  uuid,
}
