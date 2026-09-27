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
})
