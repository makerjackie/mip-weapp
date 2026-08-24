import type { SuperCaseId } from '../mip'
import type { SuperCaseDetail, SuperCaseDraft, SuperCasePage } from './types'
import { callOpportunityApi } from '../mip-opportunities/transport'
import { createMutationKey } from '../mip-opportunities/validation'
import { normalizeSuperCaseDraft } from './validation'

export const superCaseModule = {
  list(cursor?: string) {
    return callOpportunityApi<SuperCasePage>('listSuperCases', { cursor, limit: 16 })
  },

  listMine(cursor?: string) {
    return callOpportunityApi<SuperCasePage>('listMySuperCases', { cursor, limit: 20 })
  },

  get(id: SuperCaseId) {
    return callOpportunityApi<SuperCaseDetail>('getSuperCase', { id })
  },

  save(draft: SuperCaseDraft, idempotencyKey = createMutationKey('case-save')) {
    const { aiConfirmation, ...resourceDraft } = normalizeSuperCaseDraft(draft)
    return callOpportunityApi<{ id: SuperCaseId, status: string, version: number }>('saveSuperCase', {
      draft: resourceDraft,
      aiConfirmation,
      idempotencyKey,
    })
  },

  unpublish(
    id: SuperCaseId,
    expectedVersion: number,
    idempotencyKey = createMutationKey('case-unpublish'),
  ) {
    return callOpportunityApi<{ id: SuperCaseId, status: 'UNPUBLISHED', version: number }>(
      'unpublishSuperCase',
      { id, expectedVersion, idempotencyKey },
    )
  },

  setOwnerInterest(
    id: SuperCaseId,
    active: boolean,
    idempotencyKey = createMutationKey('case-interest'),
  ) {
    return callOpportunityApi<{ active: boolean, version: number }>('setProfileInterest', {
      sourceType: 'SUPER_CASE',
      sourceId: id,
      active,
      idempotencyKey,
    })
  },
}
