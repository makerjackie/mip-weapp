import type { OperationValues } from './admin-operation-ui.ts'
import { record } from './admin-read-formatters.ts'

/** Only editable fields cross the read → edit seam; presentation labels stay read-only. */
export function opportunityEditorValues(payload: unknown): OperationValues {
  const item = record(payload)
  if (typeof item.id !== 'string' || !item.id || !Number.isInteger(item.version) || Number(item.version) < 1
    || typeof item.ownerUserId !== 'string' || !item.ownerUserId
    || typeof item.title !== 'string' || typeof item.valueSummary !== 'string'
    || !['PLATFORM', 'BRANCH'].includes(String(item.scopeType))
    || !Array.isArray(item.roleKeys) || !Array.isArray(item.tagIds)) {
    throw new Error('机会详情字段不完整，请重新加载；当前内容未保存。')
  }
  const draft: OperationValues = {}
  for (const key of ['ownerUserId', 'scopeType', 'branchId', 'title', 'valueSummary', 'targetSummary', 'description', 'cityTagId', 'coverAssetId', 'roleKeys', 'tagIds', 'deadlineAt']) {
    draft[key] = item[key] ?? (['roleKeys', 'tagIds'].includes(key) ? [] : '')
  }
  if (item.commercialTerms) {
    const terms = record(item.commercialTerms)
    if (!Array.isArray(terms.locations)) throw new Error('机会商业条件不完整，请重新加载。')
    draft.commercialTerms = {
      currency: 'CNY', amountUnit: 'CNY_CENTS',
      minAmountCents: terms.minAmountCents ?? null,
      maxAmountCents: terms.maxAmountCents ?? null,
      locations: terms.locations.map(location => {
        const value = record(location)
        return value.type === 'CITY' ? { type: value.type, cityTagId: value.cityTagId } : { type: value.type }
      }),
    }
  }
  return { opportunityId: item.id, expectedVersion: item.version, draft,
    _mediaUrls: item.coverAssetId && typeof item.coverUrl === 'string' ? { [String(item.coverAssetId)]: item.coverUrl } : {},
    ...(Array.isArray(item.availableActions) ? { _canSave: item.availableActions.includes('mip.admin.opportunities.save') } : {}) }
}
