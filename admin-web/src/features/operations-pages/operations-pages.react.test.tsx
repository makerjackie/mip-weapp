import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminMediaFile } from '../../modules/admin-media-upload'
import type { AdminReadPage, AdminTableRow } from '../../modules/admin-read-pages'
import { EntitlementGrantPage } from './entitlement-grant-page'
import { GameManagementPage } from './game-management-page'
import { GrowthContributionPage } from './growth-contribution-page'
import { GrowthEntitlementsPage } from './growth-entitlements-page'
import { GrowthExperiencePage } from './growth-experience-page'
import { GrowthLevelsPage } from './growth-levels-page'
import { MediaUploadPage } from './media-upload-page'
import { OpportunitiesContentPage } from './opportunities-content-page'
import { TaskManagementPage } from './task-management-page'
import type { OperationsPageState } from './types'

vi.mock('./membership-configuration-panel', () => ({ MembershipConfigurationPanel: () => null }))

const mockNavigate = vi.fn()
const session = vi.hoisted(() => ({
  request: vi.fn(async () => ({ items: [] })),
  hasCapability: () => true,
  demoMode: false,
}))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({
  ...session,
}) }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({} as Record<string, string>),
  useSearch: () => ({} as Record<string, unknown>),
  useRouterState: () => ({ location: { search: {} } }),
}))

vi.mock('../../shared/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/ui')>()
  return {
    ...actual,
    DataTable: ({ label, rows, onView, renderActions }: {
      label: string
      rows: AdminTableRow[]
      onView?: (row: AdminTableRow) => void
      renderActions?: (row: AdminTableRow) => React.ReactNode
    }) => (
      <div aria-label={label}>
        {rows.map((row, index) => (
          <div key={String(row.detailId || index)}>
            {onView && row.detailId ? <button onClick={() => onView(row)}>查看</button> : null}
            {renderActions?.(row)}
          </div>
        ))}
      </div>
    ),
  }
})

afterEach(cleanup)

function pageState(page: AdminReadPage, overrides: Partial<OperationsPageState> = {}): OperationsPageState {
  return {
    page,
    query: { query: '', status: '' },
    onFilterChange: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  }
}

describe('second-batch operations pages', () => {
  it.each([TaskManagementPage])('only exposes supported basic filters on %s', async (Page) => {
    const onFilterChange = vi.fn()
    const onRefresh = vi.fn()
    render(<Page {...pageState({ sections: [], nextCursor: null }, { onFilterChange, onRefresh })} />)

    expect(screen.queryByText('多维度')).toBeNull()
    expect(screen.queryByText('时间范围')).toBeNull()
    expect(screen.getByText('每页')).toBeTruthy()
    await userEvent.type(screen.getByRole('textbox'), '验收任务')
    await userEvent.click(screen.getByRole('button', { name: /筛\s*选/ }))
    expect(onFilterChange).toHaveBeenLastCalledWith({ query: '验收任务', status: '', filters: undefined })
    await userEvent.click(screen.getByRole('button', { name: '刷新数据' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('retains the task status filter callback', async () => {
    const onFilterChange = vi.fn()
    render(<TaskManagementPage {...pageState({ sections: [], nextCursor: null }, { onFilterChange })} />)
    await userEvent.click(screen.getAllByRole('combobox')[0])
    await userEvent.click(await screen.findByText('已发布'))
    expect(onFilterChange).toHaveBeenLastCalledWith({ query: '', status: 'PUBLISHED', filters: undefined })
  })

  it('exposes task detail, create, and cursor pagination intents', async () => {
    const onWrite = vi.fn()
    const onOpenDetail = vi.fn()
    const onNextPage = vi.fn()
    render(
      <TaskManagementPage {...pageState({
        sections: [
          { title: '任务', rows: [{ detailId: 'task-1', name: '早会复盘', state: '已发布' }], columns: [{ key: 'name', label: '任务名称' }, { key: 'state', label: '状态' }] },
          { title: '近期完成记录', detailTarget: 'taskCompletions', rows: [{ detailId: 'completion-1', task: '早会复盘' }], columns: [{ key: 'task', label: '任务' }] },
        ],
        nextCursor: 'task-cursor-2',
      }, { onWrite, onOpenDetail, onNextPage })} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /创建任务/ }))
    expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/tasks/$taskId/edit' }))
    fireEvent.click(screen.getAllByRole('button', { name: '查看' })[0])
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ route: 'tasks', id: 'task-1' }))
    fireEvent.click(screen.getByRole('button', { name: /下一页/ }))
    expect(onNextPage).toHaveBeenCalledWith('task-cursor-2')
  })

  it('forwards reviewed game row operations without rebuilding mutation input', async () => {
    const onWrite = vi.fn()
    render(
      <GameManagementPage {...pageState({
        sections: [{
          title: '赛季',
          detailTarget: 'gameSeasons',
          rows: [{
            detailId: 'season-1',
            name: '半年赛季',
            rowActions: [{
              action: 'mip.admin.game.seasons.changeStatus',
              label: '启用',
              targetId: 'season-1',
              values: { seasonId: 'season-1', expectedVersion: 2, status: 'ACTIVE' },
            }],
          }],
          columns: [{ key: 'name', label: '赛季' }],
        }],
        nextCursor: null,
      }, { onWrite })} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    expect(onWrite).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mip.admin.game.seasons.changeStatus',
      targetId: 'season-1',
      values: { seasonId: 'season-1', expectedVersion: 2, status: 'ACTIVE' },
    }))
  })

  it('maps the opportunity status filter to page-local wording while submitting codes (MIW-127)', async () => {
    const onFilterChange = vi.fn()
    render(<OpportunitiesContentPage {...pageState({ sections: [], nextCursor: null }, {
      onFilterChange,
      query: { query: '', status: '', filters: { section: 'opportunities' } },
    })} />)
    await userEvent.click(screen.getAllByRole('combobox')[0])
    await userEvent.click(await screen.findByText('招募中'))
    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'PUBLISHED', filters: { section: 'opportunities' } }))
  })

  it('keeps opportunity and growth write actions as exact service actions', async () => {
    const opportunityWrite = vi.fn()
    const { unmount } = render(
      <OpportunitiesContentPage {...pageState({ sections: [], nextCursor: null }, { onWrite: opportunityWrite })} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /创建机会/ }))
    expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/opportunities/$opportunityId/edit' }))
    fireEvent.click(screen.getByRole('button', { name: /创建合作卡/ }))
    expect(mockNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '/userContent/$contentId/edit', search: expect.any(Function) }))
    expect(mockNavigate.mock.calls.at(-1)?.[0].search({ q: '当前内容', filters: { ownerUserId: 'owner-a' } })).toEqual({ kind: 'COOPERATION_CARD', returnSearch: { q: '当前内容', filters: { ownerUserId: 'owner-a', section: 'content' } } })
    fireEvent.click(screen.getByRole('button', { name: /创建超级案例/ }))
    expect(mockNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '/userContent/$contentId/edit', search: expect.any(Function) }))
    expect(mockNavigate.mock.calls.at(-1)?.[0].search({ q: '当前内容', filters: { ownerUserId: 'owner-a' } })).toEqual({ kind: 'SUPER_CASE', returnSearch: { q: '当前内容', filters: { ownerUserId: 'owner-a', section: 'content' } } })
    unmount()

    // MIW-129：等级管理页保留授予勋章入口；成长数据调整改由权益发放页承接。
    const growthWrite = vi.fn()
    render(<GrowthLevelsPage {...pageState({ sections: [], nextCursor: null }, { onWrite: growthWrite, canCapability: () => true })} />)
    await userEvent.click(screen.getByRole('button', { name: /运营操作/ }))
    await userEvent.click(await screen.findByText('授予勋章'))
    expect(growthWrite).toHaveBeenCalledWith({ action: 'mip.admin.badges.grant' })
  })

  it('hides badge sections from operators without badges.manage (MIW-129)', async () => {
    render(<GrowthLevelsPage {...pageState({ sections: [], nextCursor: null }, { canCapability: capability => capability === 'growth.read' })} />)
    await userEvent.click(screen.getByRole('combobox', { name: '等级管理分区' }))
    expect(await screen.findByText('等级变更', { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
    expect(screen.queryByText('勋章目录', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument()
  })

  it('navigates from entitlements to the standalone grant page and back (MIW-129)', async () => {
    const onWrite = vi.fn()
    render(<GrowthEntitlementsPage {...pageState({ sections: [], nextCursor: null }, { onWrite, canCapability: () => true })} />)
    fireEvent.click(screen.getByRole('button', { name: /发放权益/ }))
    expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/entitlements/grant' }))
  })

  it('switches contribution behaviors to server codes and keeps the rules section reachable (MIW-129)', async () => {
    const onFilterChange = vi.fn()
    render(<GrowthContributionPage {...pageState({ sections: [], nextCursor: null }, {
      onFilterChange,
      query: { query: '', status: '', filters: { section: 'contributionTransactions' } },
    })} />)
    // 组合框顺序：状态、分区、行为、服务器、每页（与 FilterBar 渲染顺序一致）。
    await userEvent.click(screen.getAllByRole('combobox')[2])
    await userEvent.click(await screen.findByText('引荐机会', { selector: '.ant-select-item-option-content' }))
    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({
      filters: expect.objectContaining({ section: 'contributionTransactions', behavior: 'OPPORTUNITY_REFERRAL' }),
    }))
  })

  it('maps experience source filters onto existing source events (MIW-129)', async () => {
    const onFilterChange = vi.fn()
    render(<GrowthExperiencePage {...pageState({ sections: [], nextCursor: null }, {
      onFilterChange,
      query: { query: '', status: '', filters: { section: 'entries' } },
    })} />)
    // 组合框顺序：状态、分区、来源、服务器、每页。
    await userEvent.click(screen.getAllByRole('combobox')[2])
    await userEvent.click(await screen.findByText('人工冲正', { selector: '.ant-select-item-option-content' }))
    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({
      filters: expect.objectContaining({ section: 'entries', sourceEventType: 'ADMIN_ADJUSTMENT' }),
    }))
  })

  it('blocks the grant form submit in demo mode instead of calling the service (MIW-129)', async () => {
    session.demoMode = true
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    try {
      render(
        <App>
          <QueryClientProvider client={client}>
            <EntitlementGrantPage />
          </QueryClientProvider>
        </App>,
      )
      // 演示模式：用户从演示目录选择，提交被拦截并提示。
      await userEvent.click(screen.getAllByRole('combobox')[0])
      await userEvent.click(await screen.findByText(/林晓/, { selector: '.ant-select-item-option-content' }))
      await userEvent.type(screen.getByLabelText('发放数值'), '20')
      await userEvent.type(screen.getByLabelText('发放原因'), '线下活动补录')
      fireEvent.click(screen.getByRole('button', { name: '确认发放' }))
      expect(await screen.findByText('演示模式不会提交写操作')).toBeInTheDocument()
      expect(session.request).not.toHaveBeenCalledWith('mip.admin.growth.adjust', expect.anything())
    }
    finally {
      session.demoMode = false
    }
  })

  it('validates upload metadata and exposes upload and copy callbacks', async () => {
    const onFileChange = vi.fn()
    const onValidationError = vi.fn()
    const onUpload = vi.fn()
    const onCopyAssetId = vi.fn()
    const file = new File(['png'], 'banner.png', { type: 'image/png' }) as AdminMediaFile
    const { container, rerender } = render(
      <MediaUploadPage
        purposeOptions={[{ value: 'BANNER', label: 'Banner 图片' }]}
        selectedPurpose="BANNER"
        file={null}
        previewUrl=""
        onPurposeChange={vi.fn()}
        onFileChange={onFileChange}
        onValidationError={onValidationError}
        onUpload={onUpload}
        onCopyAssetId={onCopyAssetId}
      />,
    )
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(picker, file as File)
    expect(onFileChange).toHaveBeenCalledWith(file)
    expect(onValidationError).not.toHaveBeenCalled()

    rerender(
      <MediaUploadPage
        purposeOptions={[{ value: 'BANNER', label: 'Banner 图片' }]}
        selectedPurpose="BANNER"
        file={file}
        previewUrl="blob:banner"
        result={{ assetId: '123e4567-e89b-42d3-a456-426614174000', imageUrl: 'cloud://env/banner.png' }}
        onPurposeChange={vi.fn()}
        onFileChange={onFileChange}
        onValidationError={onValidationError}
        onUpload={onUpload}
        onCopyAssetId={onCopyAssetId}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /上传图片/ }))
    expect(onUpload).toHaveBeenCalledWith(file, 'BANNER')
    fireEvent.click(screen.getByRole('button', { name: /复制/ }))
    expect(onCopyAssetId).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174000')
  })

  it('adds current-page task filters for star level, owner, and reward type', async () => {
    const onFilterChange = vi.fn()
    const taskSections = [{
      title: '任务',
      rows: [
        { detailId: 'task-1', name: '早会复盘', starLevel: '3', assignedOwner: '笨笨老大', rewardConfig: '经验值 30 / 贡献值 5', state: '已发布' },
        { detailId: 'task-2', name: '机会跟进', starLevel: '5', assignedOwner: '周宁', rewardConfig: '奖金（线下） 100', state: '草稿' },
      ],
      columns: [{ key: 'name', label: '任务名称' }, { key: 'starLevel', label: '星级' }, { key: 'assignedOwner', label: '负责人' }, { key: 'rewardConfig', label: '奖励分项' }, { key: 'state', label: '状态' }],
    }]
    const { rerender } = render(<TaskManagementPage {...pageState({
      sections: taskSections,
      nextCursor: null,
    }, { onFilterChange, onOpenDetail: vi.fn() })} />)

    expect(screen.queryByText('当前页过滤')).toBeNull()
    await userEvent.click(screen.getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByText('三星', { selector: '.ant-select-item-option-content' }))
    expect(onFilterChange).toHaveBeenLastCalledWith({ query: '', status: '', filters: { starLevel: '3' } })

    await userEvent.click(screen.getAllByRole('combobox')[2])
    expect(await screen.findByText('笨笨老大', { selector: '.ant-select-item-option-content' })).toBeTruthy()
    await userEvent.click(screen.getByText('周宁', { selector: '.ant-select-item-option-content' }))
    expect(onFilterChange).toHaveBeenLastCalledWith({ query: '', status: '', filters: { assignedOwner: '周宁' } })

    await userEvent.click(screen.getAllByRole('combobox')[3])
    await userEvent.click(await screen.findByText('奖金', { selector: '.ant-select-item-option-content' }))
    expect(onFilterChange).toHaveBeenLastCalledWith({ query: '', status: '', filters: { rewardType: 'bonus' } })

    rerender(<TaskManagementPage {...pageState({
      sections: taskSections,
      nextCursor: null,
    }, {
      onFilterChange,
      onOpenDetail: vi.fn(),
      query: { query: '', status: '', filters: { starLevel: '3', assignedOwner: '笨笨老大', rewardType: 'experience' } },
    })} />)
    expect(screen.getByText('当前页过滤')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '查看' }).length).toBe(1)
  })
})
