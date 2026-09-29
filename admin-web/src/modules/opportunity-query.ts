import type { AdminListQuery } from './admin-read-contracts.ts'

const FILTER_KEYS = ['ownerUserId', 'ownerQuery', 'cityQuery', 'publishedFrom', 'publishedTo', 'updatedFrom', 'updatedTo', 'deadlineFrom', 'deadlineTo', 'minAmountCents', 'maxAmountCents'] as const

/** One input for the list and export; UI-only keys never reach the server. */
export function opportunityQueryFilters(query: Pick<AdminListQuery, 'query' | 'status' | 'filters'>) {
  return { query: query.query, status: query.status,
    ...Object.fromEntries(FILTER_KEYS.flatMap(key => query.filters?.[key] !== undefined && query.filters[key] !== '' ? [[key, query.filters[key]]] : [])),
  }
}
