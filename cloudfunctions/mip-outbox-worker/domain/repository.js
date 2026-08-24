'use strict'

function createOutboxRepository(database, options = {}) {
  const leaseMilliseconds = options.leaseMilliseconds || 2 * 60 * 1000
  const maxAttempts = options.maxAttempts || 5

  async function leaseBatch(appId, input = {}) {
    const now = input.now || new Date()
    const batchSize = Math.min(10, Math.max(1, Number(input.limit) || 5))
    return database.transaction(async (tx) => {
      const exhausted = await tx.query(
        `SELECT id, app_id, aggregate_type, aggregate_id, event_type, source_version,
                status, attempts, available_at, lease_expires_at
         FROM mip_outbox_events
         WHERE app_id = ? AND attempts >= ?
           AND ((status = 'FAILED' AND available_at <= ?)
             OR (status = 'PROCESSING' AND lease_expires_at < ?))
         ORDER BY available_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, maxAttempts, now, now, batchSize],
      )
      for (const event of exhausted) {
        await tx.query(
          `UPDATE mip_outbox_events
           SET status = 'CANCELLED', lease_expires_at = NULL,
               last_error_code = COALESCE(last_error_code, 'OUTBOX_ATTEMPTS_EXHAUSTED')
           WHERE app_id = ? AND id = ? AND status IN ('FAILED', 'PROCESSING')`,
          [appId, event.id],
        )
        await writeAudit(tx, event, 'OUTBOX_EVENT_DEAD', 'OUTBOX_ATTEMPTS_EXHAUSTED')
      }

      const remaining = batchSize - exhausted.length
      if (remaining <= 0) {
        return { events: [], reaped: exhausted.map(deadResult) }
      }
      const rows = await tx.query(
        `SELECT id
         FROM mip_outbox_events
         WHERE app_id = ? AND attempts < ? AND available_at <= ?
           AND (status IN ('PENDING', 'FAILED')
             OR (status = 'PROCESSING' AND lease_expires_at < ?))
         ORDER BY available_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, maxAttempts, now, now, remaining],
      )
      if (!rows.length) return { events: [], reaped: exhausted.map(deadResult) }
      const ids = rows.map(row => row.id)
      const placeholders = ids.map(() => '?').join(', ')
      const leaseExpiresAt = new Date(now.getTime() + leaseMilliseconds)
      await tx.query(
        `UPDATE mip_outbox_events
         SET status = 'PROCESSING', attempts = attempts + 1,
             lease_expires_at = ?, last_error_code = NULL
         WHERE app_id = ? AND id IN (${placeholders})`,
        [leaseExpiresAt, appId, ...ids],
      )
      const events = await tx.query(
        `SELECT id, app_id, aggregate_type, aggregate_id, event_type, source_version,
                status, attempts, available_at, lease_expires_at
         FROM mip_outbox_events
         WHERE app_id = ? AND id IN (${placeholders})
         ORDER BY available_at, id`,
        [appId, ...ids],
      )
      return {
        events: events.map(event => ({
          ...event,
          leaseKey: iso(event.lease_expires_at),
        })),
        reaped: exhausted.map(deadResult),
      }
    })
  }

  async function completeEvent(event) {
    const result = await database.query(
      `UPDATE mip_outbox_events
       SET status = 'DELIVERED', delivered_at = UTC_TIMESTAMP(3),
           lease_expires_at = NULL, last_error_code = NULL
       WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
      [event.app_id, event.id, event.lease_expires_at],
    )
    assertLease(result)
    return { eventId: event.id, status: 'DELIVERED' }
  }

  async function retryEvent(event, errorCode, now = new Date()) {
    if (Number(event.attempts) >= maxAttempts) {
      return cancelEvent(event, errorCode, 'OUTBOX_EVENT_DEAD')
    }
    const availableAt = new Date(now.getTime() + retryDelayMs(Number(event.attempts)))
    const result = await database.query(
      `UPDATE mip_outbox_events
       SET status = 'FAILED', available_at = ?, lease_expires_at = NULL, last_error_code = ?
       WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
      [availableAt, safeErrorCode(errorCode), event.app_id, event.id, event.lease_expires_at],
    )
    assertLease(result)
    return {
      eventId: event.id,
      status: 'RETRY',
      errorCode: safeErrorCode(errorCode),
      nextAttemptAt: iso(availableAt),
    }
  }

  async function ignoreEvent(event) {
    return cancelEvent(event, 'EVENT_TYPE_UNSUPPORTED', 'OUTBOX_EVENT_UNSUPPORTED', 'IGNORED')
  }

  async function deadEvent(event, errorCode) {
    return cancelEvent(event, errorCode, 'OUTBOX_EVENT_DEAD')
  }

  async function cancelEvent(event, errorCode, auditAction, resultStatus = 'DEAD') {
    return database.transaction(async (tx) => {
      const result = await tx.query(
        `UPDATE mip_outbox_events
         SET status = 'CANCELLED', lease_expires_at = NULL, last_error_code = ?
         WHERE app_id = ? AND id = ? AND status = 'PROCESSING' AND lease_expires_at = ?`,
        [safeErrorCode(errorCode), event.app_id, event.id, event.lease_expires_at],
      )
      assertLease(result)
      await writeAudit(tx, event, auditAction, safeErrorCode(errorCode))
      return {
        eventId: event.id,
        status: resultStatus,
        errorCode: safeErrorCode(errorCode),
      }
    })
  }

  return {
    completeEvent,
    deadEvent,
    ignoreEvent,
    leaseBatch,
    retryEvent,
  }
}

async function writeAudit(tx, event, action, reason) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
       app_id, actor_type, scope_type, action, resource_type, resource_id, metadata_json
     ) VALUES (?, 'SYSTEM', 'RESOURCE', ?, 'OUTBOX_EVENT', ?, ?)`,
    [
      event.app_id,
      action,
      event.id,
      JSON.stringify({
        aggregateType: event.aggregate_type,
        aggregateId: event.aggregate_id,
        eventType: event.event_type,
        attempts: Number(event.attempts || 0),
        reason,
      }),
    ],
  )
}

function deadResult(event) {
  return {
    eventId: event.id,
    status: 'DEAD',
    errorCode: event.last_error_code || 'OUTBOX_ATTEMPTS_EXHAUSTED',
  }
}

function retryDelayMs(attempts) {
  return Math.min(4_000, Math.max(250, 2 ** Math.max(0, attempts - 1) * 250))
}

function safeErrorCode(value) {
  const code = String(value || '')
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'OUTBOX_DELIVERY_FAILED'
}

function assertLease(result) {
  if (Number(result?.affectedRows) !== 1) throw new Error('OUTBOX_LEASE_LOST')
}

function iso(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

module.exports = {
  createOutboxRepository,
  retryDelayMs,
  safeErrorCode,
}
