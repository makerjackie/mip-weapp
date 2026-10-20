import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IndustrySettingsPage } from './industry-settings-page'

const mocks = vi.hoisted(() => ({ request: vi.fn(), launch: vi.fn(), navigate: vi.fn(), allowed: true }))
vi.mock('@tanstack/react-router', async original => ({ ...await original<object>(), useNavigate: () => mocks.navigate }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({ request: mocks.request, demoMode: false, session: { enabled: true, actor: { id: 'owner-1' } }, sessionBoundary: 'owner-session', loading: false,
  hasCapability: () => mocks.allowed, hasCapabilityAtScope: () => mocks.allowed,
}) }))
vi.mock('../admin-runtime/admin-operation-provider', () => ({ useAdminOperations: () => ({ launch: mocks.launch }) }))
const group = { id: 'group-1', label: '互联网/AI', parentId: null, selectable: false, popular: false, enabled: true, sortOrder: 1, version: 2 }
const child = { id: 'industry-1', label: '人工智能', parentId: group.id, selectable: true, popular: true, enabled: false, sortOrder: 2, version: 3 }
beforeEach(() => { vi.clearAllMocks(); mocks.allowed = true; mocks.request.mockResolvedValue({ items: [group, child] }) })
afterEach(cleanup)
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App><IndustrySettingsPage /></App></QueryClientProvider>)
}

it('shows nonempty server industry fields and opens versioned edit/activation operations', async () => {
  const user = userEvent.setup()
  mount()
  const text = await screen.findByText('人工智能')
  const row = text.closest('tr')!
  expect(within(row).getByText('二级行业')).toBeInTheDocument()
  expect(within(row).getByText('互联网/AI')).toBeInTheDocument()
  expect(within(row).getByText('是')).toBeInTheDocument()
  expect(mocks.request).toHaveBeenCalledWith('mip.admin.industries.list')
  await user.click(within(row).getByRole('button', { name: '编辑' }))
  expect(mocks.launch).toHaveBeenLastCalledWith('mip.admin.industries.save', child.id, null, { expectedVersion: 3 })
  await user.click(within(row).getByRole('button', { name: '启用' }))
  expect(mocks.launch).toHaveBeenLastCalledWith('mip.admin.industries.changeStatus', child.id, null, { expectedVersion: 3, values: { enabled: true } })
})

it('provides separate group/industry creation and a real users return route', async () => {
  const user = userEvent.setup()
  mount()
  await screen.findByText('人工智能')
  await user.click(screen.getByRole('button', { name: /新增一级分类/ }))
  expect(mocks.launch).toHaveBeenLastCalledWith('mip.admin.industries.save', '', null, { values: { parentId: null } })
  await user.click(screen.getByRole('button', { name: /新增行业/ }))
  expect(mocks.launch).toHaveBeenLastCalledWith('mip.admin.industries.save', '', null, { values: { parentId: group.id } })
  await user.click(screen.getByRole('button', { name: '返回用户列表' }))
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/users' })
})

it('keeps a failed catalog read visible and retryable', async () => {
  mocks.request.mockRejectedValue(new Error('行业服务暂不可用'))
  mount()
  expect(await screen.findByText('行业服务暂不可用')).toBeInTheDocument()
  expect(screen.queryByText('人工智能')).toBeNull()
  expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
})

it('does not read or expose industry management without its capability', async () => {
  mocks.allowed = false
  mount()
  expect(mocks.request).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /新增行业/ })).toBeNull()
})
