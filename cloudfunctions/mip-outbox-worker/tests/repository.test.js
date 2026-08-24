'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createOutboxRepository, retryDelayMs } = require('../domain/repository')

const now = new Date('2026-08-24T10:00:00.000Z')
const lease = new Date('2026-08-24T10:02:00.000Z')
const event = {
  id: '90000000-0000-4000-8000-000000000001',
  app_id: 'wx-app',
  aggregate_type: 'USER',
  aggregate_id: '10000000-0000-4000-8000-000000000001',
  event_type: 'identity.profile_completed',
  source_version: 1,
  status: 'PROCESSING',
  attempts: 1,
  available_at: now,
  lease_expires_at: lease,
}

describe('outbox repository', () => {
  it('leases eligible rows with MySQL 8 SKIP LOCKED and a compare-and-set lease key', async () => {
    const calls = []
    let select = 0
    const tx = {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('attempts >= ?')) return []
        if (sql.includes('SELECT id\n')) return [{ id: event.id }]
        if (sql.includes('SELECT id, app_id')) {
          select += 1
          return [{ ...event, lease_expires_at: lease }]
        }
        return { affectedRows: 1 }
      },
    }
    const repository = createOutboxRepository({ transaction: work => work(tx) })
    const result = await repository.leaseBatch('wx-app', { limit: 3, now })
    assert.equal(select, 1)
    assert.equal(result.events[0].leaseKey, lease.toISOString())
    assert.ok(calls.some(call => call.sql.includes('FOR UPDATE SKIP LOCKED')))
    assert.ok(calls.some(call => call.sql.includes("status = 'PROCESSING'")))
  })

  it('uses exponential retry backoff and preserves the leased compare-and-set guard', async () => {
    let update
    const repository = createOutboxRepository({
      async query(sql, params) {
        update = { sql, params }
        return { affectedRows: 1 }
      },
    })
    const result = await repository.retryEvent({ ...event, attempts: 2 }, 'INTERNAL_FUNCTION_FAILED', now)
    assert.equal(result.status, 'RETRY')
    assert.equal(result.nextAttemptAt, '2026-08-24T10:00:00.500Z')
    assert.match(update.sql, /status = 'FAILED'/)
    assert.equal(update.params.at(-1), lease)
    assert.equal(retryDelayMs(5), 4_000)
  })

  it('enqueues continuation events with a deterministic idempotent key', async () => {
    const calls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = createOutboxRepository(database)
    const payload = { knowledgeRecipientCursor: '20000000-0000-4000-8000-000000000500' }
    const first = await repository.enqueueContinuation(event, payload)
    const replay = await repository.enqueueContinuation(event, payload)
    assert.equal(first.eventId, replay.eventId)
    assert.match(first.eventId, /^[0-9a-f-]{36}$/)
    assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/)
    assert.equal(calls[0].params[6], JSON.stringify(payload))
  })

  it('moves the final failed attempt to CANCELLED and appends a system audit', async () => {
    const calls = []
    const tx = {
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = createOutboxRepository({ transaction: work => work(tx) })
    const result = await repository.retryEvent({ ...event, attempts: 5 }, 'FORBIDDEN', now)
    assert.equal(result.status, 'DEAD')
    assert.ok(calls.some(call => call.sql.includes("status = 'CANCELLED'")))
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO mip_audit_logs')))
  })

  it('audits unsupported event types without retrying them', async () => {
    const calls = []
    const tx = {
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = createOutboxRepository({ transaction: work => work(tx) })
    const result = await repository.ignoreEvent(event)
    assert.equal(result.status, 'IGNORED')
    const audit = calls.find(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(audit)
    assert.equal(audit.params[1], 'OUTBOX_EVENT_UNSUPPORTED')
  })

  it('reaps an expired exhausted lease so a crashed final attempt cannot remain PROCESSING', async () => {
    const calls = []
    const exhausted = { ...event, attempts: 5, last_error_code: 'INTERNAL_FUNCTION_FAILED' }
    const tx = {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('attempts >= ?')) return [exhausted]
        return { affectedRows: 1 }
      },
    }
    const repository = createOutboxRepository({ transaction: work => work(tx) })
    const result = await repository.leaseBatch('wx-app', { limit: 1, now })
    assert.deepEqual(result.events, [])
    assert.deepEqual(result.reaped, [{
      eventId: event.id,
      status: 'DEAD',
      errorCode: 'INTERNAL_FUNCTION_FAILED',
    }])
    assert.ok(calls.some(call => call.sql.includes("status = 'CANCELLED'")))
    assert.ok(calls.some(call => call.sql.includes('OUTBOX_EVENT')))
  })
})
