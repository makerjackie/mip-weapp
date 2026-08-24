'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { signInternalEvent, verifyInternalEvent } = require('../lib/internal-auth')

const secret = 'growth-secret-that-is-longer-than-thirty-two-bytes'
const now = 1_800_000_000_000

function signed(overrides = {}) {
  const event = {
    action: 'recordConfirmedEvent',
    timestamp: now,
    appId: 'wx-app',
    userId: '10000000-0000-4000-8000-000000000001',
    sourceEventType: 'event.checked_in',
    sourceEventId: '20000000-0000-4000-8000-000000000001',
    ...overrides,
  }
  return { ...event, signature: signInternalEvent(event, secret) }
}

test('accepts a current signed business event', () => {
  assert.equal(verifyInternalEvent(signed(), {
    secret,
    now,
    allowedAppIds: new Set(['wx-app']),
  }).sourceEventType, 'event.checked_in')
})

test('rejects tampered and expired events', () => {
  const event = signed()
  assert.throws(() => verifyInternalEvent({ ...event, userId: '30000000-0000-4000-8000-000000000001' }, {
    secret,
    now,
    allowedAppIds: new Set(['wx-app']),
  }), /FORBIDDEN/)
  assert.throws(() => verifyInternalEvent(signed({ timestamp: now - 6 * 60 * 1000 }), {
    secret,
    now,
    allowedAppIds: new Set(['wx-app']),
  }), /FORBIDDEN/)
})

test('authenticates a check-in transition without accepting a caller-supplied user', () => {
  const event = signed({
    action: 'applyCheckInTransition',
    transitionId: '40000000-0000-4000-8000-000000000001',
    userId: undefined,
    sourceEventType: undefined,
    sourceEventId: undefined,
  })
  assert.deepEqual(verifyInternalEvent(event, {
    secret,
    now,
    allowedAppIds: new Set(['wx-app']),
  }), {
    appId: 'wx-app',
    transitionId: '40000000-0000-4000-8000-000000000001',
  })
  assert.throws(() => verifyInternalEvent({ ...event, transitionId: 'tampered' }, {
    secret,
    now,
    allowedAppIds: new Set(['wx-app']),
  }), /FORBIDDEN/)
})
