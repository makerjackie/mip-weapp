'use strict'

const { createHash } = require('node:crypto')

function requestHash(request) {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}

function duplicateConstraint(error) {
  return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062
}

function conflictError() {
  const error = new Error('CONFLICT')
  error.code = 'CONFLICT'
  return error
}

function parseResponse(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(value) }
  catch { return null }
}

async function readStored(tx, input, operation) {
  return tx.one(
    `SELECT request_hash, status, response_json
     FROM mip_idempotency_keys
     WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
     FOR UPDATE`,
    [input.appId, input.actorUserId, operation, input.idempotencyKey],
  )
}

function replayOrConflict(stored, hash) {
  if (!stored || stored.request_hash !== hash || stored.status !== 'COMPLETED') {
    throw conflictError()
  }
  const response = parseResponse(stored.response_json)
  if (!response || typeof response !== 'object') throw conflictError()
  return { ...response, idempotent: true }
}

/**
 * Claims an optional request key inside the caller's mutation transaction.
 * The mini-program may omit the key; Web callers use it to safely retry writes.
 */
async function claimOptional(tx, input, operation, request, createId) {
  if (!input.idempotencyKey) return { requestHash: null, replay: null }
  const hash = requestHash(request)
  try {
    await tx.query(
      `INSERT INTO mip_idempotency_keys (
        id, app_id, actor_user_id, operation, idempotency_key,
        request_hash, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [createId(), input.appId, input.actorUserId, operation, input.idempotencyKey, hash],
    )
  }
  catch (error) {
    if (!duplicateConstraint(error)) throw error
    return { requestHash: hash, replay: replayOrConflict(await readStored(tx, input, operation), hash) }
  }
  return { requestHash: hash, replay: null }
}

async function complete(tx, input, operation, requestHash, response) {
  if (!input.idempotencyKey) return
  const result = await tx.query(
    `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
     WHERE app_id = ? AND actor_user_id = ? AND operation = ?
       AND idempotency_key = ? AND request_hash = ? AND status = 'RUNNING'`,
    [JSON.stringify(response), input.appId, input.actorUserId, operation,
      input.idempotencyKey, requestHash],
  )
  if (Number(result.affectedRows) !== 1) throw conflictError()
}

module.exports = { claimOptional, complete, requestHash }
