import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminDetailView } from '../../modules/admin-details'
import { DetailDrawer } from './detail-drawer'

afterEach(cleanup)

describe('DetailDrawer', () => {
  it('renders independent previous and next controls for detail sections', async () => {
    const user = userEvent.setup()
    const onPagerChange = vi.fn()
    const view: AdminDetailView = {
      route: 'tasks',
      title: '任务详情',
      subtitle: '',
      status: '启用',
      sections: [
        {
          title: '成员候选',
          rows: [{ name: '成员一' }],
          columns: [{ key: 'name', label: '姓名' }],
          pager: {
            key: 'taskMembers',
            query: '',
            currentCursor: null,
            nextCursor: 'member-cursor-2',
            placeholder: '搜索成员或服务器',
          },
        },
        {
          title: '完成记录',
          rows: [{ task: '任务一' }],
          columns: [{ key: 'task', label: '任务' }],
          pager: {
            key: 'taskCompletions',
            query: '',
            currentCursor: 'completion-cursor-2',
            nextCursor: null,
            placeholder: '搜索成员或任务',
          },
        },
      ],
    }

    render(
      <DetailDrawer
        open
        view={view}
        onClose={vi.fn()}
        onPagerChange={onPagerChange}
      />,
    )

    const memberPager = within(screen.getByRole('navigation', { name: '成员候选分页' }))
    expect(memberPager.getByRole('button', { name: '上一页' })).toBeDisabled()
    await user.click(memberPager.getByRole('button', { name: '下一页' }))
    expect(onPagerChange).toHaveBeenLastCalledWith(view.sections[0].pager, 'next')

    const completionPager = within(screen.getByRole('navigation', { name: '完成记录分页' }))
    expect(completionPager.getByRole('button', { name: '下一页' })).toBeDisabled()
    await user.click(completionPager.getByRole('button', { name: '上一页' }))
    expect(onPagerChange).toHaveBeenLastCalledWith(view.sections[1].pager, 'previous')
  })

  it('collects selected section rows and shared form values for a section batch', async () => {
    const user = userEvent.setup()
    const onSectionBatchAction = vi.fn().mockResolvedValue(undefined)
    const view: AdminDetailView = {
      route: 'events',
      title: '活动详情',
      subtitle: '',
      status: '已发布',
      sections: [
        {
          title: '报名名单',
          rows: [
            { detailId: 'reg-1', name: '报名一', rowActions: [{ action: 'mip.admin.events.registrations.review', label: '审核', values: { eventId: 'e1', registrationId: 'reg-1', expectedVersion: 1 } }] },
            { detailId: 'reg-2', name: '报名二', rowActions: [{ action: 'mip.admin.events.registrations.review', label: '审核', values: { eventId: 'e1', registrationId: 'reg-2', expectedVersion: 2 } }] },
          ],
          columns: [{ key: 'name', label: '姓名' }],
        },
      ],
    }

    render(
      <DetailDrawer
        open
        view={view}
        onClose={vi.fn()}
        onSectionBatchAction={onSectionBatchAction}
        batchActionsForSection={() => [{
          key: 'mip.admin.events.registrations.review',
          label: '批量审核报名',
          fields: [{ key: 'decision', label: '审核结果', kind: 'select', required: true, options: [{ value: 'APPROVE', label: '审核通过' }, { value: 'REJECT', label: '审核拒绝' }] }],
        }]}
      />,
    )

    await user.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByText('已选 2 项')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '批量审核报名' }))
    const dialog = await waitFor(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .find(node => node.textContent?.includes('将对已选'))
      if (!target) throw new Error('批量确认弹窗未打开')
      return target
    })
    await user.click(within(dialog).getByRole('button', { name: '批量审核报名' }))
    expect(await within(dialog).findByText('请填写审核结果')).toBeInTheDocument()
    expect(onSectionBatchAction).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('combobox'))
    await user.click(await screen.findByText('审核通过'))
    await user.click(within(dialog).getByRole('button', { name: '批量审核报名' }))
    await waitFor(() => expect(onSectionBatchAction).toHaveBeenCalledOnce())
    expect(onSectionBatchAction.mock.calls[0][2]).toHaveLength(2)
    expect(onSectionBatchAction.mock.calls[0][3]).toMatchObject({ decision: 'APPROVE' })
  })
})
