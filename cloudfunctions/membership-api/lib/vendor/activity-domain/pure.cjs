/**
 * Storage-agnostic activity domain decisions shared by real callers.
 * No hashing, redaction, SQL, UI, or business state machines.
 * CommonJS so membership cloud functions can require without a bundler.
 */

'use strict'

/** @typedef {'ACTIVITY_NOT_ACCEPTING'|'ACTIVITY_ENROLLMENT_CLOSED'|'ACTIVITY_CAPACITY_FULL'|'ACTIVITY_IDEMPOTENCY_CONFLICT'|'ACTIVITY_IDEMPOTENCY_EXPIRED'|'ACTIVITY_POLICY_INVALID'|'ACTIVITY_AUDIT_INVALID'|'DATA_INTEGRITY'} ActivityErrorCode */

const ACTIVITY_ERROR_CODES = Object.freeze({
  NOT_ACCEPTING: 'ACTIVITY_NOT_ACCEPTING',
  ENROLLMENT_CLOSED: 'ACTIVITY_ENROLLMENT_CLOSED',
  CAPACITY_FULL: 'ACTIVITY_CAPACITY_FULL',
  IDEMPOTENCY_CONFLICT: 'ACTIVITY_IDEMPOTENCY_CONFLICT',
  IDEMPOTENCY_EXPIRED: 'ACTIVITY_IDEMPOTENCY_EXPIRED',
  POLICY_INVALID: 'ACTIVITY_POLICY_INVALID',
  AUDIT_INVALID: 'ACTIVITY_AUDIT_INVALID',
  DATA_INTEGRITY: 'DATA_INTEGRITY',
})

/**
 * @param {string} code
 * @param {string} [message]
 * @returns {Error & { code: string }} Error carrying the stable activity code.
 */
function activityError(code, message) {
  const error = new Error(message ? `${code}: ${message}` : code)
  error.code = code
  return error
}

/**
 * @param {unknown} value
 * @returns {value is number} Whether the value is a finite number.
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * @param {unknown} value
 * @returns {boolean} Whether the value is a non-negative integer.
 */
function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Decide whether an enrollment attempt may proceed.
 *
 * Priority:
 * 1. existing replayable fact → REPLAY (before accepting/deadline/capacity)
 * 2. not accepting → ACTIVITY_NOT_ACCEPTING
 * 3. closed window (nowMs >= closesAtMs) → ACTIVITY_ENROLLMENT_CLOSED
 * 4. capacity full (occupied >= limit) → ACTIVITY_CAPACITY_FULL
 * 5. otherwise ACCEPT
 *
 * `capacityLimit: null` is unlimited. Invalid finite-window/capacity values fail closed.
 *
 * @template TFact
 * @param {{
 *   existing?: TFact | null,
 *   isReplayable?: (fact: TFact) => boolean,
 *   accepting: boolean,
 *   closesAtMs?: number | null,
 *   nowMs: number,
 *   capacityLimit?: number | null,
 *   occupiedSeats?: number,
 * }} input
 * @returns {{
 *   kind: 'REPLAY',
 *   fact: TFact,
 * } | {
 *   kind: 'ACCEPT',
 * } | {
 *   kind: 'REJECT',
 *   code: string,
 * }} The enrollment decision.
 */
function decideEnrollmentAttempt(input) {
  if (!input || typeof input !== 'object') {
    return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID }
  }

  if (!isFiniteNumber(input.nowMs)) {
    return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID }
  }

  const existing = input.existing ?? null
  if (existing != null) {
    const isReplayable = typeof input.isReplayable === 'function'
      ? input.isReplayable
      : () => true
    if (isReplayable(existing)) {
      return { kind: 'REPLAY', fact: existing }
    }
  }

  if (input.accepting !== true) {
    return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.NOT_ACCEPTING }
  }

  const closesAtMs = input.closesAtMs === undefined ? null : input.closesAtMs
  if (closesAtMs !== null) {
    if (!isFiniteNumber(closesAtMs)) {
      // Illegal deadline must not fail-open into ACCEPT.
      throw activityError(ACTIVITY_ERROR_CODES.DATA_INTEGRITY, 'enrollment deadline is not a finite timestamp')
    }
    if (input.nowMs >= closesAtMs) {
      return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.ENROLLMENT_CLOSED }
    }
  }

  const capacityLimit = input.capacityLimit === undefined ? null : input.capacityLimit
  const occupiedSeats = input.occupiedSeats === undefined ? 0 : input.occupiedSeats

  if (!isNonNegativeInteger(occupiedSeats)) {
    return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID }
  }

  if (capacityLimit !== null) {
    if (!isNonNegativeInteger(capacityLimit)) {
      return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID }
    }
    if (occupiedSeats >= capacityLimit) {
      return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.CAPACITY_FULL }
    }
  }

  return { kind: 'ACCEPT' }
}

/**
 * Compare an opaque idempotency fingerprint against a stored record.
 * Hashing stays outside this package; only equality is checked.
 *
 * Priority when a record exists:
 * 1. different fingerprint → CONFLICT
 * 2. same fingerprint and expired → EXPIRED
 * 3. same fingerprint and fresh → REPLAY with the original result
 *
 * @template T
 * @param {{
 *   existing?: null | {
 *     fingerprint: string,
 *     result: T,
 *     expiresAtMs?: number | null,
 *   },
 *   fingerprint: string,
 *   nowMs: number,
 * }} input
 * @returns {{
 *   kind: 'MISS',
 * } | {
 *   kind: 'REPLAY',
 *   result: T,
 * } | {
 *   kind: 'REJECT',
 *   code: string,
 * }} The idempotency decision.
 */
function decideIdempotency(input) {
  if (!input || typeof input !== 'object') {
    return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID }
  }

  if (typeof input.fingerprint !== 'string' || input.fingerprint.length === 0) {
    return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID }
  }

  if (!isFiniteNumber(input.nowMs)) {
    return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID }
  }

  const existing = input.existing ?? null
  if (!existing) {
    return { kind: 'MISS' }
  }

  if (!existing || typeof existing !== 'object') {
    return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID }
  }

  if (typeof existing.fingerprint !== 'string' || existing.fingerprint.length === 0) {
    return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID }
  }

  if (existing.fingerprint !== input.fingerprint) {
    return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.IDEMPOTENCY_CONFLICT }
  }

  const expiresAtMs = existing.expiresAtMs === undefined ? null : existing.expiresAtMs
  if (expiresAtMs !== null) {
    if (!isFiniteNumber(expiresAtMs)) {
      return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.POLICY_INVALID }
    }
    if (input.nowMs >= expiresAtMs) {
      return { kind: 'REJECT', code: ACTIVITY_ERROR_CODES.IDEMPOTENCY_EXPIRED }
    }
  }

  return { kind: 'REPLAY', result: existing.result }
}

/**
 * @param {unknown} value
 * @returns {boolean} Whether the value is a non-empty string.
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * @param {unknown} value
 * @returns {boolean} Whether the value is a plain JSON object.
 */
function isPlainJsonObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Build a storage-agnostic state-change audit record.
 * Metadata must already be redacted by the caller; this package does not redact.
 *
 * @template TState
 * @param {{
 *   actor: { appId: string, actorId: string, actorRole?: string },
 *   action: string,
 *   resourceType: string,
 *   resourceId: string,
 *   from?: TState | null,
 *   to: TState,
 *   version: number,
 *   occurredAtMs: number,
 *   requestId?: string,
 *   metadata?: Record<string, unknown>,
 * }} input
 * @returns {{
 *   appId: string,
 *   actorId: string,
 *   actorRole: string,
 *   action: string,
 *   resourceType: string,
 *   resourceId: string,
 *   from: TState | null,
 *   to: TState,
 *   version: number,
 *   occurredAt: string,
 *   requestId: string,
 *   metadata: Record<string, unknown>,
 * }} The validated audit record.
 */
function buildStateChangeAudit(input) {
  if (!input || typeof input !== 'object') {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'audit input missing')
  }

  const actor = input.actor
  if (!actor || typeof actor !== 'object') {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'actor context missing')
  }
  if (!isNonEmptyString(actor.appId) || !isNonEmptyString(actor.actorId)) {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'actor appId/actorId required')
  }
  if (!isNonEmptyString(input.action)
    || !isNonEmptyString(input.resourceType)
    || !isNonEmptyString(input.resourceId)) {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'action/resource fields required')
  }
  if (input.to === undefined) {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'to state required')
  }
  if (!isFiniteNumber(input.occurredAtMs)) {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'occurredAtMs must be finite')
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'version must be a positive integer')
  }

  const metadata = input.metadata === undefined ? {} : input.metadata
  if (!isPlainJsonObject(metadata)) {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'metadata must be a plain JSON object')
  }

  const requestId = input.requestId ?? ''
  if (typeof requestId !== 'string') {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'requestId must be a string')
  }

  const actorRole = actor.actorRole ?? ''
  if (typeof actorRole !== 'string') {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'actorRole must be a string')
  }

  const occurredAt = new Date(input.occurredAtMs).toISOString()
  if (occurredAt === 'Invalid Date') {
    throw activityError(ACTIVITY_ERROR_CODES.AUDIT_INVALID, 'occurredAtMs is not a valid time')
  }

  return {
    appId: String(actor.appId).trim(),
    actorId: String(actor.actorId).trim(),
    actorRole: String(actorRole),
    action: String(input.action).trim(),
    resourceType: String(input.resourceType).trim(),
    resourceId: String(input.resourceId).trim(),
    from: input.from === undefined ? null : input.from,
    to: input.to,
    version: input.version,
    occurredAt,
    requestId: String(requestId),
    metadata: { ...metadata },
  }
}

module.exports = {
  ACTIVITY_ERROR_CODES,
  decideEnrollmentAttempt,
  decideIdempotency,
  buildStateChangeAudit,
}
