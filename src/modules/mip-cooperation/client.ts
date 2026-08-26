import type { CooperationCardId } from '../mip'
import type {
  CooperationCardDetail,
  CooperationCardDraft,
  CooperationCardFilter,
  CooperationCardPage,
  CooperationCatalog,
  CooperationTalentPage,
} from './types'
import { callOpportunityApi } from '../mip-opportunities/transport'
import { createMutationKey } from '../mip-opportunities/validation'
import {
  normalizeCooperationCardDraft,
  normalizeCooperationCardFilter,
  parseCooperationTalentPage,
} from './validation'

export const cooperationModule = {
  getCatalogs() {
    return callOpportunityApi<CooperationCatalog>('getCatalogs')
  },

  list(filter: CooperationCardFilter = {}) {
    return callOpportunityApi<CooperationCardPage>('listCooperationCards', {
      filter: normalizeCooperationCardFilter(filter),
    })
  },

  async listTalents(filter: CooperationCardFilter = {}) {
    const page = await callOpportunityApi<CooperationTalentPage>('listCooperationTalents', {
      filter: normalizeCooperationCardFilter(filter),
    })
    return parseCooperationTalentPage(page)
  },

  listMine(cursor?: string) {
    return callOpportunityApi<CooperationCardPage>('listMyCooperationCards', { cursor, limit: 20 })
  },

  get(id: CooperationCardId) {
    return callOpportunityApi<CooperationCardDetail>('getCooperationCard', { id })
  },

  save(draft: CooperationCardDraft, idempotencyKey = createMutationKey('cooperation-save')) {
    const { aiConfirmation, ...resourceDraft } = normalizeCooperationCardDraft(draft)
    return callOpportunityApi<{ id: CooperationCardId, status: string, version: number }>(
      'saveCooperationCard',
      { draft: resourceDraft, aiConfirmation, idempotencyKey },
    )
  },

  unpublish(
    id: CooperationCardId,
    expectedVersion: number,
    idempotencyKey = createMutationKey('cooperation-unpublish'),
  ) {
    return callOpportunityApi<{ id: CooperationCardId, status: 'UNPUBLISHED', version: number }>(
      'unpublishCooperationCard',
      { id, expectedVersion, idempotencyKey },
    )
  },

  archive(
    id: CooperationCardId,
    expectedVersion: number,
    idempotencyKey = createMutationKey('cooperation-archive'),
  ) {
    return callOpportunityApi<{ id: CooperationCardId, status: 'ARCHIVED', version: number }>(
      'archiveCooperationCard',
      { id, expectedVersion, idempotencyKey },
    )
  },

  setOwnerInterest(
    id: CooperationCardId,
    active: boolean,
    idempotencyKey = createMutationKey('cooperation-interest'),
  ) {
    return callOpportunityApi<{ active: boolean, version: number }>('setProfileInterest', {
      sourceType: 'COOPERATION_CARD',
      sourceId: id,
      active,
      idempotencyKey,
    })
  },
}
