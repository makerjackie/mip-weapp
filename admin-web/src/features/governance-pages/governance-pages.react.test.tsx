import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getAdminReadRouteDefinition, type AdminReadPage } from '../../modules/admin-read-pages'
import {
  KnowledgePage,
  MessagesPage,
  OperationsPage,
  PermissionsPage,
  type GovernancePageProps,
} from './governance-pages'

const commonProps = {
  filter: { q: '', status: '' },
  activeTab: '',
  canCapability: () => true,
  onFilterChange: vi.fn(),
  onTabChange: vi.fn(),
} satisfies Pick<GovernancePageProps, 'filter' | 'activeTab' | 'canCapability' | 'onFilterChange' | 'onTabChange'>

afterEach(cleanup)
beforeAll(() => {
  const getComputedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element))
})

describe('governance React pages', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '查看' }))
    expect(onViewDetail).toHaveBeenCalledWith({ route: 'messages', id: 'campaign-1' })
  }, 15_000)

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

    fireEvent.click(screen.getByRole('button', { name: '新建消息模板' }))
    expect(onMutationRequest).toHaveBeenCalledWith({
      action: 'mip.admin.messageTemplates.save',
      capability: 'messages.manage',
    })
    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    expect(onMutationRequest).toHaveBeenLastCalledWith({
      action: 'mip.admin.messageTemplates.activate',
      capability: 'messages.manage',
      targetId: 'template-1',
      values: { templateId: 'template-1', expectedVersion: 3 },
    })
  }, 15_000)

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

    fireEvent.click(screen.getByRole('button', { name: '更新策略' }))
    expect(onMutationRequest).toHaveBeenCalledWith({
      action: 'mip.admin.rolePolicies.update',
      capability: 'roles.change',
      values: { roleKey: 'BRANCH_ADMIN', capabilities: ['events.read'], reset: false },
      expectedVersion: 3,
      allowedCapabilities: ['events.read', 'events.write'],
    })
  }, 15_000)

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

    fireEvent.click(screen.getByRole('button', { name: '发布' }))
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
    fireEvent.click(screen.getByRole('button', { name: '结案' }))
    expect(onMutationRequest).toHaveBeenLastCalledWith({
      action: 'mip.admin.communityReports.close',
      capability: 'community.reports.manage',
      targetId: 'report-1',
      values: { reportId: 'report-1', expectedVersion: 4, outcome: 'RESOLVED', reason: '' },
    })
  }, 15_000)
})
