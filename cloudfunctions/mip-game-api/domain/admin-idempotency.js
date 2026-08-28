'use strict'

const { createHash, randomUUID } = require('node:crypto')

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{12,128}$/
const OPERATION_PATTERN = /^mip\.admin\.game\.[A-Za-z0-9.]{1,64}$/

async function gameAdminMutation(database, {
  caller,
  operation,
  idempotencyKey,
  request,
  createId = randomUUID,
  authorize,
  work,
} = {}) {
  if (!idempotencyKey) {
    return database.transaction(async (tx) => {
      const authorization = await authorize(tx)
      return work(tx, authorization)
    })
  }
  const key = normalizeIdempotencyKey(idempotencyKey)
  if (!database || typeof database.transaction !== 'function'
    || !caller || typeof caller.appId !== 'string' || typeof caller.userId !== 'string'
    || !OPERATION_PATTERN.test(operation) || typeof createId !== 'function'
    || typeof authorize !== 'function' || typeof work !== 'function') {
    throw codedError('VALIDATION_FAILED')
  }
  const hash = requestHash(request)

  try {
    return await database.transaction(async (tx) => {
      const authorization = await authorize(tx)
      const claimId = createId()
      await tx.query(
        `INSERT INTO mip_idempotency_keys (
           id, app_id, actor_user_id, operation, idempotency_key,
           request_hash, status, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING',
           DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
        [claimId, caller.appId, caller.userId, operation, key, hash],
      )

      const response = durableResponse(await work(tx, authorization), false)
      const completed = await tx.query(
        `UPDATE mip_idempotency_keys
         SET status = 'COMPLETED', response_json = ?
         WHERE app_id = ? AND id = ? AND request_hash = ? AND status = 'RUNNING'`,
        [JSON.stringify(response), caller.appId, claimId, hash],
      )
      if (Number(completed.affectedRows) !== 1) throw codedError('CONFLICT')
      return response
    })
  }
  catch (error) {
    if (!duplicateConstraint(error)) throw error
    return database.transaction(async (tx) => {
      await authorize(tx)
      const stored = await tx.one(
        `SELECT request_hash, status, response_json
         FROM mip_idempotency_keys
         WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
         FOR UPDATE`,
        [caller.appId, caller.userId, operation, key],
      )
      if (!stored) throw error
      return replayResult(stored, hash)
    })
  }
}

function replayResult(stored, hash) {
  if (!stored || stored.request_hash !== hash) throw codedError('IDEMPOTENCY_CONFLICT')
  if (stored.status !== 'COMPLETED') throw codedError('CONFLICT')
  const response = parseResponse(stored.response_json)
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw codedError('CONFLICT')
  }
  return { ...response, idempotent: true }
}

function durableResponse(value, idempotent) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError('CONFLICT')
  return { ...value, idempotent }
}

function normalizeIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw codedError('VALIDATION_FAILED')
  return key
}

function requestHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex')
}

function canonicalValue(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : canonicalValue(item))
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = canonicalValue(value[key])
  }
  return result
}

function parseResponse(value) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(value) }
  catch { return null }
}

function duplicateConstraint(error) {
  return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = {
  IDEMPOTENCY_KEY_PATTERN,
  gameAdminMutation,
  normalizeIdempotencyKey,
  requestHash,
}
