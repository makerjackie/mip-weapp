import type { AdminRequestInput } from '../domain/contracts'

export type AdminListRoute = 'users' | 'events' | 'orders' | 'permissions' | 'messages' | 'knowledge' | 'opportunities' | 'growth' | 'operations'
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

const capabilityLabels: Record<string, string> = {
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
  opportunities: {
    searchPlaceholder: '搜索机会、合作卡、案例或发布人',
    statusOptions: [...commonStatus, ...options(['DRAFT', 'PUBLISHED', 'ENDED', 'UNPUBLISHED', 'ARCHIVED'])],
    paginated: true,
  },
  growth: {
    searchPlaceholder: '搜索等级、规则、用户或徽章',
    statusOptions: [...commonStatus, ...options(['DRAFT', 'ACTIVE', 'INACTIVE', 'REVOKED'])],
    paginated: false,
  },
  operations: {
    searchPlaceholder: '搜索公告、举报、异常或待办',
    statusOptions: [...commonStatus, ...options(['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED', 'FAILED', 'STALLED', 'REJECTED', 'EXPIRED', 'CLEANUP_PENDING', 'PROCESSING', 'MANUAL_REVIEW', 'DRAFT', 'PUBLISHED', 'WITHDRAWN'])],
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
    case 'opportunities': return loadOpportunities(query, request)
    case 'growth': return loadGrowth(query, request)
    case 'operations': return loadOperations(query, request)
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
  const [rolePayload, branchPayload, policyPayload, auditPayload] = await Promise.all([
    request('mip.admin.roles.list'),
    request('mip.admin.branches.list'),
    request('mip.admin.rolePolicies.list'),
    request('mip.admin.audit.list', { limit: query.limit }),
  ])
  const roles = filterRows(pageValue(rolePayload).items.map(item => ({
    detailId: valueOf(item, 'id', 'roleId'),
    name: valueOf(item, 'nickname', 'name'),
    role: roleLabel(valueOf(item, 'roleKey')),
    scope: valueOf(item, 'scopeName') !== '—' ? valueOf(item, 'scopeName') : scopeLabel(item.scopeType),
    grantedAt: formatDateTime(item.grantedAt),
    state: label(valueOf(item, 'status')),
  })), query)
  const branches = filterRows(pageValue(branchPayload).items.map(item => ({
    detailId: valueOf(item, 'id', 'branchId'),
    branchKey: valueOf(item, 'branchKey'),
    name: valueOf(item, 'name'),
    city: valueOf(item, 'cityName'),
    summary: valueOf(item, 'summary'),
    players: numberLabel(item.currentPlayerCount),
    admins: arrayLabel(item.branchAdminNames),
    blockers: blockersLabel(item.blockers),
    state: label(valueOf(item, 'status')),
  })), query)
  const policies = pageValue(policyPayload).items.map(item => ({
    role: roleLabel(valueOf(item, 'roleKey')),
    scope: scopeLabel(item.scopeType),
    effective: capabilityListLabel(item.capabilities),
    allowed: capabilityListLabel(item.allowedCapabilities),
    source: label(valueOf(item, 'source')),
    version: numberLabel(item.version),
    updatedAt: formatDateTime(item.updatedAt),
  }))
  const audits = filterRows(pageValue(auditPayload).items.map(item => ({
    actor: valueOf(item, 'actorNickname') !== '—' ? valueOf(item, 'actorNickname') : '未知运营成员',
    action: auditActionLabel(valueOf(item, 'action')),
    resource: label(valueOf(item, 'resourceType')),
    role: roleLabel(valueOf(item, 'effectiveRole')),
    scope: scopeLabel(item.scopeType),
    createdAt: formatDateTime(item.createdAt),
  })), { ...query, status: '' })
  return {
    sections: [
      { title: '运营成员', rows: roles, columns: columns([['name', '姓名'], ['role', '角色'], ['scope', '作用范围'], ['grantedAt', '授权时间'], ['state', '状态']]) },
      { title: '角色策略摘要', rows: policies, columns: columns([['role', '角色'], ['scope', '作用范围'], ['effective', '当前能力'], ['allowed', '可用能力边界'], ['source', '策略来源'], ['version', '版本'], ['updatedAt', '更新时间']]) },
      { title: '城市分会', rows: branches, columns: columns([['name', '分会'], ['city', '城市'], ['summary', '说明'], ['players', '有效会员'], ['admins', '管理员'], ['blockers', '关联数据'], ['state', '状态']]) },
      { title: '最近审计记录', rows: audits, columns: columns([['actor', '操作人'], ['action', '操作'], ['resource', '资源'], ['role', '生效角色'], ['scope', '作用范围'], ['createdAt', '时间']]) },
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

async function loadOpportunities(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const contentStatus = ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].includes(query.status)
    ? query.status
    : 'ALL'
  const [opportunityPayload, contentPayload, matchingPayload] = await Promise.all([
    request('mip.admin.opportunities.list', {
      cursor: query.cursor || undefined,
      limit: query.limit,
      filters: { query: query.query, status: query.status },
    }),
    request('mip.admin.userContent.list', {
      query: query.query,
      status: contentStatus,
      limit: query.limit,
    }),
    request('mip.admin.matching.get', {}),
  ])
  const opportunityItems = pageValue(opportunityPayload).items
  const opportunityRows = filterRows(opportunityItems.map(item => ({
    detailId: valueOf(item, 'id', 'opportunityId'),
    title: valueOf(item, 'title'),
    owner: valueOf(item, 'ownerNickname'),
    location: [item.cityName, item.branchName].filter(Boolean).join(' · ') || scopeLabel(item.scopeType),
    target: valueOf(item, 'targetSummary'),
    roles: arrayCodeLabel(item.roleKeys),
    referrals: numberLabel(item.referralCount),
    safety: label(valueOf(item, 'contentSafetyStatus')),
    updatedAt: formatDateTime(item.updatedAt),
    state: label(valueOf(item, 'status')),
  })), query)
  const contentRows = filterRows(pageValue(contentPayload).items.map(item => {
    const owner = record(item.owner)
    return {
      title: valueOf(item, 'title'),
      kind: label(valueOf(item, 'kind')),
      owner: valueOf(owner, 'nickname'),
      location: [owner.cityName, owner.branchName].filter(Boolean).join(' · ') || '—',
      summary: valueOf(item, 'summary'),
      safety: label(valueOf(item, 'contentSafetyStatus')),
      updatedAt: formatDateTime(item.updatedAt),
      state: label(valueOf(item, 'status')),
    }
  }), query)
  const matching = record(matchingPayload)
  const settings = record(matching.settings)
  const requests = Array.isArray(matching.requests) ? matching.requests : []
  return {
    sections: [
      { title: '机会', rows: opportunityRows, columns: columns([['title', '标题'], ['owner', '发布人'], ['location', '城市与分会'], ['target', '目标'], ['roles', '合作角色'], ['referrals', '引荐数'], ['safety', '内容安全'], ['updatedAt', '更新时间'], ['state', '状态']]) },
      { title: '用户内容', rows: contentRows, columns: columns([['title', '标题'], ['kind', '内容类型'], ['owner', '发布人'], ['location', '城市与分会'], ['summary', '摘要'], ['safety', '内容安全'], ['updatedAt', '更新时间'], ['state', '状态']]) },
      { title: '撮合设置', rows: settings.scopeKey ? [{
        scope: scopeLabel(settings.scopeType),
        talentScore: numberLabel(settings.talentMinScore),
        projectScore: numberLabel(settings.projectMinScore),
        maximum: numberLabel(settings.maximumCandidates),
        provider: settings.externalProviderEnabled === true ? '允许外部服务' : '仅本地服务',
        updatedAt: formatDateTime(settings.updatedAt),
      }] : [], columns: columns([['scope', '作用范围'], ['talentScore', '人才阈值'], ['projectScore', '项目阈值'], ['maximum', '候选上限'], ['provider', '服务来源'], ['updatedAt', '更新时间']]) },
      { title: '撮合请求', rows: requests.map(item => {
        const source = record(item.sourceOpportunity)
        return { opportunity: valueOf(source, 'title'), initiator: label(valueOf(item, 'requestedByType')), provider: label(valueOf(item, 'provider')), results: numberLabel(item.resultCount), fallback: reasonLabel(item.fallbackReason), createdAt: formatDateTime(item.createdAt) }
      }), columns: columns([['opportunity', '机会'], ['initiator', '发起方'], ['provider', '服务来源'], ['results', '结果数'], ['fallback', '回退原因'], ['createdAt', '创建时间']]) },
    ],
    nextCursor: pageValue(opportunityPayload).nextCursor,
  }
}

async function loadGrowth(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const [levelsPayload, benefitsPayload, rulesPayload, entriesPayload, transitionsPayload, badgesPayload, awardsPayload] = await Promise.all([
    request('mip.admin.growth.levels'),
    request('mip.admin.growth.benefits'),
    request('mip.admin.growth.rules'),
    request('mip.admin.growth.entries', { filters: { query: query.query }, limit: query.limit }),
    request('mip.admin.growth.levelTransitions', { filters: { query: query.query }, limit: query.limit }),
    request('mip.admin.badges.list'),
    request('mip.admin.badges.awards', {
      query: query.query,
      status: ['ACTIVE', 'REVOKED'].includes(query.status) ? query.status : '',
    }),
  ])
  const levels = filterRows(pageValue(levelsPayload).items.map(item => ({
    name: valueOf(item, 'name'), threshold: numberLabel(item.minimumExperience), badge: valueOf(item, 'displayBadge'), benefits: nestedNames(item.benefits).concat(arrayLabel(item.legacyBenefits) === '—' ? [] : [arrayLabel(item.legacyBenefits)]).join('、') || '—', users: numberLabel(item.currentUserCount), share: `${numberLabel(item.currentUserPercentage)}%`, state: label(valueOf(item, 'status')),
  })), query)
  const benefits = filterRows(pageValue(benefitsPayload).items.map(item => ({ name: valueOf(item, 'name'), description: valueOf(item, 'description'), sort: numberLabel(item.sortOrder), state: label(valueOf(item, 'status')) })), query)
  const rules = filterRows(pageValue(rulesPayload).items.map(item => ({ name: valueOf(item, 'name', 'ruleKey'), metric: label(valueOf(item, 'metric')), delta: numberLabel(item.deltaValue), dailyLimit: numberLabel(item.dailyLimitValue), source: sourceEventLabel(item.sourceEventType), scope: scopeLabel(item.scopeType), effective: dateRange(item.effectiveFrom, item.effectiveTo), state: label(valueOf(item, 'status')) })), query)
  const entries = filterRows(pageValue(entriesPayload).items.map(item => ({ user: valueOf(item, 'nickname') === '—' ? '未知用户' : valueOf(item, 'nickname'), metric: label(valueOf(item, 'metric')), delta: numberLabel(item.deltaValue), balance: `${numberLabel(item.balanceBefore)} → ${numberLabel(item.balanceAfter)}`, source: sourceEventLabel(item.sourceEventType), reason: reasonLabel(item.adjustmentReason), createdAt: formatDateTime(item.createdAt) })), { ...query, status: '' })
  const transitions = filterRows(pageValue(transitionsPayload).items.map(item => { const from = record(item.fromLevel); const to = record(item.toLevel); return { user: valueOf(item, 'nickname') === '—' ? '未知用户' : valueOf(item, 'nickname'), direction: `${valueOf(from, 'name')} → ${valueOf(to, 'name')}`, experience: `${numberLabel(item.experienceBefore)} → ${numberLabel(item.experienceAfter)}`, source: sourceEventLabel(item.sourceEventType), createdAt: formatDateTime(item.createdAt) } }), { ...query, status: '' })
  const badges = filterRows(pageValue(badgesPayload).items.map(item => ({ name: valueOf(item, 'name'), description: valueOf(item, 'description'), shape: label(valueOf(item, 'placeholderShape')), updatedAt: formatDateTime(item.updatedAt), state: label(valueOf(item, 'status')) })), query)
  const awards = filterRows(pageValue(awardsPayload).items.map(item => ({ user: valueOf(item, 'nickname') === '—' ? '未知用户' : valueOf(item, 'nickname'), badge: valueOf(item, 'badgeName'), reason: reasonLabel(item.awardReason), awardedAt: formatDateTime(item.awardedAt), equipped: booleanLabel(item.equipped), state: label(valueOf(item, 'status')) })), query)
  return { sections: [
    { title: '等级', rows: levels, columns: columns([['name', '等级'], ['threshold', '最低经验'], ['badge', '展示徽章'], ['benefits', '权益'], ['users', '用户数'], ['share', '用户占比'], ['state', '状态']]) },
    { title: '等级权益', rows: benefits, columns: columns([['name', '权益'], ['description', '说明'], ['sort', '排序'], ['state', '状态']]) },
    { title: '成长规则', rows: rules, columns: columns([['name', '规则'], ['metric', '指标'], ['delta', '增量'], ['dailyLimit', '每日上限'], ['source', '来源事件'], ['scope', '作用范围'], ['effective', '生效区间'], ['state', '状态']]) },
    { title: '成长流水', rows: entries, columns: columns([['user', '用户'], ['metric', '指标'], ['delta', '变动'], ['balance', '余额变化'], ['source', '来源事件'], ['reason', '原因'], ['createdAt', '时间']]) },
    { title: '等级变更', rows: transitions, columns: columns([['user', '用户'], ['direction', '等级变化'], ['experience', '经验变化'], ['source', '来源事件'], ['createdAt', '时间']]) },
    { title: '徽章', rows: badges, columns: columns([['name', '徽章'], ['description', '说明'], ['shape', '图形'], ['updatedAt', '更新时间'], ['state', '状态']]) },
    { title: '徽章获得记录', rows: awards, columns: columns([['user', '用户'], ['badge', '徽章'], ['reason', '原因'], ['awardedAt', '获得时间'], ['equipped', '佩戴'], ['state', '状态']]) },
  ], nextCursor: null }
}

async function loadOperations(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const reportStatuses = ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED']
  const reportRequests = (query.status && reportStatuses.includes(query.status) ? [query.status] : reportStatuses).map(status => request('mip.admin.communityReports.list', { status, limit: query.limit }))
  const [announcementPayload, exceptionsPayload, queuePayload, ...reportPayloads] = await Promise.all([
    request('mip.admin.announcements.list', { status: ['DRAFT', 'PUBLISHED', 'WITHDRAWN'].includes(query.status) ? query.status : '', query: query.query, limit: query.limit }),
    request('mip.admin.exceptions.list', { status: ['FAILED', 'STALLED', 'REJECTED', 'EXPIRED', 'CLEANUP_PENDING'].includes(query.status) ? query.status : '', limit: query.limit }),
    request('mip.admin.operations.queue.list', { state: ['PENDING', 'PROCESSING', 'MANUAL_REVIEW'].includes(query.status) ? query.status : '', limit: query.limit }),
    ...reportRequests,
  ])
  const announcements = filterRows(pageValue(announcementPayload).items.map(item => ({ title: valueOf(item, 'title'), scope: valueOf(item, 'branchName') !== '—' ? valueOf(item, 'branchName') : scopeLabel(item.scopeType), target: item.targetType ? label(item.targetType) : '—', safety: label(valueOf(item, 'contentSafetyStatus')), pinned: booleanLabel(item.isPinned), updatedAt: formatDateTime(item.updatedAt), state: label(valueOf(item, 'status')) })), { ...query, status: '' })
  const exceptions = filterRows(pageValue(exceptionsPayload).items.map(item => { const target = record(item.target); return { title: valueOf(item, 'title'), source: label(valueOf(item, 'source')), summary: valueOf(item, 'summary'), reason: reasonLabel(item.reasonCode), target: target.type ? label(target.type) : '—', occurredAt: formatDateTime(item.occurredAt), state: label(valueOf(item, 'status')) } }), { ...query, status: '' })
  const queue = filterRows(pageValue(queuePayload).items.map(item => ({ title: valueOf(item, 'title'), source: `${label(valueOf(item, 'source'))} · ${label(valueOf(item, 'sourceType'))}`, summary: valueOf(item, 'summary'), reason: reasonLabel(item.reasonCode), occurredAt: formatDateTime(item.occurredAt), state: label(valueOf(item, 'state')) })), { ...query, status: '' })
  const reports = filterRows(reportPayloads.flatMap(payload => pageValue(payload).items).map(item => { const reporter = record(item.reporter); const target = record(item.target); return { category: label(valueOf(item, 'category')), description: valueOf(item, 'description'), reporter: valueOf(reporter, 'nickname'), target: `${valueOf(target, 'nickname')} · ${valueOf(target, 'cityName')}`, updatedAt: formatDateTime(item.updatedAt), state: label(valueOf(item, 'status')) } }), { ...query, status: '' })
  return { sections: [
    { title: '公告', rows: announcements, columns: columns([['title', '标题'], ['scope', '作用范围'], ['target', '关联对象'], ['safety', '内容安全'], ['pinned', '置顶'], ['updatedAt', '更新时间'], ['state', '状态']]) },
    { title: '社区举报', rows: reports, columns: columns([['category', '分类'], ['description', '描述'], ['reporter', '举报人'], ['target', '被举报对象'], ['updatedAt', '更新时间'], ['state', '状态']]) },
    { title: '运营异常', rows: exceptions, columns: columns([['title', '异常'], ['source', '来源'], ['summary', '摘要'], ['reason', '原因'], ['target', '关联对象'], ['occurredAt', '发生时间'], ['state', '状态']]) },
    { title: '运营待办', rows: queue, columns: columns([['title', '待办'], ['source', '来源'], ['summary', '摘要'], ['reason', '原因'], ['occurredAt', '发生时间'], ['state', '状态']]) },
  ], nextCursor: null }
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

function arrayCodeLabel(value: unknown) {
  return Array.isArray(value) && value.length ? value.map(label).join('、') : '—'
}

function nestedNames(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(item => valueOf(record(item), 'name')).filter(item => item !== '—').map(String)
}

function booleanLabel(value: unknown) {
  return value === true ? '开启' : value === false ? '关闭' : '—'
}

function dateRange(from: unknown, to: unknown) {
  const start = formatDateTime(from)
  const end = formatDateTime(to)
  if (start === '—' && end === '—') return '长期有效'
  return `${start} – ${end}`
}

function sourceEventLabel(value: unknown) {
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

function reasonLabel(value: unknown) {
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
  return reasonLabels[code] || (/[\u3400-\u9fff]/u.test(code) ? code : '需人工核查')
}

function capabilityListLabel(value: unknown) {
  if (!Array.isArray(value)) return '—'
  return value.length ? value.map(item => capabilityLabels[String(item)] || String(item)).join('、') : '无'
}

function roleLabel(value: unknown) {
  const key = String(value || '')
  return labels[key] || key || '—'
}

function scopeLabel(value: unknown) {
  return label(value)
}

function auditActionLabel(value: unknown) {
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

function blockersLabel(value: unknown) {
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

function accessLabel(accessType: unknown, priceCents: unknown) {
  return accessType === 'PAID' ? money(priceCents, 'CNY') : label(accessType)
}

function label(value: unknown) {
  const key = String(value || '')
  return labels[key] || key || '—'
}
