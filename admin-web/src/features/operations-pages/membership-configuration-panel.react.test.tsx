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

  it('edits badge definitions with category, acquire condition, and artwork upload', async () => {
    state.tab = 'badges'
    const badge = {
      id: 'b1', key: 'event_participant', name: '活动参与', description: '已完成活动参与记录',
      acquireCondition: '', category: 'IDENTITY', iconName: '', imageUrl: '', imageAssetId: null,
      placeholderShape: 'CIRCLE', sortOrder: 10, status: 'ACTIVE', version: 3,
    }
    state.request.mockImplementation(async (action: string) => action === 'mip.admin.badges.list' ? { items: [badge] } : { title: '协议', body: '正文', isDemo: true, version: 1 })
    mount()
    await screen.findByText('活动参与')
    fireEvent.click(screen.getByRole('button', { name: /编\s*辑/ }))
    await screen.findByPlaceholderText('上传勋章图片后自动填入')
    expect(screen.getByLabelText('勋章图片 HTTPS 地址')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('获得条件'), { target: { value: '由运营人工授予年度志愿者' } })
    fireEvent.mouseDown(screen.getByLabelText('分类'))
    fireEvent.click(await screen.findByTitle('荣誉勋章'))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.badges.save', expect.objectContaining({
      badgeId: 'b1',
      expectedVersion: 3,
      draft: expect.objectContaining({ category: 'HONOR', acquireCondition: '由运营人工授予年度志愿者' }),
    })))
    const call = state.request.mock.calls.find(([action]) => action === 'mip.admin.badges.save')
    expect(String((call?.[1] as { draft: { key: string } }).draft.key)).not.toMatch(/^demo_/)
  })

  it('previews the saved artwork from the server-resolved URL and clears it explicitly', async () => {
    state.tab = 'badges'
    const badge = {
      id: 'b2', key: 'honor_volunteer', name: '荣誉志愿者', description: '年度志愿服务',
      acquireCondition: '由运营人工授予年度志愿者', category: 'HONOR', iconName: '',
      imageUrl: '', imagePreviewUrl: 'https://tmp.example/badge.png', imageAssetId: 'asset-1',
      placeholderShape: 'CIRCLE', sortOrder: 30, status: 'ACTIVE', version: 5,
    }
    state.request.mockImplementation(async (action: string) => action === 'mip.admin.badges.list' ? { items: [badge] } : { title: '协议', body: '正文', isDemo: true, version: 1 })
    mount()
    await screen.findByText('荣誉志愿者')
    fireEvent.click(screen.getByRole('button', { name: /编\s*辑/ }))
    await waitFor(() => expect(screen.getByAltText('预览')).toHaveAttribute('src', 'https://tmp.example/badge.png'))
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.badges.save', expect.objectContaining({
      badgeId: 'b2',
      expectedVersion: 5,
      draft: expect.objectContaining({ imageAssetId: '', imageUrl: '' }),
    })))
  })

})
