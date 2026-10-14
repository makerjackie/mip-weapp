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

  it('keeps accepting registrations past capacity when oversell is enabled', () => {
    assert.equal(
      decideRegistration({ event: event({ capacity: 1, oversell_enabled: 1 }), userKind: 'GUEST', capacityCount: 1, activeHoldCount: 0, now }),
      'REGISTERED',
    )
    assert.equal(
      decideRegistration({ event: event({ capacity: 1, oversell_enabled: 1, registration_policy: 'APPROVAL' }), userKind: 'GUEST', capacityCount: 3, activeHoldCount: 2, now }),
      'PENDING_REVIEW',
    )
    // 候补优先级高于超售：两者互斥由写入层保证，判定层候补开关存在时仍走候补
    assert.equal(
      decideRegistration({ event: event({ capacity: 1, waitlist_enabled: 1, oversell_enabled: 1 }), userKind: 'GUEST', capacityCount: 1, activeHoldCount: 0, now }),
      'WAITLISTED',
    )
  })

  it('still rejects paid events past capacity even when oversell is enabled', () => {
    assert.throws(
      () => decideRegistration({ event: event({ access_type: 'PAID', capacity: 1, oversell_enabled: 1 }), userKind: 'GUEST', capacityCount: 1, activeHoldCount: 0, now }),
      error => error.code === 'CONFLICT',
    )
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
  // MIW-103：活动 05:00 开始 → 签到 2026-08-23 23:00（开始前 6 小时）开放；凭证
  // valid_from 晚于该点（改期后的旧海报、现场轮换码）时以凭证生效时间为准。
  const checkInEvent = { id: 'event-1', starts_at: '2026-08-24T05:00:00.000Z' }
  const openCredential = {
    event_id: 'event-1',
    status: 'ACTIVE',
    valid_from: '2026-08-24T03:00:00.000Z',
    valid_until: '2026-08-24T06:00:00.000Z',
  }

  it('allows check-in from 6 hours before start until the credential expires', () => {
    // 04:45 在凭证生效（03:00）之后、过期（06:00）之前。
    assert.doesNotThrow(() => assertCheckInAllowed({
      event: checkInEvent,
      registration: { event_id: 'event-1', status: 'REGISTERED' },
      credential: openCredential,
      now: new Date('2026-08-24T04:45:00.000Z'),
    }))
    // 凭证生效早于 6 小时点时，由 6 小时口径兜底：04:45 已过开放点（23:00）。
    assert.doesNotThrow(() => assertCheckInAllowed({
      event: checkInEvent,
      registration: { event_id: 'event-1', status: 'REGISTERED' },
      credential: { ...openCredential, valid_from: '2026-08-23T20:00:00.000Z' },
      now: new Date('2026-08-24T04:45:00.000Z'),
    }))
    assert.throws(() => assertCheckInAllowed({
      event: checkInEvent,
      registration: { event_id: 'event-1', status: 'PAYMENT_PENDING' },
      credential: { ...openCredential, valid_from: now, valid_until: now },
      now,
    }), error => error.code === 'REGISTRATION_PENDING')
    assert.throws(() => assertCheckInAllowed({
      event: checkInEvent,
      registration: null,
      credential: { ...openCredential, valid_from: now, valid_until: now },
      now,
    }), error => error.code === 'REGISTRATION_REQUIRED')
  })

  it('reports CHECKIN_NOT_OPEN with structured times when scanning before the window opens', () => {
    // 22:00 早于开放点 23:00（开始前 6 小时）：凭证（valid_from 20:00 已生效）也必须拦下。
    assert.throws(() => assertCheckInAllowed({
      event: checkInEvent,
      registration: { event_id: 'event-1', status: 'REGISTERED' },
      credential: { ...openCredential, valid_from: '2026-08-23T20:00:00.000Z' },
      now: new Date('2026-08-23T22:00:00.000Z'),
    }), error => error.code === 'CHECKIN_NOT_OPEN'
      && error.details.opensAt === '2026-08-23T23:00:00.000Z'
      && error.details.startsAt === '2026-08-24T05:00:00.000Z')
    // 现场轮换码晚于规则点生成（04:40 签发）：以凭证生效时间为准。
    assert.throws(() => assertCheckInAllowed({
      event: checkInEvent,
      registration: { event_id: 'event-1', status: 'REGISTERED' },
      credential: { ...openCredential, valid_from: '2026-08-24T04:40:00.000Z' },
      now: new Date('2026-08-24T04:35:00.000Z'),
    }), error => error.code === 'CHECKIN_NOT_OPEN'
      && error.details.opensAt === '2026-08-24T04:40:00.000Z')
  })

  it('reports CHECKIN_EXPIRED once the credential window has passed', () => {
    assert.throws(() => assertCheckInAllowed({
      event: checkInEvent,
      registration: { event_id: 'event-1', status: 'REGISTERED' },
      credential: openCredential,
      now: new Date('2026-08-24T06:01:00.000Z'),
    }), error => error.code === 'CHECKIN_EXPIRED')
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
