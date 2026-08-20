/** Shared activity-domain error codes (exact strings). */
export type ActivityErrorCode
  = | 'ACTIVITY_NOT_ACCEPTING'
    | 'ACTIVITY_ENROLLMENT_CLOSED'
    | 'ACTIVITY_CAPACITY_FULL'
    | 'ACTIVITY_IDEMPOTENCY_CONFLICT'
    | 'ACTIVITY_IDEMPOTENCY_EXPIRED'
    | 'ACTIVITY_POLICY_INVALID'
    | 'ACTIVITY_AUDIT_INVALID'
    | 'DATA_INTEGRITY'

export interface EnrollmentAttemptInput<TFact> {
  /** Existing enrollment/membership fact, if any. */
  existing?: TFact | null
  /**
   * Case-owned predicate: which existing facts short-circuit as REPLAY.
   * Defaults to always-true when omitted and existing is present.
   */
  isReplayable?: (fact: TFact) => boolean
  /** Whether the activity currently accepts new enrollments (status window). */
  accepting: boolean
  /** Absolute close timestamp in ms; null/undefined means no deadline. */
  closesAtMs?: number | null
  /** Server clock in ms. */
  nowMs: number
  /** Capacity limit; null/undefined means unlimited. */
  capacityLimit?: number | null
  /** Current seats that count against capacity. */
  occupiedSeats?: number
}

export type EnrollmentDecision<TFact>
  = | { kind: 'REPLAY', fact: TFact }
    | { kind: 'ACCEPT' }
    | { kind: 'REJECT', code: ActivityErrorCode }

export interface IdempotencyRecord<T> {
  /** Opaque fingerprint produced by the caller (already hashed if needed). */
  fingerprint: string
  /** Prior successful result to replay verbatim. */
  result: T
  /** Absolute expiry in ms; null/undefined means no expiry. */
  expiresAtMs?: number | null
}

export interface IdempotencyInput<T> {
  existing?: IdempotencyRecord<T> | null
  fingerprint: string
  nowMs: number
}

export type IdempotencyDecision<T>
  = | { kind: 'MISS' }
    | { kind: 'REPLAY', result: T }
    | { kind: 'REJECT', code: ActivityErrorCode }

export interface ActorContext {
  appId: string
  actorId: string
  actorRole?: string
}

export interface StateChangeAuditInput<TState> {
  actor: ActorContext
  action: string
  resourceType: string
  resourceId: string
  from?: TState | null
  to: TState
  version: number
  occurredAtMs: number
  requestId?: string
  /** Already-redacted plain JSON metadata. */
  metadata?: Record<string, unknown>
}

export interface StateChangeAuditRecord<TState> {
  appId: string
  actorId: string
  actorRole: string
  action: string
  resourceType: string
  resourceId: string
  from: TState | null
  to: TState
  version: number
  /** ISO-8601 timestamp derived from occurredAtMs. */
  occurredAt: string
  requestId: string
  metadata: Record<string, unknown>
}
