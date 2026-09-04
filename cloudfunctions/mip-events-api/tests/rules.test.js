'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertCanCancel,
  assertCheckInAllowed,
  decideRegistration,
  grantsCapability,
  validateFeedback,
} = require('../domain/rules')

const now = new Date('2026-08-24T04:00:00.000Z')

function event(overrides = {}) {
  return {
    id: 'event-1',
    branch_id: 'branch-1',
    status: 'PUBLISHED',
    starts_at: '2026-08-25T04:00:00.000Z',
    registration_opens_at: null,
    registration_deadline: '2026-08-25T03:00:00.000Z',
    access_type: 'FREE',
    registration_policy: 'AUTO',
    capacity: 10,
    waitlist_enabled: 0,
    ...overrides,
  }
}

describe('MIP event registration rules', () => {
  it('derives free, approval, waitlist, and paid states on the server', () => {
    assert.equal(decideRegistration({ event: event(), userKind: 'GUEST', capacityCount: 0, activeHoldCount: 0, now }), 'REGISTERED')
    assert.equal(decideRegistration({ event: event({ registration_policy: 'APPROVAL' }), userKind: 'GUEST', capacityCount: 0, activeHoldCount: 0, now }), 'PENDING_REVIEW')
    assert.equal(decideRegistration({ event: event({ capacity: 1, waitlist_enabled: 1 }), userKind: 'GUEST', capacityCount: 1, activeHoldCount: 0, now }), 'WAITLISTED')
    assert.equal(decideRegistration({ event: event({ access_type: 'PAID' }), userKind: 'GUEST', capacityCount: 0, activeHoldCount: 0, now }), 'PAYMENT_PENDING')
  })

  it('rejects a guest from a player-only event', () => {
    assert.throws(
      () => decideRegistration({ event: event({ access_type: 'MEMBER_INCLUDED' }), userKind: 'GUEST', capacityCount: 0, activeHoldCount: 0, now }),
      error => error.code === 'FORBIDDEN',
    )
  })

  it('counts active seat holds when enforcing paid capacity', () => {
    assert.throws(
      () => decideRegistration({ event: event({ access_type: 'PAID', capacity: 1 }), userKind: 'PLAYER', capacityCount: 0, activeHoldCount: 1, now }),
      error => error.code === 'CONFLICT',
    )
  })

  it('does not restart a cancellation that is already pending', () => {
    assert.doesNotThrow(() => assertCanCancel('REGISTERED'))
    assert.throws(() => assertCanCancel('CANCELLATION_PENDING'), error => error.code === 'CONFLICT')
    assert.throws(() => assertCanCancel('ATTENDED'), error => error.code === 'CONFLICT')
  })
})

describe('MIP event check-in and feedback rules', () => {
  it('requires a matching active credential in its time window', () => {
    assert.doesNotThrow(() => assertCheckInAllowed({
      event: { id: 'event-1' },
      registration: { event_id: 'event-1', status: 'REGISTERED' },
      credential: {
        event_id: 'event-1',
        status: 'ACTIVE',
        valid_from: '2026-08-24T03:00:00.000Z',
        valid_until: '2026-08-24T05:00:00.000Z',
      },
      now,
    }))
    assert.throws(() => assertCheckInAllowed({
      event: { id: 'event-1' },
      registration: { event_id: 'event-1', status: 'PAYMENT_PENDING' },
      credential: { event_id: 'event-1', status: 'ACTIVE', valid_from: now, valid_until: now },
      now,
    }), error => error.code === 'REGISTRATION_PENDING')
    assert.throws(() => assertCheckInAllowed({
      event: { id: 'event-1' },
      registration: null,
      credential: { event_id: 'event-1', status: 'ACTIVE', valid_from: now, valid_until: now },
      now,
    }), error => error.code === 'REGISTRATION_REQUIRED')
  })

  it('normalizes feedback without exposing it through public rules', () => {
    const answers = {
      recommendation: 'RECOMMEND',
      roleKeys: ['connector', 'strategist'],
      joinIntent: 'JOIN_NOW',
      explorationMethods: ['ATTEND_EVENT', 'COMMUNITY_CHAT'],
      rosterConsent: 'MATCH_OPPORTUNITIES',
    }
    assert.deepEqual(validateFeedback({ rating: 5, body: '  有收获  ', answers }), {
      rating: 5,
      body: '有收获',
      answers,
    })
    assert.deepEqual(validateFeedback({ rating: 4, answers: { ...answers, explorationMethods: [] } }), {
      rating: 4,
      body: '',
      answers: { ...answers, explorationMethods: [] },
    })
    for (const input of [
      { rating: undefined, answers },
      { rating: 6, answers },
      { rating: 5, body: '超'.repeat(301), answers },
      { rating: 5, answers: null },
      { rating: 5, answers: { ...answers, recommendation: 'MAYBE' } },
      { rating: 5, answers: { ...answers, roleKeys: [] } },
      { rating: 5, answers: { ...answers, roleKeys: ['connector', 'connector'] } },
      { rating: 5, answers: { ...answers, roleKeys: ['unknown'] } },
      { rating: 5, answers: { ...answers, joinIntent: 'UNKNOWN' } },
      { rating: 5, answers: { ...answers, explorationMethods: ['ATTEND_EVENT', 'ATTEND_EVENT'] } },
      { rating: 5, answers: { ...answers, explorationMethods: ['UNKNOWN'] } },
      { rating: 5, answers: { ...answers, rosterConsent: 'PUBLIC' } },
      { rating: 5, answers: { ...answers, extra: true } },
    ]) {
      assert.throws(() => validateFeedback(input), error => error.code === 'VALIDATION_FAILED')
    }
  })
})

describe('MIP event admin scope', () => {
  it('limits a branch administrator to the matching city branch', () => {
    const grants = [{ scope_type: 'BRANCH', scope_id: 'branch-1', role_key: 'BRANCH_ADMIN' }]
    assert.equal(grantsCapability(grants, 'events.manage', event()), true)
    assert.equal(grantsCapability(grants, 'events.manage', event({ branch_id: 'branch-2' })), false)
  })

  it('allows event staff to check in but not read feedback', () => {
    const grants = [{ scope_type: 'EVENT', scope_id: 'event-1', role_key: 'EVENT_STAFF' }]
    assert.equal(grantsCapability(grants, 'events.checkin', event()), true)
    assert.equal(grantsCapability(grants, 'events.feedback.read', event()), false)
  })

  it('applies a configured role policy without widening the role default', () => {
    const operations = [{
      scope_type: 'PLATFORM',
      scope_id: '00000000-0000-0000-0000-000000000000',
      role_key: 'PLATFORM_OPERATIONS',
      policy_capabilities_json: JSON.stringify(['admin.dashboard']),
    }]
    assert.equal(grantsCapability(operations, 'events.manage', event()), false)
    const staff = [{
      scope_type: 'EVENT',
      scope_id: 'event-1',
      role_key: 'EVENT_STAFF',
      policy_capabilities_json: JSON.stringify(['events.write']),
    }]
    assert.equal(grantsCapability(staff, 'events.manage', event()), false)
  })
})
