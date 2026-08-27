import {
  AdminApiClient,
  AdminApiClientError,
  type AdminLoginChallenge,
} from './services/admin-api'
import type { AdminSession } from './domain/contracts'
import { demo } from './services/demo-data'
import './styles.css'

type Route = 'overview' | 'users' | 'events' | 'orders' | 'permissions' | 'messages' | 'knowledge'
type Row = Record<string, unknown>
type OverviewMetric = { label: string; value: string; detail: string }
type OverviewModel = { metrics: OverviewMetric[]; activity: Row[]; period: string }

const client = new AdminApiClient()
const app = document.querySelector<HTMLDivElement>('#app')!
let route: Route = 'overview'
let loading = false
let notice = ''
let apiErrorCode = ''
let liveRows: Row[] | null = null
let liveOverview: OverviewModel | null = null
let session: AdminSession | null = null
let loginChallenge: AdminLoginChallenge | null = null
let loginError = ''
let loginFlow = 0

const nav: Array<{ route: Route; label: string; icon: string; group: string }> = [
  { route: 'overview', label: '网站概览', icon: '▦', group: '工作台' },
  { route: 'users', label: '用户管理', icon: '◎', group: '业务管理' },
  { route: 'events', label: '活动管理', icon: '◇', group: '业务管理' },
  { route: 'orders', label: '订单管理', icon: '▤', group: '业务管理' },
  { route: 'permissions', label: '权限管理', icon: '⌘', group: '平台设置' },
  { route: 'messages', label: '消息管理', icon: '▱', group: '平台设置' },
  { route: 'knowledge', label: '知识库', icon: '□', group: '平台设置' },
]

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}

function statusClass(value: string) {
  if (['已发布', '已支付', '有效会员'].includes(value)) return 'status status-success'
  if (['报名中', '待确认', '定时中'].includes(value)) return 'status status-warning'
  if (['草稿', '嘉宾'].includes(value)) return 'status status-muted'
  return 'status'
}

function rowsToTable(rows: Row[], columns: Array<{ key: string; label: string }>) {
  if (!rows.length) return '<div class="empty">暂无数据</div>'
  return `<div class="table-scroll"><table><thead><tr>${columns.map(column => `<th>${column.label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(column => {
    const value = escapeHtml(row[column.key] ?? '—')
    const rendered = ['status', 'state'].includes(column.key) ? `<span class="${statusClass(String(row[column.key] || ''))}">${value}</span>` : value
    return `<td>${rendered}</td>`
  }).join('')}</tr>`).join('')}</tbody></table></div>`
}

function extractRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object') as Row[]
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['items', 'rows', 'records', 'data']) {
      if (Array.isArray(record[key])) return extractRows(record[key])
    }
  }
  return []
}

function valueOf(row: Row, ...keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key]
  return '—'
}

function mapRows(value: unknown, mapping: Record<string, string[]>) {
  return extractRows(value).map(row => Object.fromEntries(Object.entries(mapping).map(([key, keys]) => [key, valueOf(row, ...keys)])))
}

function mapUserRows(value: unknown): Row[] {
  return extractRows(value).map(row => ({
    id: valueOf(row, 'id', 'userId'),
    name: valueOf(row, 'name', 'displayName', 'nickname'),
    company: valueOf(row, 'company', 'companyName', 'headline'),
    role: valueOf(row, 'role', 'cooperationRole', 'levelName'),
    phone: valueOf(row, 'phone', 'phoneNumber', 'phoneMasked'),
    branch: valueOf(row, 'branch', 'branchName', 'cityName'),
    state: row.isPlayer === true || row.is_player === 1 ? '有效会员' : valueOf(row, 'membershipStatus', 'status'),
  }))
}

function sidebar() {
  const groups = [...new Set(nav.map(item => item.group))]
  const sessionText = client.demoMode ? '本地演示模式' : session?.enabled ? '已验证运营会话' : '尚未登录'
  return `<aside class="sidebar"><div class="brand"><span class="brand-mark">MIP</span><div><strong>MIP</strong><small>运营管理</small></div></div><nav>${groups.map(group => `<div class="nav-group"><span class="nav-label">${group}</span>${nav.filter(item => item.group === group).map(item => `<button class="nav-item ${item.route === route ? 'active' : ''}" data-route="${item.route}"><span class="nav-icon">${item.icon}</span>${item.label}</button>`).join('')}</div>`).join('')}</nav><div class="sidebar-footer"><span class="avatar">M</span><div><strong>运营账号</strong><small>${sessionText}</small></div>${session?.enabled ? '<button class="icon-button" id="logout-button" title="退出登录">↪</button>' : ''}</div></aside>`
}

function header() {
  const current = nav.find(item => item.route === route)!
  const connection = client.demoMode ? '本地演示数据' : session?.enabled ? '真实数据已连接' : '需要运营登录'
  const sessionAction = !client.demoMode && !session?.enabled ? '<button class="outline-button" id="login-button">运营登录</button>' : ''
  return `<header class="topbar"><div class="mobile-brand"><span class="brand-mark">MIP</span></div><div class="breadcrumb"><span>运营管理</span><i>/</i><strong>${current.label}</strong></div><div class="top-actions"><span class="connection"><i class="dot ${session?.enabled ? 'online' : ''}"></i>${connection}</span>${sessionAction}<button class="outline-button" id="refresh-button">刷新数据</button></div></header>`
}

function shell(content: string) {
  const loginAction = apiErrorCode === 'AUTH_REQUIRED' ? '<button class="notice-action" id="notice-login-button">运营登录</button>' : ''
  app.innerHTML = `${sidebar()}<main class="main"><div class="content"><div id="notice" class="notice ${notice ? '' : 'hidden'}"><span>${escapeHtml(notice)}</span>${loginAction}</div>${header()}${content}</div></main>${loginDialog()}`
  document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(button => button.addEventListener('click', () => {
    route = button.dataset.route as Route
    notice = ''
    void render()
  }))
  document.querySelector('#refresh-button')?.addEventListener('click', () => void render())
  document.querySelector('#login-button')?.addEventListener('click', startLogin)
  document.querySelector('#notice-login-button')?.addEventListener('click', startLogin)
  document.querySelector('#logout-button')?.addEventListener('click', () => void logout())
  document.querySelector('#login-close-button')?.addEventListener('click', closeLogin)
  document.querySelector('#login-retry-button')?.addEventListener('click', () => void startLogin())
}

function loginDialog() {
  if (!loginChallenge && !loginError) return ''
  const code = loginChallenge?.code || '--------'
  const expiry = loginChallenge
    ? new Date(loginChallenge.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : ''
  return `<div class="login-backdrop" role="dialog" aria-modal="true" aria-labelledby="login-title"><section class="login-dialog"><button id="login-close-button" class="login-close" aria-label="关闭">×</button><span class="login-kicker">小程序确认</span><h2 id="login-title">运营登录</h2>${loginError ? `<p class="login-error">${escapeHtml(loginError)}</p><button id="login-retry-button" class="primary-button login-retry">重新生成登录码</button>` : `<p>在 MIP 小程序的运营工作台输入以下登录码。只有已获得运营权限的账号可以确认。</p><div class="login-code" aria-label="网页登录码">${escapeHtml(code)}</div><div class="login-status"><i class="dot online"></i>等待小程序确认${expiry ? ` · ${escapeHtml(expiry)} 前有效` : ''}</div>`}</section></div>`
}

function sectionTitle(title: string, description: string, action = '') {
  return `<div class="section-title"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`
}

function toolbar(placeholder: string, action = '新建') {
  return `<div class="toolbar"><label class="search"><span>⌕</span><input placeholder="${placeholder}" /></label><select><option>全部状态</option><option>已发布</option><option>草稿</option></select><button class="primary-button">${action}</button></div>`
}

function pageOverview() {
  const data = liveOverview || (client.demoMode ? demoOverview() : null)
  if (!data) return `${sectionTitle('网站概览', '查看会员、活动和订单的运营状态')}<section class="panel"><div class="empty">${loading ? '正在加载' : '暂无可显示的真实数据'}</div></section>`
  return `${sectionTitle('网站概览', '查看会员、活动和订单的运营状态', `<span class="date-range">${escapeHtml(data.period)}</span>`)}<div class="metric-grid">${data.metrics.map(metric => `<div class="metric"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong><small>${escapeHtml(metric.detail)}</small></div>`).join('')}</div><div class="overview-grid"><section class="panel"><div class="panel-heading"><h2>近期运营记录</h2></div>${rowsToTable(data.activity, [{ key: 'title', label: '记录' }, { key: 'meta', label: '时间与范围' }, { key: 'state', label: '类型' }])}</section><section class="panel permission-note"><h2>数据说明</h2><p>概览和用户列表均由服务端按当前运营账号的 capability 与作用范围返回。页面不计算会员、活动或订单事实。</p><div class="boundary-row"><span>数据来源</span><strong>${client.demoMode ? '演示数据' : 'MIP 管理服务'}</strong></div><div class="boundary-row"><span>请求协议</span><strong>AdminRequest v1</strong></div></section></div>`
}

function pageUsers() {
  const rows = liveRows ?? (client.demoMode ? demo.users.map(user => ({ ...user, state: user.status })) : [])
  return `${sectionTitle('用户管理', '查看和维护会员、嘉宾及用户资料', '<button class="outline-button">导出用户</button>')}${toolbar('搜索姓名、手机号或公司')}<section class="panel">${rowsToTable(rows, [{ key: 'name', label: '姓名' }, { key: 'company', label: '公司' }, { key: 'role', label: '合作角色' }, { key: 'phone', label: '手机号' }, { key: 'branch', label: '所属分会' }, { key: 'state', label: '状态' }])}</section>`
}

function pageEvents() {
  const rows = liveRows ?? (client.demoMode ? demo.events.map(event => ({ ...event, state: event.status })) : [])
  return `${sectionTitle('活动管理', '维护活动信息、报名名单和活动状态', '<button class="primary-button">创建活动</button>')}${toolbar('搜索活动名称或活动编号', '批量操作')}<section class="panel">${rowsToTable(rows, [{ key: 'title', label: '活动名称' }, { key: 'time', label: '活动时间' }, { key: 'location', label: '活动地点' }, { key: 'registrations', label: '报名人数' }, { key: 'state', label: '状态' }])}</section>`
}

function pageOrders() {
  const rows = liveRows ?? (client.demoMode ? demo.orders.map(order => ({ ...order, state: order.status })) : [])
  return `${sectionTitle('订单管理', '查看会员和活动门票订单及支付状态', '<button class="outline-button">导出订单</button>')}${toolbar('搜索订单号、姓名或手机号')}<section class="panel">${rowsToTable(rows, [{ key: 'id', label: '订单号' }, { key: 'user', label: '用户' }, { key: 'type', label: '订单类型' }, { key: 'amount', label: '金额' }, { key: 'createdAt', label: '创建时间' }, { key: 'state', label: '状态' }])}</section>`
}

function pagePermissions() {
  const rows = liveRows ?? (client.demoMode ? demo.roles.map(role => ({ ...role })) : [])
  return `${sectionTitle('权限管理', '按平台、分会和活动范围管理运营权限', '<button class="primary-button">添加运营成员</button>')}<div class="permission-layout"><section class="panel"><div class="panel-heading"><h2>角色与权限</h2><button class="text-button">角色策略</button></div>${rowsToTable(rows, [{ key: 'name', label: '角色' }, { key: 'members', label: '成员数' }, { key: 'scope', label: '作用范围' }, { key: 'capabilities', label: '权限' }])}</section><section class="panel permission-note"><h2>权限边界</h2><p>所有管理操作由服务端校验当前账号的 capability 和作用范围。Web 端仅提交业务意图，不在浏览器计算会员、订单或活动资格。</p><div class="boundary-row"><span>当前访问模式</span><strong>${client.demoMode ? '本地演示' : session?.enabled ? '已验证运营会话' : '尚未登录'}</strong></div><div class="boundary-row"><span>请求协议</span><strong>AdminRequest v1</strong></div></section></div>`
}

function pageMessages() {
  const rows = liveRows ?? (client.demoMode ? demo.messages.map(message => ({ ...message, state: message.status })) : [])
  return `${sectionTitle('消息管理', '维护模板、发送范围和投递记录', '<button class="primary-button">新建消息</button>')}${toolbar('搜索消息标题或模板')}<section class="panel">${rowsToTable(rows, [{ key: 'title', label: '消息标题' }, { key: 'audience', label: '发送范围' }, { key: 'updatedAt', label: '更新时间' }, { key: 'state', label: '状态' }])}</section>`
}

function pageKnowledge() {
  const rows = liveRows ?? (client.demoMode ? demo.knowledge.map(item => ({ ...item, state: item.status })) : [])
  return `${sectionTitle('知识库', '管理可供会员阅读的内容和信息源', '<button class="primary-button">新建文档</button>')}${toolbar('搜索文档标题或类型')}<section class="panel">${rowsToTable(rows, [{ key: 'title', label: '文档标题' }, { key: 'type', label: '内容类型' }, { key: 'updatedAt', label: '更新时间' }, { key: 'state', label: '状态' }])}</section>`
}

async function startLogin() {
  const flow = loginFlow + 1
  loginFlow = flow
  loginChallenge = null
  loginError = ''
  try {
    loginChallenge = await client.beginLogin()
    await render()
    void pollLogin(flow, loginChallenge.pollAfterMs)
  }
  catch (error) {
    loginError = error instanceof AdminApiClientError ? error.message : '网页登录服务暂时不可用'
    await render()
  }
}

async function pollLogin(flow: number, delay: number) {
  await new Promise(resolve => window.setTimeout(resolve, Math.max(750, delay)))
  if (flow !== loginFlow || !loginChallenge) return
  try {
    const status = await client.pollLogin()
    if (flow !== loginFlow) return
    if (status.state === 'AUTHENTICATED') {
      loginChallenge = null
      loginError = ''
      await render()
      return
    }
    void pollLogin(flow, status.pollAfterMs)
  }
  catch (error) {
    if (flow !== loginFlow) return
    loginChallenge = null
    loginError = error instanceof AdminApiClientError ? error.message : '网页登录服务暂时不可用'
    await render()
  }
}

function closeLogin() {
  loginFlow += 1
  loginChallenge = null
  loginError = ''
  void render()
}

async function logout() {
  loginFlow += 1
  loginChallenge = null
  loginError = ''
  await client.logout()
  session = null
  await render()
}

async function loadRouteData() {
  if (!client.configured) return
  if (route === 'overview') {
    const payload = await client.request<unknown>('mip.admin.dashboard.overview.get')
    liveOverview = mapOverview(payload)
    return
  }
  const actions: Partial<Record<Route, string>> = {
    users: 'mip.admin.users.list',
  }
  const action = actions[route]
  if (!action) {
    notice = '当前 Web 版本仅接入概览和用户列表；其他管理功能继续在小程序管理端使用。'
    return
  }
  const payload = await client.request<unknown>(action, { limit: 50 })
  if (route === 'users') {
    liveRows = mapUserRows(payload)
    return
  }
  const mappings: Partial<Record<Route, Record<string, string[]>>> = {
    users: { id: ['id', 'userId'], name: ['name', 'displayName'], company: ['company', 'companyName'], role: ['role', 'cooperationRole'], phone: ['phone', 'phoneMasked'], branch: ['branch', 'branchName'], state: ['status', 'membershipStatus'] },
    events: { id: ['id', 'eventId'], title: ['title', 'name'], time: ['time', 'startsAt', 'startAt'], location: ['location', 'venue'], registrations: ['registrations', 'registrationCount'], state: ['status'] },
    orders: { id: ['id', 'orderId'], user: ['user', 'userName'], type: ['type', 'orderType'], amount: ['amount', 'totalAmount'], createdAt: ['createdAt', 'created_at'], state: ['status'] },
    permissions: { name: ['name', 'roleName'], members: ['members', 'memberCount'], scope: ['scope', 'scopeType'], capabilities: ['capabilities', 'capabilitySummary'] },
    messages: { title: ['title', 'name'], audience: ['audience', 'recipientScope'], updatedAt: ['updatedAt', 'updated_at'], state: ['status'] },
    knowledge: { title: ['title', 'name'], type: ['type', 'contentType'], updatedAt: ['updatedAt', 'updated_at'], state: ['status'] },
  }
  liveRows = mapRows(payload, mappings[route] || {})
}

async function render() {
  loading = true
  liveRows = null
  liveOverview = null
  notice = ''
  apiErrorCode = ''
  const pages: Record<Route, () => string> = { overview: pageOverview, users: pageUsers, events: pageEvents, orders: pageOrders, permissions: pagePermissions, messages: pageMessages, knowledge: pageKnowledge }
  shell(`<div class="loading-bar ${loading ? '' : 'hidden'}"></div>${pages[route]()}`)
  if (client.demoMode) {
    notice = '当前为显式本地演示模式，页面数据不代表生产事实。'
  }
  else if (loginChallenge || loginError) {
    loading = false
    shell(`<div class="loading-bar hidden"></div>${pages[route]()}`)
    requestAnimationFrame(assertResponsiveViewport)
    return
  }
  else {
    try {
      session = await client.getSession()
      await loadRouteData()
    }
    catch (error) {
      apiErrorCode = error instanceof AdminApiClientError ? error.code : 'SERVICE_UNAVAILABLE'
      notice = error instanceof AdminApiClientError ? error.message : '管理 API 暂时不可用'
      if (apiErrorCode === 'AUTH_REQUIRED') session = null
    }
  }
  loading = false
  shell(`<div class="loading-bar hidden"></div>${pages[route]()}`)
  const noticeElement = document.querySelector('#notice')
  if (noticeElement) { noticeElement.textContent = notice; noticeElement.classList.toggle('hidden', !notice) }
  requestAnimationFrame(assertResponsiveViewport)
}

function demoOverview(): OverviewModel {
  return {
    period: '2030 年 2 月',
    metrics: [
      { label: '用户总数', value: demo.dashboard.users.toLocaleString(), detail: '演示数据' },
      { label: '有效会员', value: String(demo.dashboard.activeMembers), detail: '会员权益有效' },
      { label: '近期活动', value: String(demo.dashboard.upcomingEvents), detail: '未来 30 天' },
      { label: '待处理订单', value: String(demo.dashboard.pendingOrders), detail: '需要运营跟进' },
    ],
    activity: demo.dashboard.activity.map(item => ({ title: item.title, meta: item.meta, state: item.status })),
  }
}

function mapOverview(value: unknown): OverviewModel {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const people = record(data.people)
  const membership = record(data.membership)
  const events = record(data.events)
  const operations = record(data.operations)
  const period = record(data.period)
  return {
    period: dateRange(period.startAt, period.endAt),
    metrics: [
      { label: '用户总数', value: metricCount(record(people.activeAccounts)), detail: '当前可见范围' },
      { label: '有效会员', value: metricCount(record(membership.currentPlayers)), detail: '付费权益有效' },
      { label: '活动总数', value: metricCount(record(events.totalEvents)), detail: '所选时间范围' },
      { label: '有效报名', value: metricCount(record(events.effectiveRegistrations)), detail: '所选时间范围' },
    ],
    activity: Array.isArray(operations.activity) ? operations.activity.map((item) => {
      const activity = record(item)
      const resource = record(activity.resource)
      const scope = record(activity.scope)
      return {
        title: String(resource.title || '运营记录'),
        meta: `${formatDate(activity.occurredAt)} · ${String(scope.type || '平台')}`,
        state: String(activity.kind || '记录'),
      }
    }) : [],
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function metricCount(value: Record<string, unknown>) {
  const count = Number(value.count)
  return value.availability === 'AVAILABLE' && Number.isFinite(count) ? count.toLocaleString() : '—'
}

function formatDate(value: unknown) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? '时间未提供' : date.toLocaleString('zh-CN', { hour12: false })
}

function dateRange(start: unknown, end: unknown) {
  const startDate = new Date(String(start || ''))
  const endDate = new Date(String(end || ''))
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return '当前周期'
  const format = (date: Date) => date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${format(startDate)}–${format(endDate)}`
}

function assertResponsiveViewport() {
  if (window.innerWidth > 680) return
  const overflow = document.documentElement.scrollWidth > window.innerWidth + 1
  document.documentElement.dataset.mipResponsive = overflow ? 'fail' : 'pass'
  if (overflow) console.error(`MIP responsive overflow: document=${document.documentElement.scrollWidth}px viewport=${window.innerWidth}px`)
}

void render()
