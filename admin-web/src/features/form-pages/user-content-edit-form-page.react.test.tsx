import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpportunityEditFormPage } from './opportunity-edit-form-page'
import { UserContentEditFormPage } from './user-content-edit-form-page'

const state = vi.hoisted(() => ({ request: vi.fn(), navigate: vi.fn(), contentId: 'new' }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ contentId: state.contentId, opportunityId: 'new' }),
  useSearch: () => ({ kind: 'COOPERATION_CARD' }),
  useNavigate: () => state.navigate,
  useBlocker: () => ({ status: 'idle' }),
}))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({
  request: state.request, demoMode: false, hasCapability: () => true,
}) }))

afterEach(cleanup)
beforeEach(() => {
  state.contentId = 'new'
  state.request.mockReset().mockImplementation(async (action: string) => action === 'mip.admin.users.list'
    ? { items: [{ id: 'user-demo', nickname: '验收发布人' }] }
    : action === 'mip.admin.opportunities.options' ? { owners: [{ id: 'user-demo', nickname: '验收发布人' }], tags: [], branches: [] } : { id: 'new-content' })
  state.navigate.mockReset()
})

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}
async function select(label: string, value: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  fireEvent.click(await screen.findByText(value, { selector: '.ant-select-item-option-content' }))
}
function mount() { render(<QueryClientProvider client={new QueryClient()}><App><UserContentEditFormPage /></App></QueryClientProvider>) }

describe('independent user content editor', () => {
  it('submits the selected strategist fields after filling and switching away from connector', async () => {
    mount()
    await select('归属用户', '验收发布人')
    fill('圈层', '先前角色内容')
    fill('可提供资源', '不应提交的隐藏内容')
    await select('合作角色', '狗策划')
    await waitFor(() => expect(screen.queryByLabelText('圈层')).not.toBeInTheDocument())
    expect(screen.queryByText('封面图片')).not.toBeInTheDocument()
    fill('合作定位', '演示合作卡')
    // The form has a summary and a role-specific target with the same label.
    const targets = screen.getAllByLabelText('合作目标')
    fireEvent.change(targets[0], { target: { value: '演示合作目标' } })
    fireEvent.change(targets[1], { target: { value: '仅供验收' } })
    fill('策划类型', '社区策划')
    fill('工作方法', '目标拆解')
    for (const label of ['商务拓展', '资源整合', '资本运作', '战略策划', '视觉设计', '交付管理']) fill(label, '3')
    await select('内容状态', '已发布')
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(state.request.mock.calls.filter(([action]) => action === 'mip.admin.userContent.save')).toHaveLength(1))
    expect(state.request).toHaveBeenCalledWith('mip.admin.userContent.save', {
      kind: 'COOPERATION_CARD', ownerUserId: 'user-demo', idempotencyKey: expect.any(String),
      draft: {
        kind: 'COOPERATION_CARD', roleKey: 'strategist', positioning: '演示合作卡', targetSummary: '演示合作目标',
        roleFields: { planning_types: '社区策划', methods: '目标拆解', target: '仅供验收' },
        abilityScores: { business_development: 3, resource_integration: 3, capital_operation: 3, strategy_planning: 3, visual_design: 3, delivery_management: 3 },
        status: 'PUBLISHED',
      },
    })
    expect(state.navigate).toHaveBeenCalledWith({ to: '/opportunities' })
  })

  it('opens existing content with locked ownership, hidden metadata and zero scores intact', async () => {
    state.contentId = 'COOPERATION_CARD:card-existing'
    const item = { kind: 'COOPERATION_CARD', id: 'card-existing', version: 4, owner: { userId: 'user-demo' },
      roleKey: 'connector', positioning: '已有定位', targetSummary: '已有目标', roleFields: { circles: '圈层', resources: '资源', target: '目标' },
      abilityScores: { business_development: 0, resource_integration: 1, capital_operation: 2, strategy_planning: 3, visual_design: 4, delivery_management: 5 }, status: 'PUBLISHED' }
    state.request.mockImplementation(async (action: string) => action === 'mip.admin.userContent.get' ? item : { items: [{ id: 'user-demo', nickname: '验收发布人' }] })
    mount()
    await waitFor(() => expect(screen.getByLabelText('合作定位')).toHaveValue('已有定位'))
    expect(screen.getByLabelText('归属用户')).toBeDisabled()
    expect(screen.getByLabelText('内容类型')).toBeDisabled()
    expect(screen.queryByLabelText('版本')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('用户内容')).not.toBeInTheDocument()
    expect(screen.getByLabelText('商务拓展')).toHaveValue('0')
    fill('合作定位', '更新定位')
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('mip.admin.userContent.save', expect.objectContaining({
      contentId: 'card-existing', expectedVersion: 4, ownerUserId: 'user-demo', draft: expect.objectContaining({ positioning: '更新定位', abilityScores: item.abilityScores }),
    })))
  })

  it('creates a case after switching content type with empty optional media and tags', async () => {
    mount()
    await select('归属用户', '验收发布人')
    fill('合作定位', '不应提交的合作卡字段')
    await select('内容类型', '超级案例')
    await waitFor(() => expect(screen.queryByLabelText('合作定位')).not.toBeInTheDocument())
    expect(screen.getByText('封面图片')).toBeInTheDocument()
    fill('项目名称', '演示案例')
    fill('案例摘要', '案例摘要')
    fill('项目责任', '演示项目责任')
    fill('案例说明', '虚构案例，仅供验收')
    await select('内容状态', '已发布')
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(state.request.mock.calls.filter(([action]) => action === 'mip.admin.userContent.save')).toHaveLength(1))
    expect(state.request).toHaveBeenCalledWith('mip.admin.userContent.save', {
      kind: 'SUPER_CASE', ownerUserId: 'user-demo', idempotencyKey: expect.any(String),
      draft: {
        kind: 'SUPER_CASE', projectName: '演示案例', summary: '案例摘要', responsibility: '演示项目责任',
        description: '虚构案例,仅供验收', startedOn: null, endedOn: null, caseType: null,
        cityTagId: null, industryTagId: null, coverAssetId: null, mediaAssetIds: [], status: 'PUBLISHED',
      },
    })
  })
})


describe('independent opportunity editor', () => {
  it('submits multiple selected roles without incomplete commercial terms', async () => {
    render(<QueryClientProvider client={new QueryClient()}><App><OpportunityEditFormPage /></App></QueryClientProvider>)
    await select('发布人', '验收发布人')
    fill('机会标题', '演示合作机会')
    fill('机会价值', '仅供验收')
    await select('合作角色', '狗策划')
    fireEvent.click(await screen.findByText('死美工', { selector: '.ant-select-item-option-content' }))
    fireEvent.click(screen.getByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(state.request.mock.calls.filter(([action]) => action === 'mip.admin.opportunities.save')).toHaveLength(1))
    expect(state.request).toHaveBeenCalledWith('mip.admin.opportunities.save', {
      idempotencyKey: expect.any(String),
      draft: {
        ownerUserId: 'user-demo', scopeType: 'PLATFORM', title: '演示合作机会', valueSummary: '仅供验收',
        targetSummary: undefined, description: undefined, cityTagId: undefined, coverAssetId: null, deadlineAt: undefined,
        commercialTerms: undefined, roleKeys: ['strategist', 'visual_designer'], tagIds: [],
      },
    })
  })
})
