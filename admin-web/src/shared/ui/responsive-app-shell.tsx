import {
  BellOutlined,
  LoginOutlined,
  LogoutOutlined,
  MenuOutlined,
  ReloadOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { Avatar, Badge, Breadcrumb, Button, Drawer, Dropdown, Grid, Layout, Menu, Modal, Result, Space, Tag, Typography, type MenuProps } from 'antd'
import { useMemo, useState } from 'react'
import { adminNavigation, navigationByPath, type AdminRoutePath } from '../../app/navigation'
import { useAdminSession } from '../../app/session-provider'
import { ErrorState, LoadingState } from './feedback-states'

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
  const pathname = useRouterState({ select: state => state.location.pathname }) as AdminRoutePath
  const navigate = useNavigate()
  const {
    session, loading, error, demoMode, hasCapability, challenge, loginError, loginConfirmed,
    refreshSession, beginLogin, retryConfirmedLogin, closeLogin, logout,
  } = useAdminSession()

  const loginVisible = loginOpen && !session?.enabled

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

  const openLogin = () => { setLoginOpen(true); void beginLogin() }
  const accountItems: MenuProps['items'] = [
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: () => { setLoginOpen(false); void logout() } },
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

      <Modal
        open={loginVisible}
        title="运营登录"
        footer={null}
        onCancel={() => { setLoginOpen(false); closeLogin() }}
        destroyOnHidden
      >
        <Typography.Paragraph>打开 MIP 小程序，进入“我的 → 现场工作台 → 确认网页登录”，输入下方 6 位登录码并确认。</Typography.Paragraph>
        <Typography.Paragraph type="secondary">可使用已获得访问权限的开发版或体验版，请登录具有运营权限的账号。</Typography.Paragraph>
        {challenge ? (
          <div className="login-challenge" aria-live="polite">
            <small>登录码</small>
            <strong aria-label={`登录码 ${challenge.code}`}>{challenge.code}</strong>
            <small>有效期至 {new Date(challenge.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}</small>
            <span>等待小程序确认，完成后网页将自动登录</span>
          </div>
        ) : loginError ? (
          <Space orientation="vertical">
            <Typography.Text type="danger">{loginError}</Typography.Text>
            <Button onClick={() => void (loginConfirmed ? retryConfirmedLogin() : beginLogin())}>
              {loginConfirmed ? '重新加载会话' : '重新获取登录请求'}
            </Button>
          </Space>
        ) : <Typography.Text type="secondary" role="status">{loginConfirmed ? '登录已确认，正在加载运营会话…' : '正在获取登录码…'}</Typography.Text>}
      </Modal>
    </Layout>
  )
}
