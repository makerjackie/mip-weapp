import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminRoot } from './admin-root'
import { useAdminOperations } from '../features/admin-runtime/admin-operation-provider'
const state = vi.hoisted(() => ({ request: vi.fn(async () => ({ draftId: '41' })) }))
vi.mock('./session-provider', () => ({ useAdminSession: () => ({ demoMode: false, hasCapability: () => true, request: state.request, sessionBoundary: 1 }) }))
vi.mock('../shared/ui/responsive-app-shell', () => ({ ResponsiveAppShell: () => <Outlet /> }))
vi.mock('../shared/ui', () => ({
  humanizeError: (error: Error) => error.message,
  MutationDialog: ({ open, values, onSubmit }: { open: boolean; values: Record<string, unknown>; onSubmit: (values: Record<string, unknown>) => void }) => open ? <button onClick={() => onSubmit(values)}>准备复制</button> : null,
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => open ? <button onClick={onConfirm}>确认复制</button> : null,
}))
afterEach(cleanup)
it('navigates to the copied draft through the real router context', async () => {
  function Source() {
    const { launch } = useAdminOperations()
    return <button onClick={() => void launch('mip.admin.events.clone', 'event-a', { route: 'events', title: '原活动', subtitle: '', status: 'DRAFT', sections: [{ title: '活动信息', fields: [{ label: '版本', value: '4' }] }] })}>复制活动</button>
  }
  const root = createRootRoute({ component: AdminRoot })
  const source = createRoute({ getParentRoute: () => root, path: '/', component: Source })
  const edit = createRoute({ getParentRoute: () => root, path: '/events/$eventId/edit', component: () => <h1>编辑复制草稿</h1> })
  const router = createRouter({ routeTree: root.addChildren([source, edit]), history: createMemoryHistory({ initialEntries: ['/'] }) })
  render(<QueryClientProvider client={new QueryClient()}><App><RouterProvider router={router} /></App></QueryClientProvider>)
  fireEvent.click(await screen.findByText('复制活动'))
  fireEvent.click(await screen.findByText('准备复制'))
  fireEvent.click(await screen.findByText('确认复制'))
  await screen.findByRole('heading', { name: '编辑复制草稿' })
  await waitFor(() => expect(router.state.location.pathname).toBe('/events/new/edit'))
  expect(router.state.location.search).toMatchObject({ draftId: '41' })
  expect(state.request).toHaveBeenCalledWith('mip.admin.events.clone', expect.objectContaining({ sourceEventId: 'event-a', expectedVersion: 4, draftOnly: true, idempotencyKey: expect.any(String) }))
})
