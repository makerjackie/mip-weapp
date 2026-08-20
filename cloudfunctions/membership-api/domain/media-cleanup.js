'use strict'

/**
 * Recoverable media object cleanup outbox.
 *
 * deleteMemberAccount writes PENDING rows in the same DB transaction as account wipe.
 * The current request may attempt deleteFile immediately, but only marks DONE after
 * every fileList item reports success. Owner/admin retryMediaCleanup and signed
 * maintenance share lease + version + exponential backoff.
 *
 * Terminal FAILED (attempts >= MAX_ATTEMPTS) is not reclaimed by default claim/batch.
 * Operators requeue explicitly via requeueTerminalCleanup before further processing.
 */

const { createHash, randomUUID } = require('node:crypto')

const OUTBOX_STATUSES = Object.freeze(['PENDING', 'LEASED', 'DONE', 'FAILED'])
const DEFAULT_LEASE_MS = 30_000
const MAX_ATTEMPTS = 12
const BASE_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000

function requirePositiveVersion(value) {
  if (value === null || value === undefined || value === '') {
    throw new Error('DATA_INTEGRITY')
  }
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('DATA_INTEGRITY')
  }
  return version
}

function backoffMs(attempts) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** Math.max(0, attempts - 1)))
  return Math.min(MAX_BACKOFF_MS, exp)
}

function nextRetryAt(attempts, now = new Date()) {
  return new Date(now.getTime() + backoffMs(attempts))
}

/**
 * Parse deleteFile response into per-fileID success map.
 * CloudBase returns { fileList: [{ fileID, status, errMsg }] } or similar.
 * Success only for explicit success codes. Missing status → not successful.
 */
function resolveDeleteFileResults(response, expectedFileIds) {
  const expected = Array.isArray(expectedFileIds) ? expectedFileIds : []
  const byId = new Map()
  const list = response?.fileList || response?.file_list || []
  if (Array.isArray(list)) {
    for (const item of list) {
      const fileId = item?.fileID || item?.fileId || item?.file_id
      if (!fileId) {
        continue
      }
      const status = item?.status
      const errMsg = String(item?.errMsg || item?.errmsg || '')
      // Only official explicit success codes count. Missing status is failure.
      const ok = status === 0
        || status === '0'
        || status === 'ok'
        || status === 'SUCCESS'
      byId.set(String(fileId), { ok: Boolean(ok), status, errMsg })
    }
  }
  return expected.map((fileId) => {
    const entry = byId.get(String(fileId))
    if (!entry) {
      // No per-item row → treat as unresolved failure (do not mark DONE).
      return { fileId, ok: false, reason: 'MISSING_ITEM_STATUS' }
    }
    if (!entry.ok) {
      const reason = entry.status === undefined || entry.status === null
        ? (entry.errMsg || 'MISSING_ITEM_STATUS')
        : (entry.errMsg || 'DELETE_FAILED')
      return { fileId, ok: false, reason }
    }
    return { fileId, ok: true, reason: null }
  })
}

async function insertCleanupOutbox(tx, {
  appId,
  userId,
  mediaAssetId,
  cloudFileId,
  now = new Date(),
}) {
  const id = randomUUID()
  // Duplicate (app_id, media_asset_id) is pure idempotent: never reset
  // PENDING/LEASED/FAILED/DONE, and never touch lease/version/attempts.
  // FAILED → PENDING only via explicit requeueTerminalCleanup (+ audit at API).
  await tx.query(
    `INSERT INTO member_media_cleanup_outbox (
       id, app_id, user_id, media_asset_id, cloud_file_id,
       status, attempts, next_retry_at, version, last_error
     ) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, UTC_TIMESTAMP(3), 1, NULL)
     ON DUPLICATE KEY UPDATE
       media_asset_id = media_asset_id`,
    [id, appId, userId, mediaAssetId, cloudFileId],
  )
  const row = await tx.one(
    `SELECT id, app_id, user_id, media_asset_id, cloud_file_id, status, attempts, version
     FROM member_media_cleanup_outbox
     WHERE app_id = ? AND media_asset_id = ?`,
    [appId, mediaAssetId],
  )
  return row || {
    id,
    app_id: appId,
    user_id: userId,
    media_asset_id: mediaAssetId,
    cloud_file_id: cloudFileId,
    status: 'PENDING',
    attempts: 0,
    version: 1,
  }
}

/**
 * Claim a lease on due PENDING rows or expired LEASED rows.
 * Terminal FAILED is never claimed here; operators must requeue first.
 * Uses optimistic version bump so concurrent workers do not double-delete.
 */
async function claimCleanupLease(tx, {
  appId,
  outboxId,
  leaseOwner,
  expectedVersion,
  leaseMs = DEFAULT_LEASE_MS,
  now = new Date(),
}) {
  const version = requirePositiveVersion(expectedVersion)
  const leaseUntil = new Date(now.getTime() + leaseMs)
  const result = await tx.query(
    `UPDATE member_media_cleanup_outbox
     SET status = 'LEASED',
         lease_owner = ?,
         lease_until = ?,
         attempts = attempts + 1,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
     WHERE id = ?
       AND app_id = ?
       AND version = ?
       AND status IN ('PENDING', 'LEASED')
       AND (
         status = 'PENDING'
         OR lease_until IS NULL
         OR lease_until < UTC_TIMESTAMP(3)
       )
       AND next_retry_at <= UTC_TIMESTAMP(3)`,
    [leaseOwner, leaseUntil, outboxId, appId, version],
  )
  if (!result || result.affectedRows !== 1) {
    return null
  }
  return tx.one(
    `SELECT * FROM member_media_cleanup_outbox WHERE id = ? AND app_id = ?`,
    [outboxId, appId],
  )
}

async function markCleanupDone(tx, { appId, outboxId, expectedVersion }) {
  const version = requirePositiveVersion(expectedVersion)
  const result = await tx.query(
    `UPDATE member_media_cleanup_outbox
     SET status = 'DONE',
         lease_owner = NULL,
         lease_until = NULL,
         last_error = NULL,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND app_id = ? AND version = ? AND status = 'LEASED'`,
    [outboxId, appId, version],
  )
  return Boolean(result && result.affectedRows === 1)
}

async function markCleanupRetry(tx, {
  appId,
  outboxId,
  expectedVersion,
  lastError,
  now = new Date(),
}) {
  const version = requirePositiveVersion(expectedVersion)
  const row = await tx.one(
    `SELECT attempts FROM member_media_cleanup_outbox
     WHERE id = ? AND app_id = ?`,
    [outboxId, appId],
  )
  const attempts = Number(row?.attempts || 1)
  const terminal = attempts >= MAX_ATTEMPTS
  const status = terminal ? 'FAILED' : 'PENDING'
  const retryAt = nextRetryAt(attempts, now)
  const result = await tx.query(
    `UPDATE member_media_cleanup_outbox
     SET status = ?,
         lease_owner = NULL,
         lease_until = NULL,
         next_retry_at = ?,
         last_error = ?,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND app_id = ? AND version = ? AND status = 'LEASED'`,
    [
      status,
      retryAt,
      String(lastError || 'DELETE_FAILED').slice(0, 500),
      outboxId,
      appId,
      version,
    ],
  )
  return {
    ok: Boolean(result && result.affectedRows === 1),
    status,
    attempts,
    nextRetryAt: retryAt,
  }
}

/**
 * Explicit operator requeue of a terminal FAILED outbox row.
 * Resets attempts to a fresh budget and returns the row to PENDING.
 * Version-guarded; only status=FAILED is eligible.
 */
async function requeueTerminalCleanup(tx, {
  appId,
  outboxId,
  expectedVersion,
  actorId,
  reason,
  now = new Date(),
}) {
  const version = requirePositiveVersion(expectedVersion)
  const result = await tx.query(
    `UPDATE member_media_cleanup_outbox
     SET status = 'PENDING',
         attempts = 0,
         lease_owner = NULL,
         lease_until = NULL,
         next_retry_at = ?,
         last_error = NULL,
         version = version + 1,
         updated_at = UTC_TIMESTAMP(3)
     WHERE id = ?
       AND app_id = ?
       AND version = ?
       AND status = 'FAILED'`,
    [now, outboxId, appId, version],
  )
  return {
    ok: Boolean(result && result.affectedRows === 1),
    outboxId,
    appId,
    actorId: actorId || null,
    reason: reason ? String(reason).slice(0, 500) : null,
  }
}

/**
 * Attempt cloud delete for one outbox row. Checks per-item status before DONE.
 */
async function processCleanupItem(db, cloud, item, {
  leaseOwner = 'worker',
  now = new Date(),
} = {}) {
  const claimed = await db.transaction(async (tx) => {
    const current = await tx.one(
      `SELECT * FROM member_media_cleanup_outbox
       WHERE id = ? AND app_id = ?
       FOR UPDATE`,
      [item.id || item.outboxId, item.app_id || item.appId],
    )
    // DONE is finished; terminal FAILED requires explicit requeue before claim.
    if (!current || current.status === 'DONE' || current.status === 'FAILED') {
      return null
    }
    return claimCleanupLease(tx, {
      appId: current.app_id,
      outboxId: current.id,
      leaseOwner,
      expectedVersion: current.version,
      now,
    })
  })
  if (!claimed) {
    return { status: 'SKIPPED' }
  }

  const fileId = claimed.cloud_file_id
  let response
  let transportError = null
  try {
    response = await cloud.deleteFile({ fileList: [fileId] })
  }
  catch (error) {
    transportError = String(error?.message || error || 'DELETE_TRANSPORT_ERROR').slice(0, 500)
  }

  const resolved = transportError
    ? [{ fileId, ok: false, reason: transportError }]
    : resolveDeleteFileResults(response, [fileId])
  const itemResult = resolved[0]

  if (itemResult?.ok) {
    const done = await db.transaction(async (tx) => markCleanupDone(tx, {
      appId: claimed.app_id,
      outboxId: claimed.id,
      expectedVersion: claimed.version,
    }))
    return { status: done ? 'DONE' : 'LEASE_LOST', fileId }
  }

  const retry = await db.transaction(async (tx) => markCleanupRetry(tx, {
    appId: claimed.app_id,
    outboxId: claimed.id,
    expectedVersion: claimed.version,
    lastError: itemResult?.reason || transportError || 'DELETE_FAILED',
    now,
  }))
  return {
    status: retry.status || 'PENDING',
    fileId,
    reason: itemResult?.reason || transportError,
    attempts: retry.attempts,
  }
}

/**
 * Process up to `limit` due outbox rows for an app (or one user).
 * Selects PENDING and expired LEASED only — never terminal FAILED.
 */
async function processDueCleanup(db, cloud, {
  appId,
  userId = null,
  limit = 20,
  leaseOwner = null,
  now = new Date(),
} = {}) {
  const owner = leaseOwner || `cleanup:${createHash('sha256').update(`${appId}:${Date.now()}`).digest('hex').slice(0, 12)}`
  const rows = await db.query(
    `SELECT id, app_id, user_id, media_asset_id, cloud_file_id, status, attempts, version
     FROM member_media_cleanup_outbox
     WHERE app_id = ?
       AND status IN ('PENDING', 'LEASED')
       AND next_retry_at <= UTC_TIMESTAMP(3)
       AND (
         status = 'PENDING'
         OR lease_until IS NULL
         OR lease_until < UTC_TIMESTAMP(3)
       )
       ${userId ? 'AND user_id = ?' : ''}
     ORDER BY next_retry_at ASC
     LIMIT ${Math.min(50, Math.max(1, Number(limit) || 20))}`,
    userId ? [appId, userId] : [appId],
  )
  const results = []
  for (const row of rows || []) {
    // eslint-disable-next-line no-await-in-loop
    const result = await processCleanupItem(db, cloud, row, { leaseOwner: owner, now })
    results.push({ outboxId: row.id, ...result })
  }
  return { processed: results.length, results, leaseOwner: owner }
}

module.exports = {
  BASE_BACKOFF_MS,
  DEFAULT_LEASE_MS,
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  OUTBOX_STATUSES,
  backoffMs,
  claimCleanupLease,
  insertCleanupOutbox,
  markCleanupDone,
  markCleanupRetry,
  nextRetryAt,
  processCleanupItem,
  processDueCleanup,
  requeueTerminalCleanup,
  resolveDeleteFileResults,
}
