import type { EventCommentSubmissionInput, ReportCategory } from './types'
import { createMipCommunityGateway } from './gateway'
import { createCommunityRequestId } from './report-intent'
import { callCommunityApi } from './transport'

const gateway = createMipCommunityGateway({ invoke: callCommunityApi })

export const mipCommunityModule = {
  relationship(profileRef: string) {
    return gateway.relationship(profileRef.trim())
  },

  block(profileRef: string) {
    return gateway.block(profileRef.trim())
  },

  unblock(profileRef: string) {
    return gateway.unblock(profileRef.trim())
  },

  listBlocked(cursor?: string) {
    return gateway.listBlocked(cursor)
  },

  report(
    profileRef: string,
    category: ReportCategory,
    description = '',
    stableRequestId = createCommunityRequestId(),
  ) {
    return gateway.report({
      profileRef: profileRef.trim(),
      category,
      description: description.trim(),
      requestId: stableRequestId,
    })
  },

  listEventComments(eventId: string, cursor?: string) {
    return gateway.listEventComments(eventId.trim(), cursor)
  },

  saveEventComment(input: EventCommentSubmissionInput, idempotencyKey: string) {
    return gateway.saveEventComment({
      ...input,
      eventId: input.eventId.trim(),
      body: input.body.trim(),
    }, idempotencyKey)
  },

  deleteEventComment(
    eventId: string,
    commentId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return gateway.deleteEventComment(
      eventId.trim(),
      commentId.trim(),
      expectedVersion,
      idempotencyKey,
    )
  },

  reportEventComment(input: {
    eventId: string
    commentId: string
    expectedVersion: number
    category: ReportCategory
    description?: string
    requestId: string
    idempotencyKey: string
  }) {
    return gateway.reportEventComment({
      ...input,
      eventId: input.eventId.trim(),
      commentId: input.commentId.trim(),
      description: input.description?.trim() || '',
    })
  },
}
