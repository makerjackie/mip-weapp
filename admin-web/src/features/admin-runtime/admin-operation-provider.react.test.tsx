import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminOperationProvider, useAdminOperations } from './admin-operation-provider'
import { AdminDetailActions } from './admin-detail-actions'

afterEach(cleanup)

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../app/session-provider', () => ({
  useAdminSession: () => ({ demoMode: false, hasCapability: () => true, request }),
}))
vi.mock('../../shared/ui', () => ({
  MutationDialog: ({ open, values, error, onSubmit, onCancel }: {
    open: boolean; values: Record<string, unknown>; error: string
    onSubmit: (values: Record<string, unknown>) => void; onCancel: () => void
  }) => open ? <div>
    <span>{error}</span><span data-testid="reason">{String(values.reason || '')}</span>
    <button onClick={() => onSubmit({ ...values, reason: '活动安排调整' })}>保存表单</button>
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
  beforeEach(() => { request.mockReset(); version = '4' })
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
    expect(Boolean(screen.queryByRole('button', { name: '编辑活动' }))).toBe(['DRAFT', 'UNPUBLISHED'].includes(status))
    expect(screen.getByRole('button', { name: '克隆活动' })).toBeInTheDocument()
    if (status === 'PUBLISHED') expect(screen.getByRole('button', { name: '下架活动' })).toBeInTheDocument()
  })
})
