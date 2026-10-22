import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GrowthContributionPage } from './growth-contribution-page'
import { GrowthLevelsPage } from './growth-levels-page'
import type { OperationsPageState } from './types'
import type { AdminTableRow } from '../../modules/admin-read-pages'

const session = vi.hoisted(() => ({ request: vi.fn(), writable: true, navigate: vi.fn() }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({
  request: session.request, demoMode: false, session: { actor: { id: 'admin' } }, sessionBoundary: 1,
  hasCapability: () => false,
  hasCapabilityAtScope: (capability: string) => capability === 'growth.read' || session.writable,
}) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => session.navigate, useRouterState: () => ({}) }))
// Match the existing operations-page suite: test workflow interactions, not Ant table layout in JSDOM.
vi.mock('../../shared/ui', async importOriginal => ({
  ...await importOriginal<typeof import('../../shared/ui')>(),
  DataTable: ({ rows, renderActions }: { rows: AdminTableRow[]; renderActions?: (row: AdminTableRow) => React.ReactNode }) => <div>{rows.map((row, index) => <div key={index}>{String(row.user || row.name)}{renderActions?.(row)}</div>)}</div>,
}))
const base: OperationsPageState = { page: null, query: { query: '', status: '' }, onFilterChange: vi.fn(), onRefresh: vi.fn() }
const contributionPage = { sections: [{ title: '贡献值流水', columns: [{ key: 'user', label: '用户' }], rows: [{ user: '林晓', txnNo: 'original-entry', reversibleValue: 20 }] }], nextCursor: null }
function mount(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><App>{node}</App></QueryClientProvider>)
}
afterEach(cleanup)
beforeEach(() => { session.writable = true; session.request.mockReset(); session.request.mockResolvedValue({ items: [] }); session.navigate.mockReset() })

describe('growth review fixes', () => {
  it('keeps read-only contribution operators from reversing balances', () => {
    session.writable = false
    mount(<GrowthContributionPage {...base} page={contributionPage} />)
    expect(screen.queryByRole('button', { name: /冲正/ })).not.toBeInTheDocument()
  })
  it('reverses a selected original record with a reason and reuses the request key after an uncertain response', async () => {
    const onRefresh = vi.fn()
    let attempts = 0
    session.request.mockImplementation(async (action: string) => {
      if (action === 'mip.admin.contribution.transactions.reverse' && ++attempts === 1) throw new Error('网络响应中断')
      return { items: [], reversalNo: 'reversal-1' }
    })
    mount(<GrowthContributionPage {...base} page={contributionPage} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: /冲\s*正/ }))
    fireEvent.change(screen.getByLabelText('冲正贡献值'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('冲正原因'), { target: { value: '误发奖励回退' } })
    fireEvent.click(screen.getByRole('button', { name: '确认冲正' }))
    await screen.findByText('网络响应中断')
    expect(onRefresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认冲正' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
    const calls = session.request.mock.calls.filter(call => call[0] === 'mip.admin.contribution.transactions.reverse')
    expect(calls).toHaveLength(2)
    expect(calls[0][1]).toEqual({ originalTransactionNo: 'original-entry', reversalValue: 10, reason: '误发奖励回退', idempotencyKey: expect.any(String) })
    expect(calls[1][1]).toEqual(calls[0][1])
  })
  it('opens the exact level editor with its saved version and drills down to active users of the same level', async () => {
    const level = { id: 'level-1', levelKey: 'lv01', name: '探索者', version: 4, status: 'ACTIVE', minimumExperience: 0, sortOrder: 0, benefits: [{ id: 'benefit-1', name: '活动权益', description: '已有权益说明' }] }
    session.request.mockImplementation(async (action: string) => ({ items: action === 'mip.admin.growth.levels' ? [level] : [{ id: 'benefit-1', name: '活动权益', status: 'ACTIVE' }] }))
    const onRefresh = vi.fn()
    mount(<GrowthLevelsPage {...base} onRefresh={onRefresh} canCapability={() => true} page={{ sections: [{ title: '等级', columns: [{ key: 'name', label: '名称' }], rows: [{ name: '探索者', levelItem: level }] }], nextCursor: null }} />)
    fireEvent.click(screen.getByRole('button', { name: '用户明细' }))
    expect(session.navigate).toHaveBeenCalledWith({ to: '/users', search: { status: 'ACTIVE', filters: { levelId: 'level-1' } } })
    fireEvent.click(screen.getByRole('button', { name: /^编\s*辑$/ }))
    expect(await screen.findByDisplayValue('探索者')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '探索者更新' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(session.request).toHaveBeenCalledWith('mip.admin.growth.saveLevel', expect.objectContaining({ levelId: 'level-1', expectedVersion: 4, draft: expect.objectContaining({ name: '探索者更新', benefitIds: ['benefit-1'] }) })))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})
