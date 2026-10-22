import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAdminReadPage, type AdminReadPage } from '../../modules/admin-read-pages'
import { createCoreDemoEventTagCatalog, createCoreDemoOverview, createCoreDemoReadPage } from './core-demo-adapter'
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
    // 用户列表按原型口径无操作列，行内只有数据本身。
    expect(screen.getAllByRole('row').slice(1).map(row => row.textContent)).toEqual(['赵', '阿'])
  })
  it('maps the authoritative overview without inventing a player trend', () => {
    const view = mapAdminOverview({
      asOf: '2030-03-01T00:00:00.000Z',
      period: { startAt: '2030-02-01T00:00:00.000Z', endAt: '2030-02-28T00:00:00.000Z' },
      people: { newAccounts: count(84, 6) },
      membership: {
        currentPlayers: count(1284, 84),
        expiringPlayers30d: count(9, 1),
        purchaseFlow: { availability: 'AVAILABLE', firstRenewals: count(328, 25) },
      },
      events: { totalEvents: count(12, 2), effectiveRegistrations: count(96, 8), pendingReviewRegistrations: count(4, 0) },
      tasks: { pendingReview: count(3, 0) },
      messaging: { deliveryFailed: count(2, 1) },
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
    expect(view.metrics.slice(0, 4).map(item => item.label)).toEqual(['当前玩家', '首年续费', '新增用户', '缴费金额'])
    expect(view.metrics.slice(0, 4).map(item => item.value)).toEqual(['1,284', '328', '84', '—'])
    expect(view.metrics.find(item => item.label === '活动总数')).toMatchObject({ value: '12', trend: 'up' })
    expect(view.metrics.find(item => item.label === '有效报名')).toMatchObject({ value: '96', trend: 'up' })
    expect(view.metrics.find(item => item.label === '用户总数')?.value).toBe('—')
    expect(view.playerTrend).toEqual({ available: false, months: [] })
    expect(view.attention.map(item => item.label)).toEqual(['30 日内到期会员', '待审核报名', '待验收任务', '消息发送失败'])
    expect(view.attention.map(item => item.target)).toEqual(['/users', '/events', '/task-approval', '/operations'])
    expect(view.activity[0]).toMatchObject({ title: 'MIP 早会', state: '活动报名' })
  })
  it('maps the monthly player trend only when the payload carries valid months', () => {
    const absent = mapAdminOverview({})
    expect(absent.playerTrend).toEqual({ available: false, months: [] })
    const view = mapAdminOverview({
      playerTrend: {
        available: true,
        months: [
          { month: '2030-01', newPlayers: 74, firstRenewal: 38, nextRenewal: 13 },
          { month: '2030-02', newPlayers: 86, firstRenewal: 44, nextRenewal: 15 },
        ],
      },
    })
    expect(view.playerTrend.available).toBe(true)
    expect(view.playerTrend.months).toEqual([
      { month: '2030-01', newPlayers: 74, firstRenewal: 38, nextRenewal: 13 },
      { month: '2030-02', newPlayers: 86, firstRenewal: 44, nextRenewal: 15 },
    ])
    expect(mapAdminOverview({ playerTrend: { available: true, months: [{ month: '2030-13', newPlayers: 1 }] } }).playerTrend.available).toBe(false)
  })
  it('shows authoritative purchase buckets and monetary units while keeping restricted metrics unknown', () => {
    const view = mapAdminOverview({ membership: { purchaseFlow: { availability: 'AVAILABLE', eligiblePaidAmount: { availability: 'AVAILABLE', amountCents: 1990 }, series: [{ bucketStartDate: '2030-01-01', initialPurchaseCount: 1, firstRenewalCount: 0, repeatRenewalCount: 2, eligiblePaidAmountCents: 1990 }] } }, events: { financials: { netAmount: { availability: 'RESTRICTED', amountCents: null } } } })
    expect(view.metrics.find(item => item.label === '缴费金额')?.value).toBe('¥19.90')
    expect(view.metrics.find(item => item.label === '活动净收入')?.value).toBe('—')
    expect(view.purchaseTrend?.rows).toEqual([{ date: '2030-01-01', initial: '1', firstRenewal: '0', repeatRenewal: '2', paidAmount: '19.90' }])
    expect(view.playerTrend.available).toBe(false)
  })
  it('keeps the paid amount comparison a server fact instead of a client calculation', () => {
    const compared = mapAdminOverview({ membership: { purchaseFlow: { eligiblePaidAmount: { availability: 'AVAILABLE', amountCents: 12860000, comparison: { availability: 'AVAILABLE', previousAmountCents: 13280000, deltaAmountCents: -420000 } } } } })
    expect(compared.metrics.find(item => item.label === '缴费金额')).toMatchObject({ value: '¥128,600.00', detail: '较上一周期 -¥4,200.00', trend: 'down' })
    const flat = mapAdminOverview({ membership: { purchaseFlow: { eligiblePaidAmount: { availability: 'AVAILABLE', amountCents: 12860000 } } } })
    expect(flat.metrics.find(item => item.label === '缴费金额')).toMatchObject({ value: '¥128,600.00', detail: '所选时间范围 · 人民币', trend: 'neutral' })
  })
  it('keeps demo overview fixtures aligned with the PRD headline cards', () => {
    const view = createCoreDemoOverview()
    expect(view.metrics.map(item => item.label)).toEqual(['当前玩家', '首年续费', '新增用户', '缴费金额'])
    expect(view.metrics.map(item => item.value)).toEqual(['1,286', '328', '86', '¥128,600'])
    expect(view.playerTrend.available).toBe(true)
    expect(view.playerTrend.months).toHaveLength(12)
    expect(view.playerTrend.months.at(-1)).toMatchObject({ month: '2030-02', newPlayers: 86 })
    expect(view.attention.map(item => item.label)).toEqual(['30 日内到期会员', '待审核报名', '待验收任务', '消息发送失败'])
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

    // 整行点击进入用户档案（原型口径：无操作列）。
    await user.click(screen.getByText('林晓'))
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

  it('renders the prototype user list columns and filters demo users by identity and expiry buckets', () => {
    const page = createCoreDemoReadPage('users', { query: '', status: '', cursor: null, limit: 20 })
    expect(page.sections[0].columns.map(column => column.label)).toEqual([
      '头像', '昵称', '手机号', '当前角色', '行业', '当前身份', '用户等级', '贡献值', '玩家权益状态', '用户注册时间', '玩家到期时间',
    ])
    expect(page.sections[0].rows.map(row => row.playerStatus)).toEqual(['生效中', '—', '本月到期', '—'])

    const normal = createCoreDemoReadPage('users', { query: '', status: '', cursor: null, limit: 20, filters: { kind: 'NORMAL' } })
    expect(normal.sections[0].rows.map(row => row.detailId)).toEqual(['USR-1004'])
    expect(normal.sections[0].rows[0].role).toBe('普通用户')

    const expiring = createCoreDemoReadPage('users', { query: '', status: '', cursor: null, limit: 20, filters: { playerLifecycle: 'EXPIRING_THIS_MONTH' } })
    expect(expiring.sections[0].rows.map(row => row.detailId)).toEqual(['USR-1003'])

    const guest = createCoreDemoReadPage('users', { query: '', status: '', cursor: null, limit: 20, filters: { kind: 'GUEST' } })
    expect(guest.sections[0].rows.map(row => row.detailId)).toEqual(['USR-1002'])
  })

  it('builds demo tag rows with server-shaped catalog operations for the settings page', () => {
    const rows = createCoreDemoEventTagCatalog()
    expect(rows.map(row => row.name)).toEqual(['早会', '集会', '沙龙'])
    expect(rows[0].rowActions?.map(operation => operation.label)).toEqual(['编辑', '停用', '归档'])
    expect(rows[2].rowActions?.map(operation => operation.label)).toEqual(['编辑', '启用', '归档'])
  })

  it('preserves all server-returned event statuses while keeping the inline tag section in settings', async () => {
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
    expect(screen.getByText('草稿活动')).toBeInTheDocument()
    expect(screen.getByText('已归档活动')).toBeInTheDocument()
    expect(screen.queryByText('活动政策')).toBeNull()
    await user.click(screen.getByText('活动规则与类型设置'))
    expect(screen.getByText('活动政策')).toBeInTheDocument()
    expect(screen.getByText('活动类型')).toBeInTheDocument()
    expect(screen.queryByText('活动标签')).toBeNull()

    await user.click(within(container.querySelector('.filter-bar__status') as HTMLElement).getByRole('combobox'))
    await screen.findAllByRole('option')
    // antd 的 role=option 走 aria-label 且被虚拟列表截断，这里断言实际渲染的选项内容。
    const optionLabels = Array.from(document.querySelectorAll('.ant-select-dropdown .ant-select-item-option-content'))
      .map(node => node.textContent)
    expect(optionLabels).toEqual(['全部状态', '草稿', '已发布', '已下架', '已取消', '已结束', '已归档'])
  })

  it.each(['DRAFT', 'ARCHIVED'])('keeps a searched %s event visible and reachable with its server cursor', async status => {
    const request = vi.fn().mockResolvedValue({ items: [{ id: 'saved-event', title: '测试活动保存回读', status, version: 1 }], nextCursor: 'event-next' })
    const page = await loadAdminReadPage('events', { query: '测试活动保存回读', status, limit: 1, cursor: null }, request)
    expect(request).toHaveBeenCalledWith('mip.admin.events.list', {
      filters: { query: '测试活动保存回读', status }, limit: 1, cursor: undefined, sort: { field: 'startsAt', direction: 'ASC' },
    })
    const onOpenDetail = vi.fn()
    const onSearchChange = vi.fn()
    render(<CoreListPageView route="events" search={{ q: '测试活动保存回读', status }} page={page} onOpenDetail={onOpenDetail} onSearchChange={onSearchChange} />)
    expect(screen.getByText('测试活动保存回读', { selector: 'td' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '查看' }))
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ route: 'events', id: 'saved-event' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onSearchChange).toHaveBeenCalledWith({ q: '测试活动保存回读', status, cursor: 'event-next', page: 2 })
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

  it('keeps the demo order columns aligned with the design, including payment and completion times', () => {
    const page = createCoreDemoReadPage('orders', {
      query: '',
      status: '',
      cursor: null,
      limit: 20,
    })
    expect(page.sections[0].columns.map(column => column.label)).toEqual([
      '订单号', '用户', '订单类型', '订单内容', '金额', '支付时间', '完成时间', '创建时间', '状态',
    ])
    expect(page.sections[0].rows[0]).toMatchObject({ id: 'ORD-20300018', paidAt: '2030-02-16 14:25', completedAt: '2030-02-16 14:25' })
    expect(page.sections[0].rows[2]).toMatchObject({ id: 'ORD-20300020', paidAt: '', completedAt: '' })
  })

  it('keeps event policy and catalog operations reachable with their server-projected context', async () => {
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

    expect(screen.queryByRole('button', { name: /新建活动目录/ })).toBeNull()
    fireEvent.click(screen.getByText('活动规则与类型设置'))
    fireEvent.click(screen.getByRole('button', { name: /新建活动目录/ }))
    expect(onMutation).toHaveBeenCalledWith({ action: 'mip.admin.events.catalog.save', targetId: '' })
    fireEvent.click(screen.getByText('编辑政策'))
    expect(onMutation).toHaveBeenCalledWith({
      action: 'mip.admin.events.policy.save',
      targetId: '',
      values: { expectedVersion: 0, cancellationHoursBeforeStart: 24 },
    })
    fireEvent.click(screen.getByText('编辑', { exact: true }))
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
        quickActions={[{ label: '订单查询', target: '/orders' }]}
        onNavigate={onNavigate}
      />,
    )
    expect(screen.getByText('暂无会籍趋势')).toBeInTheDocument()
    expect(screen.getByText(/其余类别将在后续分期开放/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /订单查询/ }))
    expect(onNavigate).toHaveBeenCalledWith('/orders')
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
