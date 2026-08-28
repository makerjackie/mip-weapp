import { useQuery } from '@tanstack/react-query'
import { useAdminSession } from '../../app/session-provider'
import {
  loadAdminReadPage,
  type AdminListQuery,
  type AdminRequest,
} from '../../modules/admin-read-pages'
import { createCoreDemoOverview, createCoreDemoReadPage } from './core-demo-adapter'
import type { CorePageSearchState } from './core-page-types'
import { loadAdminOverview } from './overview-model'

type CoreListRoute = 'users' | 'events' | 'orders'

export function useCoreReadPage(route: CoreListRoute, search: CorePageSearchState) {
  const sessionState = useAdminSession()
  const query = normalizeListQuery(search)
  const request: AdminRequest = (action, input) => sessionState.request(action, input)
  const enabled = sessionState.demoMode || Boolean(sessionState.session?.enabled)
  const result = useQuery({
    queryKey: [
      'admin-read-page',
      sessionState.session?.actor?.id || 'anonymous',
      sessionState.demoMode ? 'demo' : 'api',
      route,
      query.query,
      query.status,
      query.cursor,
      query.limit,
    ],
    enabled,
    queryFn: () => sessionState.demoMode
      ? Promise.resolve(createCoreDemoReadPage(route, query))
      : loadAdminReadPage(route, query, request),
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

export function normalizeListQuery(search: CorePageSearchState): AdminListQuery {
  return {
    query: search.q?.trim() || '',
    status: search.status || '',
    cursor: search.cursor || null,
    limit: 20,
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : ''
}
