import type { AdminListQuery, AdminTableColumn, AdminTableRow } from './admin-read-contracts.ts'

export const labels: Record<string, string> = {
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
  RESOURCE: '资源', ROLE: '角色', USER: '用户', ORDER: '订单', REFUND: '退款', MESSAGE: '消息', KNOWLEDGE: '知识内容',
  DEFAULT: '默认策略', CUSTOM: '自定义策略',
  COOPERATION_CARD: '合作卡', SUPER_CASE: '超级案例',
  PENDING: '待处理', PASSED: '已通过', ERROR: '处理异常', APPROVED: '已通过',
  EXPERIENCE: '经验值', CONTRIBUTION: '贡献值', COIN: '游戏币',
  LOCAL: '本地撮合', EXTERNAL: '外部撮合', ADMIN: '运营发起',
  CITY: '城市', NATIONAL: '全国', REMOTE: '远程',
  STALLED: '停滞', EXPIRED: '已过期', CLEANUP_PENDING: '待清理',
  PROCESSING: '处理中', MANUAL_REVIEW: '人工复核',
  REVIEWING: '审核中', RESOLVED: '已处理', DISMISSED: '已驳回',
  SPAM: '垃圾信息', HARASSMENT: '骚扰', FRAUD: '欺诈', INAPPROPRIATE_CONTENT: '不当内容', IMPERSONATION: '冒用身份', OTHER: '其他',
  OUTBOX: '消息队列', PAYMENT: '支付', MEDIA: '媒体', DELIVERY: '投递', AI: 'AI',
  EXCEPTION: '运营异常', DELIVERY_REVIEW: '投递复核',
  CIRCLE: '圆形', DIAMOND: '菱形', HEXAGON: '六边形',
  connector: '皮条客', business_builder: '生意佬', capital_operator: '暴发户',
  strategist: '狗策划', visual_designer: '死美工', delivery_lead: '老保姆',
  DOG_PLANNER: '狗策划', COMMENT: '评论', REVIEW: '项目评价',
}

export const capabilityLabels: Record<string, string> = {
  'admin.dashboard': '查看概览',
  'users.read': '查看用户', 'users.phone.read': '查看手机号', 'users.fields.edit': '编辑用户资料',
  'users.access.manage': '管理用户访问', 'memberships.read': '查看会员权益', 'memberships.adjust': '调整会员权益',
  'exports.create': '创建导出', 'events.read': '查看活动', 'events.write': '管理活动',
  'events.roster.read': '查看报名名单', 'events.registrations.manage': '管理报名', 'events.checkin.manage': '管理签到',
  'events.checkin.undo': '撤销签到', 'events.team.manage': '管理活动团队', 'events.album.manage': '管理活动相册',
  'events.feedback.read': '查看活动反馈', 'events.comments.manage': '管理活动评论', 'events.catalog.manage': '管理活动目录',
  'events.recaps.manage': '管理活动回顾', 'announcements.manage': '管理公告', 'messages.manage': '管理消息',
  'messages.delivery.review': '审核消息投递', 'communications.publish': '发布通知', 'branches.manage': '管理城市分会',
  'community.reports.manage': '管理社区举报', 'userContent.moderate': '审核用户内容',
  'opportunities.moderate': '审核机会', 'opportunities.archive': '归档机会', 'growth.read': '查看成长数据',
  'growth.configure': '配置成长规则', 'growth.adjust': '调整成长数据', 'tasks.manage': '管理任务',
  'banners.manage': '管理横幅', 'badges.manage': '管理徽章', 'game.manage': '管理互动玩法',
  'knowledge.manage': '管理知识库', 'orders.read': '查看订单', 'refunds.submit': '提交退款',
  'operations.exceptions.read': '查看运营异常', 'roles.change': '调整运营角色', 'audit.read': '查看审计记录',
}

export function pageValue(value: unknown): { items: AdminTableRow[]; nextCursor: string | null } {
  const source = record(value)
  const items = Array.isArray(source.items)
    ? source.items.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as AdminTableRow[]
    : Array.isArray(value)
      ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as AdminTableRow[]
      : []
  return { items, nextCursor: typeof source.nextCursor === 'string' ? source.nextCursor : null }
}

export function record(value: unknown): AdminTableRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AdminTableRow : {}
}

export function valueOf(row: AdminTableRow, ...keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key]
  return '—'
}

export function filterRows(rows: AdminTableRow[], query: Pick<AdminListQuery, 'query' | 'status'>) {
  const keyword = query.query.trim().toLocaleLowerCase('zh-CN')
  const expectedStatus = query.status ? label(query.status) : ''
  return rows.filter((row) => {
    const values = Object.values(row).map(value => String(value))
    return (!keyword || values.some(value => value.toLocaleLowerCase('zh-CN').includes(keyword)))
      && (!expectedStatus || values.includes(expectedStatus))
  })
}

export function columns(entries: Array<[string, string]>): AdminTableColumn[] {
  return entries.map(([key, label]) => ({ key, label }))
}

export function options(values: string[]) {
  return values.map(value => ({ value, label: label(value) }))
}

export function formatDateTime(value: unknown) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

export function money(value: unknown, currency: unknown) {
  const cents = Number(value)
  if (!Number.isFinite(cents)) return '—'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: String(currency || 'CNY') }).format(cents / 100)
}

export function countLabel(count: unknown, capacity: unknown) {
  const current = numberLabel(count)
  const total = Number(capacity)
  return Number.isInteger(total) && total > 0 ? `${current} / ${total}` : current
}

export function numberLabel(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '—'
}

export function arrayLabel(value: unknown) {
  return Array.isArray(value) && value.length ? value.join('、') : '—'
}

export function arrayCodeLabel(value: unknown) {
  return Array.isArray(value) && value.length ? value.map(label).join('、') : '—'
}

export function nestedNames(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(item => valueOf(record(item), 'name')).filter(item => item !== '—').map(String)
}

export function booleanLabel(value: unknown) {
  return value === true ? '开启' : value === false ? '关闭' : '—'
}

export function dateRange(from: unknown, to: unknown) {
  const start = formatDateTime(from)
  const end = formatDateTime(to)
  if (start === '—' && end === '—') return '长期有效'
  return `${start} – ${end}`
}

export function sourceEventLabel(value: unknown) {
  const code = String(value || '')
  const sourceLabels: Record<string, string> = {
    'event.checked_in': '活动签到',
    'event.registered': '活动报名',
    'profile.completed': '完善资料',
    'opportunity.published': '发布机会',
    'admin.adjusted': '人工调整',
  }
  return sourceLabels[code] || (code ? '其他业务记录' : '—')
}

export function reasonLabel(value: unknown) {
  const code = String(value || '').trim()
  if (!code) return '—'
  const reasonLabels: Record<string, string> = {
    TIMEOUT: '处理超时',
    DELIVERY_FAILED: '投递失败',
    RETRY_EXHAUSTED: '重试已达上限',
    STALE: '长时间未处理',
    REJECTED: '已拒绝',
    EXPIRED: '已过期',
    CLEANUP_PENDING: '等待清理',
  }
  return reasonLabels[code] || (/[㐀-鿿]/u.test(code) ? code : '需人工核查')
}

export function capabilityListLabel(value: unknown) {
  if (!Array.isArray(value)) return '—'
  return value.length ? value.map(item => capabilityLabels[String(item)] || String(item)).join('、') : '无'
}

export function roleLabel(value: unknown) {
  const key = String(value || '')
  return labels[key] || key || '—'
}

export function scopeLabel(value: unknown) {
  return label(value)
}

export function auditActionLabel(value: unknown) {
  const key = String(value || '')
  const parts = key.replace(/^admin\./, '').split('.').filter(Boolean)
  const tokens: Record<string, string> = {
    roles: '角色', rolePolicies: '权限策略', users: '用户', memberships: '会员', branches: '城市分会',
    events: '活动', orders: '订单', refunds: '退款', messages: '消息', knowledge: '知识库', audit: '审计',
    grant: '授权', revoke: '撤销', create: '创建', update: '更新', save: '保存', publish: '发布',
    withdraw: '撤回', archive: '归档', submit: '提交', changeStatus: '更改状态', view: '查看', enter: '进入',
  }
  return parts.length ? parts.map(part => tokens[part] || part).join(' · ') : '—'
}

export function blockersLabel(value: unknown) {
  const blockers = record(value)
  const entries = [
    ['activeMemberships', '会员'],
    ['activeBranchAdmins', '管理员'],
    ['publishedEvents', '活动'],
    ['publishedOpportunities', '机会'],
  ] as const
  const values = entries
    .filter(([key]) => blockers[key] !== undefined && blockers[key] !== null)
    .map(([key, name]) => `${name} ${numberLabel(blockers[key])}`)
  return values.length ? values.join(' · ') : '—'
}

export function accessLabel(accessType: unknown, priceCents: unknown) {
  return accessType === 'PAID' ? money(priceCents, 'CNY') : label(accessType)
}

export function label(value: unknown) {
  const key = String(value || '')
  return labels[key] || key || '—'
}
