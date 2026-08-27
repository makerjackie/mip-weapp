import type { AdminRequestInput } from '../domain/contracts'

export type AdminListRoute = 'users' | 'events' | 'orders' | 'permissions' | 'messages' | 'knowledge'
export type AdminTableRow = Record<string, unknown>

export interface AdminTableColumn {
  key: string
  label: string
}

export interface AdminTableSection {
  title?: string
  rows: AdminTableRow[]
  columns: AdminTableColumn[]
}

export interface AdminReadPage {
  sections: AdminTableSection[]
  nextCursor: string | null
  summary?: Array<{ label: string; value: string }>
}

export interface AdminListQuery {
  query: string
  status: string
  cursor: string | null
  limit: number
}

export interface AdminReadRouteDefinition {
  searchPlaceholder: string
  statusOptions: Array<{ value: string; label: string }>
  paginated: boolean
}

export type AdminRequest = <T>(action: string, input?: AdminRequestInput) => Promise<T>

const labels: Record<string, string> = {
  ACTIVE: '启用', BLOCKED: '已限制', CLOSED: '已关闭', INACTIVE: '停用', REVOKED: '已撤销',
  PLAYER: '玩家', GUEST: '嘉宾', PLATFORM: '平台', BRANCH: '分会', EVENT: '活动',
  DRAFT: '草稿', READY: '待发布', PUBLISHED: '已发布', UNPUBLISHED: '已下架',
  CANCELLED: '已取消', ENDED: '已结束', ARCHIVED: '已归档', WITHDRAWN: '已撤回',
  CREATED: '待支付', PAYMENT_CREATED: '支付处理中', PAID: '已支付', FAILED: '失败',
  REFUND_PENDING: '退款处理中', PARTIALLY_REFUNDED: '部分退款', REFUNDED: '已退款',
  PENDING_REVIEW: '待审核', REJECTED: '已拒绝', FREE: '免费', MEMBER_INCLUDED: '会员权益',
  MEMBER: '会员可见', MEMBER_OR_PAID: '会员或付费', ALL: '全部用户', EXPLICIT: '指定用户',
  MEMBERSHIP: '会员订单', CONTENT: '内容订单', HOT_NEWS: '热点', ARTICLE: '文章', WEB: '网页',
  VIDEO: '视频', PRIVATE_CHANNEL: '私域内容', EXPERT_SHARE: '专家分享',
  PLATFORM_OWNER: '平台负责人', PLATFORM_OPERATIONS: '平台运营', PLATFORM_FINANCE: '平台财务',
  BRANCH_ADMIN: '分会管理员', EVENT_OWNER: '活动负责人', EVENT_MANAGER: '活动管理员', EVENT_STAFF: '活动工作人员',
}

const commonStatus = [{ value: '', label: '全部状态' }]

const routeDefinitions: Record<AdminListRoute, AdminReadRouteDefinition> = {
  users: {
    searchPlaceholder: '搜索姓名、手机号或简介',
    statusOptions: [...commonStatus, ...options(['ACTIVE', 'BLOCKED', 'CLOSED'])],
    paginated: true,
  },
  events: {
    searchPlaceholder: '搜索活动名称、城市或分会',
    statusOptions: [...commonStatus, ...options(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED', 'ARCHIVED'])],
    paginated: true,
  },
  orders: {
    searchPlaceholder: '搜索订单号、姓名或活动',
    statusOptions: [...commonStatus, ...options(['CREATED', 'PAYMENT_CREATED', 'PAID', 'FAILED', 'CLOSED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'])],
    paginated: true,
  },
  permissions: {
    searchPlaceholder: '筛选成员、角色、分会或城市',
    statusOptions: [...commonStatus, ...options(['ACTIVE', 'REVOKED', 'INACTIVE'])],
    paginated: false,
  },
  messages: {
    searchPlaceholder: '搜索消息或公告标题',
    statusOptions: [...commonStatus, ...options(['DRAFT', 'READY', 'PUBLISHED', 'WITHDRAWN'])],
    paginated: false,
  },
  knowledge: {
    searchPlaceholder: '搜索文档标题、作者或分类',
    statusOptions: [...commonStatus, ...options(['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'WITHDRAWN'])],
    paginated: false,
  },
}

export function getAdminReadRouteDefinition(route: AdminListRoute) {
  return routeDefinitions[route]
}

export async function loadAdminReadPage(
  route: AdminListRoute,
  query: AdminListQuery,
  request: AdminRequest,
): Promise<AdminReadPage> {
  switch (route) {
    case 'users': return loadUsers(query, request)
    case 'events': return loadEvents(query, request)
    case 'orders': return loadOrders(query, request)
    case 'permissions': return loadPermissions(query, request)
    case 'messages': return loadMessages(query, request)
    case 'knowledge': return loadKnowledge(query, request)
  }
}

async function loadUsers(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const page = pageValue(await request('mip.admin.users.list', listInput(query)))
  return {
    sections: [{
      rows: page.items.map(item => ({
        detailId: valueOf(item, 'id', 'userId'),
        name: valueOf(item, 'nickname', 'name', 'displayName'),
        headline: valueOf(item, 'headline', 'companyName'),
        identity: label(valueOf(item, 'kind')),
        phone: item.phoneNumber || (item.phoneBound === true ? '已绑定' : '未绑定'),
        branch: valueOf(item, 'branchName', 'cityName'),
        level: valueOf(item, 'levelName'),
        state: label(valueOf(item, 'status', 'membershipStatus')),
      })),
      columns: columns([
        ['name', '姓名'], ['headline', '简介'], ['identity', '身份'], ['phone', '手机状态'],
        ['branch', '所属分会'], ['level', '等级'], ['state', '账号状态'],
      ]),
    }],
    nextCursor: page.nextCursor,
  }
}

async function loadEvents(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const page = pageValue(await request('mip.admin.events.list', listInput(query, {
    sort: { field: 'startsAt', direction: 'DESC' },
  })))
  return {
    sections: [{
      rows: page.items.map(item => ({
        detailId: valueOf(item, 'id', 'eventId'),
        title: valueOf(item, 'title', 'name'),
        time: formatDateTime(item.startsAt),
        location: [item.cityName, item.branchName].filter(Boolean).join(' · ') || '—',
        access: accessLabel(item.accessType, item.priceCents),
        registrations: countLabel(item.registrationCount, item.capacity),
        attended: numberLabel(item.attendedCount),
        state: label(valueOf(item, 'status')),
      })),
      columns: columns([
        ['title', '活动名称'], ['time', '开始时间'], ['location', '城市与分会'],
        ['access', '活动类型'], ['registrations', '报名人数'], ['attended', '签到人数'], ['state', '状态'],
      ]),
    }],
    nextCursor: page.nextCursor,
  }
}

async function loadOrders(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const payload = record(await request('mip.admin.orders.list', listInput(query)))
  const page = pageValue(payload)
  const summary = record(payload.summary)
  return {
    sections: [{
      rows: page.items.map(item => ({
        detailId: valueOf(item, 'id', 'orderId'),
        id: valueOf(item, 'merchantOrderNoMasked', 'id', 'orderId'),
        user: valueOf(item, 'nickname', 'userName'),
        type: label(valueOf(item, 'orderType', 'type')),
        resource: valueOf(item, 'resourceTitle', 'title'),
        amount: money(item.amountCents, item.currency),
        createdAt: formatDateTime(item.createdAt),
        state: label(valueOf(item, 'status')),
      })),
      columns: columns([
        ['id', '订单号'], ['user', '用户'], ['type', '订单类型'], ['resource', '订单内容'],
        ['amount', '金额'], ['createdAt', '创建时间'], ['state', '状态'],
      ]),
    }],
    nextCursor: page.nextCursor,
    summary: [
      { label: '订单数', value: numberLabel(summary.orderCount) },
      { label: '已支付', value: numberLabel(summary.paidOrderCount) },
      { label: '实收金额', value: money(summary.netAmountCents, 'CNY') },
      { label: '已退款', value: money(summary.refundedAmountCents, 'CNY') },
    ],
  }
}

async function loadPermissions(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const [rolePayload, branchPayload] = await Promise.all([
    request('mip.admin.roles.list'),
    request('mip.admin.branches.list'),
  ])
  const roles = filterRows(pageValue(rolePayload).items.map(item => ({
    name: valueOf(item, 'nickname', 'name'),
    role: label(valueOf(item, 'roleKey')),
    scope: valueOf(item, 'scopeName', 'scopeType'),
    grantedAt: formatDateTime(item.grantedAt),
    state: label(valueOf(item, 'status')),
  })), query)
  const branches = filterRows(pageValue(branchPayload).items.map(item => ({
    name: valueOf(item, 'name'),
    city: valueOf(item, 'cityName'),
    players: numberLabel(item.currentPlayerCount),
    admins: arrayLabel(item.branchAdminNames),
    state: label(valueOf(item, 'status')),
  })), query)
  return {
    sections: [
      { title: '运营成员', rows: roles, columns: columns([['name', '姓名'], ['role', '角色'], ['scope', '作用范围'], ['grantedAt', '授权时间'], ['state', '状态']]) },
      { title: '城市分会', rows: branches, columns: columns([['name', '分会'], ['city', '城市'], ['players', '有效会员'], ['admins', '管理员'], ['state', '状态']]) },
    ],
    nextCursor: null,
  }
}

async function loadMessages(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const filter = filterInput(query)
  const campaignPayload = await request('mip.admin.messageCampaigns.list', filter)
  return {
    sections: [{
      rows: pageValue(campaignPayload).items.map(item => ({
        detailId: valueOf(item, 'id', 'campaignId'),
        title: valueOf(item, 'title', 'name'),
        audience: item.audienceType === 'ALL' ? '全部用户' : `${numberLabel(item.recipientCount)} 人`,
        scope: item.branchName || label(valueOf(item, 'scopeType')),
        updatedAt: formatDateTime(item.updatedAt),
        state: label(valueOf(item, 'status')),
      })),
      columns: columns([['title', '消息标题'], ['audience', '发送范围'], ['scope', '作用范围'], ['updatedAt', '更新时间'], ['state', '状态']]),
    }],
    nextCursor: null,
  }
}

async function loadKnowledge(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const payload = pageValue(await request('mip.admin.knowledge.list', {
    section: 'CONTENTS',
    status: query.status,
    limit: query.limit,
  }))
  const rows = filterRows(payload.items.map(item => {
    const category = record(item.category)
    return {
      title: valueOf(item, 'title', 'name'),
      detailId: valueOf(item, 'id', 'contentId'),
      type: label(valueOf(item, 'contentType', 'type')),
      category: valueOf(category, 'name'),
      author: valueOf(item, 'authorName'),
      access: label(valueOf(item, 'accessType')),
      updatedAt: formatDateTime(item.updatedAt),
      state: label(valueOf(item, 'status')),
    }
  }), { ...query, status: '' })
  return {
    sections: [{
      rows,
      columns: columns([['title', '文档标题'], ['type', '内容类型'], ['category', '分类'], ['author', '作者'], ['access', '访问范围'], ['updatedAt', '更新时间'], ['state', '状态']]),
    }],
    nextCursor: payload.nextCursor,
  }
}

function listInput(query: AdminListQuery, extra: AdminRequestInput = {}): AdminRequestInput {
  return {
    filters: { query: query.query, status: query.status },
    cursor: query.cursor || undefined,
    limit: query.limit,
    ...extra,
  }
}

function filterInput(query: AdminListQuery): AdminRequestInput {
  return { query: query.query, status: query.status, limit: query.limit }
}

function pageValue(value: unknown): { items: AdminTableRow[]; nextCursor: string | null } {
  const source = record(value)
  const items = Array.isArray(source.items)
    ? source.items.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as AdminTableRow[]
    : Array.isArray(value)
      ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as AdminTableRow[]
      : []
  return { items, nextCursor: typeof source.nextCursor === 'string' ? source.nextCursor : null }
}

function record(value: unknown): AdminTableRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AdminTableRow : {}
}

function valueOf(row: AdminTableRow, ...keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key]
  return '—'
}

function filterRows(rows: AdminTableRow[], query: Pick<AdminListQuery, 'query' | 'status'>) {
  const keyword = query.query.trim().toLocaleLowerCase('zh-CN')
  const expectedStatus = query.status ? label(query.status) : ''
  return rows.filter((row) => {
    const values = Object.values(row).map(value => String(value))
    return (!keyword || values.some(value => value.toLocaleLowerCase('zh-CN').includes(keyword)))
      && (!expectedStatus || values.includes(expectedStatus))
  })
}

function columns(entries: Array<[string, string]>): AdminTableColumn[] {
  return entries.map(([key, label]) => ({ key, label }))
}

function options(values: string[]) {
  return values.map(value => ({ value, label: label(value) }))
}

function formatDateTime(value: unknown) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

function money(value: unknown, currency: unknown) {
  const cents = Number(value)
  if (!Number.isFinite(cents)) return '—'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: String(currency || 'CNY') }).format(cents / 100)
}

function countLabel(count: unknown, capacity: unknown) {
  const current = numberLabel(count)
  const total = Number(capacity)
  return Number.isInteger(total) && total > 0 ? `${current} / ${total}` : current
}

function numberLabel(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '—'
}

function arrayLabel(value: unknown) {
  return Array.isArray(value) && value.length ? value.join('、') : '—'
}

function accessLabel(accessType: unknown, priceCents: unknown) {
  return accessType === 'PAID' ? money(priceCents, 'CNY') : label(accessType)
}

function label(value: unknown) {
  const key = String(value || '')
  return labels[key] || key || '—'
}
