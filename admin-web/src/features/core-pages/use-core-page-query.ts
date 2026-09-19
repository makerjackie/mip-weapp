import { useQuery } from '@tanstack/react-query'
import { useAdminSession } from '../../app/session-provider'
import {
  loadAdminReadPage,
  type AdminListQuery,
  type AdminListRoute,
  type AdminRequest,
  getAdminReadRouteDefinition,
} from '../../modules/admin-read-pages'
import { createCoreDemoOverview, createCoreDemoReadPage } from './core-demo-adapter'
import type { CorePageSearchState } from './core-page-types'
import { loadAdminOverview } from './overview-model'

type CoreListRoute = 'users' | 'events' | 'orders'

function stableFilters(filters: Record<string, string> | undefined): string {
  if (!filters || Object.keys(filters).length === 0) return '{}'
  return JSON.stringify(Object.keys(filters).sort().reduce((acc, key) => {
    acc[key] = filters[key]
    return acc
  }, {} as Record<string, string>))
}

export function useCoreReadPage(route: CoreListRoute, search: CorePageSearchState) {
  const sessionState = useAdminSession()
  const query = normalizeListQuery(search, route)
  const request: AdminRequest = (action, input) => sessionState.request(action, input)
  const enabled = sessionState.demoMode || Boolean(sessionState.session?.enabled)
  const result = useQuery({
    queryKey: [
      'admin-read-page',
      sessionState.session?.actor?.id || 'anonymous',
      sessionState.sessionBoundary,
      sessionState.demoMode ? 'demo' : 'api',
      route,
      query.query,
      query.status,
      query.cursor,
      query.limit,
      stableFilters(query.filters),
    ],
    enabled,
    queryFn: () => sessionState.demoMode
      ? Promise.resolve(createCoreDemoReadPage(route, query))
      : loadAdminReadPage(route, query, request, {
        hasCapability: (capability, scopeType) => scopeType
          ? sessionState.hasCapabilityAtScope(capability, scopeType)
          : sessionState.hasCapability(capability),
      }),
  })
  return {
    ...result,
    loading: sessionState.loading || (enabled && result.isPending),
    errorMessage: errorMessage(result.error || sessionState.error),
  }
}

export function useAdminOverview() {
  const sessionState = useAdminSession()
  const request: AdminRequest = (action, input) => sessionState.request(action, input)
  const enabled = sessionState.demoMode || Boolean(sessionState.session?.enabled)
  const result = useQuery({
    queryKey: [
      'admin-overview',
      sessionState.session?.actor?.id || 'anonymous',
      sessionState.sessionBoundary,
      sessionState.demoMode ? 'demo' : 'api',
    ],
    enabled,
    queryFn: () => sessionState.demoMode
      ? Promise.resolve(createCoreDemoOverview())
      : loadAdminOverview(request),
  })
  return {
    ...result,
    loading: sessionState.loading || (enabled && result.isPending),
    errorMessage: errorMessage(result.error || sessionState.error),
  }
}

export function normalizeListQuery(search: CorePageSearchState, route?: string): AdminListQuery {
  const declaredKeys = route
    ? new Set((getAdminReadRouteDefinition(route as AdminListRoute)?.filterDimensions ?? []).map(d => d.key))
    : null
  const rawFilters = search.filters
  const filters = rawFilters && Object.keys(rawFilters).length > 0
    ? Object.fromEntries(
        Object.entries(rawFilters)
          .filter(([key, value]) => typeof value === 'string' && value.length > 0 && (!declaredKeys || declaredKeys.has(key)))
          .map(([key, value]) => [key, String(value)]),
      )
    : undefined
  return {
    query: search.q?.trim() || '',
    status: search.status || '',
    cursor: search.cursor || null,
    limit: 20,
    filters: filters && Object.keys(filters).length > 0 ? filters : undefined,
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : ''
}
