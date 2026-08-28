import { useQuery } from '@tanstack/react-query'
import { useAdminSession } from '../../app/session-provider'
import {
  loadAdminReadPage,
  type AdminListQuery,
  type AdminListRoute,
} from '../../modules/admin-read-pages'
import { createDemoReadPage } from './demo-read-pages'

export function useAdminReadPage(route: AdminListRoute, query: AdminListQuery) {
  const session = useAdminSession()
  const enabled = session.demoMode || Boolean(session.session?.enabled)
  const result = useQuery({
    queryKey: ['admin', 'read-page', session.session?.actor?.id || 'anonymous', session.demoMode ? 'demo' : 'api', route, query],
    enabled,
    queryFn: () => session.demoMode
      ? Promise.resolve(createDemoReadPage(route, query))
      : loadAdminReadPage(route, query, session.request),
  })
  return {
    ...result,
    loading: session.loading || (enabled && result.isPending),
    errorMessage: errorMessage(result.error || session.error),
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : ''
}
