import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import { EventSettingsPage } from './event-settings-page'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', async importOriginal => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigate,
}))

const request = vi.fn()
const launch = vi.fn()
vi.mock('../../app/session-provider', () => ({
  useAdminSession: () => ({
    request,
    demoMode: false,
    session: { enabled: true, actor: { id: 'admin-1' } },
    sessionBoundary: 'boundary-1',
    loading: false,
    hasCapability: (capability: string) => capability === 'events.catalog.manage',
    hasCapabilityAtScope: (capability: string) => capability === 'events.catalog.manage',
  }),
}))
vi.mock('../admin-runtime/admin-operation-provider', () => ({
  useAdminOperations: () => ({ launch }),
}))

afterEach(cleanup)

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <App>
        <EventSettingsPage />
      </App>
    </QueryClientProvider>,
  )
}

const catalogItems = [
  { id: 'cat-1', kind: 'TAG', name: '早会', description: '早会类活动标签', status: 'ACTIVE', version: 2, sortOrder: 10 },
  { id: 'cat-2', kind: 'TAG', name: '沙龙', description: '', status: 'INACTIVE', version: 1, sortOrder: 20 },
]

it('lists event tags with rename, enable/disable and archive operations from the existing catalog actions', async () => {
  const user = userEvent.setup()
  request.mockResolvedValue({ items: catalogItems })
  mount()
  expect(await screen.findByText('早会')).toBeInTheDocument()
  expect(screen.getByText('沙龙')).toBeInTheDocument()
  expect(screen.getAllByText('启用').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('停用').length).toBeGreaterThanOrEqual(1)
  expect(request).toHaveBeenCalledWith('mip.admin.events.catalog.list', { kind: 'TAG' })
  expect(screen.getByRole('button', { name: /新增活动标签/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '返回活动列表' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(2)
  expect(screen.getByRole('button', { name: '停用' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '启用' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '归档' })).toHaveLength(2)

  await user.click(screen.getAllByRole('button', { name: '编辑' })[0])
  expect(launch).toHaveBeenCalledWith('mip.admin.events.catalog.save', 'cat-1', null, expect.objectContaining({
    values: expect.objectContaining({ kind: 'TAG', catalogId: 'cat-1', expectedVersion: 2, name: '早会' }),
  }))
})

it('creates a tag through the reviewed catalog save dialog with the kind preset', async () => {
  const user = userEvent.setup()
  request.mockResolvedValue({ items: catalogItems })
  mount()
  await screen.findByText('早会')
  await user.click(screen.getByRole('button', { name: /新增活动标签/ }))
  expect(launch).toHaveBeenCalledWith('mip.admin.events.catalog.save', '', null, expect.objectContaining({
    values: { kind: 'TAG' },
  }))
})

it('returns to the event list from the settings page', async () => {
  const user = userEvent.setup()
  request.mockResolvedValue({ items: catalogItems })
  mount()
  await screen.findByText('早会')
  await user.click(screen.getByRole('button', { name: '返回活动列表' }))
  expect(navigate).toHaveBeenCalledWith({ to: '/events' })
})

it('shows a retryable error state when the catalog read fails', async () => {
  request.mockRejectedValue(new Error('目录服务暂不可用'))
  mount()
  await screen.findByText('目录服务暂不可用')
  expect(screen.queryByText('早会')).toBeNull()
  await waitFor(() => expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument())
})
