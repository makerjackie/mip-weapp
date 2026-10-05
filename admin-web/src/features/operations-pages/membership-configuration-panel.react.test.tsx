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

  it('edits growth rules without a per-rule copy field and points to the document tab', async () => {
    state.tab = 'rules'
    state.request.mockImplementation(async (action: string) => action.endsWith('.rules')
      ? { items: [{ id: 'rule-1', ruleKey: 'event_attended', name: '完成活动签到', metric: 'EXPERIENCE', deltaValue: 100, dailyLimitValue: 300, sourceEventType: 'event.checked_in', status: 'ACTIVE', version: 4 }] }
      : { version: 5 })
    mount()
    await screen.findByText('完成活动签到')
    fireEvent.click(screen.getByRole('button', { name: '编 辑' }))
    expect(await screen.findByText('规则详情页签的展示文本请在「经验值规则说明」页签中整段配置；此处仅维护奖励数值。')).toBeInTheDocument()
    expect(screen.queryByLabelText('规则说明')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.growth.saveRule', expect.objectContaining({
      ruleId: 'rule-1',
      expectedVersion: 4,
      draft: expect.objectContaining({ name: '完成活动签到' }),
    })))
  })

  it('loads and saves the experience rules text as its own document', async () => {
    state.tab = 'experience-rules'
    state.request.mockResolvedValue({ title: '经验值规则说明', body: '一、每日签到\n二、活动奖励', isDemo: false, version: 3 })
    mount()
    // 多行正文经 display-value 规范化后换行会折叠成空格，改用 label 定位读原始 value。
    const body = await screen.findByLabelText('正文') as HTMLTextAreaElement
    expect(body.value).toBe('一、每日签到\n二、活动奖励')
    expect(state.request).toHaveBeenCalledWith('mip.admin.membershipAgreement.get', { document: 'experience-rules' })
    fireEvent.click(screen.getByRole('button', { name: '保存并生效' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.membershipAgreement.save', expect.objectContaining({ document: 'experience-rules', expectedVersion: 3 })))
  })

})
