'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createSignedToken, readSignedToken } = require('../lib/tokens')

describe('MIP opaque activity tokens', () => {
  it('round-trips a scoped token without exposing it as a trusted identifier', () => {
    const token = createSignedToken({
      type: 'heart-target',
      eventId: 'event-1',
      registrationId: 'registration-1',
      expiresAt: '2026-08-25T00:00:00.000Z',
    }, 'test-secret')
    const payload = readSignedToken(token, 'test-secret', 'heart-target', new Date('2026-08-24T00:00:00.000Z'))
    assert.equal(payload.registrationId, 'registration-1')
    assert.equal(token.includes('registration-1'), false)
  })

  it('rejects a changed or expired token', () => {
    const token = createSignedToken({
      type: 'event-invitation',
      eventId: 'event-1',
      expiresAt: '2026-08-24T01:00:00.000Z',
    }, 'test-secret')
    assert.throws(() => readSignedToken(`${token}x`, 'test-secret', 'event-invitation'), error => error.code === 'VALIDATION_FAILED')
    assert.throws(
      () => readSignedToken(token, 'test-secret', 'event-invitation', new Date('2026-08-24T02:00:00.000Z')),
      error => error.code === 'VALIDATION_FAILED',
    )
  })
})
