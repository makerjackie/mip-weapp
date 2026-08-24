import type { OpportunityCommentType } from './types'
import { createMutationKey } from './validation'

export interface OpportunityCommentSubmissionInput {
  opportunityId: string
  commentId?: string
  expectedVersion?: number
  type: OpportunityCommentType
  body: string
  rating?: number
}

export interface OpportunityCommentSubmissionIntent {
  fingerprint: string
  idempotencyKey: string
}

export interface OpportunityCommentReportInput {
  commentId: string
  category: string
  description?: string
}

export interface OpportunityCommentReportIntent {
  fingerprint: string
  requestId: string
  idempotencyKey: string
}

function submissionFingerprint(input: OpportunityCommentSubmissionInput) {
  return JSON.stringify({
    opportunityId: input.opportunityId,
    commentId: input.commentId || null,
    expectedVersion: input.expectedVersion ?? null,
    type: input.type,
    body: input.body.trim(),
    rating: input.type === 'REVIEW' ? input.rating ?? null : null,
  })
}

function reportFingerprint(input: OpportunityCommentReportInput) {
  return JSON.stringify({
    commentId: input.commentId,
    category: input.category,
    description: input.description?.trim() || '',
  })
}

export function retainOpportunityCommentSubmissionIntent(
  current: OpportunityCommentSubmissionIntent | null,
  input: OpportunityCommentSubmissionInput,
  createKey = () => createMutationKey('opportunity-comment-save'),
): OpportunityCommentSubmissionIntent {
  const fingerprint = submissionFingerprint(input)
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, idempotencyKey: createKey() }
}

export function retainOpportunityCommentReportIntent(
  current: OpportunityCommentReportIntent | null,
  input: OpportunityCommentReportInput,
  createIdempotencyKey = () => createMutationKey('opportunity-comment-report'),
  createRequestId = () => createMutationKey('opportunity-comment-report-request'),
): OpportunityCommentReportIntent {
  const fingerprint = reportFingerprint(input)
  return current?.fingerprint === fingerprint
    ? current
    : {
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
        requestId: createRequestId(),
      }
}
