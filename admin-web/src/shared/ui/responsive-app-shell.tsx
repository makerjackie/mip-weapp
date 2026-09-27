import {
  BellOutlined,
  LoginOutlined,
  LockOutlined,
  LogoutOutlined,
  MenuOutlined,
  ReloadOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { Avatar, Badge, Breadcrumb, Button, Drawer, Dropdown, Grid, Layout, Menu, Result, Space, Tag, type MenuProps } from 'antd'
import { useMemo, useState } from 'react'
import { adminNavigation, navigationByPath, type AdminRoutePath } from '../../app/navigation'
import { useAdminSession } from '../../app/session-provider'
import { ErrorState, LoadingState } from './feedback-states'
import { AdminLoginDialog } from './admin-login-dialog'
import { AdminPasswordDialog } from './admin-password-dialog'

const { Header, Sider, Content } = Layout

function Brand() {
  return (
    <Link to="/overview" className="admin-brand" aria-label="MIP 管理后台首页">
      <span className="admin-brand__mark">MIP</span>
      <span><strong>MIP</strong><small>管理后台</small></span>
    </Link>
  )
}

export function ResponsiveAppShell() {
  const screens = Grid.useBreakpoint()
  const mobile = screens.md === false
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [loginNotice, setLoginNotice] = useState('')
  const pathname = useRouterState({ select: state => state.location.pathname }) as AdminRoutePath
  const navigate = useNavigate()
  const {
    session, loading, error, demoMode, hasCapability,
    refreshSession, closeLogin, logout,
  } = useAdminSession()

  const loginVisible = loginOpen && !session?.enabled

  // A confirmed web login must close the gate for good. Without this the flag stayed set and a later
  // AUTH_REQUIRED reopened the modal with no challenge, no polling and no retry action. Adjust the
  // state during render (React's documented alternative to an effect for prop-driven state).
  const sessionEnabled = session?.enabled === true
  const [loginSessionEnabled, setLoginSessionEnabled] = useState(sessionEnabled)
  if (sessionEnabled !== loginSessionEnabled) {
    setLoginSessionEnabled(sessionEnabled)
    if (sessionEnabled) setLoginOpen(false)
  }

  const visibleNavigation = useMemo(() => {
    if (demoMode) return adminNavigation
    if (!session?.enabled) return adminNavigation.filter(item => item.path === '/overview')
    const visible = adminNavigation.filter(item => item.requireAny
      ? item.capabilities.some(hasCapability)
      : item.capabilities.every(hasCapability))
    return visible.length ? visible : adminNavigation.slice(0, 1)
  }, [demoMode, hasCapability, session])

  const items = useMemo<MenuProps['items']>(() => {
    const groups = [...new Set(visibleNavigation.map(item => item.group))]
    return groups.map(group => ({
      type: 'group',
      label: group,
      key: group,
      children: visibleNavigation.filter(item => item.group === group).map(item => ({
        key: item.path,
        icon: item.icon,
        label: item.label,
      })),
    }))
  }, [visibleNavigation])

  const current = navigationByPath.get(pathname) || navigationByPath.get('/overview')!
  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[pathname]}
      items={items}
      onClick={({ key }) => {
        setNavigationOpen(false)
        void navigate({ to: key as AdminRoutePath })
      }}
    />
  )

  const openLogin = () => { closeLogin(); setLoginNotice(''); setLoginOpen(true) }
  const accountItems: MenuProps['items'] = [
    { key: 'password', icon: <LockOutlined />, label: '设置 / 修改登录密码', disabled: demoMode, onClick: () => setPasswordOpen(true) },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: () => { setLoginOpen(false); setPasswordOpen(false); closeLogin(); void logout() } },
  ]

  return (
    <Layout className="admin-layout">
      {!mobile ? (
        <Sider className="admin-sider" width={184}>
          <Brand />
          <nav aria-label="管理后台导航">{menu}</nav>
          <div className="admin-sider__account">
            <Avatar icon={<UserOutlined />} />
            <span><strong>{session?.actor?.name || '运营账号'}</strong><small>{demoMode ? '演示模式' : session?.enabled ? '已验证会话' : '尚未登录'}</small></span>
          </div>
        </Sider>
      ) : null}

      <Drawer
        className="mobile-navigation"
        placement="left"
        size="min(86vw, 320px)"
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
        title={<Brand />}
      >
        <nav aria-label="管理后台导航">{menu}</nav>
      </Drawer>

      <Layout className="admin-main">
        <Header className="admin-topbar">
          <Space size={12}>
            {mobile ? <Button type="text" aria-label="打开导航" icon={<MenuOutlined />} onClick={() => setNavigationOpen(true)} /> : null}
            <Breadcrumb items={[{ title: '运营管理' }, { title: current.label }]} />
          </Space>
          <Space size={8}>
            {demoMode ? <Tag color="gold">演示数据</Tag> : error?.code === 'AUTH_REQUIRED' ? <Tag>需要登录</Tag> : <Badge status={session?.enabled ? 'success' : 'default'} text={session?.enabled ? '真实数据' : '未连接'} />}
            {session?.enabled ? <Button type="text" aria-label="消息管理" icon={<BellOutlined />} onClick={() => void navigate({ to: '/messages' })} /> : null}
            <Button type="text" aria-label="刷新会话" loading={loading} icon={<ReloadOutlined />} onClick={() => void refreshSession()} />
            {session?.enabled ? (
              <Dropdown menu={{ items: accountItems }} trigger={['click']}>
                <Button aria-label="账号菜单" icon={<UserOutlined />}>{mobile ? null : session.actor?.name || '账号'}</Button>
              </Dropdown>
            ) : <Button type="primary" icon={<LoginOutlined />} onClick={openLogin}>登录</Button>}
          </Space>
        </Header>
        <Content className="admin-content">
          {demoMode ? <div className="demo-notice" role="status">当前为显式演示模式，页面数据不代表生产事实。</div> : null}
          {loading && !session?.enabled ? <LoadingState label="正在加载运营会话" rows={3} />
            : session?.enabled || demoMode ? <Outlet />
              : error && error.code !== 'AUTH_REQUIRED' ? <ErrorState title="运营会话暂时无法加载" description={error.message} onRetry={() => void refreshSession()} />
                : <Result title="请先登录" subTitle="登录后可查看和管理运营数据。" extra={<Button type="primary" onClick={openLogin}>运营登录</Button>} />}
        </Content>
      </Layout>

      {loginVisible ? <AdminLoginDialog notice={loginNotice} onClose={() => { setLoginOpen(false); closeLogin() }} /> : null}
      {passwordOpen && session?.enabled ? <AdminPasswordDialog onClose={() => setPasswordOpen(false)} onRequireLogin={() => {
        setPasswordOpen(false)
        setLoginNotice('登录密码已更新，请使用新密码重新登录')
        setLoginOpen(true)
      }} /> : null}
    </Layout>
  )
}
