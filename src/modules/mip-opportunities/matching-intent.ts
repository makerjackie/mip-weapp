import type { MatchingCandidateType, MatchingFeedbackType } from './types'
import { createMutationKey } from './validation'

export interface MatchingRequestIntent {
  fingerprint: string
  idempotencyKey: string
}

export interface MatchingFeedbackIntent {
  fingerprint: string
  idempotencyKey: string
}

export function retainMatchingRequestIntent(
  current: MatchingRequestIntent | null,
  opportunityId: string,
  createKey = () => createMutationKey('matching-request-create'),
) {
  const fingerprint = JSON.stringify({ opportunityId })
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, idempotencyKey: createKey() }
}

export function retainMatchingFeedbackIntent(
  current: MatchingFeedbackIntent | null,
  input: {
    requestId: string
    candidateType: MatchingCandidateType
    candidateRef: string
    feedbackType: MatchingFeedbackType
    reason?: string
  },
  createKey = () => createMutationKey('matching-feedback-save'),
) {
  const fingerprint = JSON.stringify({
    requestId: input.requestId,
    candidateType: input.candidateType,
    candidateRef: input.candidateRef,
    feedbackType: input.feedbackType,
    reason: input.reason?.trim() || '',
  })
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, idempotencyKey: createKey() }
}
