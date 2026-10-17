import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useNavigate, useRouterState } from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'
import { afterEach, describe, expect, it } from 'vitest'
import { navigationByPath, type AdminRoutePath } from '../../app/navigation'
import { AdminTabsBar } from './admin-tabs-bar'

// 与真实 shell 相同的解析方式：详情路由折算到所属菜单页签。
function Harness() {
  const pathname = useRouterState({ select: state => state.location.pathname }) as AdminRoutePath
  const current = navigationByPath.get(pathname) || navigationByPath.get('/overview')!
  const navigate = useNavigate()
  const others = (['/overview', '/users', '/events', '/levels'] as const).filter(path => path !== pathname)
  return (
    <>
      <AdminTabsBar current={current} />
      {others.map(path => (
        <button key={path} onClick={() => void navigate({ to: path })}>前往{navigationByPath.get(path)?.label}</button>
      ))}
      <Outlet />
    </>
  )
}

async function setup(initialPath: string) {
  const root = createRootRoute({ component: Harness })
  const routes = (['/overview', '/users', '/events', '/levels'] as const).map(path => createRoute({
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
  await screen.findByRole('navigation', { name: '已打开页面' })
  return { router }
}

afterEach(cleanup)

describe('admin tabs bar', () => {
  it('opens a tab for the entry route and appends newly visited menus without duplication', async () => {
    const { router } = await setup('/events')
    expect(screen.queryByRole('button', { name: '网站概览' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '活动管理' })).toHaveAttribute('aria-current', 'page')

    await userEvent.click(screen.getByRole('button', { name: '前往用户管理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/users'))
    expect(screen.getByRole('button', { name: '用户管理' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '活动管理' })).not.toHaveAttribute('aria-current')

    await userEvent.click(screen.getByRole('button', { name: '前往等级管理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/levels'))
    expect(screen.getAllByRole('button', { name: '活动管理' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '用户管理' })).toHaveLength(1)
  })

  it('switches routes by clicking an open tab', async () => {
    const { router } = await setup('/events')
    await userEvent.click(screen.getByRole('button', { name: '前往用户管理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/users'))

    await userEvent.click(screen.getByRole('button', { name: '活动管理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/events'))
    expect(await screen.findByText('页面/events')).toBeVisible()
    expect(screen.getByRole('button', { name: '活动管理' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps the current route when closing an inactive tab', async () => {
    const { router } = await setup('/events')
    await userEvent.click(screen.getByRole('button', { name: '前往用户管理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/users'))
    await userEvent.click(screen.getByRole('button', { name: '活动管理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/events'))

    await userEvent.click(screen.getByRole('button', { name: '关闭页签：用户管理' }))
    expect(screen.queryByRole('button', { name: '关闭页签：用户管理' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/events')
    expect(screen.getByRole('button', { name: '活动管理' })).toHaveAttribute('aria-current', 'page')
  })

  it('activates the neighbouring tab when closing the active one', async () => {
    const { router } = await setup('/events')
    await userEvent.click(screen.getByRole('button', { name: '前往用户管理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/users'))
    await userEvent.click(screen.getByRole('button', { name: '前往等级管理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/levels'))

    await userEvent.click(screen.getByRole('button', { name: '关闭页签：等级管理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/users'))
    expect(screen.getByRole('button', { name: '用户管理' })).toHaveAttribute('aria-current', 'page')
  })

  it('returns to the overview when the last tab is closed', async () => {
    const { router } = await setup('/events')
    await userEvent.click(screen.getByRole('button', { name: '关闭页签：活动管理' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/overview'))
    expect(screen.getByRole('button', { name: '网站概览' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: '关闭页签：活动管理' })).not.toBeInTheDocument()
  })
})
