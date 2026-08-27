import {
  AdminApiClient,
  AdminApiClientError,
  type AdminLoginChallenge,
} from './services/admin-api'
import type { AdminSession } from './domain/contracts'
import {
  loadAdminDetail,
  type AdminDetailRoute,
  type AdminDetailView,
} from './modules/admin-details'
import {
  getAdminReadRouteDefinition,
  loadAdminReadPage,
  type AdminListQuery,
  type AdminListRoute,
  type AdminReadPage,
  type AdminTableColumn,
  type AdminTableRow,
} from './modules/admin-read-pages'
import { demo } from './services/demo-data'
import './styles.css'

type Route = 'overview' | AdminListRoute
type OverviewMetric = { label: string; value: string; detail: string }
type OverviewModel = { metrics: OverviewMetric[]; activity: AdminTableRow[]; period: string }

const client = new AdminApiClient()
const app = document.querySelector<HTMLDivElement>('#app')!
let route: Route = 'overview'
let loading = false
let notice = ''
let apiErrorCode = ''
let liveReadPage: AdminReadPage | null = null
let liveOverview: OverviewModel | null = null
let session: AdminSession | null = null
let loginChallenge: AdminLoginChallenge | null = null
let loginError = ''
let loginFlow = 0
let detailRoute: AdminDetailRoute | null = null
let detailView: AdminDetailView | null = null
let detailLoading = false
let detailError = ''
let detailFlow = 0

type ListState = AdminListQuery & { history: Array<string | null> }
const listState = (): ListState => ({ query: '', status: '', cursor: null, limit: 20, history: [] })
const listStates: Record<AdminListRoute, ListState> = {
  users: listState(),
  events: listState(),
  orders: listState(),
  permissions: listState(),
  messages: listState(),
  knowledge: listState(),
}

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
  if (['已发布', '已支付', '启用', '玩家'].includes(value)) return 'status status-success'
  if (['报名中', '待确认', '定时中', '待支付', '支付处理中', '退款处理中', '待发布', '待审核'].includes(value)) return 'status status-warning'
  if (['草稿', '嘉宾', '停用', '已撤销', '已关闭', '已归档'].includes(value)) return 'status status-muted'
  return 'status'
}

function rowsToTable(rows: AdminTableRow[], columns: AdminTableColumn[], detailTarget?: AdminDetailRoute) {
  if (!rows.length) return '<div class="empty">暂无数据</div>'
  const actionHeading = detailTarget ? '<th>操作</th>' : ''
  return `<div class="table-scroll"><table><thead><tr>${columns.map(column => `<th>${column.label}</th>`).join('')}${actionHeading}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(column => {
    const value = escapeHtml(row[column.key] ?? '—')
    const rendered = ['status', 'state'].includes(column.key) ? `<span class="${statusClass(String(row[column.key] || ''))}">${value}</span>` : value
    return `<td>${rendered}</td>`
  }).join('')}${detailAction(row, detailTarget)}</tr>`).join('')}</tbody></table></div>`
}

function detailAction(row: AdminTableRow, target?: AdminDetailRoute) {
  const id = String(row.detailId || '')
  if (!target || !id || id === '—') return target ? '<td>—</td>' : ''
  return `<td><button class="table-action detail-button" data-detail-route="${target}" data-detail-id="${escapeHtml(id)}">查看</button></td>`
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
  app.innerHTML = `${sidebar()}<main class="main"><div class="content"><div id="notice" class="notice ${notice ? '' : 'hidden'}"><span>${escapeHtml(notice)}</span>${loginAction}</div>${header()}${content}</div></main>${detailPanel()}${loginDialog()}`
  document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(button => button.addEventListener('click', () => {
    route = button.dataset.route as Route
    notice = ''
    closeDetail(false)
    void render()
  }))
  document.querySelector('#refresh-button')?.addEventListener('click', () => void render())
  document.querySelector('#login-button')?.addEventListener('click', startLogin)
  document.querySelector('#notice-login-button')?.addEventListener('click', startLogin)
  document.querySelector('#logout-button')?.addEventListener('click', () => void logout())
  document.querySelector('#login-close-button')?.addEventListener('click', closeLogin)
  document.querySelector('#login-retry-button')?.addEventListener('click', () => void startLogin())
  document.querySelector<HTMLFormElement>('#filter-form')?.addEventListener('submit', applyFilters)
  document.querySelector('#previous-page')?.addEventListener('click', () => void changePage('previous'))
  document.querySelector('#next-page')?.addEventListener('click', () => void changePage('next'))
  document.querySelectorAll<HTMLButtonElement>('.detail-button').forEach(button => button.addEventListener('click', () => {
    void openDetail(button.dataset.detailRoute as AdminDetailRoute, button.dataset.detailId || '')
  }))
  document.querySelector('#detail-close-button')?.addEventListener('click', () => closeDetail())
  document.querySelector('#detail-backdrop')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeDetail()
  })
}

function loginDialog() {
  if (!loginChallenge && !loginError) return ''
  const code = loginChallenge?.code || '--------'
  const expiry = loginChallenge
    ? new Date(loginChallenge.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : ''
  return `<div class="login-backdrop" role="dialog" aria-modal="true" aria-labelledby="login-title"><section class="login-dialog"><button id="login-close-button" class="login-close" aria-label="关闭">×</button><span class="login-kicker">小程序确认</span><h2 id="login-title">运营登录</h2>${loginError ? `<p class="login-error">${escapeHtml(loginError)}</p><button id="login-retry-button" class="primary-button login-retry">重新生成登录码</button>` : `<p>在 MIP 小程序的运营工作台输入以下登录码。只有已获得运营权限的账号可以确认。</p><div class="login-code" aria-label="网页登录码">${escapeHtml(code)}</div><div class="login-status"><i class="dot online"></i>等待小程序确认${expiry ? ` · ${escapeHtml(expiry)} 前有效` : ''}</div>`}</section></div>`
}

function detailPanel() {
  if (!detailRoute) return ''
  const body = detailLoading
    ? '<div class="detail-state">正在加载详情</div>'
    : detailError
      ? `<div class="detail-state detail-error">${escapeHtml(detailError)}</div>`
      : detailView
        ? detailView.sections.map(section => `<section class="detail-section"><h3>${escapeHtml(section.title)}</h3>${section.fields ? `<div class="detail-fields">${section.fields.map(item => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div>` : ''}${section.metrics ? `<div class="detail-metrics">${section.metrics.map(item => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div>` : ''}${section.rows && section.columns ? rowsToTable(section.rows, section.columns) : ''}</section>`).join('')
        : ''
  const title = detailView?.title || ({ users: '用户详情', events: '活动详情', orders: '订单详情', messages: '消息活动详情', knowledge: '知识内容详情' })[detailRoute]
  const subtitle = detailView?.subtitle ? `<p>${escapeHtml(detailView.subtitle)}</p>` : ''
  const status = detailView?.status ? `<span class="${statusClass(detailView.status)}">${escapeHtml(detailView.status)}</span>` : ''
  return `<div class="detail-backdrop" id="detail-backdrop"><aside class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title"><header class="detail-header"><div><span class="detail-kicker">只读详情</span><h2 id="detail-title">${escapeHtml(title)}</h2>${subtitle}</div><div class="detail-header-actions">${status}<button id="detail-close-button" class="login-close" aria-label="关闭">×</button></div></header><div class="detail-body">${body}</div></aside></div>`
}

function sectionTitle(title: string, description: string, action = '') {
  return `<div class="section-title"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`
}

function toolbar(route: AdminListRoute) {
  const definition = getAdminReadRouteDefinition(route)
  const state = listStates[route]
  return `<form class="toolbar" id="filter-form"><label class="search"><span>⌕</span><input name="query" value="${escapeHtml(state.query)}" placeholder="${escapeHtml(definition.searchPlaceholder)}" /></label><select name="status" aria-label="状态筛选">${definition.statusOptions.map(option => `<option value="${option.value}" ${option.value === state.status ? 'selected' : ''}>${option.label}</option>`).join('')}</select><button class="primary-button" type="submit">查询</button></form>`
}

function pageOverview() {
  const data = liveOverview || (client.demoMode ? demoOverview() : null)
  if (!data) return `${sectionTitle('网站概览', '查看会员、活动和订单的运营状态')}<section class="panel"><div class="empty">${loading ? '正在加载' : '暂无可显示的真实数据'}</div></section>`
  return `${sectionTitle('网站概览', '查看会员、活动和订单的运营状态', `<span class="date-range">${escapeHtml(data.period)}</span>`)}<div class="metric-grid">${data.metrics.map(metric => `<div class="metric"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong><small>${escapeHtml(metric.detail)}</small></div>`).join('')}</div><div class="overview-grid"><section class="panel"><div class="panel-heading"><h2>近期运营记录</h2></div>${rowsToTable(data.activity, [{ key: 'title', label: '记录' }, { key: 'meta', label: '时间与范围' }, { key: 'state', label: '类型' }])}</section><section class="panel permission-note"><h2>数据说明</h2><p>概览和用户列表均由服务端按当前运营账号的 capability 与作用范围返回。页面不计算会员、活动或订单事实。</p><div class="boundary-row"><span>数据来源</span><strong>${client.demoMode ? '演示数据' : 'MIP 管理服务'}</strong></div><div class="boundary-row"><span>请求协议</span><strong>AdminRequest v1</strong></div></section></div>`
}

function pageList(route: AdminListRoute, title: string, description: string) {
  const page = liveReadPage || (client.demoMode ? demoReadPage(route) : null)
  const detailTarget = ['users', 'events', 'orders', 'messages', 'knowledge'].includes(route) ? route as AdminDetailRoute : undefined
  const content = page
    ? `${summaryCards(page)}${page.sections.map(section => `<section class="panel list-panel">${section.title ? `<div class="panel-heading"><h2>${escapeHtml(section.title)}</h2></div>` : ''}${rowsToTable(section.rows, section.columns, detailTarget)}</section>`).join('')}${pagination(route, page)}`
    : `<section class="panel"><div class="empty">${loading ? '正在加载' : '暂无可显示的真实数据'}</div></section>`
  return `${sectionTitle(title, description)}${toolbar(route)}${content}`
}

function pageUsers() { return pageList('users', '用户管理', '查看会员、嘉宾及用户资料') }
function pageEvents() { return pageList('events', '活动管理', '查看活动信息、报名和签到状态') }
function pageOrders() { return pageList('orders', '订单管理', '查看会员和活动订单及支付状态') }
function pagePermissions() { return pageList('permissions', '权限管理', '查看运营成员和城市分会范围') }
function pageMessages() { return pageList('messages', '消息管理', '查看消息活动和公告状态') }
function pageKnowledge() { return pageList('knowledge', '知识库', '查看会员内容及发布状态') }

function summaryCards(page: AdminReadPage) {
  if (!page.summary?.length) return ''
  return `<div class="summary-strip">${page.summary.map(item => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div>`
}

function pagination(route: AdminListRoute, page: AdminReadPage) {
  const definition = getAdminReadRouteDefinition(route)
  const state = listStates[route]
  if (!definition.paginated || (!state.history.length && !page.nextCursor)) return ''
  return `<nav class="pagination" aria-label="分页"><button class="outline-button" id="previous-page" ${state.history.length ? '' : 'disabled'}>上一页</button><span>第 ${state.history.length + 1} 页</span><button class="outline-button" id="next-page" ${page.nextCursor ? '' : 'disabled'}>下一页</button></nav>`
}

function demoReadPage(route: AdminListRoute): AdminReadPage {
  if (route === 'users') return { sections: [{ rows: demo.users.map(item => ({ name: item.name, headline: item.company, identity: item.status, phone: item.phone, branch: item.branch, level: item.role, state: item.status })), columns: [{ key: 'name', label: '姓名' }, { key: 'headline', label: '简介' }, { key: 'identity', label: '身份' }, { key: 'phone', label: '手机状态' }, { key: 'branch', label: '所属分会' }, { key: 'level', label: '等级' }, { key: 'state', label: '账号状态' }] }], nextCursor: null }
  if (route === 'events') return { sections: [{ rows: demo.events.map(item => ({ ...item, access: '会员权益', attended: '—', state: item.status })), columns: [{ key: 'title', label: '活动名称' }, { key: 'time', label: '开始时间' }, { key: 'location', label: '城市与分会' }, { key: 'access', label: '活动类型' }, { key: 'registrations', label: '报名人数' }, { key: 'attended', label: '签到人数' }, { key: 'state', label: '状态' }] }], nextCursor: null }
  if (route === 'orders') return { sections: [{ rows: demo.orders.map(item => ({ ...item, resource: item.type, state: item.status })), columns: [{ key: 'id', label: '订单号' }, { key: 'user', label: '用户' }, { key: 'type', label: '订单类型' }, { key: 'resource', label: '订单内容' }, { key: 'amount', label: '金额' }, { key: 'createdAt', label: '创建时间' }, { key: 'state', label: '状态' }] }], nextCursor: null }
  if (route === 'permissions') return { sections: [{ title: '运营成员', rows: demo.roles.map(item => ({ name: item.name, role: item.capabilities, scope: item.scope, grantedAt: '—', state: '启用' })), columns: [{ key: 'name', label: '姓名' }, { key: 'role', label: '角色' }, { key: 'scope', label: '作用范围' }, { key: 'grantedAt', label: '授权时间' }, { key: 'state', label: '状态' }] }], nextCursor: null }
  if (route === 'messages') return { sections: [{ title: '消息活动', rows: demo.messages.map(item => ({ ...item, scope: item.audience, state: item.status })), columns: [{ key: 'title', label: '消息标题' }, { key: 'audience', label: '发送范围' }, { key: 'scope', label: '作用范围' }, { key: 'updatedAt', label: '更新时间' }, { key: 'state', label: '状态' }] }], nextCursor: null }
  return { sections: [{ rows: demo.knowledge.map(item => ({ ...item, category: '—', author: '—', access: '会员可见', state: item.status })), columns: [{ key: 'title', label: '文档标题' }, { key: 'type', label: '内容类型' }, { key: 'category', label: '分类' }, { key: 'author', label: '作者' }, { key: 'access', label: '访问范围' }, { key: 'updatedAt', label: '更新时间' }, { key: 'state', label: '状态' }] }], nextCursor: null }
}

function applyFilters(event: SubmitEvent) {
  event.preventDefault()
  if (route === 'overview') return
  const form = new FormData(event.currentTarget as HTMLFormElement)
  const state = listStates[route]
  state.query = String(form.get('query') || '').trim()
  state.status = String(form.get('status') || '')
  state.cursor = null
  state.history = []
  void render()
}

async function changePage(direction: 'previous' | 'next') {
  if (route === 'overview') return
  const state = listStates[route]
  if (direction === 'next') {
    const nextCursor = liveReadPage?.nextCursor
    if (!nextCursor) return
    state.history.push(state.cursor)
    state.cursor = nextCursor
  }
  else {
    const previousCursor = state.history.pop()
    if (previousCursor === undefined) return
    state.cursor = previousCursor
  }
  await render()
}

function paint() {
  const pages: Record<Route, () => string> = {
    overview: pageOverview,
    users: pageUsers,
    events: pageEvents,
    orders: pageOrders,
    permissions: pagePermissions,
    messages: pageMessages,
    knowledge: pageKnowledge,
  }
  shell(`<div class="loading-bar ${loading ? '' : 'hidden'}"></div>${pages[route]()}`)
  requestAnimationFrame(assertResponsiveViewport)
}

async function openDetail(target: AdminDetailRoute, id: string) {
  if (!id) return
  const flow = detailFlow + 1
  detailFlow = flow
  detailRoute = target
  detailView = null
  detailError = ''
  detailLoading = true
  paint()
  try {
    const value = await loadAdminDetail(target, id, (action, input) => client.request(action, input))
    if (flow !== detailFlow) return
    detailView = value
  }
  catch (error) {
    if (flow !== detailFlow) return
    detailError = error instanceof AdminApiClientError ? error.message : '详情暂时无法加载'
  }
  finally {
    if (flow === detailFlow) {
      detailLoading = false
      paint()
    }
  }
}

function closeDetail(repaint = true) {
  detailFlow += 1
  detailRoute = null
  detailView = null
  detailError = ''
  detailLoading = false
  if (repaint) paint()
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
  liveReadPage = await loadAdminReadPage(
    route,
    listStates[route],
    (action, input) => client.request(action, input),
  )
}

async function render() {
  loading = true
  liveReadPage = null
  liveOverview = null
  notice = ''
  apiErrorCode = ''
  paint()
  if (client.demoMode) {
    notice = '当前为显式本地演示模式，页面数据不代表生产事实。'
  }
  else if (loginChallenge || loginError) {
    loading = false
    paint()
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
  paint()
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
  const overflow = document.documentElement.scrollWidth > window.innerWidth + 1
  document.documentElement.dataset.mipResponsive = overflow ? 'fail' : 'pass'
  if (overflow) console.error(`MIP responsive overflow: document=${document.documentElement.scrollWidth}px viewport=${window.innerWidth}px`)
}

void render()
