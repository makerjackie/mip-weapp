'use strict'

const { createHash } = require('node:crypto')

function requestHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function duplicate(error) {
  return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062
}

function conflict() {
  const error = new Error('CONFLICT')
  error.code = 'CONFLICT'
  return error
}

async function claimOptional(tx, caller, idempotencyKey, operation, request, createId) {
  if (!idempotencyKey) return { requestHash: null, replay: null }
  const hash = requestHash(request)
  try {
    await tx.query(
      `INSERT INTO mip_idempotency_keys (
         id, app_id, actor_user_id, operation, idempotency_key,
         request_hash, status, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [createId(), caller.appId, caller.userId, operation, idempotencyKey, hash],
    )
  }
  catch (error) {
    if (!duplicate(error)) throw error
    const stored = await tx.one(
      `SELECT request_hash, status, response_json
       FROM mip_idempotency_keys
       WHERE app_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ?
       FOR UPDATE`,
      [caller.appId, caller.userId, operation, idempotencyKey],
    )
    if (!stored || stored.request_hash !== hash || stored.status !== 'COMPLETED') throw conflict()
    let response
    try { response = JSON.parse(stored.response_json) }
    catch { throw conflict() }
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw conflict()
    return { requestHash: hash, replay: { ...response, idempotent: true } }
  }
  return { requestHash: hash, replay: null }
}

async function complete(tx, caller, idempotencyKey, operation, hash, response) {
  if (!idempotencyKey) return
  const result = await tx.query(
    `UPDATE mip_idempotency_keys SET status = 'COMPLETED', response_json = ?
     WHERE app_id = ? AND actor_user_id = ? AND operation = ?
       AND idempotency_key = ? AND request_hash = ? AND status = 'RUNNING'`,
    [JSON.stringify(response), caller.appId, caller.userId, operation, idempotencyKey, hash],
  )
  if (Number(result.affectedRows) !== 1) throw conflict()
}

module.exports = { claimOptional, complete }
