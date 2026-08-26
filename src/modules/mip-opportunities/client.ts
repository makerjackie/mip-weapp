import type { OpportunityId } from '../mip'
import type {
  MatchingCandidateType,
  MatchingFeedbackType,
  MatchingPreferences,
  MatchingRequestPage,
  MatchingRequestSummary,
  MatchingResultPage,
  OpportunityCatalog,
  OpportunityCommentMutationResult,
  OpportunityCommentPage,
  OpportunityCommentType,
  OpportunityDetail,
  OpportunityDraft,
  OpportunityFilter,
  OpportunityInteractionResult,
  OpportunityMutationResult,
  OpportunityPage,
  PeopleFilter,
  PeoplePage,
  ProfileInfluenceSummary,
  PublicProfileAggregate,
  ReceivedInteractionCategory,
  ReceivedInteractionPage,
} from './types'
import { callOpportunityApi } from './transport'
import {
  createMutationKey,
  normalizeOpportunityDraft,
  normalizeOpportunityFilter,
  normalizePeopleFilter,
  parseOpportunityDetail,
  parseOpportunityPage,
  parsePeoplePage,
  parseProfileInfluence,
  parsePublicProfileAggregate,
} from './validation'

export const opportunityModule = {
  getCatalogs() {
    return callOpportunityApi<OpportunityCatalog>('getCatalogs')
  },

  async list(filter: OpportunityFilter) {
    return parseOpportunityPage(await callOpportunityApi<OpportunityPage>('listOpportunities', {
      filter: normalizeOpportunityFilter(filter),
    }))
  },

  async get(id: OpportunityId) {
    return parseOpportunityDetail(await callOpportunityApi<OpportunityDetail>('getOpportunity', { id }))
  },

  async listPeople(filter: PeopleFilter) {
    return parsePeoplePage(await callOpportunityApi<PeoplePage>('listPeople', {
      filter: normalizePeopleFilter(filter),
    }))
  },

  async getPublicProfile(profileRef: string) {
    return parsePublicProfileAggregate(await callOpportunityApi<PublicProfileAggregate>(
      'getPublicProfileAggregate',
      { profileRef: profileRef.trim() },
    ))
  },

  async getProfileInfluence() {
    return parseProfileInfluence(await callOpportunityApi<ProfileInfluenceSummary>('getProfileInfluence'))
  },

  recordProfileVisit(
    profileRef: string,
    visitKey = createMutationKey('profile-visit'),
  ) {
    return callOpportunityApi<{ recorded: boolean }>('recordProfileVisit', {
      profileRef: profileRef.trim(),
      visitKey,
    })
  },

  listMine(cursor?: string) {
    return callOpportunityApi<OpportunityPage>('listMine', { cursor, limit: 20 }).then(parseOpportunityPage)
  },

  listReceived(category: ReceivedInteractionCategory, cursor?: string) {
    return callOpportunityApi<ReceivedInteractionPage>('listReceivedInteractions', {
      category,
      cursor,
      limit: 20,
    })
  },

  markReceivedRead(
    messageId: string,
    category: ReceivedInteractionCategory = 'REFERRAL',
    idempotencyKey = createMutationKey('received-interaction-read'),
  ) {
    return callOpportunityApi<{ messageId: string, readAt: string }>('markReceivedInteractionRead', {
      messageId,
      category,
      ...(category === 'VISITOR' ? { profileRef: messageId } : {}),
      idempotencyKey,
    })
  },

  save(draft: OpportunityDraft, idempotencyKey = createMutationKey('opportunity-save')) {
    return callOpportunityApi<OpportunityMutationResult>('saveOpportunity', {
      draft: normalizeOpportunityDraft(draft),
      idempotencyKey,
    })
  },

  end(id: OpportunityId, expectedVersion: number, idempotencyKey = createMutationKey('opportunity-end')) {
    return callOpportunityApi<OpportunityMutationResult>('endOpportunity', {
      id,
      expectedVersion,
      idempotencyKey,
    })
  },

  setReferral(
    id: OpportunityId,
    active: boolean,
    targetProfileRef = '',
    note = '',
    idempotencyKey = createMutationKey('opportunity-referral'),
  ) {
    return callOpportunityApi<OpportunityInteractionResult>('setReferral', {
      id,
      active,
      targetProfileRef: targetProfileRef.trim(),
      note: note.trim(),
      idempotencyKey,
    })
  },

  setAuthorInterest(
    id: OpportunityId,
    active: boolean,
    idempotencyKey = createMutationKey('opportunity-interest'),
  ) {
    return callOpportunityApi<OpportunityInteractionResult>('setProfileInterest', {
      sourceType: 'OPPORTUNITY',
      sourceId: id,
      active,
      idempotencyKey,
    })
  },

  setProfileInterest(
    profileRef: string,
    active: boolean,
    idempotencyKey = createMutationKey('profile-interest'),
  ) {
    return callOpportunityApi<OpportunityInteractionResult>('setProfileInterest', {
      sourceType: 'PROFILE',
      profileRef: profileRef.trim(),
      active,
      idempotencyKey,
    })
  },

  listComments(opportunityId: OpportunityId, cursor?: string) {
    return callOpportunityApi<OpportunityCommentPage>('listOpportunityComments', {
      opportunityId,
      cursor,
      limit: 20,
    })
  },

  saveComment(input: {
    opportunityId: OpportunityId
    commentId?: string
    expectedVersion?: number
    type: OpportunityCommentType
    body: string
    rating?: number
  }, idempotencyKey = createMutationKey('opportunity-comment-save')) {
    return callOpportunityApi<OpportunityCommentMutationResult>('saveOpportunityComment', {
      ...input,
      body: input.body.trim(),
      idempotencyKey,
    })
  },

  deleteComment(
    commentId: string,
    expectedVersion: number,
    idempotencyKey = createMutationKey('opportunity-comment-delete'),
  ) {
    return callOpportunityApi<OpportunityCommentMutationResult>('deleteOpportunityComment', {
      commentId,
      expectedVersion,
      idempotencyKey,
    })
  },

  setCommentCall(
    commentId: string,
    active: boolean,
    idempotencyKey = createMutationKey('opportunity-comment-call'),
  ) {
    return callOpportunityApi<{ id: string, active: boolean, callCount: number }>(
      'setOpportunityCommentCall',
      { commentId, active, idempotencyKey },
    )
  },

  reportComment(input: {
    commentId: string
    category: 'SPAM' | 'HARASSMENT' | 'FRAUD' | 'INAPPROPRIATE_CONTENT' | 'IMPERSONATION' | 'OTHER'
    description?: string
    requestId: string
  }, idempotencyKey = createMutationKey('opportunity-comment-report')) {
    return callOpportunityApi<{ reportId: string, status: 'PENDING' }>('reportOpportunityComment', {
      ...input,
      description: input.description?.trim() || '',
      idempotencyKey,
    })
  },

  getMatchingPreferences() {
    return callOpportunityApi<MatchingPreferences>('getMatchingPreferences')
  },

  saveMatchingPreferences(
    preferences: {
      commentsEnabled: boolean
      opportunityMatchingNotificationsEnabled: boolean
      hotspotsEnabled: boolean
      matchingEnabled: boolean
      talentRecommendationsEnabled: boolean
      projectRecommendationsEnabled: boolean
      discoverableForMatching: boolean
      matchingScope: 'PLATFORM' | 'PRIMARY_BRANCH'
      notificationVersion: number
      opportunityVersion: number
    },
    idempotencyKey = createMutationKey('matching-preferences-save'),
  ) {
    return callOpportunityApi<MatchingPreferences>('saveMatchingPreferences', {
      preferences,
      idempotencyKey,
    })
  },

  createMatchingRequest(
    opportunityId: OpportunityId,
    idempotencyKey = createMutationKey('matching-request-create'),
  ) {
    return callOpportunityApi<MatchingRequestSummary>('createMatchingRequest', {
      opportunityId,
      idempotencyKey,
    })
  },

  listMatchingRequests(cursor?: string) {
    return callOpportunityApi<MatchingRequestPage>('listMatchingRequests', { cursor, limit: 20 })
  },

  listMatchingResults(requestId: string, type: 'ALL' | MatchingCandidateType = 'ALL', cursor?: string) {
    return callOpportunityApi<MatchingResultPage>('listMatchingResults', {
      requestId,
      type,
      cursor,
      limit: 20,
    })
  },

  saveMatchingFeedback(input: {
    requestId: string
    candidateType: MatchingCandidateType
    candidateRef: string
    feedbackType: MatchingFeedbackType
    reason?: string
  }, idempotencyKey = createMutationKey('matching-feedback-save')) {
    return callOpportunityApi<{ id: string, feedbackType: MatchingFeedbackType, reason?: string }>(
      'saveMatchingFeedback',
      { ...input, reason: input.reason?.trim() || '', idempotencyKey },
    )
  },
}
