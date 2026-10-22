import userEvent from '@testing-library/user-event'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAdminReadRouteDefinition, type AdminReadPage } from '../../modules/admin-read-pages'
import { AuditLogsPage } from './audit-logs-page'
import {
  KnowledgePage,
  MessagesPage,
  OperationsPage,
  PermissionsPage,
  ServersPage,
  type GovernancePageProps,
} from './governance-pages'

const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({} as Record<string, string>),
  useSearch: () => ({} as Record<string, unknown>),
  useRouterState: () => ({ location: { search: {} } }),
}))

const commonProps = {
  filter: { q: '', status: '' },
  activeTab: '',
  canCapability: () => true,
  onFilterChange: vi.fn(),
  onTabChange: vi.fn(),
} satisfies Pick<GovernancePageProps, 'filter' | 'activeTab' | 'canCapability' | 'onFilterChange' | 'onTabChange'>

afterEach(cleanup)

describe('governance React pages', () => {
  it('keeps servers in their independent page and role templates only in the policy tab', () => {
    const page: AdminReadPage = { sections: [
      { key: 'members', title: '运营成员', rows: [], columns: [] },
      { key: 'policies', title: '角色策略', rows: [], columns: [] },
      { key: 'branches', title: '服务器', rows: [{ name: '测试服务器', rowActions: [{ action: 'mip.admin.branches.update', label: '编辑服务器', targetId: 'branch-1', values: { branchId: 'branch-1', name: '测试服务器' }, expectedVersion: 7 }] }], columns: [{ key: 'name', label: '名称' }] },
    ], nextCursor: null }
    const props = { ...commonProps, page, routeDefinition: getAdminReadRouteDefinition('permissions'), onMutationRequest: vi.fn(), sectionContent: { policies: <div>岗位配置入口</div> } }
    const view = render(<PermissionsPage {...props} activeTab="members" />)
    expect(screen.queryByRole('button', { name: '新建服务器' })).not.toBeInTheDocument()
    expect(screen.queryByText('岗位配置入口')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '服务器' })).not.toBeInTheDocument()
    view.rerender(<PermissionsPage {...props} activeTab="policies" />)
    expect(screen.getByText('岗位配置入口')).toBeVisible()
    expect(screen.queryByRole('button', { name: '新建服务器' })).not.toBeInTheDocument()
    view.rerender(<ServersPage {...props} activeTab="branches" />)
    expect(screen.getByRole('button', { name: '新建服务器' })).toBeVisible()
    expect(screen.queryByText('岗位配置入口')).not.toBeInTheDocument()
    expect(screen.getByText('测试服务器')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '新建服务器' }))
    expect(props.onMutationRequest).toHaveBeenLastCalledWith({ action: 'mip.admin.branches.create', capability: 'branches.manage' })
    fireEvent.click(screen.getByRole('button', { name: '编辑服务器' }))
    expect(props.onMutationRequest).toHaveBeenLastCalledWith({ action: 'mip.admin.branches.update', capability: 'branches.manage', targetId: 'branch-1', values: { branchId: 'branch-1', name: '测试服务器' }, expectedVersion: 7 })
    view.rerender(<ServersPage {...props} canCapability={() => false} />)
    expect(screen.queryByRole('button', { name: '新建服务器' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑服务器' })).not.toBeInTheDocument()
  })
  it('opens a message detail using the server-projected campaign id', () => {
    const onViewDetail = vi.fn()
    const page: AdminReadPage = {
      sections: [{
        rows: [{ detailId: 'campaign-1', title: '活动提醒', audience: '全部用户', scope: '平台', updatedAt: '2030-03-01', state: '已发布' }],
        columns: [
          { key: 'title', label: '消息标题' },
          { key: 'audience', label: '发送范围' },
          { key: 'scope', label: '作用范围' },
          { key: 'updatedAt', label: '更新时间' },
          { key: 'state', label: '状态' },
        ],
      }],
      nextCursor: null,
    }

    render(
      <MessagesPage
        {...commonProps}
        page={page}
        routeDefinition={getAdminReadRouteDefinition('messages')}
        onViewDetail={onViewDetail}
      />,
    )

    fireEvent.click(screen.getByText('查看', { selector: 'button, button span' }).closest('button')!)
    expect(onViewDetail).toHaveBeenCalledWith({ route: 'messages', id: 'campaign-1' })
  })

  it('creates and operates message templates through reviewed actions', () => {
    const onMutationRequest = vi.fn()
    const page: AdminReadPage = {
      sections: [
        { key: 'campaigns', title: '消息活动', rows: [], columns: [{ key: 'title', label: '消息标题' }] },
        {
          key: 'templates',
          title: '消息模板',
          rows: [{
            name: '活动提醒',
            rowActions: [{
              action: 'mip.admin.messageTemplates.activate',
              label: '启用',
              targetId: 'template-1',
              values: { templateId: 'template-1', expectedVersion: 3 },
            }],
          }],
          columns: [{ key: 'name', label: '模板名称' }],
        },
      ],
      nextCursor: null,
    }

    render(
      <MessagesPage
        {...commonProps}
        activeTab="templates"
        page={page}
        routeDefinition={getAdminReadRouteDefinition('messages')}
        onMutationRequest={onMutationRequest}
      />,
    )

    fireEvent.click(screen.getByText('新建消息模板', { selector: 'button, button span' }).closest('button')!)
    expect(onMutationRequest).toHaveBeenCalledWith({
      action: 'mip.admin.messageTemplates.save',
      capability: 'messages.manage',
    })
    fireEvent.click(screen.getByText('启用', { selector: 'button, button span' }).closest('button')!)
    expect(onMutationRequest).toHaveBeenLastCalledWith({
      action: 'mip.admin.messageTemplates.activate',
      capability: 'messages.manage',
      targetId: 'template-1',
      values: { templateId: 'template-1', expectedVersion: 3 },
    })
  })

  it('preserves reviewed permission row operation context', () => {
    const onMutationRequest = vi.fn()
    const page: AdminReadPage = {
      sections: [
        { title: '运营成员', rows: [], columns: [{ key: 'name', label: '姓名' }] },
        {
          title: '角色策略摘要',
          rows: [{
            role: '分会管理员',
            version: '3',
            rowActions: [{
              action: 'mip.admin.rolePolicies.update',
              label: '更新策略',
              values: { roleKey: 'BRANCH_ADMIN', capabilities: ['events.read'], reset: false },
              expectedVersion: 3,
              allowedCapabilities: ['events.read', 'events.write'],
            }],
          }],
          columns: [{ key: 'role', label: '角色' }, { key: 'version', label: '版本' }],
        },
        { title: '服务器', rows: [], columns: [{ key: 'name', label: '服务器' }] },
        { title: '最近审计记录', rows: [], columns: [{ key: 'action', label: '操作' }] },
      ],
      nextCursor: null,
    }

    render(
      <PermissionsPage
        {...commonProps}
        activeTab="policies"
        page={page}
        routeDefinition={getAdminReadRouteDefinition('permissions')}
        onMutationRequest={onMutationRequest}
      />,
    )

    fireEvent.click(screen.getByText('更新策略', { selector: 'button, button span' }).closest('button')!)
    expect(onMutationRequest).toHaveBeenCalledWith({
      action: 'mip.admin.rolePolicies.update',
      capability: 'roles.change',
      values: { roleKey: 'BRANCH_ADMIN', capabilities: ['events.read'], reset: false },
      expectedVersion: 3,
      allowedCapabilities: ['events.read', 'events.write'],
    })
  })

  it('marks demo data and disables knowledge mutations', () => {
    const onMutationRequest = vi.fn()
    render(
      <KnowledgePage
        {...commonProps}
        demoMode
        page={{ sections: [{ rows: [], columns: [{ key: 'title', label: '文档标题' }] }], nextCursor: null }}
        routeDefinition={getAdminReadRouteDefinition('knowledge')}
        onMutationRequest={onMutationRequest}
      />,
    )

    expect(screen.getByText('演示数据')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建内容' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '新建内容' }))
    expect(onMutationRequest).not.toHaveBeenCalled()
  })

  it('keeps operations error recovery and URL tab selection outside the component', () => {
    const onRefresh = vi.fn()
    const onTabChange = vi.fn()
    const page: AdminReadPage = {
      sections: [
        { title: '公告', rows: [], columns: [{ key: 'title', label: '标题' }] },
        { title: '社区举报', rows: [], columns: [{ key: 'category', label: '分类' }] },
        { title: '运营异常', rows: [], columns: [{ key: 'title', label: '异常' }] },
        { title: '运营待办', rows: [], columns: [{ key: 'title', label: '待办' }] },
      ],
      nextCursor: null,
    }
    render(
      <OperationsPage
        {...commonProps}
        canCapability={() => false}
        page={page}
        error="运营记录暂时无法刷新"
        routeDefinition={getAdminReadRouteDefinition('operations')}
        onRefresh={onRefresh}
        onTabChange={onTabChange}
      />,
    )

    expect(screen.getByText('运营记录暂时无法刷新')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建公告' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(onRefresh).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('tab', { name: '社区举报' }))
    expect(onTabChange).toHaveBeenCalledWith('reports')
  })

  it('preserves announcement and report identifiers and versions in row operations', () => {
    const onMutationRequest = vi.fn()
    const page: AdminReadPage = {
      sections: [
        {
          key: 'announcements',
          title: '公告',
          rows: [{
            title: '服务通知',
            rowActions: [{
              action: 'mip.admin.announcements.publish',
              label: '发布',
              targetId: 'announcement-1',
              values: { announcementId: 'announcement-1', expectedVersion: 2 },
            }],
          }],
          columns: [{ key: 'title', label: '标题' }],
        },
        {
          key: 'reports',
          title: '社区举报',
          rows: [{
            description: '重复发布',
            rowActions: [{
              action: 'mip.admin.communityReports.close',
              label: '结案',
              targetId: 'report-1',
              values: { reportId: 'report-1', expectedVersion: 4, outcome: 'RESOLVED', reason: '' },
            }],
          }],
          columns: [{ key: 'description', label: '描述' }],
        },
      ],
      nextCursor: null,
    }
    const { rerender } = render(
      <OperationsPage
        {...commonProps}
        activeTab="announcements"
        page={page}
        routeDefinition={getAdminReadRouteDefinition('operations')}
        onMutationRequest={onMutationRequest}
      />,
    )

    fireEvent.click(screen.getByText('发布', { selector: 'button, button span' }).closest('button')!)
    expect(onMutationRequest).toHaveBeenLastCalledWith({
      action: 'mip.admin.announcements.publish',
      capability: 'announcements.manage',
      targetId: 'announcement-1',
      values: { announcementId: 'announcement-1', expectedVersion: 2 },
    })

    rerender(
      <OperationsPage
        {...commonProps}
        activeTab="reports"
        page={page}
        routeDefinition={getAdminReadRouteDefinition('operations')}
        onMutationRequest={onMutationRequest}
      />,
    )
    fireEvent.click(screen.getByText('结案', { selector: 'button, button span' }).closest('button')!)
    expect(onMutationRequest).toHaveBeenLastCalledWith({
      action: 'mip.admin.communityReports.close',
      capability: 'community.reports.manage',
      targetId: 'report-1',
      values: { reportId: 'report-1', expectedVersion: 4, outcome: 'RESOLVED', reason: '' },
    })
  })

  it('switches the audit-logs type filter to LOGIN through the filter callback', async () => {
    const onFilterChange = vi.fn()
    render(
      <AuditLogsPage
        page={{ sections: [{ title: '登录记录', rows: [], columns: [{ key: 'account', label: '登录账号' }] }], nextCursor: null }}
        query={{ query: '', status: '', filters: {} }}
        onFilterChange={onFilterChange}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getByRole('columnheader', { name: '登录账号' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '类型' })).toBeInTheDocument()
    expect(screen.getByText('全部')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: '类型' }))
    await userEvent.click(await screen.findByText('登录'))
    expect(onFilterChange).toHaveBeenCalledWith({ query: '', status: '', filters: { type: 'LOGIN' } })
  })
})
