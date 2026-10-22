import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PermissionsRoutePage } from './route-pages'

afterEach(cleanup)

it('replaces the old server tab link with the independent server route and preserves filters', async () => {
  const root = createRootRoute()
  const permissions = createRoute({ getParentRoute: () => root, path: '/permissions', validateSearch: (search: Record<string, unknown>) => search, component: PermissionsRoutePage })
  const servers = createRoute({ getParentRoute: () => root, path: '/servers', validateSearch: (search: Record<string, unknown>) => search, component: () => <h1>服务器管理</h1> })
  const router = createRouter({ routeTree: root.addChildren([permissions, servers]), history: createMemoryHistory({ initialEntries: ['/permissions?tab=branches&q=深圳&status=ACTIVE'] }) })
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { name: '服务器管理' })
  await waitFor(() => expect(router.state.location.pathname).toBe('/servers'))
  expect(router.state.location.search).toMatchObject({ q: '深圳', status: 'ACTIVE' })
  expect(router.state.location.search).not.toHaveProperty('tab')
  expect(router.history.length).toBe(1)
})
