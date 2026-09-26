import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MembershipConfigurationPanel } from './membership-configuration-panel'
const state = vi.hoisted(() => ({ tab: 'agreement', writable: true, request: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ tab: state.tab }),
}))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({
  request: state.request, session: { actor: { id: 'admin' } }, sessionBoundary: 1, demoMode: false,
  hasCapabilityAtScope: (capability: string) => capability === 'growth.read' || state.writable,
}) }))
function mount(onSaved = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const ui = () => <QueryClientProvider client={client}><App><MembershipConfigurationPanel onSaved={onSaved} /></App></QueryClientProvider>
  const view = render(ui())
  return { ...view, refresh: () => view.rerender(ui()) }
}
afterEach(cleanup)
beforeEach(() => { state.tab = 'agreement'; state.writable = true; state.request.mockReset() })
describe('membership configuration UI', () => {
  it('loads the stored agreement and saves its version with an explicit demo flag', async () => {
    const agreement = { title: '测试会员协议', body: '演示内容', isDemo: true, version: 7, updatedAt: null }
    state.request.mockImplementation(async (action: string) => action.endsWith('.get') ? agreement : { version: 8 })
    const onSaved = vi.fn()
    mount(onSaved)
    await screen.findByDisplayValue('测试会员协议')
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '修改后的演示正文' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并生效' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.membershipAgreement.save', expect.objectContaining({ expectedVersion: 7, draft: { title: '测试会员协议', body: '修改后的演示正文', isDemo: true }, idempotencyKey: expect.any(String) })))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
  it('keeps read-only access read-only', async () => {
    state.writable = false
    state.request.mockResolvedValue({ title: '只读协议', body: '正文', isDemo: false, version: 1 })
    mount()
    expect(await screen.findByDisplayValue('只读协议')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '保存并生效' })).not.toBeInTheDocument()
  })
  it('shows fetch failure without silently replacing the agreement with demo content', async () => {
    state.request.mockRejectedValue(new Error('读取失败'))
    mount()
    await screen.findByText('读取失败')
    expect(screen.queryByLabelText('正文')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重 试' })).toBeInTheDocument()
  })
  it('loads and saves the separately editable user agreement', async () => {
    state.tab = 'user-agreement'
    state.request.mockResolvedValue({ title: '用户使用协议（演示）', body: '用户条款', isDemo: true, version: 2 })
    mount()
    await screen.findByDisplayValue('用户使用协议（演示）')
    expect(state.request).toHaveBeenCalledWith('mip.admin.membershipAgreement.get', { document: 'user' })
    fireEvent.click(screen.getByRole('button', { name: '保存并生效' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.membershipAgreement.save', expect.objectContaining({ document: 'user', expectedVersion: 2 })))
  })

  it('does not carry membership text into the user agreement when switching tabs', async () => {
    state.request.mockImplementation(async (_action: string, input?: { document?: string }) => ({
      title: input?.document === 'user' ? '用户协议独立正文' : '会员协议独立正文',
      body: input?.document === 'user' ? '用户内容' : '会员内容', isDemo: true, version: 1,
    }))
    const view = mount()
    await screen.findByDisplayValue('会员协议独立正文')
    state.tab = 'user-agreement'
    view.refresh()
    await screen.findByDisplayValue('用户协议独立正文')
    expect(screen.getByLabelText('正文')).toHaveValue('用户内容')
  })

})
