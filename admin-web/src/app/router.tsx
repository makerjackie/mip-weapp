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
