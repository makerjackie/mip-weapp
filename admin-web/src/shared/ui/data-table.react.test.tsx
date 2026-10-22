import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from './data-table'

afterEach(cleanup)

const rows = [
  { detailId: 'row-1', name: '公告一', state: '草稿' },
  { detailId: 'row-2', name: '公告二', state: '草稿' },
]
const columns = [
  { key: 'name', label: '标题' },
  { key: 'state', label: '状态' },
]

describe('DataTable batch actions', () => {
  it('shortens long identifiers without changing the copied value or swallowing custom cells', async () => {
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const identifier = 'ledger-12345678-90abcdef-123456'
    render(<DataTable label="流水" rows={[{ id: identifier, name: '测试记录' }]}
      columns={[{ key: 'id', label: '编号', format: 'identifier', width: 160 }, { key: 'name', label: '内容', wrap: true, width: 200 }]}
      renderCell={(value, _row, column) => column.key === 'name' ? <strong>{String(value)}</strong> : undefined} />)
    expect(screen.getByText('ledger-1…123456')).toBeInTheDocument()
    expect(screen.getByText('测试记录').tagName).toBe('STRONG')
    await user.click(screen.getByRole('button', { name: /复制完整编号/ }))
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(identifier))
    clipboard.mockRestore()
  })
  it('confirms before running and keeps selection until the handler resolves', async () => {
    const onBatchAction = vi.fn().mockResolvedValue(undefined)
    render(
      <DataTable
        label="公告"
        rows={rows}
        columns={columns}
        selectable
        batchActions={[{ key: 'publish', label: '批量发布', confirmTitle: '批量发布公告' }]}
        onBatchAction={onBatchAction}
      />,
    )

    await userEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onBatchAction).not.toHaveBeenCalled()
    expect(screen.getByText('已选 2 项')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: '批量发布' }))
    const dialog = await screen.findByRole('dialog')
    expect(onBatchAction).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: '批量发布' }))
    await waitFor(() => expect(onBatchAction).toHaveBeenCalledOnce())
    expect(onBatchAction.mock.calls[0][1]).toHaveLength(2)
    await waitFor(() => expect(screen.queryByText('已选 2 项')).not.toBeInTheDocument())
  })

  it('collects shared form values and blocks confirm until required fields pass', async () => {
    const onBatchAction = vi.fn().mockResolvedValue(undefined)
    render(
      <DataTable
        label="公告"
        rows={rows}
        columns={columns}
        selectable
        batchActions={[{
          key: 'withdraw',
          label: '批量撤回',
          fields: [{ key: 'reason', label: '撤回原因', kind: 'textarea', required: true, maxLength: 300 }],
        }]}
        onBatchAction={onBatchAction}
      />,
    )

    await userEvent.click(screen.getAllByRole('checkbox')[0])
    await userEvent.click(screen.getByRole('button', { name: '批量撤回' }))
    const dialog = await screen.findByRole('dialog')

    await userEvent.click(within(dialog).getByRole('button', { name: '批量撤回' }))
    await waitFor(() => expect(within(dialog).getByText('请填写撤回原因')).toBeInTheDocument())
    expect(onBatchAction).not.toHaveBeenCalled()

    await userEvent.type(within(dialog).getByLabelText('撤回原因'), '内容已过期')
    await userEvent.click(within(dialog).getByRole('button', { name: '批量撤回' }))
    await waitFor(() => expect(onBatchAction).toHaveBeenCalledOnce())
    expect(onBatchAction.mock.calls[0][2]).toMatchObject({ reason: '内容已过期' })
  })
})
