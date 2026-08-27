import {
  AdminApiClient,
  AdminApiClientError,
  type AdminLoginChallenge,
} from './services/admin-api'
import type { AdminRequestInput, AdminSession } from './domain/contracts'
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
import {
  createMutationIntent,
  type AdminMutationAction,
} from './modules/admin-mutations'
import {
  createMutationDefinition,
  mutationInput,
  mutationSummary,
  readMutationValues,
  renderMutationDialog,
  type MutationState,
} from './modules/admin-mutation-ui'
import {
  ADMIN_PEOPLE_MUTATION_ACTIONS,
  ADMIN_PEOPLE_MUTATION_CONFIGS,
  buildAdminPeopleMutationInput,
  createAdminPeopleMutationDefinition,
  type AdminPeopleMutationAction,
} from './modules/admin-people-mutation-forms'
import {
  ADMIN_EVENT_MUTATION_ACTIONS,
  buildAdminEventMutationInput,
  createAdminEventMutationDefinition,
  eventMutationConfig,
  type AdminEventMutationAction,
} from './modules/admin-event-mutation-forms'
import {
  ADMIN_CONTENT_MUTATION_ACTIONS,
  getContentMutationForm,
  validateContentMutation,
  type ContentMutationAction,
} from './modules/content-mutation-forms'
import {
  readOperationValues,
  renderOperationDialog,
  type OperationDialogState,
  type OperationField,
  type OperationValues,
} from './modules/admin-operation-ui'
import {
  ADMIN_TASK_MUTATION_ACTIONS,
  buildTaskMutationInput,
  createTaskMutationDefinition,
  downloadTaskCompletionExport,
  exportTaskCompletions,
  type AdminTaskMutationAction,
} from './modules/admin-task-management'
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
let currentDetailId = ''
let mutationState: MutationState | null = null
type ReviewedOperationAction = AdminPeopleMutationAction | AdminEventMutationAction | ContentMutationAction | AdminTaskMutationAction
type AdvancedOperationState = OperationDialogState & {
  action: ReviewedOperationAction
  capability: string
  idempotencyKey: string
  buildInput: (values: OperationValues) => AdminRequestInput | null
}
let operationState: AdvancedOperationState | null = null

const peopleOperationSet = new Set<string>(ADMIN_PEOPLE_MUTATION_ACTIONS)
const eventOperationSet = new Set<string>(ADMIN_EVENT_MUTATION_ACTIONS)
const contentOperationSet = new Set<string>(ADMIN_CONTENT_MUTATION_ACTIONS)
const taskOperationSet = new Set<string>(ADMIN_TASK_MUTATION_ACTIONS)

type ListState = AdminListQuery & { history: Array<string | null> }
const listState = (): ListState => ({ query: '', status: '', cursor: null, limit: 20, history: [] })
const listStates: Record<AdminListRoute, ListState> = {
  users: listState(),
  events: listState(),
  orders: listState(),
  tasks: listState(),
  permissions: listState(),
  messages: listState(),
  knowledge: listState(),
  opportunities: listState(),
  growth: listState(),
  operations: listState(),
}

const nav: Array<{ route: Route; label: string; icon: string; group: string; capabilities: string[] }> = [
  { route: 'overview', label: '网站概览', icon: '▦', group: '工作台', capabilities: ['admin.dashboard'] },
  { route: 'users', label: '用户管理', icon: '◎', group: '业务管理', capabilities: ['users.read'] },
  { route: 'events', label: '活动管理', icon: '◇', group: '业务管理', capabilities: ['events.read'] },
  { route: 'orders', label: '订单管理', icon: '▤', group: '业务管理', capabilities: ['orders.read'] },
  { route: 'tasks', label: '任务管理', icon: '✓', group: '业务管理', capabilities: ['tasks.manage'] },
  { route: 'opportunities', label: '机会与内容', icon: '◇', group: '业务管理', capabilities: ['opportunities.moderate', 'userContent.moderate'] },
  { route: 'growth', label: '成长与勋章', icon: '✦', group: '会员运营', capabilities: ['growth.read', 'badges.manage'] },
  { route: 'permissions', label: '权限管理', icon: '⌘', group: '平台设置', capabilities: ['roles.change', 'branches.manage', 'audit.read'] },
  { route: 'messages', label: '消息管理', icon: '▱', group: '平台设置', capabilities: ['messages.manage'] },
  { route: 'knowledge', label: '知识库', icon: '□', group: '平台设置', capabilities: ['knowledge.manage'] },
  { route: 'operations', label: '运营记录', icon: '≡', group: '平台设置', capabilities: ['announcements.manage', 'community.reports.manage', 'operations.exceptions.read'] },
]

function visibleNav() {
  if (client.demoMode || !session?.enabled) return nav
  const visible = nav.filter(item => item.capabilities.every(hasCapability))
  return visible.length ? visible : [nav[0]]
}

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
  const items = visibleNav()
  const groups = [...new Set(items.map(item => item.group))]
  const sessionText = client.demoMode ? '本地演示模式' : session?.enabled ? '已验证运营会话' : '尚未登录'
  return `<aside class="sidebar"><div class="brand"><span class="brand-mark">MIP</span><div><strong>MIP</strong><small>运营管理</small></div></div><nav>${groups.map(group => `<div class="nav-group"><span class="nav-label">${group}</span>${items.filter(item => item.group === group).map(item => `<button class="nav-item ${item.route === route ? 'active' : ''}" data-route="${item.route}"><span class="nav-icon">${item.icon}</span>${item.label}</button>`).join('')}</div>`).join('')}</nav><div class="sidebar-footer"><span class="avatar">M</span><div><strong>运营账号</strong><small>${sessionText}</small></div>${session?.enabled ? '<button class="icon-button" id="logout-button" title="退出登录">↪</button>' : ''}</div></aside>`
}

function header() {
  const current = nav.find(item => item.route === route) || nav[0]
  const connection = client.demoMode ? '本地演示数据' : session?.enabled ? '真实数据已连接' : '需要运营登录'
  const sessionAction = !client.demoMode && !session?.enabled ? '<button class="outline-button" id="login-button">运营登录</button>' : ''
  return `<header class="topbar"><div class="mobile-brand"><span class="brand-mark">MIP</span></div><div class="breadcrumb"><span>运营管理</span><i>/</i><strong>${current.label}</strong></div><div class="top-actions"><span class="connection"><i class="dot ${session?.enabled ? 'online' : ''}"></i>${connection}</span>${sessionAction}<button class="outline-button" id="refresh-button">刷新数据</button></div></header>`
}

function shell(content: string) {
  const loginAction = apiErrorCode === 'AUTH_REQUIRED' ? '<button class="notice-action" id="notice-login-button">运营登录</button>' : ''
  app.innerHTML = `${sidebar()}<main class="main"><div class="content"><div id="notice" class="notice ${notice ? '' : 'hidden'}"><span>${escapeHtml(notice)}</span>${loginAction}</div>${header()}${content}</div></main>${detailPanel()}${mutationDialog()}${advancedOperationDialog()}${loginDialog()}`
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
  document.querySelectorAll<HTMLButtonElement>('[data-mutation-open]').forEach(button => button.addEventListener('click', () => {
    openMutation(
      button.dataset.mutationOpen as AdminMutationAction,
      button.dataset.mutationId || '',
      button.dataset.mutationStatus as 'PUBLISHED' | 'UNPUBLISHED' | undefined,
    )
  }))
  document.querySelector('#mutation-close-button')?.addEventListener('click', closeMutation)
  document.querySelector('#mutation-cancel-button')?.addEventListener('click', closeMutation)
  document.querySelector('#mutation-backdrop')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeMutation()
  })
  document.querySelector<HTMLFormElement>('#mutation-form')?.addEventListener('submit', event => void submitMutation(event))
  document.querySelectorAll<HTMLButtonElement>('[data-operation-open]').forEach(button => button.addEventListener('click', () => {
    openAdvancedOperation(button.dataset.operationOpen || '', button.dataset.operationId || '')
  }))
  document.querySelector('#operation-close-button')?.addEventListener('click', closeAdvancedOperation)
  document.querySelector('#operation-cancel-button')?.addEventListener('click', closeAdvancedOperation)
  document.querySelector('#operation-backdrop')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeAdvancedOperation()
  })
  document.querySelector<HTMLFormElement>('#operation-form')?.addEventListener('submit', event => void submitAdvancedOperation(event))
  document.querySelectorAll<HTMLButtonElement>('[data-task-export]').forEach(button => button.addEventListener('click', () => {
    void handleTaskCompletionExport(button.dataset.taskExport || '', button)
  }))
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
        ? detailView.sections.map(section => `<section class="detail-section"><h3>${escapeHtml(section.title)}</h3>${section.fields ? `<div class="detail-fields">${section.fields.map(item => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div>` : ''}${section.metrics ? `<div class="detail-metrics">${section.metrics.map(item => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div>` : ''}${section.rows && section.columns ? rowsToTable(section.rows, section.columns, section.detailTarget) : ''}</section>`).join('')
        : ''
  const title = detailView?.title || ({ users: '用户详情', events: '活动详情', orders: '订单详情', tasks: '任务详情', taskCompletions: '任务完成记录', messages: '消息活动详情', knowledge: '知识内容详情', opportunities: '机会详情' })[detailRoute]
  const subtitle = detailView?.subtitle ? `<p>${escapeHtml(detailView.subtitle)}</p>` : ''
  const status = detailView?.status ? `<span class="${statusClass(detailView.status)}">${escapeHtml(detailView.status)}</span>` : ''
  const actions = detailActions(detailRoute)
  return `<div class="detail-backdrop" id="detail-backdrop"><aside class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title"><header class="detail-header"><div><span class="detail-kicker">运营详情</span><h2 id="detail-title">${escapeHtml(title)}</h2>${subtitle}</div><div class="detail-header-actions">${status}${actions}<button id="detail-close-button" class="login-close" aria-label="关闭">×</button></div></header><div class="detail-body">${body}</div></aside></div>`
}

function detailActions(route: AdminDetailRoute | null) {
  if (!route || !detailView) return ''
  const id = escapeHtml(detailIdForRoute(route))
  if (route === 'users') {
    const actions = [
      hasCapability('memberships.adjust') ? `<button class="outline-button detail-action-button" data-mutation-open="mip.admin.memberships.grant" data-mutation-id="${id}">补录会员</button>` : '',
      operationButton('mip.admin.users.update', '编辑资料', id),
      operationButton('mip.admin.users.changePrimaryBranch', '变更分会', id),
      operationButton('mip.admin.users.setControl', '访问控制', id),
      operationButton('mip.admin.roles.set', '设置角色', id),
      operationButton('mip.admin.badges.grant', '授予勋章', id),
      operationButton('mip.admin.growth.adjust', '调整成长值', id),
    ].join('')
    return actions ? `<div class="detail-action-group">${actions}</div>` : ''
  }
  if (route === 'events') {
    const status = detailView.status
    const targetStatus = status === '已发布'
      ? 'UNPUBLISHED'
      : ['草稿', '已下架'].includes(status)
        ? 'PUBLISHED'
        : ''
    const statusAction = hasCapability('events.write') && targetStatus
      ? `<button class="outline-button detail-action-button" data-mutation-open="mip.admin.events.changeStatus" data-mutation-status="${targetStatus}" data-mutation-id="${id}">${targetStatus === 'PUBLISHED' ? '发布活动' : '下架活动'}</button>`
      : ''
    const archive = hasCapability('events.write') && status === '草稿'
      ? `<button class="outline-button detail-action-button" data-mutation-open="mip.admin.events.archive" data-mutation-id="${id}">归档活动</button>`
      : ''
    const clone = hasCapability('events.write') ? `<button class="outline-button detail-action-button" data-mutation-open="mip.admin.events.clone" data-mutation-id="${id}">克隆活动</button>` : ''
    const reminder = hasCapability('communications.publish') ? `<button class="outline-button detail-action-button" data-mutation-open="mip.admin.communications.publishEventReminder" data-mutation-id="${id}">发布提醒</button>` : ''
    const edit = operationButton('mip.admin.events.save', '编辑活动', id)
    const tags = operationButton('mip.admin.events.tags.replace', '活动标签', id)
    return statusAction || archive || clone || reminder || edit || tags ? `<div class="detail-action-group">${edit}${statusAction}${archive}${clone}${tags}${reminder}</div>` : ''
  }
  if (route === 'orders' && hasCapability('refunds.submit')) return `<button class="outline-button detail-action-button" data-mutation-open="mip.admin.refunds.submit" data-mutation-id="${id}">提交退款</button>`
  if (route === 'tasks') {
    const task = record(detailView.source?.task)
    const status = String(task.status || '')
    const assignmentMode = String(task.assignmentMode || 'ALL')
    const actions = [
      operationButton('mip.admin.tasks.save', '编辑任务', id),
      status === 'DRAFT' || status === 'UNPUBLISHED' ? operationButton('mip.admin.tasks.publish', '发布任务', id) : '',
      status === 'PUBLISHED' ? operationButton('mip.admin.tasks.unpublish', '下架任务', id) : '',
      assignmentMode === 'SELECTED' ? operationButton('mip.admin.tasks.assignMembers', '分配成员', id) : '',
      assignmentMode === 'SELECTED' ? operationButton('mip.admin.tasks.revokeMembers', '撤销成员', id) : '',
      operationButton('mip.admin.tasks.delete', '删除任务', id),
      hasCapability('tasks.manage') ? `<button class="outline-button detail-action-button" data-task-export="${id}">导出完成记录</button>` : '',
    ].join('')
    return `<div class="detail-action-group">${actions}</div>`
  }
  if (route === 'messages') {
    return `<div class="detail-action-group">${operationButton('mip.admin.messageCampaigns.save', '编辑消息', id)}${operationButton('mip.admin.messageCampaigns.snapshot', '生成收件人快照', id)}${operationButton('mip.admin.messageCampaigns.schedule', '设置发送时间', id)}${operationButton('mip.admin.messageCampaigns.publish', '发布消息', id)}${operationButton('mip.admin.messageCampaigns.withdraw', '撤回消息', id)}</div>`
  }
  if (route === 'knowledge') {
    return `<div class="detail-action-group">${operationButton('mip.admin.knowledge.contents.save', '编辑内容', id)}${operationButton('mip.admin.knowledge.contents.review', '审核内容', id)}</div>`
  }
  if (route === 'opportunities') {
    return `<div class="detail-action-group">${operationButton('mip.admin.opportunities.save', '编辑机会', id)}${operationButton('mip.admin.opportunities.publish', '发布机会', id)}${operationButton('mip.admin.opportunities.end', '结束机会', id)}${operationButton('mip.admin.opportunities.unpublish', '下架机会', id)}${operationButton('mip.admin.opportunities.archive', '归档机会', id)}</div>`
  }
  return ''
}

function operationButton(action: ReviewedOperationAction, label: string, targetId = '') {
  if (!hasCapability(operationCapability(action))) return ''
  return `<button class="outline-button detail-action-button" data-operation-open="${action}" data-operation-id="${escapeHtml(targetId)}">${escapeHtml(label)}</button>`
}

function hasCapability(capability: string) {
  return session?.capabilities?.some(item => item.capability === capability) === true
}

function detailIdForRoute(route: AdminDetailRoute) {
  return detailRoute === route ? currentDetailId : ''
}

function mutationDialog() {
  return mutationState ? renderMutationDialog(mutationState, escapeHtml) : ''
}

function openMutation(action: AdminMutationAction, targetId: string, targetStatus?: 'PUBLISHED' | 'UNPUBLISHED') {
  if (!targetId || !detailView || !client.configured) return
  const definition = createMutationDefinition(action, targetId, detailFieldValue, targetStatus)
  mutationState = {
    ...definition,
    intent: createMutationIntent(action, definition.values),
    error: '',
    busy: false,
  }
  paint()
}

function detailFieldValue(sectionTitle: string, label: string) {
  const section = detailView?.sections.find(item => item.title === sectionTitle)
  return section?.fields?.find(item => item.label === label)?.value || ''
}

async function submitMutation(event: SubmitEvent) {
  event.preventDefault()
  const state = mutationState
  if (!state || state.busy) return
  const form = event.currentTarget as HTMLFormElement
  const values = readMutationValues(new FormData(form), state.values, state.action)
  const input = mutationInput(state, values)
  if (!input) return
  const summary = `${state.title}：${mutationSummary(state.action, values)}\n\n确认提交？`
  if (!window.confirm(summary)) return
  state.values = values
  state.busy = true
  state.error = ''
  paint()
  try {
    await client.request(state.action, { ...input, idempotencyKey: state.intent.idempotencyKey })
    notice = `${state.title}已提交`
    mutationState = null
    if (detailRoute && currentDetailId) await openDetail(detailRoute, currentDetailId)
    else paint()
  }
  catch (error) {
    state.busy = false
    state.error = error instanceof AdminApiClientError ? error.message : '请求结果暂时无法确认'
    paint()
  }
}

function closeMutation() {
  if (mutationState?.busy) return
  mutationState = null
  paint()
}

function advancedOperationDialog() {
  return operationState ? renderOperationDialog(operationState, escapeHtml) : ''
}

function openAdvancedOperation(actionValue: string, targetId: string) {
  if (!client.configured || !isReviewedOperationAction(actionValue)) return
  if (!hasCapability(operationCapability(actionValue))) return
  const idempotencyKey = createAdvancedOperationKey(actionValue)
  if (peopleOperationSet.has(actionValue)) {
    const action = actionValue as AdminPeopleMutationAction
    const definition = createAdminPeopleMutationDefinition(action, targetId, detailFieldValue)
    const values = prefillPeopleValues(action, definition.values)
    const fields = peopleFields(action, definition.fields)
    operationState = {
      action,
      capability: definition.capability,
      title: definition.title,
      description: definition.description,
      fields,
      values,
      idempotencyKey,
      buildInput: next => buildAdminPeopleMutationInput(definition, next),
      busy: false,
      error: '',
    }
  }
  else if (eventOperationSet.has(actionValue)) {
    const action = actionValue as AdminEventMutationAction
    const definition = createAdminEventMutationDefinition(action, targetId, detailFieldValue)
    const values = prefillEventValues(action, definition.values)
    operationState = {
      action,
      capability: definition.capability,
      title: definition.title,
      description: definition.description,
      fields: definition.fields as readonly OperationField[],
      values,
      idempotencyKey,
      buildInput: next => buildAdminEventMutationInput(definition, next),
      busy: false,
      error: '',
    }
  }
  else if (taskOperationSet.has(actionValue)) {
    const action = actionValue as AdminTaskMutationAction
    const definition = createTaskMutationDefinition(action, targetId, detailView?.source || {})
    operationState = {
      action,
      capability: definition.capability,
      title: definition.title,
      description: definition.description,
      fields: definition.fields,
      values: definition.values,
      idempotencyKey,
      buildInput: next => buildTaskMutationInput(definition, next),
      busy: false,
      error: '',
    }
  }
  else {
    const action = actionValue as ContentMutationAction
    const definition = getContentMutationForm(action)
    const fields = normalizeContentFields(definition.fields as readonly OperationField[])
    const values = prefillContentValues(action, defaultOperationValues(fields), targetId)
    operationState = {
      action,
      capability: definition.capability,
      title: contentOperationTitle(action, definition.resource),
      description: `${definition.resource}操作提交后由服务端校验权限、作用范围和当前状态。`,
      fields,
      values,
      idempotencyKey,
      buildInput: (next) => {
        const normalized = contentOperationValues(action, next, idempotencyKey)
        const result = validateContentMutation(action, normalized)
        return result.ok ? result.input : null
      },
      busy: false,
      error: '',
    }
  }
  paint()
}

async function submitAdvancedOperation(event: SubmitEvent) {
  event.preventDefault()
  const state = operationState
  if (!state || state.busy) return
  const values = readOperationValues(state.fields, new FormData(event.currentTarget as HTMLFormElement), state.values)
  const input = state.buildInput(values)
  if (!input) {
    state.values = values
    state.error = '请检查必填项、标识、版本和字段格式'
    paint()
    return
  }
  if (!window.confirm(`${state.title}\n\n确认提交？`)) return
  state.values = values
  state.busy = true
  state.error = ''
  paint()
  try {
    await client.request(state.action, { ...input, idempotencyKey: state.idempotencyKey })
    notice = `${state.title}已提交`
    operationState = null
    if (detailRoute && currentDetailId) await openDetail(detailRoute, currentDetailId)
    else await render()
  }
  catch (error) {
    state.busy = false
    state.error = error instanceof AdminApiClientError ? error.message : '请求结果暂时无法确认'
    paint()
  }
}

function closeAdvancedOperation() {
  if (operationState?.busy) return
  operationState = null
  paint()
}

function isReviewedOperationAction(action: string): action is ReviewedOperationAction {
  return peopleOperationSet.has(action) || eventOperationSet.has(action) || contentOperationSet.has(action) || taskOperationSet.has(action)
}

function operationCapability(action: ReviewedOperationAction) {
  if (peopleOperationSet.has(action)) return ADMIN_PEOPLE_MUTATION_CONFIGS[action as AdminPeopleMutationAction].capability
  if (eventOperationSet.has(action)) return eventMutationConfig(action as AdminEventMutationAction).capability
  if (taskOperationSet.has(action)) return 'tasks.manage'
  return getContentMutationForm(action as ContentMutationAction).capability
}

async function handleTaskCompletionExport(taskId: string, button: HTMLButtonElement) {
  if (!taskId || button.disabled || !hasCapability('tasks.manage')) return
  button.disabled = true
  const label = button.textContent
  button.textContent = '正在导出'
  try {
    const result = await exportTaskCompletions(taskId, (action, input) => client.request(action, input))
    downloadTaskCompletionExport(result)
    notice = `已导出 ${result.rowCount.toLocaleString('zh-CN')} 条完成记录`
    paint()
  }
  catch (error) {
    notice = error instanceof AdminApiClientError ? error.message : '任务完成记录暂时无法导出'
    paint()
  }
  finally {
    button.disabled = false
    button.textContent = label
  }
}

function createAdvancedOperationKey(action: string) {
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `web-${action.split('.').at(-1) || 'operation'}-${suffix}`.slice(0, 128)
}

function peopleFields(action: AdminPeopleMutationAction, fields: readonly OperationField[]) {
  if (action !== 'mip.admin.users.changePrimaryBranch') return fields
  const options = recordsValue(record(record(detailView?.source).user).primaryBranchOptions).map(item => ({
    value: String(item.id || ''),
    label: String(item.label || item.name || item.id || ''),
  })).filter(item => item.value && item.label)
  return fields.map(field => (field.name === 'targetBranchId' && options.length ? { ...field, options } : field))
}

function prefillPeopleValues(action: AdminPeopleMutationAction, values: OperationValues) {
  const next = { ...values }
  const user = record(record(detailView?.source).user)
  if (action === 'mip.admin.users.update') {
    for (const key of ['nickname', 'headline', 'introduction']) if (user[key] !== undefined) next[key] = user[key]
  }
  return next
}

function prefillEventValues(action: AdminEventMutationAction, values: OperationValues) {
  const next = { ...values }
  if (action !== 'mip.admin.events.save') return next
  const event = record(record(detailView?.source).event)
  for (const field of eventMutationConfig(action).fields) {
    if (!field.hidden && event[field.key] !== undefined) next[field.key] = event[field.key]
  }
  return next
}

function prefillContentValues(action: ContentMutationAction, values: OperationValues, targetId: string) {
  const next = { ...values }
  const source = record(detailView?.source)
  const resource = action.startsWith('mip.admin.messageCampaigns.') ? record(source.campaign)
    : action.startsWith('mip.admin.opportunities.') ? record(source.opportunity)
      : action.startsWith('mip.admin.knowledge.contents.') ? record(source.content)
        : {}
  const idKey = action.startsWith('mip.admin.messageCampaigns.') ? 'campaignId'
    : action.startsWith('mip.admin.opportunities.') ? 'opportunityId'
      : action.startsWith('mip.admin.knowledge.contents.') ? 'contentId'
        : action.startsWith('mip.admin.badges.') || action === 'mip.admin.growth.adjust' ? 'userId'
          : ''
  if (idKey && targetId) next[idKey] = targetId
  if (resource.version !== undefined) next.expectedVersion = resource.version
  if (action.endsWith('.save')) {
    for (const key of Object.keys(next)) if (resource[key] !== undefined) next[key] = resource[key]
  }
  return next
}

function defaultOperationValues(fields: readonly OperationField[]): OperationValues {
  const values: OperationValues = {}
  for (const field of fields) {
    const key = String(field.key || field.name || '')
    if (!key) continue
    if (field.kind === 'group') values[key] = defaultOperationValues(field.fields || [])
    else if (field.kind === 'checkbox' || field.kind === 'boolean') values[key] = false
    else if (['id-list', 'profile-ref-list', 'asset-list', 'tags', 'multi-select'].includes(field.kind)) values[key] = []
    else if (field.kind === 'select') {
      const first = field.options?.[0]
      values[key] = field.required && first ? (typeof first === 'string' ? first : first.value) : ''
    }
    else values[key] = ''
  }
  return values
}

function contentOperationValues(action: ContentMutationAction, values: OperationValues, idempotencyKey: string) {
  const next = pruneEmptyGroups({ ...values })
  const form = getContentMutationForm(action)
  if (form.idempotencyRequired) next.idempotencyKey = idempotencyKey
  if (action === 'mip.admin.opportunities.save') {
    const draft = record(next.draft)
    const terms = record(draft.commercialTerms)
    if (!terms.minAmountCents && !terms.maxAmountCents && !Array.isArray(terms.locations)) delete draft.commercialTerms
    next.draft = draft
  }
  if (action === 'mip.admin.messageCampaigns.schedule' && typeof next.scheduledFor === 'string' && next.scheduledFor) {
    const date = new Date(next.scheduledFor)
    if (Number.isFinite(date.getTime())) next.scheduledFor = date.toISOString()
  }
  return next
}

function normalizeContentFields(fields: readonly OperationField[]): readonly OperationField[] {
  return fields.map((field) => {
    const key = String(field.key || field.name || '')
    const nested = field.fields ? normalizeContentFields(field.fields) : undefined
    if (key === 'roleKeys') return { ...field, kind: 'multi-select', fields: nested }
    return nested ? { ...field, fields: nested } : field
  })
}

function pruneEmptyGroups(value: OperationValues): OperationValues {
  const output: OperationValues = {}
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const nested = pruneEmptyGroups(item as OperationValues)
      if (Object.keys(nested).length) output[key] = nested
    }
    else output[key] = item
  }
  return output
}

function contentOperationTitle(action: ContentMutationAction, resource: string) {
  const verb = action.endsWith('.save') ? '保存'
    : action.endsWith('.publish') ? '发布'
      : action.endsWith('.withdraw') || action.endsWith('.unpublish') ? '下架'
        : action.endsWith('.archive') ? '归档'
          : action.endsWith('.claim') ? '领取处理'
            : action.endsWith('.close') ? '完成处理'
              : action.endsWith('.grant') ? '授予'
                : action.endsWith('.revoke') ? '撤销'
                  : action.endsWith('.adjust') ? '调整'
                    : '更新'
  return `${verb}${resource}`
}

function recordsValue(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
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

function pageList(route: AdminListRoute, title: string, description: string, actions: readonly ReviewedOperationAction[] = []) {
  const page = liveReadPage || (client.demoMode ? demoReadPage(route) : null)
  const detailTarget = ['users', 'events', 'orders', 'tasks', 'messages', 'knowledge', 'opportunities'].includes(route) ? route as AdminDetailRoute : undefined
  const content = page
    ? `${summaryCards(page)}${page.sections.map(section => `<section class="panel list-panel">${section.title ? `<div class="panel-heading"><h2>${escapeHtml(section.title)}</h2></div>` : ''}${rowsToTable(section.rows, section.columns, section.detailTarget === null ? undefined : section.detailTarget || detailTarget)}</section>`).join('')}${pagination(route, page)}`
    : `<section class="panel"><div class="empty">${loading ? '正在加载' : '暂无可显示的真实数据'}</div></section>`
  return `${sectionTitle(title, description, operationMenu(actions))}${toolbar(route)}${content}`
}

function pageUsers() { return pageList('users', '用户管理', '查看会员、嘉宾及用户资料') }
function pageEvents() { return pageList('events', '活动管理', '查看活动信息、报名和签到状态', [
  'mip.admin.events.save', 'mip.admin.events.policy.save', 'mip.admin.events.catalog.save',
  'mip.admin.events.catalog.changeStatus', 'mip.admin.events.catalog.archive',
]) }
function pageOrders() { return pageList('orders', '订单管理', '查看会员和活动订单及支付状态') }
function pageTasks() { return pageList('tasks', '任务管理', '管理任务内容、成员分配和完成记录', ['mip.admin.tasks.save']) }
function pagePermissions() { return pageList('permissions', '权限管理', '查看运营成员和城市分会范围', ['mip.admin.branches.create']) }
function pageMessages() { return pageList('messages', '消息管理', '查看消息活动和公告状态', [
  'mip.admin.messageCampaigns.save', 'mip.admin.messageTemplates.save', 'mip.admin.messageTemplates.activate',
  'mip.admin.messageTemplates.archive',
]) }
function pageKnowledge() { return pageList('knowledge', '知识库', '查看会员内容及发布状态', [
  'mip.admin.knowledge.contents.save', 'mip.admin.knowledge.contents.review', 'mip.admin.knowledge.schedules.save',
]) }

function operationMenu(actions: readonly ReviewedOperationAction[]) {
  const available = actions.filter(action => hasCapability(operationCapability(action)))
  if (!available.length) return ''
  return `<details class="operation-menu"><summary class="primary-button">运营操作</summary><div>${available.map(action => `<button type="button" class="outline-button" data-operation-open="${action}">${escapeHtml(contentOperationLabel(action))}</button>`).join('')}</div></details>`
}

function contentOperationLabel(action: ReviewedOperationAction) {
  if (peopleOperationSet.has(action)) return ADMIN_PEOPLE_MUTATION_CONFIGS[action as AdminPeopleMutationAction].title
  if (eventOperationSet.has(action)) return eventMutationConfig(action as AdminEventMutationAction).title
  if (taskOperationSet.has(action)) return createTaskMutationDefinition(action as AdminTaskMutationAction).title
  const form = getContentMutationForm(action as ContentMutationAction)
  return contentOperationTitle(action as ContentMutationAction, form.resource)
}

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
  if (route === 'tasks') return {
    sections: [
      {
        title: '任务',
        rows: demo.tasks.map(item => ({ ...item })),
        columns: [{ key: 'name', label: '任务名称' }, { key: 'reward', label: '经验奖励' }, { key: 'assignment', label: '分配范围' }, { key: 'assigned', label: '已分配' }, { key: 'completed', label: '已完成' }, { key: 'endsAt', label: '截止时间' }, { key: 'updatedAt', label: '更新时间' }, { key: 'state', label: '状态' }],
        detailTarget: null,
      },
      {
        title: '近期完成记录',
        rows: demo.taskCompletions.map(item => ({ ...item })),
        columns: [{ key: 'task', label: '任务' }, { key: 'member', label: '成员' }, { key: 'reward', label: '经验奖励' }, { key: 'completedAt', label: '完成时间' }, { key: 'state', label: '结果' }],
        detailTarget: null,
      },
    ],
    nextCursor: null,
  }
  if (route === 'permissions') return { sections: [{ title: '运营成员', rows: demo.roles.map(item => ({ name: item.name, role: item.capabilities, scope: item.scope, grantedAt: '—', state: '启用' })), columns: [{ key: 'name', label: '姓名' }, { key: 'role', label: '角色' }, { key: 'scope', label: '作用范围' }, { key: 'grantedAt', label: '授权时间' }, { key: 'state', label: '状态' }] }], nextCursor: null }
  if (route === 'messages') return { sections: [{ title: '消息活动', rows: demo.messages.map(item => ({ ...item, scope: item.audience, state: item.status })), columns: [{ key: 'title', label: '消息标题' }, { key: 'audience', label: '发送范围' }, { key: 'scope', label: '作用范围' }, { key: 'updatedAt', label: '更新时间' }, { key: 'state', label: '状态' }] }], nextCursor: null }
  if (route === 'knowledge') return { sections: [{ rows: demo.knowledge.map(item => ({ ...item, category: '—', author: '—', access: '会员可见', state: item.status })), columns: [{ key: 'title', label: '文档标题' }, { key: 'type', label: '内容类型' }, { key: 'category', label: '分类' }, { key: 'author', label: '作者' }, { key: 'access', label: '访问范围' }, { key: 'updatedAt', label: '更新时间' }, { key: 'state', label: '状态' }] }], nextCursor: null }
  if (route === 'opportunities') return { sections: [{ title: '机会', rows: [], columns: [{ key: 'title', label: '标题' }] }, { title: '用户内容', rows: [], columns: [{ key: 'title', label: '标题' }] }], nextCursor: null }
  if (route === 'growth') return { sections: [{ title: '等级', rows: [], columns: [{ key: 'name', label: '等级' }] }, { title: '徽章', rows: [], columns: [{ key: 'name', label: '徽章' }] }], nextCursor: null }
  return { sections: [{ title: '运营记录', rows: [], columns: [{ key: 'title', label: '记录' }] }], nextCursor: null }
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
    tasks: pageTasks,
    permissions: pagePermissions,
    messages: pageMessages,
    knowledge: pageKnowledge,
    opportunities: () => pageList('opportunities', '机会与内容', '查看机会、用户内容、撮合和评论事实', [
      'mip.admin.opportunities.save', 'mip.admin.userContent.save', 'mip.admin.userContent.unpublish', 'mip.admin.userContent.archive',
    ]),
    growth: () => pageList('growth', '成长与勋章', '查看等级、权益、成长流水和徽章事实', [
      'mip.admin.growth.adjust', 'mip.admin.badges.grant', 'mip.admin.badges.revoke',
    ]),
    operations: () => pageList('operations', '运营记录', '查看公告、社区举报、运营异常和待办', [
      'mip.admin.announcements.save', 'mip.admin.announcements.publish', 'mip.admin.announcements.withdraw',
      'mip.admin.announcements.pin', 'mip.admin.communityReports.claim', 'mip.admin.communityReports.close',
    ]),
  }
  shell(`<div class="loading-bar ${loading ? '' : 'hidden'}"></div>${pages[route]()}`)
  requestAnimationFrame(assertResponsiveViewport)
}

async function openDetail(target: AdminDetailRoute, id: string) {
  if (!id) return
  const flow = detailFlow + 1
  detailFlow = flow
  detailRoute = target
  currentDetailId = id
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
  currentDetailId = ''
  detailView = null
  detailError = ''
  detailLoading = false
  mutationState = null
  operationState = null
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
      if (!visibleNav().some(item => item.route === route)) route = visibleNav()[0].route
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
