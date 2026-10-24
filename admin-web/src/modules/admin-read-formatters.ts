import type { AdminListQuery, AdminTableColumn, AdminTableRow } from './admin-read-contracts.ts'

export const labels: Record<string, string> = {
  ACTIVE: '启用', BLOCKED: '已限制', CLOSED: '已关闭', INACTIVE: '停用', REVOKED: '已撤销',
  PLAYER: '玩家', GUEST: '嘉宾', NORMAL: '普通用户', ANONYMOUS: '匿名访客', PLATFORM: '平台', BRANCH: '服务器', EVENT: '活动', OPPORTUNITY: '机会',
  DRAFT: '草稿', READY: '待发布', PUBLISHED: '已发布', UNPUBLISHED: '已下架',
  CANCELLED: '已取消', ENDED: '已结束', ARCHIVED: '已归档', WITHDRAWN: '已撤回',
  CREATED: '待支付', PAYMENT_CREATED: '支付处理中', PAID: '已支付', FAILED: '失败',
  REFUND_PENDING: '退款处理中', PARTIALLY_REFUNDED: '部分退款', REFUNDED: '已退款',
  PENDING_REVIEW: '待审核', REJECTED: '已拒绝', FREE: '免费', MEMBER_INCLUDED: '会员权益',
  MEMBER: '会员可见', MEMBER_OR_PAID: '会员或付费', ALL: '全部用户', EXPLICIT: '指定用户',
  MEMBERSHIP: '会员订单', CONTENT: '内容订单', HOT_NEWS: '热点', ARTICLE: '文章', WEB: '网页',
  VIDEO: '视频', PRIVATE_CHANNEL: '私域内容', EXPERT_SHARE: '专家分享',
  PLATFORM_OWNER: '平台负责人', PLATFORM_OPERATIONS: '平台运营', PLATFORM_FINANCE: '平台财务',
  BRANCH_ADMIN: '服务器管理员', EVENT_OWNER: '活动负责人', EVENT_MANAGER: '活动管理员', EVENT_STAFF: '活动工作人员',
  RESOURCE: '资源', ROLE: '角色', USER: '用户', BADGE: '勋章', ORDER: '订单', REFUND: '退款', MESSAGE: '消息', KNOWLEDGE: '知识内容',
  ADMIN_SESSION: '管理会话',
  DEFAULT: '默认策略', CUSTOM: '自定义策略',
  COOPERATION_CARD: '合作卡', SUPER_CASE: '超级案例',
  PENDING: '待处理', PASSED: '已通过', ERROR: '处理异常', APPROVED: '已通过',
  EXPERIENCE: '经验值', EXP: '经验值', CONTRIBUTION: '贡献值', COIN: '游戏币', SYSTEM: '系统', AUTO: '自动审核',
  LOCAL: '本地撮合', EXTERNAL: '外部撮合', ADMIN: '运营发起',
  CITY: '城市', NATIONAL: '全国', REMOTE: '远程',
  STALLED: '停滞', EXPIRED: '已过期', CLEANUP_PENDING: '待清理',
  MANUAL: '人工来源', JSON_FEED: '数据源', RSS: '订阅源', BEFORE_ACCESS: '访问前可退款', NON_REFUNDABLE: '不可退款', SUBMIT: '提交审核', APPROVE: '批准', REJECT: '拒绝', PUBLISH: '发布', WITHDRAW: '撤回', HIDE: '隐藏',
  PROCESSING: '处理中', MANUAL_REVIEW: '人工复核',
  REVIEWING: '审核中', RESOLVED: '已处理', DISMISSED: '已驳回',
  SPAM: '垃圾信息', HARASSMENT: '骚扰', FRAUD: '欺诈', INAPPROPRIATE_CONTENT: '不当内容', IMPERSONATION: '冒用身份', OTHER: '其他',
  OUTBOX: '消息队列', PAYMENT: '支付', MEDIA: '媒体', DELIVERY: '投递', AI: 'AI',
  EXCEPTION: '运营异常', DELIVERY_REVIEW: '投递复核',
  CIRCLE: '圆形', DIAMOND: '菱形', HEXAGON: '六边形',
  // 六角色展示名与小程序 cooperationRoles 同口径（客户指定文案，MIW-78 复原两端）。
  connector: '皮条客', business_builder: '生意佬', capital_operator: '暴发户',
  strategist: '狗策划', visual_designer: '死美工', delivery_lead: '老保姆',
  DOG_PLANNER: '策略策划', COMMENT: '评论', REVIEW: '项目评价',
}

export const capabilityLabels: Record<string, string> = {
  'admin.dashboard': '查看概览',
  'users.read': '查看用户', 'users.phone.read': '查看手机号', 'users.fields.edit': '编辑用户资料',
  'users.access.manage': '管理用户访问', 'memberships.read': '查看会员权益', 'memberships.adjust': '调整会员权益',
  'exports.create': '创建导出', 'events.read': '查看活动', 'events.write': '管理活动',
  'events.roster.read': '查看报名名单', 'events.registrations.manage': '管理报名', 'events.checkin.manage': '管理签到',
  'events.checkin.undo': '撤销签到', 'events.team.manage': '管理活动团队',
  'events.feedback.read': '查看活动反馈', 'events.catalog.manage': '管理活动目录', 'industries.manage': '管理行业目录',
  'events.recaps.manage': '管理活动回顾', 'announcements.manage': '管理公告', 'messages.manage': '管理消息',
  'messages.delivery.review': '审核消息投递', 'communications.publish': '发布通知', 'branches.manage': '管理服务器',
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

export function filterRows(rows: AdminTableRow[], query: Pick<AdminListQuery, 'query' | 'status' | 'filters'>) {
  const keyword = query.query.trim().toLocaleLowerCase('zh-CN')
  const expectedStatus = query.status ? label(query.status) : ''
  const extraFilters = query.filters
    ? Object.entries(query.filters).filter(([, v]) => typeof v === 'string' && v.length > 0)
    : []
  return rows.filter((row) => {
    const values = Object.values(row).map(value => String(value))
    return (!keyword || values.some(value => value.toLocaleLowerCase('zh-CN').includes(keyword)))
      && (!expectedStatus || values.includes(expectedStatus))
      && extraFilters.every(([key, expected]) => {
        const rowValue = row[key]
        return rowValue !== undefined && String(rowValue) === expected
      })
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
  if (value === undefined || value === null || value === '') return '—'
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
    'event.checkin_revoked': '撤销签到',
    'event.registered': '活动报名',
    'event.guest_invited': '邀请嘉宾',
    'game.guest_invited': '团队邀请嘉宾',
    'task.completed': '完成任务',
    'referral.confirmed': '引荐机会',
    'opportunity.cooperation.completed': '完成机会合作',
    'profile.completed': '完善资料',
    'opportunity.published': '发布机会',
    'admin.adjusted': '人工调整',
    ADMIN_ADJUSTMENT: '人工发放或调整',
    CONTRIBUTION_REVERSAL: '贡献值冲正',
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
    session: '登录会话', badge: '勋章', cards: '名片', history: '历史', profile_edit: '编辑资料', user_content: '用户内容',
    roles: '角色', rolePolicies: '权限策略', role_capability_policies: '角色权限策略', users: '用户', memberships: '会员', branches: '服务器',
    events: '活动', industries: '行业', status: '状态', change: '变更', orders: '订单', refunds: '退款', messages: '消息', knowledge: '知识库', audit: '审计',
    grant: '授权', revoke: '撤销', create: '创建', update: '更新', save: '保存', publish: '发布',
    withdraw: '撤回', archive: '归档', submit: '提交', changeStatus: '更改状态', view: '查看', enter: '进入',
    list: '列表', get: '详情', detail: '详情', paymentAttempts: '支付记录',
    growth: '成长', contribution: '贡献值', rule: '规则', adjust: '调整', reverse: '冲正', entitlements: '权益',
    opportunities: '机会', referrals: '引荐', tasks: '任务', videos: '视频', banners: 'Banner',
    cooperation_cards: '合作卡', super_cases: '超级案例', profile: '档案', influence: '影响力',
    policy: '政策', catalog: '类型', tags: '标签', replace: '更新', roster: '报名名单',
    all: '全部', phone: '手机号', checkin: '签到', undo: '撤销', draft: '草稿', clone: '复制',
    communications: '活动通知', message_templates: '消息模板', message_campaigns: '消息批次',
    message_delivery_reviews: '投递复核', community_reports: '举报',
    operational_exceptions: '运营异常', operations: '运营', queue: '待办',
    export: '导出', request: '申请', download: '下载', prepare: '准备', reserve: '准备', consume: '完成',
    membership: '会籍', agreement: '协议', plan: '方案', price: '价格',
    approval: '审核', approvals: '审核记录', decide: '决定', timeline: '流水',
    web_login: '网页登录', confirm: '确认', confirm_failed: '确认失败',
    retry: '重试', delete: '删除', end: '结束', unpublish: '下架',
    matching: '撮合', settings: '设置', opportunity_comments: '机会评论',
    opportunity_comment_reports: '机会评论举报', close: '关闭', claim: '认领',
    activate: '启用', deactivate: '停用', login: '登录', logout: '退出',
  }
  return parts.length ? parts.map(part => tokens[part] || part).join(' · ') : '—'
}

/** Translate only known resource codes; unknown codes stay available for diagnosis. */
export function auditResourceLabel(value: unknown) {
  const key = String(value || '')
  const resources: Record<string, string> = {
    CITY_BRANCH: '服务器', ADMIN_ROLE_BINDING: '运营授权', ROLE_CAPABILITY_POLICY: '角色权限策略',
    AUDIT_LOG: '审计记录', OPERATIONAL_EXCEPTION: '运营异常', PAYMENT_ATTEMPT: '支付记录',
    GROWTH: '成长', GROWTH_ENTRY: '成长流水', GROWTH_RULE: '成长规则', GROWTH_LEVEL: '成长等级', GROWTH_BENEFIT: '等级权益', APP_SETTING: '应用设置',
    MEMBERSHIP_PLAN: '会籍方案', MEMBERSHIP_CHAIN: '会籍记录', MEMBERSHIP_ENTITLEMENT: '玩家权益',
    TASK: '任务', TASK_CARD: '任务配置', TASK_COMPLETION: '任务完成记录',
    EVENT_REGISTRATION: '活动报名', EVENT_CHECKIN: '活动签到', EVENT_CATALOG: '活动类型',
    MESSAGE_CAMPAIGN: '消息批次', MESSAGE_TEMPLATE: '消息模板', EXPORT: '数据导出', EXPORT_TICKET: '导出文件',
    INDUSTRY_TAG: '行业', USER_CONTENT: '用户内容',
  }
  if (key.endsWith('_LIST')) {
    const base = key.slice(0, -5)
    return resources[base] || labels[base] ? `${resources[base] || labels[base]}列表` : key
  }
  return resources[key] || labels[key] || key || '—'
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

export function accessLabel(accessType: unknown, priceCents: unknown, memberFree = false) {
  return accessType === 'PAID' ? `${money(priceCents, 'CNY')}${memberFree ? ' · 玩家免费' : ''}` : label(accessType)
}

export function label(value: unknown) {
  const key = String(value || '')
  return labels[key] || key || '—'
}

export function campaignAudienceLabel(campaign: Record<string, unknown>) {
  if (campaign.audienceType === 'ALL') return '全部用户'
  const selected = Array.isArray(campaign.recipientRefs) ? campaign.recipientRefs.length : 0
  if (selected) return `指定 ${selected} 人`
  return Number(campaign.recipientCount) > 0 ? `指定 ${Number(campaign.recipientCount)} 人` : '指定用户'
}

// MIW-124：玩家权益到期分档展示口径。CURRENT 按 expiresAt 细分（30 日内=本月到期、
// 下个自然月=下个月到期、其余=生效中）；FORMER=已到期未续费；NEVER=「—」。
export const playerStatusLabels: Record<string, string> = {
  ACTIVE: '生效中', EXPIRING_THIS_MONTH: '本月到期', NEXT_MONTH: '下个月到期', EXPIRED: '已到期未续费',
}

export function normalizePlayerStatusFilter(value: unknown): string {
  const key = String(value || '')
  // 服务端 CURRENT/FORMER/NEVER 枚举兼容：按新分档映射展示。
  if (key === 'CURRENT') return 'ACTIVE'
  if (key === 'FORMER') return 'EXPIRED'
  return key
}

export function playerStatusFilterLabel(value: unknown): string {
  const key = normalizePlayerStatusFilter(value)
  return playerStatusLabels[key] || (key === 'NEVER' ? '—' : '')
}

export function currentPlayerStatusLabel(expiresAt: unknown, now = Date.now()): string {
  const time = new Date(String(expiresAt || '')).getTime()
  if (!expiresAt || Number.isNaN(time)) return playerStatusLabels.ACTIVE
  if (time - now <= EXPIRING_WINDOW_MS) return playerStatusLabels.EXPIRING_THIS_MONTH
  if (isNextCalendarMonth(time, now)) return playerStatusLabels.NEXT_MONTH
  return playerStatusLabels.ACTIVE
}

export function playerStatusLabel(item: AdminTableRow, now = Date.now()): string {
  if (typeof item.membershipStatus === 'string') return playerStatusLabels[item.membershipStatus] || '—'
  if (item.kind === 'PLAYER') return currentPlayerStatusLabel(item.latestEntitlementEndsAt, now)
  // FORMER：有玩家历史（玩家号、首次成为玩家时间或有效会籍时长）但当前无效；NEVER：从未开通。
  const hasPlayerHistory = (item.firstPlayerAt !== undefined && item.firstPlayerAt !== null && item.firstPlayerAt !== '')
    || (item.playerNumber !== undefined && item.playerNumber !== null)
    || Number(item.totalValidMembershipSeconds) > 0
  return hasPlayerHistory ? playerStatusLabels.EXPIRED : '—'
}

const EXPIRING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function isNextCalendarMonth(time: number, now: number) {
  const expires = new Date(time)
  const anchor = new Date(now)
  anchor.setDate(1)
  anchor.setMonth(anchor.getMonth() + 1)
  return expires.getFullYear() === anchor.getFullYear() && expires.getMonth() === anchor.getMonth()
}

/** Admin users operate on Beijing calendar dates independent of the operator's device timezone. */
export function formatUserDateTime(value: unknown) {
  if (!value) return '—'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replaceAll('/', '-')
}
