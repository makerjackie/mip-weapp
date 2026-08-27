'use strict'

const { createHash, randomUUID } = require('node:crypto')

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{12,128}$/
const OPERATION_PATTERN = /^[a-z][a-z0-9_.-]{2,79}$/

async function idempotentMutation(database, {
  caller,
  operation,
  idempotencyKey,
  request,
  createId = randomUUID,
  authorize,
  preflight,
  work,
} = {}) {
  if (!idempotencyKey) {
    if (typeof preflight === 'function') {
      if (typeof authorize === 'function') {
        await database.transaction(tx => authorize(tx))
      }
      await preflight()
    }
    return database.transaction(async (tx) => {
      const authorization = typeof authorize === 'function' ? await authorize(tx) : undefined
      return work(tx, authorization)
    })
  }
  const key = normalizeIdempotencyKey(idempotencyKey)
  if (!caller || typeof caller.appId !== 'string' || typeof caller.userId !== 'string'
    || !OPERATION_PATTERN.test(operation) || typeof createId !== 'function'
    || typeof work !== 'function') {
    throw new Error('VALIDATION_FAILED')
  }
  const hash = requestHash(request)
  const prior = await database.transaction(async (tx) => {
    if (typeof authorize === 'function') await authorize(tx)
    const stored = await readStored(tx, caller, operation, key)
    return stored
      ? { found: true, response: replayResult(stored, hash) }
      : { found: false, response: null }
  })
  if (prior.found) return prior.response
  if (typeof preflight === 'function') await preflight()
  try {
    return await database.transaction(async (tx) => {
      const authorization = typeof authorize === 'function' ? await authorize(tx) : undefined
      const existing = await readStored(tx, caller, operation, key)
      if (existing) return replayResult(existing, hash)

      const claimId = createId()
      await tx.query(
        `INSERT INTO mip_idempotency_keys (
           id, app_id, actor_user_id, operation, idempotency_key,
           request_hash, status, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING',
           DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
        [claimId, caller.appId, caller.userId, operation, key, hash],
      )

      const response = await work(tx, authorization)
      const completed = await tx.query(
        `UPDATE mip_idempotency_keys
         SET status = 'COMPLETED', response_json = ?
         WHERE app_id = ? AND id = ? AND request_hash = ? AND status = 'RUNNING'`,
        [JSON.stringify(response), caller.appId, claimId, hash],
      )
      if (Number(completed.affectedRows) !== 1) throw new Error('CONFLICT')
      return response
    })
  }
  catch (error) {
    if (!duplicateConstraint(error)) throw error
    return database.transaction(async (tx) => {
      if (typeof authorize === 'function') await authorize(tx)
      const stored = await readStored(tx, caller, operation, key)
      if (!stored) throw error
      return replayResult(stored, hash)
    })
  }
}

async function readStored(adapter, caller, operation, key) {
  return adapter.one(
    `SELECT request_hash, status, response_json
     FROM mip_idempotency_keys
     WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
     FOR UPDATE`,
    [caller.appId, caller.userId, operation, key],
  )
}

function duplicateConstraint(error) {
  return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062
}

function replayResult(stored, hash) {
  if (stored.request_hash !== hash) throw new Error('IDEMPOTENCY_CONFLICT')
  if (stored.status !== 'COMPLETED') throw new Error('CONFLICT')
  const response = parseResponse(stored.response_json)
  if (!response || typeof response !== 'object') throw new Error('CONFLICT')
  return response
}

function normalizeIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error('VALIDATION_FAILED')
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

module.exports = {
  IDEMPOTENCY_KEY_PATTERN,
  idempotentMutation,
  normalizeIdempotencyKey,
  requestHash,
}
