import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { ResponsiveAppShell } from '../shared/ui/responsive-app-shell'
import { adminNavigation } from './navigation'
import { routeComponents } from './route-pages'

export interface AdminListSearch {
  q?: string
  status?: string
  cursor?: string
  page?: number
  tab?: string
  filters?: Record<string, string>
}

function validateSearch(search: Record<string, unknown>): AdminListSearch {
  const text = (key: string, maximum = 120) => typeof search[key] === 'string' ? String(search[key]).slice(0, maximum) : undefined
  const page = Number(search.page)
  const rawFilters = search.filters
  const filters = rawFilters && typeof rawFilters === 'object' && !Array.isArray(rawFilters)
    ? Object.fromEntries(
        Object.entries(rawFilters as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string' && v.length > 0)
          .map(([k, v]) => [k, String(v)]),
      )
    : undefined
  return {
    q: text('q', 80),
    status: text('status', 64),
    cursor: text('cursor', 512),
    page: Number.isSafeInteger(page) && page > 1 ? page : undefined,
    tab: text('tab', 64),
    filters: filters && Object.keys(filters).length > 0 ? filters : undefined,
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
  component: routeComponents[item.path],
}))

const eventEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId/edit',
  component: routeComponents['/events/$eventId/edit'],
})

const taskEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks/$taskId/edit',
  component: routeComponents['/tasks/$taskId/edit'],
})

const opportunityEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/opportunities/$opportunityId/edit',
  component: routeComponents['/opportunities/$opportunityId/edit'],
})

const knowledgeEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/knowledge/$contentId/edit',
  component: routeComponents['/knowledge/$contentId/edit'],
})

const userContentEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/userContent/$contentId/edit',
  component: routeComponents['/userContent/$contentId/edit'],
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  ...pageRoutes,
  eventEditRoute,
  taskEditRoute,
  opportunityEditRoute,
  knowledgeEditRoute,
  userContentEditRoute,
])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
