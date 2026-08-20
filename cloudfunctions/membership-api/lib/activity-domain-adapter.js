/**
 * Membership adapter over in-repo activity-domain.
 * Maps registration statuses and case error codes without changing external APIs.
 */

'use strict'

// Package-local vendor copy. CloudBase deploys only this function directory, so
// Keep pure.cjs byte-identical with src/shared/activity-domain/pure.cjs
// (enforced by scripts/lib/membership-api-package.mjs).
const {
  ACTIVITY_ERROR_CODES,
  buildStateChangeAudit,
  decideEnrollmentAttempt,
  decideIdempotency,
} = require('./vendor/activity-domain/pure.cjs')

/** Frozen registration statuses used by this case. */
const REGISTRATION_STATUSES = Object.freeze([
  'PENDING_REVIEW',
  'WAITLISTED',
  'REGISTERED',
  'CANCELLATION_PENDING',
  'CANCELLED',
  'REJECTED',
  'ATTENDED',
])

/**
 * Case-owned status matrix. Reactivation (CANCELLED → REGISTERED) stays here,
 * not in the shared package.
 */
const REGISTRATION_STATUS_POLICY = Object.freeze({
  PENDING_REVIEW: Object.freeze({
    replayable: true,
    holdsSeat: false,
    reactivatable: false,
  }),
  WAITLISTED: Object.freeze({
    replayable: true,
    holdsSeat: false,
    reactivatable: false,
  }),
  REGISTERED: Object.freeze({
    replayable: true,
    holdsSeat: true,
    reactivatable: false,
  }),
  CANCELLATION_PENDING: Object.freeze({
    replayable: true,
    holdsSeat: true,
    reactivatable: false,
  }),
  ATTENDED: Object.freeze({
    replayable: true,
    holdsSeat: true,
    reactivatable: false,
  }),
  CANCELLED: Object.freeze({
    replayable: false,
    holdsSeat: false,
    reactivatable: true,
  }),
  REJECTED: Object.freeze({
    replayable: false,
    holdsSeat: false,
    reactivatable: true,
  }),
})

const ENROLLMENT_ERROR_MAP = Object.freeze({
  [ACTIVITY_ERROR_CODES.NOT_ACCEPTING]: 'EVENT_NOT_AVAILABLE',
  [ACTIVITY_ERROR_CODES.ENROLLMENT_CLOSED]: 'REGISTRATION_CLOSED',
  [ACTIVITY_ERROR_CODES.CAPACITY_FULL]: 'EVENT_FULL',
  [ACTIVITY_ERROR_CODES.POLICY_INVALID]: 'DATA_INTEGRITY',
  [ACTIVITY_ERROR_CODES.DATA_INTEGRITY]: 'DATA_INTEGRITY',
})

function registrationPolicy(status) {
  return REGISTRATION_STATUS_POLICY[status] || null
}

function isReplayableRegistration(fact) {
  const policy = registrationPolicy(fact?.status)
  return Boolean(policy && policy.replayable)
}

function isReactivatableRegistration(fact) {
  const policy = registrationPolicy(fact?.status)
  return Boolean(policy && policy.reactivatable)
}

function holdsRegistrationSeat(status) {
  const policy = registrationPolicy(status)
  return Boolean(policy && policy.holdsSeat)
}

/**
 * @param {string} code
 * @returns {string}
 */
function mapEnrollmentError(code) {
  return ENROLLMENT_ERROR_MAP[code] || code
}

/**
 * Parse a deadline value into finite ms, or null when absent.
 * Illegal non-empty values fail closed as DATA_INTEGRITY.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function parseDeadlineMs(value) {
  if (value == null || value === '') {
    return null
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(ms)) {
    const error = new Error('DATA_INTEGRITY')
    error.code = 'DATA_INTEGRITY'
    throw error
  }
  return ms
}

/**
 * Capacity null is unlimited. Non-integer finite values fail closed.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function parseCapacityLimit(value) {
  if (value == null || value === '') {
    return null
  }
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 0) {
    const error = new Error('DATA_INTEGRITY')
    error.code = 'DATA_INTEGRITY'
    throw error
  }
  return limit
}

function throwMappedEnrollmentError(code) {
  const mapped = mapEnrollmentError(code)
  const error = new Error(mapped)
  error.code = mapped
  error.activityCode = code
  throw error
}

/**
 * Phase-1 enrollment decision: REPLAY / accepting / deadline.
 * Capacity is intentionally skipped so callers can keep phone eligibility before seat checks.
 *
 * @param {{
 *   existing: null | { id: string, status: string, ticket_code?: string | null, version?: number },
 *   eventStatus: string,
 *   startsAt: unknown,
 *   registrationDeadline: unknown,
 *   now: Date | number,
 * }} input
 * @param {{ decideEnrollmentAttempt?: typeof decideEnrollmentAttempt }} [deps]
 */
function decideMembershipEnrollment(input, deps = {}) {
  const decide = deps.decideEnrollmentAttempt || decideEnrollmentAttempt
  const nowMs = input.now instanceof Date ? input.now.getTime() : Number(input.now)
  if (!Number.isFinite(nowMs)) {
    const error = new Error('DATA_INTEGRITY')
    error.code = 'DATA_INTEGRITY'
    throw error
  }

  const startsAtMs = parseDeadlineMs(input.startsAt)
  const closesAtMs = parseDeadlineMs(input.registrationDeadline)

  // Event must be PUBLISHED and not yet started to accept new/reactivated seats.
  const accepting = input.eventStatus === 'PUBLISHED'
    && startsAtMs != null
    && nowMs < startsAtMs

  const decision = decide({
    existing: input.existing,
    isReplayable: isReplayableRegistration,
    accepting,
    closesAtMs,
    nowMs,
    // Capacity is a second phase so phone/membership stay before seat checks.
    capacityLimit: null,
    occupiedSeats: 0,
  })

  if (decision.kind === 'REJECT') {
    throwMappedEnrollmentError(decision.code)
  }

  return decision
}

/**
 * Phase-2 capacity decision after case-specific eligibility (phone, membership).
 * `capacity: null` is unlimited and must never be coerced through Number(null)===0.
 *
 * @param {{
 *   capacity: unknown,
 *   occupiedSeats: number,
 *   now?: Date | number,
 * }} input
 * @param {{ decideEnrollmentAttempt?: typeof decideEnrollmentAttempt }} [deps]
 */
function decideMembershipCapacity(input, deps = {}) {
  const decide = deps.decideEnrollmentAttempt || decideEnrollmentAttempt
  const nowMs = input.now instanceof Date
    ? input.now.getTime()
    : (typeof input.now === 'number' ? input.now : Date.now())
  const capacityLimit = parseCapacityLimit(input.capacity)
  const decision = decide({
    existing: null,
    accepting: true,
    closesAtMs: null,
    nowMs,
    capacityLimit,
    occupiedSeats: Number(input.occupiedSeats || 0),
  })
  if (decision.kind === 'REJECT') {
    throwMappedEnrollmentError(decision.code)
  }
  return decision
}

/**
 * Build a membership registration audit payload for SQL insert.
 *
 * @param {{
 *   appId: string,
 *   actorId: string,
 *   action: string,
 *   registrationId: string,
 *   from?: string | null,
 *   to: string,
 *   version: number,
 *   eventId: string,
 *   now?: Date | number,
 *   requestId?: string,
 * }} input
 * @param {{ buildStateChangeAudit?: typeof buildStateChangeAudit }} [deps]
 */
function buildRegistrationAuditRow(input, deps = {}) {
  const build = deps.buildStateChangeAudit || buildStateChangeAudit
  const occurredAtMs = input.now instanceof Date
    ? input.now.getTime()
    : (typeof input.now === 'number' ? input.now : Date.now())

  const record = build({
    actor: {
      appId: input.appId,
      actorId: input.actorId,
      actorRole: 'member',
    },
    action: input.action,
    resourceType: 'registration',
    resourceId: input.registrationId,
    from: input.from === undefined ? null : input.from,
    to: input.to,
    version: input.version,
    occurredAtMs,
    requestId: input.requestId || '',
    metadata: {
      eventId: input.eventId,
      from: input.from === undefined ? null : input.from,
      to: input.to,
      version: input.version,
    },
  })

  return {
    appId: record.appId,
    actorId: record.actorId,
    actorRole: record.actorRole,
    action: record.action,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    metadata: record.metadata,
    occurredAt: record.occurredAt,
    requestId: record.requestId,
    version: record.version,
    from: record.from,
    to: record.to,
  }
}

module.exports = {
  ACTIVITY_ERROR_CODES,
  REGISTRATION_STATUSES,
  REGISTRATION_STATUS_POLICY,
  buildRegistrationAuditRow,
  buildStateChangeAudit,
  decideIdempotency,
  decideMembershipCapacity,
  decideMembershipEnrollment,
  decideEnrollmentAttempt,
  holdsRegistrationSeat,
  isReactivatableRegistration,
  isReplayableRegistration,
  mapEnrollmentError,
  parseCapacityLimit,
  parseDeadlineMs,
  registrationPolicy,
}
