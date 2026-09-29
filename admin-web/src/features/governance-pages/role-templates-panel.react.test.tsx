import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RoleTemplatesPanel } from './role-templates-panel'

const state = vi.hoisted(() => ({ request: vi.fn(), canEdit: true }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({ request: state.request,
  sessionBoundary: 'operator-1', demoMode: false, hasCapability: () => true, hasCapabilityAtScope: () => state.canEdit }) }))
const item = { id: '21', name: '活动编务', description: '内容维护', baseRoleKey: 'BRANCH_ADMIN',
  capabilities: ['events.read'], status: 'ACTIVE', version: 4, bindingCount: 3 }
const catalog = { items: [item], baseRoles: [{ key: 'BRANCH_ADMIN', allowedCapabilities: ['events.read', 'events.write'] }], bindingWritesEnabled: true }
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App><RoleTemplatesPanel /></App></QueryClientProvider>)
afterEach(cleanup)
beforeEach(() => { state.canEdit = true; state.request.mockReset() })

it('retains input on conflict, uses the newly read version after explicit review, and records the reason', async () => {
  let version = 4
  state.request.mockImplementation(async action => {
    if (action === 'mip.admin.roles.templates.list') return { ...catalog, items: [{ ...item, version }] }
    if (version === 4) { version = 5; throw { code: 'CONFLICT' } }
    return { id: '21', version: 6 }
  })
  mount()
  await screen.findByText('活动编务')
  fireEvent.click(screen.getByRole('button', { name: /编\s*辑/ }))
  fireEvent.change(screen.getByLabelText('岗位名称'), { target: { value: '活动只读编务' } })
  fireEvent.change(screen.getByLabelText('变更原因'), { target: { value: '缩小工作权限' } })
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
  await screen.findByRole('button', { name: '保留我的修改并核对' })
  expect(screen.getByLabelText('岗位名称')).toHaveValue('活动只读编务')
  fireEvent.click(screen.getByRole('button', { name: '保留我的修改并核对' }))
  fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
  await waitFor(() => expect(state.request.mock.calls.filter(call => call[0] === 'mip.admin.roles.update')).toHaveLength(2))
  expect(state.request.mock.calls.filter(call => call[0] === 'mip.admin.roles.update')[1]?.[1]).toMatchObject({ templateId: '21', expectedVersion: 5,
    name: '活动只读编务', reason: '缩小工作权限', capabilities: ['events.read'] })
})

it('exposes a read-only catalog to a branch operator and never starts a write', async () => {
  state.canEdit = false; state.request.mockResolvedValue(catalog)
  mount()
  await screen.findByText('活动编务')
  expect(screen.queryByRole('button', { name: '新增岗位' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /编\s*辑/ })).not.toBeInTheDocument()
  expect(state.request.mock.calls.every(call => call[0] === 'mip.admin.roles.templates.list')).toBe(true)
})
