import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminReadPage } from '../../modules/admin-read-pages'
import { createCoreDemoReadPage } from './core-demo-adapter'
import { CoreListPageView } from './core-list-pages'
import { mapAdminOverview } from './overview-model'
import { OverviewPageView } from './overview-page'

const userPage: AdminReadPage = {
  sections: [{
    rows: [{ detailId: 'user-1', name: '林晓', state: '启用' }],
    columns: [{ key: 'name', label: '姓名' }, { key: 'state', label: '状态' }],
  }],
  nextCursor: 'cursor-2',
}

afterEach(cleanup)

describe('core admin pages', () => {
  it('maps the authoritative overview without inventing a player trend', () => {
    const view = mapAdminOverview({
      asOf: '2030-03-01T00:00:00.000Z',
      period: { startAt: '2030-02-01T00:00:00.000Z', endAt: '2030-02-28T00:00:00.000Z' },
      people: { activeAccounts: count(1284, 84) },
      membership: { currentPlayers: count(436, 12), expiringPlayers30d: count(9, 1) },
      events: { totalEvents: count(12, 2), effectiveRegistrations: count(96, 8), pendingReviewRegistrations: count(4, 0) },
      tasks: { pendingReview: count(3, 0) },
      operations: {
        activity: [{
          id: 'activity-1',
          kind: 'event.registration_confirmed',
          occurredAt: '2030-02-28T08:00:00.000Z',
          resource: { title: 'MIP 早会' },
          scope: { type: 'EVENT' },
        }],
      },
    })
    expect(view.metrics.map(item => item.value)).toEqual(['1,284', '436', '12', '96'])
    expect(view.playerTrend).toEqual({ available: false, points: [] })
    expect(view.attention.map(item => item.label)).toEqual(['30 日内到期会员', '待审核报名', '待审核任务'])
    expect(view.activity[0]).toMatchObject({ title: 'MIP 早会', state: '活动报名' })
  })

  it('exposes URL search, detail and cursor pagination through callbacks', async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    const onOpenDetail = vi.fn()
    render(
      <CoreListPageView
        route="users"
        search={{ q: '', status: '' }}
        page={userPage}
        canExport={false}
        onSearchChange={onSearchChange}
        onOpenDetail={onOpenDetail}
      />,
    )
    await user.type(screen.getByPlaceholderText('搜索姓名、手机号或简介'), '林晓')
    await user.click(screen.getByRole('button', { name: /筛\s*选/ }))
    await waitFor(() => expect(onSearchChange).toHaveBeenCalledWith(expect.objectContaining({ q: '林晓', cursor: undefined, page: undefined })))

    await user.click(screen.getByRole('button', { name: '查看' }))
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ route: 'users', id: 'user-1' }))

    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(onSearchChange).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-2', page: 2 }))
  })

  it('keeps demo filtering inside the explicit demo adapter', () => {
    const page = createCoreDemoReadPage('users', {
      query: '林晓',
      status: '',
      cursor: null,
      limit: 20,
    })
    expect(page.sections[0].rows).toHaveLength(1)
    expect(page.sections[0].rows[0].detailId).toBe('USR-1001')
  })

  it('keeps event policy and catalog operations reachable with their server-projected context', async () => {
    const user = userEvent.setup()
    const onMutation = vi.fn()
    const page: AdminReadPage = {
      sections: [
        { key: 'events', title: '活动', rows: [], columns: [{ key: 'title', label: '活动名称' }] },
        {
          key: 'policy',
          title: '活动政策',
          detailTarget: null,
          rows: [{
            cancellation: '24 小时',
            version: '0',
            rowActions: [{
              action: 'mip.admin.events.policy.save',
              label: '编辑政策',
              values: { expectedVersion: 0, cancellationHoursBeforeStart: 24 },
            }],
          }],
          columns: [{ key: 'cancellation', label: '默认取消提前时间' }],
        },
        {
          key: 'event-types',
          title: '活动类型',
          detailTarget: null,
          rows: [{
            name: '工作坊',
            rowActions: [{
              action: 'mip.admin.events.catalog.save',
              label: '编辑',
              targetId: 'catalog-1',
              values: {
                kind: 'TYPE', catalogId: 'catalog-1', expectedVersion: 2,
                name: '工作坊', description: '互动活动', sortOrder: 10,
              },
            }],
          }],
          columns: [{ key: 'name', label: '名称' }],
        },
      ],
      nextCursor: null,
    }

    render(
      <CoreListPageView
        route="events"
        search={{ q: '', status: '' }}
        page={page}
        canManageEventCatalog
        canWriteEventPolicy
        onSearchChange={vi.fn()}
        onOpenDetail={vi.fn()}
        onMutation={onMutation}
      />,
    )

    await user.click(screen.getByRole('button', { name: /新建活动目录/ }))
    expect(onMutation).toHaveBeenCalledWith({ action: 'mip.admin.events.catalog.save', targetId: '' })
    await user.click(screen.getByRole('button', { name: '编辑政策' }))
    expect(onMutation).toHaveBeenCalledWith({
      action: 'mip.admin.events.policy.save',
      targetId: '',
      values: { expectedVersion: 0, cancellationHoursBeforeStart: 24 },
    })
    await user.click(screen.getByRole('button', { name: '编辑' }))
    expect(onMutation).toHaveBeenLastCalledWith({
      action: 'mip.admin.events.catalog.save',
      targetId: 'catalog-1',
      values: {
        kind: 'TYPE', catalogId: 'catalog-1', expectedVersion: 2,
        name: '工作坊', description: '互动活动', sortOrder: 10,
      },
    })
  })

  it('renders overview gaps and delegates quick actions', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const data = mapAdminOverview({
      people: { activeAccounts: count(1, 0) },
      membership: { currentPlayers: count(1, 0), expiringPlayers30d: count(0, 0) },
      events: { totalEvents: count(0, 0), effectiveRegistrations: count(0, 0), pendingReviewRegistrations: count(0, 0) },
      tasks: { pendingReview: count(0, 0) },
      operations: { activity: [] },
    })
    render(
      <OverviewPageView
        data={data}
        quickActions={[{ label: '用户管理', target: '/users' }]}
        onNavigate={onNavigate}
      />,
    )
    expect(screen.getByText('暂无趋势数据')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /用户管理/ }))
    expect(onNavigate).toHaveBeenCalledWith('/users')
  })
})

function count(value: number, delta: number) {
  return {
    availability: 'AVAILABLE',
    count: value,
    comparison: {
      availability: 'AVAILABLE',
      previousCount: value - delta,
      deltaCount: delta,
      changeBasisPoints: null,
    },
  }
}
