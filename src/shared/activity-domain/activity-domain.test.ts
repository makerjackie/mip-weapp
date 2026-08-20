import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_ERROR_CODES,
  buildStateChangeAudit,
  decideEnrollmentAttempt,
  decideIdempotency,
} from './index'

describe('decideEnrollmentAttempt', () => {
  const base = {
    accepting: true,
    nowMs: 1_000,
    closesAtMs: 2_000,
    capacityLimit: 10,
    occupiedSeats: 0,
  } as const

  it('replays an existing fact before accepting/deadline/capacity checks', () => {
    const fact = { id: 'r1', status: 'REGISTERED' }
    const decision = decideEnrollmentAttempt({
      ...base,
      existing: fact,
      isReplayable: () => true,
      accepting: false,
      closesAtMs: 500,
      capacityLimit: 1,
      occupiedSeats: 1,
    })
    expect(decision).toEqual({ kind: 'REPLAY', fact })
  })

  it('does not replay when isReplayable returns false (reactivation path)', () => {
    const decision = decideEnrollmentAttempt({
      ...base,
      existing: { id: 'r1', status: 'CANCELLED' },
      isReplayable: fact => fact.status !== 'CANCELLED',
    })
    expect(decision).toEqual({ kind: 'ACCEPT' })
  })

  it('rejects when not accepting after non-replayable existing', () => {
    const decision = decideEnrollmentAttempt({
      ...base,
      existing: { id: 'r1' },
      isReplayable: () => false,
      accepting: false,
    })
    expect(decision).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.NOT_ACCEPTING })
  })

  it('rejects at deadline equality (nowMs >= closesAtMs)', () => {
    const decision = decideEnrollmentAttempt({
      ...base,
      nowMs: 2_000,
      closesAtMs: 2_000,
    })
    expect(decision).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.ENROLLMENT_CLOSED })
  })

  it('accepts just before the deadline', () => {
    const decision = decideEnrollmentAttempt({
      ...base,
      nowMs: 1_999,
      closesAtMs: 2_000,
    })
    expect(decision).toEqual({ kind: 'ACCEPT' })
  })

  it('treats null capacity as unlimited even when occupied is large', () => {
    const decision = decideEnrollmentAttempt({
      ...base,
      capacityLimit: null,
      occupiedSeats: 999_999,
    })
    expect(decision).toEqual({ kind: 'ACCEPT' })
  })

  it('rejects at capacity boundary occupied === limit', () => {
    const decision = decideEnrollmentAttempt({
      ...base,
      capacityLimit: 3,
      occupiedSeats: 3,
    })
    expect(decision).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.CAPACITY_FULL })
  })

  it('accepts when occupied is one below limit', () => {
    const decision = decideEnrollmentAttempt({
      ...base,
      capacityLimit: 3,
      occupiedSeats: 2,
    })
    expect(decision).toEqual({ kind: 'ACCEPT' })
  })

  it('rejects illegal capacity numbers as policy invalid', () => {
    expect(decideEnrollmentAttempt({
      ...base,
      capacityLimit: -1,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID })

    expect(decideEnrollmentAttempt({
      ...base,
      capacityLimit: 1.5,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID })

    expect(decideEnrollmentAttempt({
      ...base,
      capacityLimit: Number.NaN,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID })

    expect(decideEnrollmentAttempt({
      ...base,
      occupiedSeats: -1,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID })
  })

  it('throws DATA_INTEGRITY for non-finite deadlines (fail-closed)', () => {
    expect(() => decideEnrollmentAttempt({
      ...base,
      closesAtMs: Number.NaN,
    })).toThrowError(/DATA_INTEGRITY|deadline/)

    expect(() => decideEnrollmentAttempt({
      ...base,
      closesAtMs: Number.POSITIVE_INFINITY,
    })).toThrowError(/DATA_INTEGRITY|deadline/)
  })

  it('priority: not-accepting before closed before full', () => {
    expect(decideEnrollmentAttempt({
      accepting: false,
      nowMs: 3_000,
      closesAtMs: 2_000,
      capacityLimit: 1,
      occupiedSeats: 1,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.NOT_ACCEPTING })

    expect(decideEnrollmentAttempt({
      accepting: true,
      nowMs: 3_000,
      closesAtMs: 2_000,
      capacityLimit: 1,
      occupiedSeats: 1,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.ENROLLMENT_CLOSED })

    expect(decideEnrollmentAttempt({
      accepting: true,
      nowMs: 1_000,
      closesAtMs: null,
      capacityLimit: 1,
      occupiedSeats: 1,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.CAPACITY_FULL })
  })

  it('rejects missing/illegal nowMs as policy invalid', () => {
    expect(decideEnrollmentAttempt({
      accepting: true,
      nowMs: Number.NaN,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID })
  })
})

describe('decideIdempotency', () => {
  it('returns MISS when no existing record', () => {
    expect(decideIdempotency({
      existing: null,
      fingerprint: 'fp-1',
      nowMs: 100,
    })).toEqual({ kind: 'MISS' })
  })

  it('replays the generic result as-is', () => {
    const result = { memberId: 'm1', status: 'ACTIVE', nested: { ok: true } }
    const decision = decideIdempotency({
      existing: {
        fingerprint: 'fp-1',
        result,
        expiresAtMs: 1_000,
      },
      fingerprint: 'fp-1',
      nowMs: 100,
    })
    expect(decision).toEqual({ kind: 'REPLAY', result })
    if (decision.kind === 'REPLAY') {
      expect(decision.result).toBe(result)
    }
  })

  it('prefers conflict over expired when fingerprints differ', () => {
    const decision = decideIdempotency({
      existing: {
        fingerprint: 'fp-old',
        result: { ok: true },
        expiresAtMs: 50,
      },
      fingerprint: 'fp-new',
      nowMs: 100,
    })
    expect(decision).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.IDEMPOTENCY_CONFLICT })
  })

  it('rejects expired same-fingerprint records', () => {
    expect(decideIdempotency({
      existing: {
        fingerprint: 'fp-1',
        result: { ok: true },
        expiresAtMs: 100,
      },
      fingerprint: 'fp-1',
      nowMs: 100,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.IDEMPOTENCY_EXPIRED })
  })

  it('treats null expiry as never expired', () => {
    expect(decideIdempotency({
      existing: {
        fingerprint: 'fp-1',
        result: 42,
        expiresAtMs: null,
      },
      fingerprint: 'fp-1',
      nowMs: Number.MAX_SAFE_INTEGER,
    })).toEqual({ kind: 'REPLAY', result: 42 })
  })

  it('rejects illegal fingerprints and clocks as policy invalid', () => {
    expect(decideIdempotency({
      fingerprint: '',
      nowMs: 1,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID })

    expect(decideIdempotency({
      fingerprint: 'fp',
      nowMs: Number.NaN,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID })

    expect(decideIdempotency({
      existing: {
        fingerprint: '',
        result: true,
      },
      fingerprint: 'fp',
      nowMs: 1,
    })).toEqual({ kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID })
  })
})

describe('buildStateChangeAudit', () => {
  const actor = { appId: 'app-1', actorId: 'user-1', actorRole: 'member' }

  it('creates an ISO audit row for a create (from null)', () => {
    const row = buildStateChangeAudit({
      actor,
      action: 'REGISTRATION_CREATED',
      resourceType: 'registration',
      resourceId: 'reg-1',
      from: null,
      to: 'REGISTERED',
      version: 1,
      occurredAtMs: Date.UTC(2026, 6, 24, 12, 0, 0),
      requestId: 'req-1',
      metadata: { eventId: 'evt-1' },
    })
    expect(row).toEqual({
      appId: 'app-1',
      actorId: 'user-1',
      actorRole: 'member',
      action: 'REGISTRATION_CREATED',
      resourceType: 'registration',
      resourceId: 'reg-1',
      from: null,
      to: 'REGISTERED',
      version: 1,
      occurredAt: '2026-07-24T12:00:00.000Z',
      requestId: 'req-1',
      metadata: { eventId: 'evt-1' },
    })
  })

  it('records from/to/version for an update', () => {
    const row = buildStateChangeAudit({
      actor,
      action: 'REGISTRATION_CANCELLED_BY_MEMBER',
      resourceType: 'registration',
      resourceId: 'reg-1',
      from: 'REGISTERED',
      to: 'CANCELLED',
      version: 2,
      occurredAtMs: 0,
      metadata: {},
    })
    expect(row.from).toBe('REGISTERED')
    expect(row.to).toBe('CANCELLED')
    expect(row.version).toBe(2)
    expect(row.occurredAt).toBe('1970-01-01T00:00:00.000Z')
    expect(row.requestId).toBe('')
  })

  it('copies already-redacted metadata without mutation', () => {
    const metadata = { safe: true }
    const row = buildStateChangeAudit({
      actor,
      action: 'PLAN_JOINED',
      resourceType: 'plan_member',
      resourceId: 'm1',
      to: 'ACTIVE',
      version: 1,
      occurredAtMs: 1,
      metadata,
    })
    expect(row.metadata).toEqual({ safe: true })
    expect(row.metadata).not.toBe(metadata)
    metadata.safe = false
    expect(row.metadata.safe).toBe(true)
  })

  it('rejects missing required fields', () => {
    expect(() => buildStateChangeAudit({
      actor: { appId: '', actorId: 'u' },
      action: 'X',
      resourceType: 'r',
      resourceId: 'id',
      to: 'A',
      version: 1,
      occurredAtMs: 1,
    })).toThrowError(/ACTIVITY_AUDIT_INVALID|actor/)

    expect(() => buildStateChangeAudit({
      actor,
      action: '',
      resourceType: 'r',
      resourceId: 'id',
      to: 'A',
      version: 1,
      occurredAtMs: 1,
    })).toThrowError(/ACTIVITY_AUDIT_INVALID/)
  })

  it('rejects illegal version and time', () => {
    expect(() => buildStateChangeAudit({
      actor,
      action: 'X',
      resourceType: 'r',
      resourceId: 'id',
      to: 'A',
      version: 0,
      occurredAtMs: 1,
    })).toThrowError(/ACTIVITY_AUDIT_INVALID|version/)

    expect(() => buildStateChangeAudit({
      actor,
      action: 'X',
      resourceType: 'r',
      resourceId: 'id',
      to: 'A',
      version: 1.5,
      occurredAtMs: 1,
    })).toThrowError(/ACTIVITY_AUDIT_INVALID|version/)

    expect(() => buildStateChangeAudit({
      actor,
      action: 'X',
      resourceType: 'r',
      resourceId: 'id',
      to: 'A',
      version: 1,
      occurredAtMs: Number.NaN,
    })).toThrowError(/ACTIVITY_AUDIT_INVALID/)
  })

  it('rejects non-object metadata', () => {
    expect(() => buildStateChangeAudit({
      actor,
      action: 'X',
      resourceType: 'r',
      resourceId: 'id',
      to: 'A',
      version: 1,
      occurredAtMs: 1,
      metadata: ['not', 'object'] as unknown as Record<string, unknown>,
    })).toThrowError(/ACTIVITY_AUDIT_INVALID|metadata/)
  })
})
