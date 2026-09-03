import type { CooperationCardId } from '../mip'
import type {
  CooperationCardDetail,
  CooperationCardDraft,
  CooperationCardFilter,
  CooperationCardPage,
  CooperationCatalog,
  CooperationTalentPage,
} from './types'
import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { callOpportunityApi } from '../mip-opportunities/transport'
import { createMutationKey } from '../mip-opportunities/validation'
import {
  normalizeCooperationCardDraft,
  normalizeCooperationCardFilter,
  parseCooperationTalentPage,
} from './validation'

let minePage: CooperationCardPage | undefined
let pendingMinePage: Promise<CooperationCardPage> | undefined
let mineCacheGeneration = 0

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
    if (!cursor && pendingMinePage) {
      return pendingMinePage
    }

    const generation = mineCacheGeneration
    const request = callOpportunityApi<CooperationCardPage>('listMyCooperationCards', { cursor, limit: 20 })
      .then((page) => {
        if (!cursor && generation === mineCacheGeneration) {
          minePage = page
        }
        return page
      })
      .finally(() => {
        if (!cursor && pendingMinePage === request) {
          pendingMinePage = undefined
        }
      })

    if (!cursor) {
      pendingMinePage = request
    }
    return request
  },

  peekMine() {
    return minePage
  },

  invalidateMine() {
    mineCacheGeneration += 1
    minePage = undefined
    pendingMinePage = undefined
  },

  get(id: CooperationCardId) {
    return callOpportunityApi<CooperationCardDetail>('getCooperationCard', { id })
  },

  save(draft: CooperationCardDraft, idempotencyKey = createMutationKey('cooperation-save')) {
    const { aiConfirmation, ...resourceDraft } = normalizeCooperationCardDraft(draft)
    const request = callOpportunityApi<{ id: CooperationCardId, status: string, version: number }>(
      'saveCooperationCard',
      { draft: resourceDraft, aiConfirmation, idempotencyKey },
    )
    return request.then((result) => {
      cooperationModule.invalidateMine()
      return result
    })
  },

  unpublish(
    id: CooperationCardId,
    expectedVersion: number,
    idempotencyKey = createMutationKey('cooperation-unpublish'),
  ) {
    const request = callOpportunityApi<{ id: CooperationCardId, status: 'UNPUBLISHED', version: number }>(
      'unpublishCooperationCard',
      { id, expectedVersion, idempotencyKey },
    )
    return request.then((result) => {
      cooperationModule.invalidateMine()
      return result
    })
  },

  archive(
    id: CooperationCardId,
    expectedVersion: number,
    idempotencyKey = createMutationKey('cooperation-archive'),
  ) {
    const request = callOpportunityApi<{ id: CooperationCardId, status: 'ARCHIVED', version: number }>(
      'archiveCooperationCard',
      { id, expectedVersion, idempotencyKey },
    )
    return request.then((result) => {
      cooperationModule.invalidateMine()
      return result
    })
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

registerMipLocalUserCache(() => cooperationModule.invalidateMine())
