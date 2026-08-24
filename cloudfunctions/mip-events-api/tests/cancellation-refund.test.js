'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { cancelRegistration } = require('../domain/event-service')

const appId = 'wx-app'
const userId = '10000000-0000-4000-8000-000000000001'
const eventId = '20000000-0000-4000-8000-000000000001'
const registrationId = '30000000-0000-4000-8000-000000000001'
const orderId = '40000000-0000-4000-8000-000000000001'
const refundId = '50000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-25T00:00:00.000Z')

function cancellationDatabase({
  registrationStatus = 'REGISTERED',
  orderStatus = 'PAID',
  orderVersion = 2,
  existingRefund = null,
  reservedCents = 0,
  activeCheckin = null,
  affectedRows = () => 1,
} = {}) {
  const calls = []
  const tx = {
    async one(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'one', sql: normalized, params })
      if (normalized.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
      if (normalized.includes('FROM mip_events')) {
        return {
          id: eventId,
          access_type: 'PAID',
          starts_at: '2026-09-10T10:00:00.000Z',
          cancellation_deadline: '2026-09-09T10:00:00.000Z',
        }
      }
      if (normalized.includes('FROM mip_event_registrations')) {
        return {
          id: registrationId,
          app_id: appId,
          event_id: eventId,
          user_id: userId,
          order_id: orderId,
          status: registrationStatus,
          version: 3,
          order_status: orderStatus,
          amount_cents: 9900,
          order_version: orderVersion,
          seat_hold_id: null,
          seat_hold_status: null,
        }
      }
      if (normalized.includes('FROM mip_event_checkins')) return activeCheckin
      if (normalized.includes('idempotency_key = ?')) return existingRefund
      if (normalized.includes('ORDER BY created_at DESC')) return existingRefund
      if (normalized.includes('COALESCE(SUM(amount_cents)')) return { reserved_cents: reservedCents }
      return null
    },
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'query', sql: normalized, params })
      return { affectedRows: affectedRows(normalized) }
    },
  }
  return { calls, transaction: work => work(tx) }
}

describe('event cancellation refund transaction', () => {
  it('refunds only the unreserved remainder and atomically moves registration and order to pending', async () => {
    const db = cancellationDatabase({ orderStatus: 'PARTIALLY_REFUNDED', reservedCents: 2000 })
    const result = await cancelRegistration(db, {
      appId, userId, eventId, expectedVersion: 3, now, paymentAvailable: true,
    })
    assert.equal(result.status, 'CANCELLATION_PENDING')
    assert.equal(result.refundRequired, true)
    const refundInsert = db.calls.find(call => call.sql.includes('INSERT INTO mip_refunds'))
    assert.equal(refundInsert.params[6], 7900)
    assert.ok(db.calls.some(call => call.sql.includes("mip_orders SET status = 'REFUND_PENDING'")))
    assert.ok(db.calls.some(call => call.sql.includes("mip_event_registrations SET status = ?")))
  })

  it('replays CANCELLATION_PENDING with the existing provider intent without duplicate writes', async () => {
    const db = cancellationDatabase({
      registrationStatus: 'CANCELLATION_PENDING',
      orderStatus: 'REFUND_PENDING',
      existingRefund: { id: refundId, status: 'PROCESSING', version: 4 },
    })
    const result = await cancelRegistration(db, {
      appId, userId, eventId, expectedVersion: 2, now, paymentAvailable: true,
    })
    assert.equal(result.refundId, refundId)
    assert.equal(result.refundStatus, 'PROCESSING')
    assert.equal(db.calls.some(call => call.kind === 'query'), false)
  })

  it('retries a FAILED event refund with a fresh provider reference and the remaining amount', async () => {
    const db = cancellationDatabase({
      registrationStatus: 'CANCELLATION_PENDING',
      orderStatus: 'PARTIALLY_REFUNDED',
      orderVersion: 7,
      existingRefund: { id: refundId, status: 'FAILED', version: 5 },
      reservedCents: 2000,
    })
    const result = await cancelRegistration(db, {
      appId, userId, eventId, now, paymentAvailable: true,
    })
    assert.notEqual(result.refundId, refundId)
    assert.equal(result.refundStatus, 'PENDING')
    const refundRetry = db.calls.find(call => call.sql.includes('INSERT INTO mip_refunds'))
    assert.equal(refundRetry.params[6], 7900)
    assert.match(refundRetry.params[4], /^MIPR/)
    assert.match(refundRetry.params[5], new RegExp(refundId))
  })

  it('fails closed on an order race before creating or publishing a refund fact', async () => {
    const db = cancellationDatabase({
      registrationStatus: 'CANCELLATION_PENDING',
      orderStatus: 'PAID',
      affectedRows: sql => sql.includes("mip_orders SET status = 'REFUND_PENDING'") ? 0 : 1,
    })
    await assert.rejects(
      cancelRegistration(db, { appId, userId, eventId, now, paymentAvailable: true }),
      error => error?.code === 'CONFLICT',
    )
    assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO mip_refunds')), false)
    assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO mip_outbox_events')), false)
  })

  it('rejects cancellation while an active check-in is locked', async () => {
    const db = cancellationDatabase({ activeCheckin: { id: 'checkin-1', version: 1 } })
    await assert.rejects(
      cancelRegistration(db, { appId, userId, eventId, expectedVersion: 3, now }),
      error => error?.code === 'CONFLICT',
    )
    assert.equal(db.calls.some(call => call.kind === 'query'), false)
  })
})
