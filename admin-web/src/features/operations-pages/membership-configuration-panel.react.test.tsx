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
  return render(<QueryClientProvider client={client}><App><MembershipConfigurationPanel onSaved={onSaved} /></App></QueryClientProvider>)
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
})
