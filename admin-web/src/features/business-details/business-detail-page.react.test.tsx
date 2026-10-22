import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useNavigate } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import { EventDetailPage, OpportunityDetailPage } from './business-detail-page'
import { DetailSections } from '../../shared/ui/detail-drawer'

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
    ? { id: 'record-1', title: '真实测试活动', status: 'PUBLISHED', version: 3, description: '<p>活动正文</p>',
        coverUrl: 'https://media.example/event-cover.png', accessType: 'PAID', priceCents: 5900,
        venueName: '真实测试场地', address: '测试地址', cityName: '深圳', availableActions: [] }
    : { items: [], nextCursor: null })
  const router = mount('events')
  fireEvent.click(await screen.findByRole('button', { name: '打开详情' }))
  await screen.findByRole('heading', { name: '真实测试活动' })
  expect(router.state.location.pathname).toBe('/events/record-1')
  expect(screen.getByText('活动正文')).toBeVisible()
  const summary = screen.getByRole('region', { name: '活动信息' })
  expect(summary).toHaveClass('detail-cover-summary')
  expect(within(summary).getByRole('img', { name: '真实测试活动封面' })).toHaveAttribute('src', 'https://media.example/event-cover.png')
  expect(within(summary).getByText('真实测试场地')).toBeVisible()
  expect(within(summary).getByText('测试地址')).toBeVisible()
  expect(within(summary).getByText('深圳')).toBeVisible()
  expect(within(summary).getByText('价格')).toBeVisible()
  expect(within(summary).queryByText('版本')).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '参与人' })).toBeVisible()
  expect(screen.getByRole('tab', { name: '活动反馈' })).toBeVisible()
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
  const summary = screen.getByRole('region', { name: '机会信息' })
  expect(summary).toHaveClass('detail-cover-summary')
  expect(within(summary).getByText('暂无封面')).toBeVisible()
  expect(within(summary).getByText('面谈')).toBeVisible()
  expect(within(summary).getByText('发布人')).toBeVisible()
  expect(within(summary).getByText('内容安全')).toBeVisible()
  expect(screen.getByRole('tab', { name: '想推荐名单' })).toBeVisible()
  expect(screen.getByRole('tab', { name: '操作记录' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '编辑机会' }))
  await screen.findByRole('heading', { name: '编辑页面' })
  expect(router.state.location.pathname).toBe('/opportunities/record-1/edit')
  expect(router.state.location.search).toEqual({ returnSearch })
})

it('uses the real opportunity cover without changing its values or adding prototype figures', async () => {
  state.request.mockImplementation(async (action: string) => action === 'mip.admin.opportunities.get'
    ? { id: 'record-1', title: '真实机会封面', status: 'DRAFT', version: 1,
        ownerNickname: '测试发布人', coverUrl: 'https://media.example/opportunity-cover.png',
        commercialTerms: { amountDisplay: '100 千' }, referralCount: 2, availableActions: [] }
    : { items: [], nextCursor: null })
  mount('opportunities')
  fireEvent.click(await screen.findByRole('button', { name: '打开详情' }))
  const summary = await screen.findByRole('region', { name: '机会信息' })
  expect(within(summary).getByRole('img', { name: '真实机会封面封面' })).toHaveAttribute('src', 'https://media.example/opportunity-cover.png')
  expect(within(summary).getByText('100 千')).toBeVisible()
  expect(within(summary).getByText('测试发布人')).toBeVisible()
  expect(within(summary).getByText('2')).toBeVisible()
  expect(within(summary).queryByText('¥1,000,000')).not.toBeInTheDocument()
})

it('keeps default drawer and user-profile sections in their existing field layout', () => {
  render(<DetailSections open onClose={vi.fn()} view={{ route: 'users', title: '用户档案', subtitle: '', status: '正常',
    sections: [{ title: '基本信息', fields: [{ label: '昵称', value: '真实昵称' }, { label: '城市', value: '深圳' }] }],
  }} />)
  expect(document.querySelector('.detail-cover-summary')).toBeNull()
  expect(document.querySelector('.detail-fields')).not.toBeNull()
  expect(screen.getByText('真实昵称')).toBeVisible()
  expect(screen.getByText('深圳')).toBeVisible()
})
