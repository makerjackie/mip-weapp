import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminReadPage } from '../../modules/admin-read-pages'
import { createCoreDemoEventTagCatalog, createCoreDemoReadPage } from './core-demo-adapter'
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
  it('preserves server ordering when a table contains only a cursor page', async () => {
    const user = userEvent.setup()
    render(<CoreListPageView route="users" search={{}} page={{
      sections: [{ rows: [{ name: '赵', detailId: 'user-z' }, { name: '阿', detailId: 'user-a' }], columns: [{ key: 'name', label: '姓名' }] }], nextCursor: 'more',
    }} onSearchChange={() => {}} onOpenDetail={() => {}} />)
    await user.click(screen.getByRole('columnheader', { name: '姓名' }))
    expect(screen.getAllByRole('row').slice(1).map(row => row.textContent)).toEqual(['赵查看', '阿查看'])
  })
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
    expect(view.metrics.slice(0, 4).map(item => item.value)).toEqual(['1,284', '436', '12', '96'])
    expect(view.metrics.slice(4).every(item => item.value === '—')).toBe(true)
    expect(view.playerTrend).toEqual({ available: false, points: [] })
    expect(view.attention.map(item => item.label)).toEqual(['30 日内到期会员', '待审核报名'])
    expect(view.activity[0]).toMatchObject({ title: 'MIP 早会', state: '活动报名' })
  })
  it('shows authoritative purchase buckets and monetary units while keeping restricted metrics unknown', () => {
    const view = mapAdminOverview({ membership: { purchaseFlow: { availability: 'AVAILABLE', eligiblePaidAmount: { availability: 'AVAILABLE', amountCents: 1990 }, series: [{ bucketStartDate: '2030-01-01', initialPurchaseCount: 1, firstRenewalCount: 0, repeatRenewalCount: 2, eligiblePaidAmountCents: 1990 }] } }, events: { financials: { netAmount: { availability: 'RESTRICTED', amountCents: null } } } })
    expect(view.metrics.find(item => item.label === '会籍实付金额')?.value).toBe('¥19.90')
    expect(view.metrics.find(item => item.label === '活动净收入')?.value).toBe('—')
    expect(view.purchaseTrend?.rows).toEqual([{ date: '2030-01-01', initial: '1', firstRenewal: '0', repeatRenewal: '2', paidAmount: '19.90' }])
    expect(view.playerTrend.available).toBe(false)
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
    await user.type(screen.getByPlaceholderText('搜索姓名、简介或城市'), '林晓')
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

  it('builds demo tag rows with server-shaped catalog operations for the settings page', () => {
    const rows = createCoreDemoEventTagCatalog()
    expect(rows.map(row => row.name)).toEqual(['早会', '集会', '沙龙'])
    expect(rows[0].rowActions?.map(operation => operation.label)).toEqual(['编辑', '停用', '归档'])
    expect(rows[2].rowActions?.map(operation => operation.label)).toEqual(['编辑', '启用', '归档'])
  })

  it('shows only design-approved status options and hides draft/archived rows and the inline tag section', async () => {
    const user = userEvent.setup()
    const page: AdminReadPage = {
      sections: [
        {
          key: 'events',
          title: '活动',
          rows: [
            { detailId: 'e-1', title: '已发布活动', state: '已发布' },
            { detailId: 'e-2', title: '草稿活动', state: '草稿' },
            { detailId: 'e-3', title: '已下架活动', state: '已下架' },
            { detailId: 'e-4', title: '已归档活动', state: '已归档' },
          ],
          columns: [{ key: 'title', label: '活动名称' }, { key: 'state', label: '状态' }],
        },
        { key: 'policy', title: '活动政策', detailTarget: null, rows: [{ cancellation: '24 小时' }], columns: [{ key: 'cancellation', label: '默认取消提前时间' }] },
        { key: 'event-types', title: '活动类型', detailTarget: null, rows: [{ name: '工作坊', state: '启用' }], columns: [{ key: 'name', label: '名称' }] },
        { key: 'event-tags', title: '活动标签', detailTarget: null, rows: [{ name: '早会', state: '启用' }], columns: [{ key: 'name', label: '名称' }] },
      ],
      nextCursor: null,
    }
    const { container } = render(
      <CoreListPageView route="events" search={{}} page={page} onSearchChange={vi.fn()} onOpenDetail={vi.fn()} />,
    )
    expect(screen.getByText('已发布活动')).toBeInTheDocument()
    expect(screen.getByText('已下架活动')).toBeInTheDocument()
    expect(screen.queryByText('草稿活动')).toBeNull()
    expect(screen.queryByText('已归档活动')).toBeNull()
    expect(screen.getByText('活动政策')).toBeInTheDocument()
    expect(screen.getByText('活动类型')).toBeInTheDocument()
    expect(screen.queryByText('活动标签')).toBeNull()

    await user.click(within(container.querySelector('.filter-bar__status') as HTMLElement).getByRole('combobox'))
    await screen.findAllByRole('option')
    // antd 的 role=option 走 aria-label 且被虚拟列表截断，这里断言实际渲染的选项内容。
    const optionLabels = Array.from(document.querySelectorAll('.ant-select-dropdown .ant-select-item-option-content'))
      .map(node => node.textContent)
    expect(optionLabels).toEqual(['全部状态', '已发布', '已结束', '已取消'])
  })

  it('opens the tag settings page from the 设置 action when catalog management is allowed', async () => {
    const user = userEvent.setup()
    const onNavigateToSettings = vi.fn()
    const { rerender } = render(
      <CoreListPageView
        route="events"
        search={{}}
        page={{ sections: [{ rows: [], columns: [{ key: 'title', label: '活动名称' }] }], nextCursor: null }}
        canManageEventCatalog
        onNavigateToSettings={onNavigateToSettings}
        onSearchChange={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /设\s*置/ }))
    expect(onNavigateToSettings).toHaveBeenCalledTimes(1)
    rerender(
      <CoreListPageView
        route="events"
        search={{}}
        page={{ sections: [{ rows: [], columns: [{ key: 'title', label: '活动名称' }] }], nextCursor: null }}
        onNavigateToSettings={onNavigateToSettings}
        onSearchChange={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
  })

  it('offers inline checkin qrcode download on published rows and downloads the fetched static code', async () => {
    const user = userEvent.setup()
    const downloaded: HTMLAnchorElement[] = []
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded.push(this)
    })
    const request = vi.fn().mockResolvedValue({
      eventId: 'e-1', mode: 'STATIC', validUntil: null, qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    })
    const page: AdminReadPage = {
      sections: [{
        key: 'events',
        title: '活动',
        rows: [
          { detailId: 'e-1', title: '已发布活动', state: '已发布' },
          { detailId: 'e-2', title: '已结束活动', state: '已结束' },
        ],
        columns: [{ key: 'title', label: '活动名称' }, { key: 'state', label: '状态' }],
      }],
      nextCursor: null,
    }
    render(
      <App>
        <CoreListPageView
          route="events"
          search={{}}
          page={page}
          canManageCheckin
          request={request}
          onMutation={vi.fn()}
          onSearchChange={vi.fn()}
          onOpenDetail={vi.fn()}
        />
      </App>,
    )
    try {
      expect(screen.getAllByRole('button', { name: '下载签到二维码' })).toHaveLength(1)
      await user.click(screen.getByRole('button', { name: '下载签到二维码' }))
      await waitFor(() => expect(request).toHaveBeenCalledWith('mip.admin.events.checkinQrcode.get', { eventId: 'e-1', mode: 'STATIC' }))
      await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1))
      expect(downloaded[0]?.getAttribute('download')).toBe('活动签到码-e-1.png')
      expect(downloaded[0]?.href).toBe('data:image/png;base64,iVBORw0KGgo=')
    }
    finally {
      anchorClick.mockRestore()
    }
  })

  it('hides the inline checkin download without checkin capability or request access', () => {
    const page: AdminReadPage = {
      sections: [{
        key: 'events',
        title: '活动',
        rows: [{ detailId: 'e-1', title: '已发布活动', state: '已发布' }],
        columns: [{ key: 'title', label: '活动名称' }, { key: 'state', label: '状态' }],
      }],
      nextCursor: null,
    }
    render(
      <CoreListPageView route="events" search={{}} page={page} onMutation={vi.fn()} onSearchChange={vi.fn()} onOpenDetail={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: '下载签到二维码' })).toBeNull()
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
    expect(screen.getByText('玩家增长趋势暂无数据，暂不展示。')).toBeInTheDocument()
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
