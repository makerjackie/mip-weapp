import { cleanup, render, screen, within } from '@testing-library/react'
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
})
