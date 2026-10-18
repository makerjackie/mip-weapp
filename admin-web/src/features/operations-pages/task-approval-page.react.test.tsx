import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminReadPage, AdminTableRow } from '../../modules/admin-read-pages'
import { TaskApprovalPage, useTaskApprovalPage } from './task-approval-page'
import type { OperationsPageState } from './types'

vi.mock('../../shared/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/ui')>()
  return {
    ...actual,
    DataTable: ({ label, rows, columns, renderActions }: {
      label: string
      rows: AdminTableRow[]
      columns: Array<{ key: string; label: string }>
      renderActions?: (row: AdminTableRow) => React.ReactNode
    }) => (
      <div aria-label={label}>
        <div>{columns.map(column => <span key={column.key}>{column.label}</span>)}</div>
        {rows.map((row, index) => (
          <div key={String(row.detailId || index)}>
            <span>{String(row.member || '')}</span>
            <span>{String(row.task || '')}</span>
            {renderActions?.(row)}
          </div>
        ))}
      </div>
    ),
  }
})

const session = vi.hoisted(() => ({
  demoMode: false,
  loading: false,
  session: null as { enabled?: boolean; actor?: { id?: string } | null } | null,
  sessionBoundary: 0,
  error: undefined as Error | undefined,
  request: async () => {
    throw new Error('tests do not call the API')
  },
}))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({ ...session }) }))

afterEach(cleanup)

const approvalRows: AdminTableRow[] = [
  {
    detailId: 'c1', member: '林晓', task: '早会复盘', starLevel: '三星', attachment: '已上传',
    reviewedBy: '—', state: '待审批', rewardResult: '—',
    rowActions: [
      { action: 'mip.admin.tasks.submissions.approve', label: '通过', targetId: 'c1', values: { submissionId: 'c1' } },
      { action: 'mip.admin.tasks.submissions.reject', label: '退回', targetId: 'c1', values: { submissionId: 'c1' } },
    ],
  },
  {
    detailId: 'c2', member: '陈默', task: '机会跟进', starLevel: '四星', attachment: '已上传',
    reviewedBy: '笨笨老大', state: '已通过', rewardResult: '经验值 50', rowActions: [],
  },
  {
    detailId: 'c3', member: '周宁', task: '早会复盘', starLevel: '二星', attachment: '未上传',
    reviewedBy: '笨笨老大', state: '奖励发放失败', rewardResult: '奖励发放失败，可重试',
    rowActions: [
      { action: 'mip.admin.tasks.submissions.retryReward', label: '重试奖励', targetId: 'c3', values: { submissionId: 'c3' } },
    ],
  },
]

function approvalPage(): AdminReadPage {
  return {
    sections: [{
      rows: approvalRows.map(row => ({ ...row })),
      columns: [
        { key: 'member', label: '提交人' }, { key: 'task', label: '任务名称' }, { key: 'starLevel', label: '星级' },
        { key: 'attachment', label: '附件' }, { key: 'reviewedBy', label: '审批人' }, { key: 'state', label: '审批状态' },
        { key: 'rewardResult', label: '奖励结果' },
      ],
      detailTarget: 'taskApprovals',
    }],
    nextCursor: null,
  }
}

function pageState(overrides: Partial<OperationsPageState> = {}): OperationsPageState {
  return {
    page: approvalPage(),
    query: { query: '', status: '' },
    onFilterChange: vi.fn(),
    onRefresh: vi.fn(),
    onWrite: vi.fn(),
    ...overrides,
  }
}

async function demoApprovalPage(status: string): Promise<AdminReadPage> {
  const queryClient = new QueryClient()
  const holder: { data: AdminReadPage | null } = { data: null }
  function Probe() {
    const result = useTaskApprovalPage({ query: '', status, cursor: null, limit: 20 })
    holder.data = result.data || null
    return null
  }
  render(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>)
  await waitFor(() => expect(holder.data).toBeTruthy())
  return holder.data as AdminReadPage
}

describe('task approval page', () => {
  it('renders NPC approval records with review and retry row actions', () => {
    const onWrite = vi.fn()
    render(<TaskApprovalPage {...pageState({ onWrite })} />)

    expect(screen.getByText('NPC任务')).toBeTruthy()
    expect(screen.getByText('提交与审批记录')).toBeTruthy()
    const table = within(screen.getByLabelText('NPC任务'))
    for (const header of ['提交人', '任务名称', '星级', '附件', '审批人', '审批状态', '奖励结果']) {
      expect(table.getByText(header)).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    expect(onWrite).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'mip.admin.tasks.submissions.approve',
      targetId: 'c1',
      values: { submissionId: 'c1' },
    }))
    fireEvent.click(screen.getByRole('button', { name: '退回' }))
    expect(onWrite).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'mip.admin.tasks.submissions.reject',
      targetId: 'c1',
    }))
    fireEvent.click(screen.getByRole('button', { name: '重试奖励' }))
    expect(onWrite).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'mip.admin.tasks.submissions.retryReward',
      targetId: 'c3',
      values: { submissionId: 'c3' },
    }))
  })

  it('filters approval rows on the current page by star and flags it', async () => {
    const onFilterChange = vi.fn()
    const { rerender } = render(<TaskApprovalPage {...pageState({ onFilterChange })} />)

    expect(screen.queryByText('当前页过滤')).toBeNull()
    await userEvent.click(screen.getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByText('三星', { selector: '.ant-select-item-option-content' }))
    expect(onFilterChange).toHaveBeenLastCalledWith({ query: '', status: '', filters: { starLevel: '3' } })

    rerender(<TaskApprovalPage {...pageState({
      onFilterChange,
      query: { query: '', status: '', filters: { starLevel: '3' } },
    })} />)
    expect(screen.getByText('当前页过滤')).toBeTruthy()
    expect(screen.getByText('林晓')).toBeTruthy()
    expect(screen.queryByText('陈默')).toBeNull()
    expect(screen.queryByText('周宁')).toBeNull()
  })

  it('maps the approval status filter to server submission statuses', async () => {
    const onFilterChange = vi.fn()
    render(<TaskApprovalPage {...pageState({ onFilterChange })} />)

    await userEvent.click(screen.getAllByRole('combobox')[0])
    await userEvent.click(await screen.findByText('待审批', { selector: '.ant-select-item-option-content' }))
    expect(onFilterChange).toHaveBeenLastCalledWith({ query: '', status: 'pending_review', filters: undefined })
  })

  it('builds the demo page from fixture completion records with guarded statuses', async () => {
    session.demoMode = true
    try {
      const pending = await demoApprovalPage('pending_review')
      expect(pending.sections[0].rows.length).toBe(1)
      expect(pending.sections[0].rows[0].state).toBe('待审批')
      expect((pending.sections[0].rows[0].rowActions ?? []).map(operation => operation.label))
        .toEqual(['通过', '退回'])

      const failed = await demoApprovalPage('reward_failed')
      expect(failed.sections[0].rows[0].state).toBe('奖励发放失败')
      expect((failed.sections[0].rows[0].rowActions ?? []).map(operation => operation.label))
        .toEqual(['重试奖励'])
    }
    finally {
      session.demoMode = false
    }
  })
})
