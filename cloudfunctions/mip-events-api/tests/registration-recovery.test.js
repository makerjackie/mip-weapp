'use strict'

const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createRegistration, cancelRegistration, updateRegistration } = require('../domain/event-service')
const { DomainError } = require('../domain/rules')
const now = new Date('2026-09-05T00:00:00Z')
const policy = { requireAccess: async () => ({}) }
const input = { eventId: 'event', formVersion: 1, expectedVersion: 1, answers: {}, idempotencyKey: 'retry' }

function fixture(options = {}) {
  const calls = []
  let candidateIndex = 0
  let hash
  const event = {
    id: 'event', status: 'PUBLISHED', access_type: 'PAID', registration_policy: 'AUTO',
    starts_at: '2026-09-10T00:00:00Z', registration_deadline: '2026-09-09T00:00:00Z',
    cancellation_deadline: '2026-09-09T00:00:00Z', form_version: 1, registration_schema_json: '[]',
    capacity: 10, ...options.event,
  }
  const registration = {
    id: 'registration', status: 'PAYMENT_PENDING', version: 1, order_id: 'original-order',
    order_status: 'PAYMENT_CREATED', amount_cents: 9900, currency: 'CNY',
    hold_id: 'original-hold', hold_status: 'ACTIVE', hold_expires_at: '2026-09-04T00:00:00Z',
    ...options.registration,
  }
  const tx = {
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_users')) return { id: params[1], status: options.disabled === params[1] ? 'DISABLED' : 'ACTIVE' }
      if (sql.includes('FROM mip_idempotency_keys')) return { request_hash: hash, status: 'COMPLETED', response_json: options.replay }
      if (sql.includes('FROM mip_events')) return event
      if (sql.includes('COUNT(*)')) return { total: options.full ? 10 : 0 }
      if (sql.includes("status = 'WAITLISTED'")) return (options.candidates || [])[candidateIndex++] || null
      if (sql.includes('FROM mip_event_registrations')) return registration
      if (sql.includes('FROM mip_event_checkins')) return null
      throw new Error(`unexpected read ${sql}`)
    },
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('INSERT INTO mip_idempotency_keys')) {
        hash = params[5]
        if (options.replay) throw Object.assign(new Error('duplicate'), { errno: 1062 })
      }
      return { affectedRows: 1 }
    },
  }
  return { calls, db: { transaction: work => work(tx) } }
}

for (const replay of [false, true]) {
  it(`renews the original expired payment hold without replacing its order (replay=${replay})`, async () => {
    const f = fixture({ replay: replay ? {
      kind: 'PAYMENT_REQUIRED', orderId: 'original-order', holdExpiresAt: '2026-09-04T00:00:00Z',
    } : null })
    const result = await createRegistration(f.db, {
      appId: 'app', userId: 'user', input, now, participationAccessPolicy: policy,
      resolveUserKind: async () => 'GUEST', paymentAvailable: true,
    })
    assert.equal(result.orderId, 'original-order')
    assert.equal(result.holdExpiresAt, '2026-09-05T00:15:00.000Z')
    assert.ok(f.calls.some(c => c.sql.includes("SET status = 'ACTIVE', expires_at")))
    assert.equal(f.calls.some(c => c.sql.includes('INSERT INTO mip_orders')), false)
    const registrationUpdate = f.calls.find(c => c.sql.includes('UPDATE mip_event_registrations'))
    assert.equal(registrationUpdate.params[5], 'original-order')
    assert.doesNotMatch(registrationUpdate.sql, /SET order_id/)
  })
}

it('does not renew a payment hold after another user takes the capacity', async () => {
  const f = fixture({ full: true })
  await assert.rejects(createRegistration(f.db, {
    appId: 'app', userId: 'user', input, now, participationAccessPolicy: policy,
    resolveUserKind: async () => 'GUEST',
  }), error => error.code === 'CONFLICT')
  assert.equal(f.calls.some(c => c.sql.includes("SET status = 'ACTIVE', expires_at")), false)
})

for (const code of ['AGREEMENT_REQUIRED', 'PHONE_REQUIRED', 'PROFILE_REQUIRED']) {
  it(`blocks registration edits when current access fails with ${code}`, async () => {
    const f = fixture({ registration: { status: 'REGISTERED' } })
    await assert.rejects(updateRegistration(f.db, {
      appId: 'app', userId: 'user', input, now,
      participationAccessPolicy: { requireAccess: async () => { throw new DomainError(code, code) } },
    }), error => error.code === code)
    assert.equal(f.calls.some(c => c.sql.includes('UPDATE mip_event_registrations')), false)
  })
}

it('blocks member-only registration edits after membership expiry', async () => {
  const f = fixture({ event: { access_type: 'MEMBER_INCLUDED' }, registration: { status: 'REGISTERED' } })
  await assert.rejects(updateRegistration(f.db, {
    appId: 'app', userId: 'user', input, now, participationAccessPolicy: policy,
    resolveUserKind: async () => 'GUEST',
  }), error => error.code === 'FORBIDDEN')
})

for (const reason of ['disabled', 'membership', 'profile']) {
  it(`skips an ineligible waitlist candidate (${reason}) and promotes the next eligible user`, async () => {
    const f = fixture({
      event: { access_type: 'MEMBER_INCLUDED' },
      registration: { status: 'REGISTERED', order_id: null },
      disabled: reason === 'disabled' ? 'candidate-1' : null,
      candidates: [1, 2].map(n => ({ id: `reg-${n}`, user_id: `candidate-${n}`, version: 1, waitlisted_at: now })),
    })
    const result = await cancelRegistration(f.db, {
      appId: 'app', userId: 'user', eventId: 'event', expectedVersion: 1, now,
      resolveUserKind: async (_tx, _app, id) => reason === 'membership' && id === 'candidate-1' ? 'GUEST' : 'PLAYER',
      participationAccessPolicy: { requireAccess: async (_tx, _app, id) => {
        if (reason === 'profile' && id === 'candidate-1') throw new DomainError('PROFILE_REQUIRED', '')
      } },
    })
    assert.equal(result.status, 'CANCELLED')
    const promotion = f.calls.find(c => c.sql.includes('ticket_hash = ?'))
    assert.equal(promotion.params[4], 'reg-2')
    assert.equal(promotion.params[0], 'REGISTERED')
  })
}

it('keeps approval-policy candidates pending review when a seat is released', async () => {
  const f = fixture({
    event: { access_type: 'FREE', registration_policy: 'APPROVAL' },
    registration: { status: 'REGISTERED', order_id: null },
    candidates: [{ id: 'candidate-reg', user_id: 'candidate', version: 1, waitlisted_at: now }],
  })
  await cancelRegistration(f.db, {
    appId: 'app', userId: 'user', eventId: 'event', expectedVersion: 1, now,
    participationAccessPolicy: policy,
  })
  const promotion = f.calls.find(c => c.sql.includes('ticket_hash = ?'))
  assert.equal(promotion.params[0], 'PENDING_REVIEW')
  assert.equal(promotion.params[1], null)
})

it('allows unpaid registrations to release their order after the normal cancellation deadline', async () => {
  const f = fixture({ event: { cancellation_deadline: '2026-09-04T00:00:00Z' } })
  const result = await cancelRegistration(f.db, {
    appId: 'app', userId: 'user', eventId: 'event', expectedVersion: 1, now,
  })
  assert.equal(result.status, 'CANCELLED')
  assert.equal(result.refundRequired, false)
  assert.ok(f.calls.some(c => c.sql.includes("mip_orders SET status = 'CLOSED'")))
})
