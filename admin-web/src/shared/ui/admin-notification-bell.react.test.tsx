import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'
import { afterEach, describe, expect, it } from 'vitest'
import { AdminNotificationBell, type AdminNotificationItem } from './admin-notification-bell'

function BellHarness({ items }: { items?: AdminNotificationItem[] }) {
  return <AdminNotificationBell items={items} />
}

async function setup(initialPath: string, items?: AdminNotificationItem[]) {
  const root = createRootRoute({ component: () => <><BellHarness items={items} /><Outlet /></> })
  const routes = (['/overview', '/tasks', '/growth', '/orders'] as const).map(path => createRoute({
    getParentRoute: () => root,
    path,
    component: () => <p>{`页面${path}`}</p>,
  }))
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: [initialPath] }) })
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <RouterProvider router={router} />
    </ConfigProvider>,
  )
  await screen.findByRole('button', { name: '运营通知' })
  return { router }
}

afterEach(cleanup)

describe('admin notification bell', () => {
  it('shows a red badge with the aggregated todo count', async () => {
    await setup('/overview')
    const badge = screen.getByText('3')
    expect(badge).toBeVisible()
    expect(badge.closest('.ant-badge-count')).not.toBeNull()
  })

  it('lists the pending todos and navigates to the matching route on click', async () => {
    const { router } = await setup('/overview')
    await userEvent.click(screen.getByRole('button', { name: '运营通知' }))
    const firstItem = await screen.findByText('NPC 任务待审批')
    await waitFor(() => expect(firstItem).toBeVisible())
    expect(screen.getByText('权益即将到期')).toBeVisible()
    expect(screen.getByText('活动支付异常')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /NPC 任务待审批/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'))
    await screen.findByText('页面/tasks')
    // antd 弹层关闭后内容仍留在 DOM（隐藏），断言收敛为不可见。
    await waitFor(() => expect(screen.queryByText('NPC 任务待审批')).not.toBeVisible())
  })

  it('shows an empty state when no todos are provided', async () => {
    await setup('/overview', [])
    await userEvent.click(screen.getByRole('button', { name: '运营通知' }))
    const empty = await screen.findByText('暂无待办')
    await waitFor(() => expect(empty).toBeVisible())
  })
})
