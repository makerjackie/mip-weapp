import type { OpportunityId } from '../mip'
import type {
  OpportunityCatalog,
  OpportunityDetail,
  OpportunityDraft,
  OpportunityFilter,
  OpportunityInteractionResult,
  OpportunityMutationResult,
  OpportunityPage,
  ReceivedInteractionCategory,
  ReceivedInteractionPage,
} from './types'
import { callOpportunityApi } from './transport'
import { createMutationKey, normalizeOpportunityDraft, normalizeOpportunityFilter } from './validation'

export const opportunityModule = {
  getCatalogs() {
    return callOpportunityApi<OpportunityCatalog>('getCatalogs')
  },

  list(filter: OpportunityFilter) {
    return callOpportunityApi<OpportunityPage>('listOpportunities', {
      filter: normalizeOpportunityFilter(filter),
    })
  },

  get(id: OpportunityId) {
    return callOpportunityApi<OpportunityDetail>('getOpportunity', { id })
  },

  listMine(cursor?: string) {
    return callOpportunityApi<OpportunityPage>('listMine', { cursor, limit: 20 })
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
    idempotencyKey = createMutationKey('received-interaction-read'),
  ) {
    return callOpportunityApi<{ messageId: string, readAt: string }>('markReceivedInteractionRead', {
      messageId,
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
    note = '',
    idempotencyKey = createMutationKey('opportunity-referral'),
  ) {
    return callOpportunityApi<OpportunityInteractionResult>('setReferral', {
      id,
      active,
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
}
