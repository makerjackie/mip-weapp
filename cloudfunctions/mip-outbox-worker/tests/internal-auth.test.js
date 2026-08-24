'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  signInternalEvent,
  verifyInternalEvent,
} = require('../lib/internal-auth')

const secret = 'outbox-secret-that-is-at-least-thirty-two-bytes'
const event = {
  action: 'runBatch',
  appId: 'wx-app',
  limit: 5,
  timestamp: 1_780_000_000_000,
}

describe('outbox internal authentication', () => {
  it('binds the signature to the action, AppID, timestamp, and full request body', () => {
    const signature = signInternalEvent(event, secret)
    const verified = verifyInternalEvent({ ...event, signature }, {
      secret,
      allowedAppIds: new Set(['wx-app']),
      now: event.timestamp,
    })
    assert.equal(verified.appId, 'wx-app')
    assert.equal(verified.limit, 5)
    assert.throws(() => verifyInternalEvent({ ...event, limit: 6, signature }, {
      secret,
      allowedAppIds: new Set(['wx-app']),
      now: event.timestamp,
    }), /FORBIDDEN/)
  })

  it('fails closed for an unlisted AppID or stale timestamp', () => {
    const signature = signInternalEvent(event, secret)
    assert.throws(() => verifyInternalEvent({ ...event, signature }, {
      secret,
      allowedAppIds: new Set(['another-app']),
      now: event.timestamp,
    }), /FORBIDDEN/)
    assert.throws(() => verifyInternalEvent({ ...event, signature }, {
      secret,
      allowedAppIds: new Set(['wx-app']),
      now: event.timestamp + 6 * 60 * 1000,
    }), /FORBIDDEN/)
  })
})
