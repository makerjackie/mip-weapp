import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '../../app/session-provider'
import { AdminApiClient, AdminApiClientError } from '../../services/admin-api'
import { ResponsiveAppShell } from './responsive-app-shell'

const routeState = vi.hoisted(() => ({ pathname: '/overview' }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#/overview">{children}</a>,
  Outlet: () => <div>已登录的运营页面</div>,
  useNavigate: () => vi.fn(),
  useRouterState: () => routeState.pathname,
}))

afterEach(() => { cleanup(); routeState.pathname = '/overview' })

function setup(authenticated = false, capabilities: string[] = []) {
  const client = new AdminApiClient()
  const getSession = vi.spyOn(client, 'getSession').mockRejectedValue(new AdminApiClientError('AUTH_REQUIRED', '请先登录'))
  if (authenticated) getSession.mockResolvedValue({ enabled: true, actor: { id: 'actor-a', name: '运营账号' }, capabilities: capabilities.map(capability => ({ capability, scopeType: 'PLATFORM' })) })
  const beginLogin = vi.spyOn(client, 'beginLogin').mockResolvedValue({
    state: 'PENDING',
    code: '123456',
    qrCodeDataUrl: 'data:image/png;base64,AA==',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    pollAfterMs: 750,
  })
  const pollLogin = vi.spyOn(client, 'pollLogin').mockResolvedValue({
    state: 'PENDING',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    pollAfterMs: 750,
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <SessionProvider client={client}><ResponsiveAppShell /></SessionProvider>
      </ConfigProvider>
    </QueryClientProvider>,
  )
  return { client, getSession, beginLogin, pollLogin }
}

describe('web login entry', () => {
  it.each([
    ['/events/new/edit', '活动管理', 'events.read'],
    ['/userContent/content-a/edit', '机会与内容', 'userContent.moderate'],
  ])('keeps the correct navigation context on %s', async (pathname, label, capability) => {
    routeState.pathname = pathname
    setup(true, [capability])
    await screen.findByText('已登录的运营页面')
    expect(within(screen.getByRole('banner')).getByText(label)).toBeVisible()
    const navigation = screen.queryByRole('button', { name: '打开导航' })
    if (navigation) await userEvent.click(navigation)
    expect(await screen.findByRole('menuitem', { name: new RegExp(label) })).toHaveClass('ant-menu-item-selected')
  })

  it('defaults to password login and only requests a numeric code when selected', async () => {
    const { beginLogin } = setup()
    await screen.findByText('请先登录')
    expect(screen.queryByText('已登录的运营页面')).not.toBeInTheDocument()
    expect(screen.queryByText('权限不足')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '账号菜单' })).not.toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: /登\s*录/ }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByLabelText('手机号')).toBeVisible())
    expect(beginLogin).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('tab', { name: '小程序登录' }))
    await waitFor(() => expect(within(dialog).getByText('123456')).toBeVisible())
    expect(within(dialog).getByText(/我的 → 现场工作台 → 确认网页登录/)).toBeVisible()
    expect(within(dialog).getByText(/开发版或体验版/)).toBeVisible()
    expect(within(dialog).queryByRole('img', { name: 'MIP 微信小程序登录码' })).not.toBeInTheDocument()
    expect(beginLogin).toHaveBeenCalledOnce()
  })

  it('enters the protected page automatically when the mini program confirms the code', async () => {
    const { getSession, pollLogin } = setup()
    await screen.findByText('请先登录')
    getSession.mockResolvedValue({ enabled: true, actor: { id: 'actor-a', name: '运营账号' }, capabilities: [] })
    pollLogin.mockResolvedValue({ state: 'AUTHENTICATED', actor: { name: '运营账号' }, expiresAt: new Date(Date.now() + 60_000).toISOString() })
    await userEvent.click(screen.getByRole('button', { name: '运营登录' }))
    await userEvent.click(await screen.findByRole('tab', { name: '小程序登录' }))
    await screen.findByText('123456')
    await screen.findByText('已登录的运营页面', {}, { timeout: 2_000 })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '账号菜单' })).toBeVisible()
  })

  it('offers a new code after expiry and keeps the protected page closed', async () => {
    const { pollLogin, beginLogin } = setup()
    pollLogin.mockResolvedValue({ state: 'PENDING', expiresAt: new Date(Date.now() - 1_000).toISOString(), pollAfterMs: 750 })
    await screen.findByText('请先登录')
    await userEvent.click(screen.getByRole('button', { name: '运营登录' }))
    await userEvent.click(await screen.findByRole('tab', { name: '小程序登录' }))
    await screen.findByText('登录请求已过期，请重新获取', {}, { timeout: 2_000 })
    expect(screen.queryByText('123456')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重新获取登录请求' }))
    await screen.findByText('123456')
    expect(beginLogin).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('已登录的运营页面')).not.toBeInTheDocument()
  })

  it('displays a polling error and allows the user to obtain another login code', async () => {
    const { pollLogin } = setup()
    pollLogin.mockRejectedValue(new AdminApiClientError('AUTH_UNAVAILABLE', '网页登录服务连接失败，请稍后重试'))
    await screen.findByText('请先登录')
    await userEvent.click(screen.getByRole('button', { name: '运营登录' }))
    await userEvent.click(await screen.findByRole('tab', { name: '小程序登录' }))
    await screen.findByText('网页登录服务连接失败，请稍后重试', {}, { timeout: 2_000 })
    expect(screen.getByRole('button', { name: '重新获取登录请求' })).toBeVisible()
    expect(screen.queryByText('123456')).not.toBeInTheDocument()
  })

  it('shows a session service failure separately from anonymous and forbidden states', async () => {
    const { getSession } = setup()
    getSession.mockRejectedValue(new AdminApiClientError('TIMEOUT', '请求超时，请重试', true))
    await screen.findByText('运营会话暂时无法加载')
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeVisible()
    expect(screen.queryByText('请先登录')).not.toBeInTheDocument()
    expect(screen.queryByText('权限不足')).not.toBeInTheDocument()
  })
})

describe('password login UI', () => {
  it('logs in with password and refreshes the protected session without a challenge', async () => {
    const { client, getSession, beginLogin } = setup()
    const login = vi.spyOn(client, 'loginWithPassword').mockResolvedValue()
    await screen.findByText('请先登录')
    await userEvent.click(screen.getByRole('button', { name: '运营登录' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('手机号'), '13800000000')
    await userEvent.type(within(dialog).getByLabelText('登录密码'), 'fictional-test-password')
    getSession.mockResolvedValue({ enabled: true, actor: { id: 'actor-a', name: '运营账号' }, capabilities: [] })
    await userEvent.click(within(dialog).getByRole('button', { name: /登\s*录/ }))
    await screen.findByText('已登录的运营页面')
    expect(login).toHaveBeenCalledWith('13800000000', 'fictional-test-password', expect.any(Function))
    expect(beginLogin).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows wrong-password errors, clears password input, and allows another method', async () => {
    const { client } = setup()
    vi.spyOn(client, 'loginWithPassword').mockRejectedValue(new AdminApiClientError('INVALID_CREDENTIALS', '手机号或密码不正确'))
    await screen.findByText('请先登录')
    await userEvent.click(screen.getByRole('button', { name: '运营登录' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('手机号'), '13800000000')
    await userEvent.type(within(dialog).getByLabelText('登录密码'), 'fictional-test-password')
    await userEvent.click(within(dialog).getByRole('button', { name: /登\s*录/ }))
    await screen.findByText('手机号或密码不正确')
    expect(within(dialog).getByLabelText('登录密码')).toHaveValue('')
    expect(screen.queryByText('已登录的运营页面')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('tab', { name: '小程序登录' }))
    await screen.findByText('123456')
  })

  it('ignores a pending challenge after switching back to password login', async () => {
    const { client, beginLogin, pollLogin } = setup()
    let resolve!: (value: Awaited<ReturnType<typeof client.beginLogin>>) => void
    beginLogin.mockImplementation(() => new Promise(done => { resolve = done }))
    await screen.findByText('请先登录')
    await userEvent.click(screen.getByRole('button', { name: '运营登录' }))
    await userEvent.click(screen.getByRole('tab', { name: '小程序登录' }))
    await userEvent.click(screen.getByRole('tab', { name: '手机号密码登录' }))
    resolve({ state: 'PENDING', code: '654321', expiresAt: new Date(Date.now() + 60_000).toISOString(), pollAfterMs: 750 })
    await waitFor(() => expect(screen.getByLabelText('手机号')).toBeVisible())
    expect(screen.queryByText('654321')).not.toBeInTheDocument()
    expect(pollLogin).not.toHaveBeenCalled()
  })
})


describe('password change session boundary', () => {
  it('closes settings and returns to password login after the server revokes the session', async () => {
    const { client, beginLogin } = setup(true)
    const status = vi.spyOn(client, 'getPasswordStatus').mockResolvedValue({ configured: true, maskedPhone: '138****0000', recentWechatAuth: false })
    vi.spyOn(client, 'setPassword').mockResolvedValue({ configured: true, requiresLogin: true })
    await screen.findByText('已登录的运营页面')
    await userEvent.click(screen.getByRole('button', { name: '账号菜单' }))
    await userEvent.click(await screen.findByText('设置 / 修改登录密码'))
    await screen.findByLabelText('当前密码')
    await userEvent.type(screen.getByLabelText('当前密码'), 'fictional-current-password')
    await userEvent.type(screen.getByLabelText('新密码'), 'fictional-new-password')
    await userEvent.type(screen.getByLabelText('确认新密码'), 'fictional-new-password')
    await userEvent.click(screen.getByRole('button', { name: '保存密码' }))
    await screen.findByText('登录密码已更新，请使用新密码重新登录')
    expect(screen.queryByText('已登录的运营页面')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument()
    expect(screen.getByLabelText('登录密码')).toHaveValue('')
    expect(status).toHaveBeenCalledTimes(1)
    expect(beginLogin).not.toHaveBeenCalled()
  })
})
