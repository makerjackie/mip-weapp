import type {
  ActivityErrorCode,
  EnrollmentAttemptInput,
  EnrollmentDecision,
  IdempotencyDecision,
  IdempotencyInput,
  StateChangeAuditInput,
  StateChangeAuditRecord,
} from './types'

export const ACTIVITY_ERROR_CODES: Readonly<{
  NOT_ACCEPTING: 'ACTIVITY_NOT_ACCEPTING'
  ENROLLMENT_CLOSED: 'ACTIVITY_ENROLLMENT_CLOSED'
  CAPACITY_FULL: 'ACTIVITY_CAPACITY_FULL'
  IDEMPOTENCY_CONFLICT: 'ACTIVITY_IDEMPOTENCY_CONFLICT'
  IDEMPOTENCY_EXPIRED: 'ACTIVITY_IDEMPOTENCY_EXPIRED'
  POLICY_INVALID: 'ACTIVITY_POLICY_INVALID'
  AUDIT_INVALID: 'ACTIVITY_AUDIT_INVALID'
  DATA_INTEGRITY: 'DATA_INTEGRITY'
}>

export function decideEnrollmentAttempt<TFact>(
  input: EnrollmentAttemptInput<TFact>,
): EnrollmentDecision<TFact>

export function decideIdempotency<T>(
  input: IdempotencyInput<T>,
): IdempotencyDecision<T>

export function buildStateChangeAudit<TState>(
  input: StateChangeAuditInput<TState>,
): StateChangeAuditRecord<TState>

export type { ActivityErrorCode }
