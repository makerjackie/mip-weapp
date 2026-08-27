import { AdminApiClient, AdminApiClientError } from './services/admin-api'
import { demo } from './services/demo-data'
import './styles.css'

type Route = 'overview' | 'users' | 'events' | 'orders' | 'permissions' | 'messages' | 'knowledge'
type Row = Record<string, string | number>

const client = new AdminApiClient()
const app = document.querySelector<HTMLDivElement>('#app')!
let route: Route = 'overview'
let loading = false
let notice = ''
let liveRows: Row[] | null = null
let token = sessionStorage.getItem('mip-admin-token') || ''
client.setToken(token)

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

function sidebar() {
  const groups = [...new Set(nav.map(item => item.group))]
  return `<aside class="sidebar"><div class="brand"><span class="brand-mark">MIP</span><div><strong>MIP</strong><small>运营管理</small></div></div><nav>${groups.map(group => `<div class="nav-group"><span class="nav-label">${group}</span>${nav.filter(item => item.group === group).map(item => `<button class="nav-item ${item.route === route ? 'active' : ''}" data-route="${item.route}"><span class="nav-icon">${item.icon}</span>${item.label}</button>`).join('')}</div>`).join('')}</nav><div class="sidebar-footer"><span class="avatar">M</span><div><strong>运营账号</strong><small>${client.hasToken ? '已配置访问令牌' : '本地演示会话'}</small></div><button class="icon-button" id="token-button" title="配置访问令牌">⚙</button></div></aside>`
}

function header() {
  const current = nav.find(item => item.route === route)!
  const connection = client.configured ? (client.hasToken ? 'API 已连接配置' : 'API 待授权') : '本地演示数据'
  return `<header class="topbar"><div class="mobile-brand"><span class="brand-mark">MIP</span></div><div class="breadcrumb"><span>运营管理</span><i>/</i><strong>${current.label}</strong></div><div class="top-actions"><span class="connection"><i class="dot ${client.configured && client.hasToken ? 'online' : ''}"></i>${connection}</span><button class="outline-button" id="refresh-button">刷新数据</button></div></header>`
}

function shell(content: string) {
  app.innerHTML = `${sidebar()}<main class="main"><div class="content"><div id="notice" class="notice ${notice ? '' : 'hidden'}">${escapeHtml(notice)}</div>${header()}${content}</div></main>`
  document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(button => button.addEventListener('click', () => {
    route = button.dataset.route as Route
    notice = ''
    void render()
  }))
  document.querySelector('#refresh-button')?.addEventListener('click', () => void render())
  document.querySelector('#token-button')?.addEventListener('click', configureToken)
}

function sectionTitle(title: string, description: string, action = '') {
  return `<div class="section-title"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`
}

function toolbar(placeholder: string, action = '新建') {
  return `<div class="toolbar"><label class="search"><span>⌕</span><input placeholder="${placeholder}" /></label><select><option>全部状态</option><option>已发布</option><option>草稿</option></select><button class="primary-button">${action}</button></div>`
}

function pageOverview() {
  const data = demo.dashboard
  return `${sectionTitle('网站概览', '查看会员、活动和订单的运营状态', '<span class="date-range">2030 年 2 月</span>')}<div class="metric-grid"><div class="metric"><span>用户总数</span><strong>${data.users.toLocaleString()}</strong><small>较上月 <em>+8.4%</em></small></div><div class="metric"><span>有效会员</span><strong>${data.activeMembers}</strong><small>会员权益有效</small></div><div class="metric"><span>近期活动</span><strong>${data.upcomingEvents}</strong><small>未来 30 天</small></div><div class="metric"><span>待处理订单</span><strong>${data.pendingOrders}</strong><small>需要运营跟进</small></div></div><div class="overview-grid"><section class="panel"><div class="panel-heading"><h2>近期活动</h2><button class="text-button" data-route="events">查看全部</button></div>${rowsToTable(data.activity.map(item => ({ title: item.title, meta: item.meta, state: item.status })), [{ key: 'title', label: '活动' }, { key: 'meta', label: '时间与地点' }, { key: 'state', label: '状态' }])}</section><section class="panel"><div class="panel-heading"><h2>运营提示</h2></div><div class="notice-list"><div><span class="notice-number">8</span><p>笔订单等待确认<small>订单管理 · 待确认</small></p></div><div><span class="notice-number yellow">3</span><p>条内容等待审核<small>知识库 · 待处理</small></p></div><div><span class="notice-number">2</span><p>个权限申请待处理<small>权限管理 · 本周</small></p></div></div></section></div>`
}

function pageUsers() {
  const rows = liveRows || demo.users.map(user => ({ ...user, state: user.status }))
  return `${sectionTitle('用户管理', '查看和维护会员、嘉宾及用户资料', '<button class="outline-button">导出用户</button>')}${toolbar('搜索姓名、手机号或公司')}<section class="panel">${rowsToTable(rows, [{ key: 'name', label: '姓名' }, { key: 'company', label: '公司' }, { key: 'role', label: '合作角色' }, { key: 'phone', label: '手机号' }, { key: 'branch', label: '所属分会' }, { key: 'state', label: '状态' }])}</section>`
}

function pageEvents() {
  const rows = liveRows || demo.events.map(event => ({ ...event, state: event.status }))
  return `${sectionTitle('活动管理', '维护活动信息、报名名单和活动状态', '<button class="primary-button">创建活动</button>')}${toolbar('搜索活动名称或活动编号', '批量操作')}<section class="panel">${rowsToTable(rows, [{ key: 'title', label: '活动名称' }, { key: 'time', label: '活动时间' }, { key: 'location', label: '活动地点' }, { key: 'registrations', label: '报名人数' }, { key: 'state', label: '状态' }])}</section>`
}

function pageOrders() {
  const rows = liveRows || demo.orders.map(order => ({ ...order, state: order.status }))
  return `${sectionTitle('订单管理', '查看会员和活动门票订单及支付状态', '<button class="outline-button">导出订单</button>')}${toolbar('搜索订单号、姓名或手机号')}<section class="panel">${rowsToTable(rows, [{ key: 'id', label: '订单号' }, { key: 'user', label: '用户' }, { key: 'type', label: '订单类型' }, { key: 'amount', label: '金额' }, { key: 'createdAt', label: '创建时间' }, { key: 'state', label: '状态' }])}</section>`
}

function pagePermissions() {
  return `${sectionTitle('权限管理', '按平台、分会和活动范围管理运营权限', '<button class="primary-button">添加运营成员</button>')}<div class="permission-layout"><section class="panel"><div class="panel-heading"><h2>角色与权限</h2><button class="text-button">角色策略</button></div>${rowsToTable(demo.roles.map(role => ({ ...role })), [{ key: 'name', label: '角色' }, { key: 'members', label: '成员数' }, { key: 'scope', label: '作用范围' }, { key: 'capabilities', label: '权限' }])}</section><section class="panel permission-note"><h2>权限边界</h2><p>所有管理操作由服务端校验当前账号的 capability 和作用范围。Web 端仅提交业务意图，不在浏览器计算会员、订单或活动资格。</p><div class="boundary-row"><span>当前访问模式</span><strong>${client.hasToken ? '已授权 API' : '本地演示'}</strong></div><div class="boundary-row"><span>请求协议</span><strong>AdminRequest v1</strong></div></section></div>`
}

function pageMessages() {
  const rows = liveRows || demo.messages.map(message => ({ ...message, state: message.status }))
  return `${sectionTitle('消息管理', '维护模板、发送范围和投递记录', '<button class="primary-button">新建消息</button>')}${toolbar('搜索消息标题或模板')}<section class="panel">${rowsToTable(rows, [{ key: 'title', label: '消息标题' }, { key: 'audience', label: '发送范围' }, { key: 'updatedAt', label: '更新时间' }, { key: 'state', label: '状态' }])}</section>`
}

function pageKnowledge() {
  const rows = liveRows || demo.knowledge.map(item => ({ ...item, state: item.status }))
  return `${sectionTitle('知识库', '管理可供会员阅读的内容和信息源', '<button class="primary-button">新建文档</button>')}${toolbar('搜索文档标题或类型')}<section class="panel">${rowsToTable(rows, [{ key: 'title', label: '文档标题' }, { key: 'type', label: '内容类型' }, { key: 'updatedAt', label: '更新时间' }, { key: 'state', label: '状态' }])}</section>`
}

function configureToken() {
  const next = window.prompt('配置运营 API 访问令牌（仅保存在本机浏览器）', token)
  if (next === null) return
  token = next.trim()
  client.setToken(token)
  if (token) sessionStorage.setItem('mip-admin-token', token)
  else sessionStorage.removeItem('mip-admin-token')
  void render()
}

async function checkApi() {
  if (!client.configured) return
  try {
    await client.getSession()
    notice = ''
  } catch (error) {
    notice = error instanceof AdminApiClientError ? `${error.message}。当前页面展示演示数据，配置正确的 API 地址和令牌后可切换为真实数据。` : '管理 API 暂时不可用，当前页面展示演示数据。'
  }
}

async function exchangeCallbackCode() {
  const code = new URLSearchParams(window.location.search).get('code')
  if (!code || !client.configured || client.hasToken) return
  try {
    const session = await client.exchangeLoginCode(code)
    token = session.accessToken
    sessionStorage.setItem('mip-admin-token', token)
    window.history.replaceState({}, document.title, window.location.pathname)
  } catch (error) {
    notice = error instanceof AdminApiClientError ? error.message : '登录服务暂时不可用'
  }
}

async function loadRouteData() {
  if (!client.configured) return
  const actions: Partial<Record<Route, string>> = {
    users: 'mip.admin.users.list',
    events: 'mip.admin.events.list',
    orders: 'mip.admin.orders.list',
    permissions: 'mip.admin.roles.list',
    messages: 'mip.admin.messageCampaigns.list',
    knowledge: 'mip.admin.knowledge.list',
  }
  const action = actions[route]
  if (!action) return
  const payload = await client.request<unknown>(action, { pageSize: 50 })
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
  await exchangeCallbackCode()
  const pages: Record<Route, () => string> = { overview: pageOverview, users: pageUsers, events: pageEvents, orders: pageOrders, permissions: pagePermissions, messages: pageMessages, knowledge: pageKnowledge }
  shell(`<div class="loading-bar ${loading ? '' : 'hidden'}"></div>${pages[route]()}`)
  await checkApi()
  if (!notice) {
    try { await loadRouteData() } catch (error) { notice = error instanceof AdminApiClientError ? error.message : '管理 API 暂时不可用，当前页面展示演示数据。' }
  }
  loading = false
  shell(`<div class="loading-bar hidden"></div>${pages[route]()}`)
  const noticeElement = document.querySelector('#notice')
  if (noticeElement) { noticeElement.textContent = notice; noticeElement.classList.toggle('hidden', !notice) }
}

void render()
