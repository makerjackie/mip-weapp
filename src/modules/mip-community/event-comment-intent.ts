import type {
  EventCommentDeleteIntent,
  EventCommentReportInput,
  EventCommentReportIntent,
  EventCommentSubmissionInput,
  EventCommentSubmissionIntent,
} from './types'

export function createEventCommentMutationKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function retainIntent<T extends { fingerprint: string, idempotencyKey: string }>(
  current: T | null,
  fingerprint: string,
  createKey: () => string,
  additional: Omit<T, 'fingerprint' | 'idempotencyKey'>,
) {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, idempotencyKey: createKey(), ...additional } as T
}

export function retainEventCommentSubmissionIntent(
  current: EventCommentSubmissionIntent | null,
  input: EventCommentSubmissionInput,
  createKey = () => createEventCommentMutationKey('event-comment-save'),
) {
  const fingerprint = JSON.stringify({
    eventId: input.eventId,
    commentId: input.commentId || null,
    expectedVersion: input.expectedVersion ?? null,
    body: input.body.trim(),
  })
  return retainIntent(current, fingerprint, createKey, {})
}

export function retainEventCommentDeleteIntent(
  current: EventCommentDeleteIntent | null,
  input: { eventId: string, commentId: string, expectedVersion: number },
  createKey = () => createEventCommentMutationKey('event-comment-delete'),
) {
  const fingerprint = JSON.stringify(input)
  return retainIntent(current, fingerprint, createKey, {})
}

export function retainEventCommentReportIntent(
  current: EventCommentReportIntent | null,
  input: EventCommentReportInput,
  createIdempotencyKey = () => createEventCommentMutationKey('event-comment-report'),
  createRequestId = () => createEventCommentMutationKey('event-comment-report-request'),
) {
  const fingerprint = JSON.stringify({
    eventId: input.eventId,
    commentId: input.commentId,
    expectedVersion: input.expectedVersion,
    category: input.category,
    description: input.description?.trim() || '',
  })
  return retainIntent(current, fingerprint, createIdempotencyKey, {
    requestId: createRequestId(),
  })
}

export function canResumeEventCommentMutation<T>(
  accessReady: boolean,
  pendingAction: T | null | undefined,
): pendingAction is T {
  return accessReady && Boolean(pendingAction)
}
