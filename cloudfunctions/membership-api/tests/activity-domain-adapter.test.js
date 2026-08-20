'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  ACTIVITY_ERROR_CODES,
  REGISTRATION_STATUS_POLICY,
  REGISTRATION_STATUSES,
  buildRegistrationAuditRow,
  decideMembershipCapacity,
  decideMembershipEnrollment,
  holdsRegistrationSeat,
  isReactivatableRegistration,
  isReplayableRegistration,
  mapEnrollmentError,
  parseCapacityLimit,
} = require('../lib/activity-domain-adapter')
const { registerForEvent, cancelEventRegistration } = require('../lib/workflows')

describe('membership registration status matrix', () => {
  it('covers all explicit registration workflow statuses', () => {
    assert.deepEqual(REGISTRATION_STATUSES, [
      'PENDING_REVIEW',
      'WAITLISTED',
      'REGISTERED',
      'CANCELLATION_PENDING',
      'CANCELLED',
      'REJECTED',
      'ATTENDED',
    ])
    assert.deepEqual(REGISTRATION_STATUS_POLICY.PENDING_REVIEW, {
      replayable: true,
      holdsSeat: false,
      reactivatable: false,
    })
    assert.deepEqual(REGISTRATION_STATUS_POLICY.WAITLISTED, {
      replayable: true,
      holdsSeat: false,
      reactivatable: false,
    })
    assert.deepEqual(REGISTRATION_STATUS_POLICY.REGISTERED, {
      replayable: true,
      holdsSeat: true,
      reactivatable: false,
    })
    assert.deepEqual(REGISTRATION_STATUS_POLICY.CANCELLATION_PENDING, {
      replayable: true,
      holdsSeat: true,
      reactivatable: false,
    })
    assert.deepEqual(REGISTRATION_STATUS_POLICY.ATTENDED, {
      replayable: true,
      holdsSeat: true,
      reactivatable: false,
    })
    assert.deepEqual(REGISTRATION_STATUS_POLICY.CANCELLED, {
      replayable: false,
      holdsSeat: false,
      reactivatable: true,
    })
    assert.deepEqual(REGISTRATION_STATUS_POLICY.REJECTED, {
      replayable: false,
      holdsSeat: false,
      reactivatable: true,
    })
  })

  it('maps replayable / holdsSeat / reactivatable helpers', () => {
    assert.equal(isReplayableRegistration({ status: 'REGISTERED' }), true)
    assert.equal(isReplayableRegistration({ status: 'WAITLISTED' }), true)
    assert.equal(isReplayableRegistration({ status: 'ATTENDED' }), true)
    assert.equal(isReplayableRegistration({ status: 'CANCELLED' }), false)
    assert.equal(holdsRegistrationSeat('REGISTERED'), true)
    assert.equal(holdsRegistrationSeat('CANCELLATION_PENDING'), true)
    assert.equal(holdsRegistrationSeat('ATTENDED'), true)
    assert.equal(holdsRegistrationSeat('WAITLISTED'), false)
    assert.equal(holdsRegistrationSeat('CANCELLED'), false)
    assert.equal(isReactivatableRegistration({ status: 'CANCELLED' }), true)
    assert.equal(isReactivatableRegistration({ status: 'REJECTED' }), true)
    assert.equal(isReactivatableRegistration({ status: 'REGISTERED' }), false)
  })

  it('maps shared enrollment errors to membership codes', () => {
    assert.equal(mapEnrollmentError(ACTIVITY_ERROR_CODES.NOT_ACCEPTING), 'EVENT_NOT_AVAILABLE')
    assert.equal(mapEnrollmentError(ACTIVITY_ERROR_CODES.ENROLLMENT_CLOSED), 'REGISTRATION_CLOSED')
    assert.equal(mapEnrollmentError(ACTIVITY_ERROR_CODES.CAPACITY_FULL), 'EVENT_FULL')
  })

  it('treats capacity null as unlimited and rejects Number(null) style coercion', () => {
    assert.equal(parseCapacityLimit(null), null)
    assert.equal(parseCapacityLimit(undefined), null)
    // Must not treat null as 0 full.
    assert.doesNotThrow(() => decideMembershipCapacity({
      capacity: null,
      occupiedSeats: 0,
      now: Date.now(),
    }))
    assert.doesNotThrow(() => decideMembershipCapacity({
      capacity: null,
      occupiedSeats: 10_000,
      now: Date.now(),
    }))
  })

  it('builds audit rows with resource/action/version metadata', () => {
    const row = buildRegistrationAuditRow({
      appId: 'app',
      actorId: 'user',
      action: 'REGISTRATION_CREATED',
      registrationId: 'reg-1',
      from: null,
      to: 'REGISTERED',
      version: 1,
      eventId: 'evt-1',
      now: Date.UTC(2026, 0, 1),
      requestId: 'req-1',
    })
    assert.equal(row.resourceType, 'registration')
    assert.equal(row.action, 'REGISTRATION_CREATED')
    assert.equal(row.version, 1)
    assert.equal(row.metadata.eventId, 'evt-1')
    assert.equal(row.requestId, 'req-1')
    assert.equal(row.occurredAt, '2026-01-01T00:00:00.000Z')
  })
})

describe('membership workflows call shared pure seams', () => {
  function createFakeDb(matchers, { queryAffectedRows = 1 } = {}) {
    const calls = []
    function normalize(sql) {
      return String(sql).replace(/\s+/g, ' ').trim()
    }
    function resolve(kind, sql, params) {
      const normalized = normalize(sql)
      calls.push({ kind, sql: normalized, params: params || [] })
      for (const matcher of matchers) {
        if (matcher.match(normalized, params || [], kind)) {
          return typeof matcher.result === 'function'
            ? matcher.result(normalized, params || [], kind)
            : matcher.result
        }
      }
      return null
    }
    return {
      calls,
      db: {
        async transaction(work) {
          return work({
            async one(sql, params) {
              return resolve('one', sql, params)
            },
            async query(sql, params) {
              resolve('query', sql, params)
              return { affectedRows: queryAffectedRows }
            },
          })
        },
      },
    }
  }

  it('injects decideEnrollmentAttempt into registerForEvent (behavior, not source scan)', async () => {
    const seen = []
    const decideEnrollmentAttempt = (input) => {
      seen.push(input)
      return {
        kind: 'REPLAY',
        fact: {
          id: 'reg-1',
          status: 'REGISTERED',
          ticket_code: 'T1',
          version: 3,
        },
      }
    }

    const { db, calls } = createFakeDb([
      {
        match: sql => sql.includes('FROM member_events') && sql.includes('FOR UPDATE'),
        result: {
          id: 'evt',
          capacity: 1,
          price_cents: 0,
          member_free: 0,
          registration_deadline: null,
          status: 'PUBLISHED',
          starts_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
      {
        match: (sql, _p, kind) =>
          kind === 'one'
          && sql.includes('FROM member_registrations')
          && sql.includes('user_id')
          && !sql.includes('COUNT(*)'),
        result: { id: 'reg-1', status: 'REGISTERED', ticket_code: 'T1', version: 3 },
      },
    ])

    const result = await registerForEvent(db, {
      appId: 'app',
      userId: 'user',
      eventId: 'evt',
    }, { decideEnrollmentAttempt })

    assert.equal(seen.length, 1)
    assert.equal(result.idempotent, true)
    assert.equal(result.status, 'REGISTERED')
    // Replay must not write.
    assert.equal(calls.filter(call => call.kind === 'query').length, 0)
  })

  it('rolls back when audit construction rejects (shared builder failure)', async () => {
    const { db } = createFakeDb([
      {
        match: sql => sql.includes('FROM member_events') && sql.includes('FOR UPDATE'),
        result: {
          id: 'evt',
          capacity: 10,
          price_cents: 0,
          member_free: 0,
          registration_deadline: null,
          status: 'PUBLISHED',
          starts_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
      {
        match: (sql, _p, kind) =>
          kind === 'one'
          && sql.includes('FROM member_registrations')
          && sql.includes('user_id')
          && !sql.includes('COUNT(*)'),
        result: null,
      },
      {
        match: sql => sql.includes('member_private_profiles'),
        result: { phone_number: '13800000000' },
      },
      {
        match: sql => sql.includes('COUNT(*)'),
        result: { total: 0 },
      },
    ])

    await assert.rejects(
      () => registerForEvent(db, {
        appId: 'app',
        userId: 'user',
        eventId: 'evt',
      }, {
        buildRegistrationAuditRow: () => {
          const error = new Error('ACTIVITY_AUDIT_INVALID')
          error.code = 'ACTIVITY_AUDIT_INVALID'
          throw error
        },
      }),
      /ACTIVITY_AUDIT_INVALID/,
    )
  })

  it('cancel injects audit builder for REGISTERED → CANCELLED writes', async () => {
    let auditCalls = 0
    const { db } = createFakeDb([
      {
        match: (sql, _p, kind) =>
          kind === 'one'
          && sql.includes('FROM member_registrations')
          && sql.includes('FOR UPDATE'),
        result: { id: 'reg-1', status: 'REGISTERED', version: 1 },
      },
      {
        match: sql => sql.includes('FROM member_events') && sql.includes('FOR SHARE'),
        result: {
          id: 'evt',
          status: 'PUBLISHED',
          starts_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
    ])

    const result = await cancelEventRegistration(db, {
      appId: 'app',
      userId: 'user',
      eventId: 'evt',
    }, {
      buildRegistrationAuditRow: (input) => {
        auditCalls += 1
        assert.equal(input.from, 'REGISTERED')
        assert.equal(input.to, 'CANCELLED')
        return {
          appId: input.appId,
          actorId: input.actorId,
          actorRole: 'member',
          action: input.action,
          resourceType: 'registration',
          resourceId: input.registrationId,
          metadata: { eventId: input.eventId, from: input.from, to: input.to, version: input.version },
          occurredAt: new Date(0).toISOString(),
          requestId: '',
          version: input.version,
          from: input.from,
          to: input.to,
        }
      },
    })

    assert.equal(result.status, 'CANCELLED')
    assert.equal(result.idempotent, false)
    assert.equal(auditCalls, 1)
  })
})

describe('membership enrollment phase decisions', () => {
  it('replays REGISTERED before deadline/capacity pressure', () => {
    const decision = decideMembershipEnrollment({
      existing: { id: 'r', status: 'REGISTERED', version: 1 },
      eventStatus: 'DRAFT',
      startsAt: new Date(Date.now() - 1000).toISOString(),
      registrationDeadline: new Date(Date.now() - 1000).toISOString(),
      now: new Date(),
    })
    assert.equal(decision.kind, 'REPLAY')
  })

  it('rejects full capacity after eligibility phase', () => {
    assert.throws(
      () => decideMembershipCapacity({ capacity: 1, occupiedSeats: 1, now: Date.now() }),
      /EVENT_FULL/,
    )
  })
})
