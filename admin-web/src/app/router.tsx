import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { FoundationPage } from '../pages/foundation-page'
import { ResponsiveAppShell } from '../shared/ui/responsive-app-shell'
import { adminNavigation } from './navigation'

export interface AdminListSearch {
  q?: string
  status?: string
  cursor?: string
  page?: number
  tab?: string
}

function validateSearch(search: Record<string, unknown>): AdminListSearch {
  const text = (key: string, maximum = 120) => typeof search[key] === 'string' ? String(search[key]).slice(0, maximum) : undefined
  const page = Number(search.page)
  return {
    q: text('q', 80),
    status: text('status', 64),
    cursor: text('cursor', 512),
    page: Number.isSafeInteger(page) && page > 1 ? page : undefined,
    tab: text('tab', 64),
  }
}

const rootRoute = createRootRoute({ component: ResponsiveAppShell })
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => { throw redirect({ to: '/overview' }) },
})

const pageRoutes = adminNavigation.map(item => createRoute({
  getParentRoute: () => rootRoute,
  path: item.path,
  validateSearch,
  component: FoundationPage,
}))

const routeTree = rootRoute.addChildren([indexRoute, ...pageRoutes])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
