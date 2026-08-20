/**
 * Shared activity-domain decisions for enrollment, idempotency, and audit rows.
 * Pure TypeScript seam over the dual-format pure.cjs runtime implementation.
 */

export {
  ACTIVITY_ERROR_CODES,
  buildStateChangeAudit,
  decideEnrollmentAttempt,
  decideIdempotency,
} from './pure.cjs'

export type {
  ActivityErrorCode,
  ActorContext,
  EnrollmentAttemptInput,
  EnrollmentDecision,
  IdempotencyDecision,
  IdempotencyInput,
  IdempotencyRecord,
  StateChangeAuditInput,
  StateChangeAuditRecord,
} from './types'
