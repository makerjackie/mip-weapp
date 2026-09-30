import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminOperationProvider, useAdminOperations } from './admin-operation-provider'
import { AdminDetailActions } from './admin-detail-actions'

const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({} as Record<string, string>),
  useSearch: () => ({} as Record<string, unknown>),
  useRouterState: () => ({ location: { search: {} } }),
}))

afterEach(cleanup)

const { request, session } = vi.hoisted(() => ({ request: vi.fn(), session: { boundary: 'actor-a' } }))
vi.mock('../../app/session-provider', () => ({
  useAdminSession: () => ({ demoMode: false, hasCapability: () => true, request, sessionBoundary: session.boundary }),
}))
vi.mock('../../shared/ui', async () => ({
  humanizeError: (await import('../../shared/ui/humanize-error')).humanizeError,
  MutationDialog: ({ open, values, error, onSubmit, onCancel }: {
    open: boolean; values: Record<string, unknown>; error: string
    onSubmit: (values: Record<string, unknown>) => void; onCancel: () => void
  }) => open ? <div>
    <span>{error}</span><span data-testid="reason">{String(values.reason || '')}</span>
    <button onClick={() => onSubmit({ ...values, reason: '活动安排调整' })}>保存表单</button>
    <button onClick={() => onSubmit({ ...values, reason: '调整后的理由' })}>修改后保存</button>
    <button onClick={onCancel}>关闭表单</button>
  </div> : null,
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => open
    ? <button onClick={onConfirm}>最终确认</button> : null,
}))
let version = '4'
function Probe() {
  const { launch } = useAdminOperations()
  return <button onClick={() => void launch('mip.admin.events.archive', 'event-a', {
    route: 'events', title: '活动', subtitle: '', status: 'DRAFT',
    sections: [{ title: '活动信息', fields: [{ label: '版本', value: version }] }],
  })}>归档活动</button>
}

describe('admin operation conflict recovery', () => {
  beforeEach(() => { request.mockReset(); version = '4'; session.boundary = 'actor-a' })
  it('keeps the key for an ambiguous retry and changes it when the operator changes the payload', async () => {
    request.mockRejectedValueOnce(new Error('NETWORK_ERROR')).mockRejectedValueOnce(new Error('NETWORK_ERROR')).mockResolvedValueOnce({})
    render(<QueryClientProvider client={new QueryClient()}><App><AdminOperationProvider><Probe /></AdminOperationProvider></App></QueryClientProvider>)
    fireEvent.click(screen.getByText('归档活动'))
    await screen.findByText('保存表单')
    for (const [index, label] of ['保存表单', '保存表单', '修改后保存'].entries()) {
      fireEvent.click(screen.getByText(label))
      fireEvent.click(screen.getByText('最终确认'))
      await waitFor(() => expect(request).toHaveBeenCalledTimes(index + 1))
      if (label !== '修改后保存') await screen.findByText('网络连接失败，请检查网络后重试')
    }
    expect(request.mock.calls[0]?.[1].idempotencyKey).toBe(request.mock.calls[1]?.[1].idempotencyKey)
    expect(request.mock.calls[1]?.[1].idempotencyKey).not.toBe(request.mock.calls[2]?.[1].idempotencyKey)
    expect(request.mock.calls[2]?.[1].reason).toBe('调整后的理由')
  })
  it('clears the old actor draft and ignores its late mutation response after a session switch', async () => {
    let finish!: (value: object) => void
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const client = new QueryClient()
    const refresh = vi.spyOn(client, 'invalidateQueries')
    const tree = () => <QueryClientProvider client={client}><App><AdminOperationProvider><Probe /></AdminOperationProvider></App></QueryClientProvider>
    const view = render(tree())
    fireEvent.click(screen.getByText('归档活动'))
    await screen.findByText('保存表单')
    fireEvent.click(screen.getByText('保存表单'))
    fireEvent.click(screen.getByText('最终确认'))
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    session.boundary = 'actor-b'; view.rerender(tree())
    expect(screen.queryByText('最终确认')).not.toBeInTheDocument()
    finish({})
    await waitFor(() => expect(refresh).not.toHaveBeenCalled())
    fireEvent.click(screen.getByText('归档活动'))
    await screen.findByText('保存表单')
    expect(screen.getByTestId('reason')).toHaveTextContent('')
  })
  it('refreshes on conflict and restores the draft with the newly confirmed version', async () => {
    const client = new QueryClient()
    const refresh = vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => { version = '5' })
    request.mockRejectedValueOnce(Object.assign(new Error('记录已变化'), { code: 'CONFLICT' })).mockResolvedValueOnce({})
    render(<QueryClientProvider client={client}><App><AdminOperationProvider><Probe /></AdminOperationProvider></App></QueryClientProvider>)
    fireEvent.click(screen.getByText('归档活动'))
    await screen.findByText('保存表单')
    fireEvent.click(screen.getByText('保存表单'))
    fireEvent.click(screen.getByText('最终确认'))
    await screen.findByText('记录已更新，列表已刷新。填写内容已保留，请重新打开操作后核对。')
    expect(refresh).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('保存表单'))
    expect(request).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('关闭表单'))
    fireEvent.click(screen.getByText('归档活动'))
    await screen.findByText('已保留上次填写内容，请核对最新记录后重新提交。')
    expect(screen.getByTestId('reason')).toHaveTextContent('活动安排调整')
    fireEvent.click(screen.getByText('保存表单'))
    fireEvent.click(screen.getByText('最终确认'))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(request.mock.calls[0]?.[1]).toMatchObject({ expectedVersion: 4, reason: '活动安排调整' })
    expect(request.mock.calls[1]?.[1]).toMatchObject({ expectedVersion: 5, reason: '活动安排调整' })
    expect(request.mock.calls[0]?.[1].idempotencyKey).not.toBe(request.mock.calls[1]?.[1].idempotencyKey)
  })
})


describe('event detail editing availability', () => {
  it.each(['DRAFT', 'UNPUBLISHED', 'PUBLISHED', 'CANCELLED', 'ENDED', 'ARCHIVED'])('matches the server edit boundary for %s', (status) => {
    render(<QueryClientProvider client={new QueryClient()}><App><AdminOperationProvider>
      <AdminDetailActions route="events" id="event-a" view={{
        route: 'events', title: '活动', subtitle: '', status, sections: [], source: { event: { status } },
      }} />
    </AdminOperationProvider></App></QueryClientProvider>)
    expect(Boolean(screen.queryByRole('button', { name: '编辑活动' }))).toBe(['DRAFT', 'UNPUBLISHED', 'PUBLISHED'].includes(status))
    expect(screen.getByRole('button', { name: '克隆活动' })).toBeInTheDocument()
    if (status === 'PUBLISHED') {
      expect(screen.getByRole('button', { name: '下架活动' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '结束活动' })).toBeInTheDocument()
    } else {
      expect(screen.queryByRole('button', { name: '结束活动' })).not.toBeInTheDocument()
    }
  })
})
