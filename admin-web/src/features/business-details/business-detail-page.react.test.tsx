import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useNavigate } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import { EventDetailPage, OpportunityDetailPage } from './business-detail-page'

const state = vi.hoisted(() => ({ request: vi.fn(), launch: vi.fn(), session: { enabled: true, actor: { id: 'operator' } }, hasCapability: () => true, hasCapabilityAtScope: () => true }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({ request: state.request, session: state.session, demoMode: false, sessionBoundary: 'test', hasCapability: state.hasCapability, hasCapabilityAtScope: state.hasCapabilityAtScope }) }))
vi.mock('../admin-runtime/admin-operation-provider', () => ({ useAdminOperations: () => ({ launch: state.launch }) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const returnSearch = { q: '测试', status: 'PUBLISHED', page: 2, cursor: 'next-page', filters: { branchId: 'test-branch' } }
function mount(route: 'events' | 'opportunities') {
  const root = createRootRoute({ component: Outlet })
  function List() {
    const navigate = useNavigate()
    return <button onClick={() => void navigate({ to: `/${route}/$${route === 'events' ? 'eventId' : 'opportunityId'}` as never, params: route === 'events' ? { eventId: 'record-1' } : { opportunityId: 'record-1' }, search: { returnSearch } } as never)}>打开详情</button>
  }
  const list = createRoute({ getParentRoute: () => root, path: `/${route}`, component: List, validateSearch: (search: Record<string, unknown>) => search })
  const detail = createRoute({ getParentRoute: () => root, path: `/${route}/$${route === 'events' ? 'eventId' : 'opportunityId'}`, component: route === 'events' ? EventDetailPage : OpportunityDetailPage, validateSearch: (search: Record<string, unknown>) => search })
  const edit = createRoute({ getParentRoute: () => root, path: `/${route}/$${route === 'events' ? 'eventId' : 'opportunityId'}/edit`, component: () => <h1>编辑页面</h1>, validateSearch: (search: Record<string, unknown>) => search })
  const router = createRouter({ routeTree: root.addChildren([list, detail, edit]), history: createMemoryHistory({ initialEntries: [`/${route}`] }) })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App><RouterProvider router={router} /></App></QueryClientProvider>)
  return router
}

it('opens and refreshes an event in its own URL and returns to the exact list filters', async () => {
  state.request.mockImplementation(async (action: string) => action === 'mip.admin.events.get'
    ? { id: 'record-1', title: '真实测试活动', status: 'PUBLISHED', version: 3, description: '<p>活动正文</p>', availableActions: [] }
    : { items: [], nextCursor: null })
  const router = mount('events')
  fireEvent.click(await screen.findByRole('button', { name: '打开详情' }))
  await screen.findByRole('heading', { name: '真实测试活动' })
  expect(router.state.location.pathname).toBe('/events/record-1')
  expect(screen.getByText('活动正文')).toBeVisible()
  state.request.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.events.get', { eventId: 'record-1' }))
  fireEvent.click(screen.getByRole('button', { name: '返回列表' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/events'))
  expect(router.state.location.search).toEqual(returnSearch)
})

it('opens opportunity content/referrals/history and keeps list filters when entering its editor', async () => {
  state.request.mockImplementation(async (action: string) => action === 'mip.admin.opportunities.get'
    ? { id: 'record-1', title: '测试合作', status: 'PUBLISHED', version: 3, description: '项目具体内容', commercialTerms: { amountDisplay: '面谈' }, availableActions: ['mip.admin.opportunities.save'] }
    : { items: [], nextCursor: null })
  const router = mount('opportunities')
  fireEvent.click(await screen.findByRole('button', { name: '打开详情' }))
  await screen.findByRole('heading', { name: '测试合作' })
  expect(screen.getByText('项目具体内容')).toBeVisible()
  expect(screen.getByRole('tab', { name: '想推荐名单' })).toBeVisible()
  expect(screen.getByRole('tab', { name: '操作记录' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '编辑机会' }))
  await screen.findByRole('heading', { name: '编辑页面' })
  expect(router.state.location.pathname).toBe('/opportunities/record-1/edit')
  expect(router.state.location.search).toEqual({ returnSearch })
})
