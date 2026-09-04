import type { AdminRequestInput } from '../domain/contracts'
import type {
  AdminListQuery,
  AdminListRoute,
  AdminReadPage,
  AdminReadAccess,
  AdminReadRouteDefinition,
  AdminRequest,
} from './admin-read-contracts.ts'
import {
  accessLabel,
  arrayCodeLabel,
  arrayLabel,
  auditActionLabel,
  blockersLabel,
  booleanLabel,
  capabilityListLabel,
  columns,
  countLabel,
  dateRange,
  filterRows,
  formatDateTime,
  label,
  money,
  nestedNames,
  numberLabel,
  options,
  pageValue,
  reasonLabel,
  record,
  roleLabel,
  scopeLabel,
  sourceEventLabel,
  valueOf,
} from './admin-read-formatters.ts'
import {
  loadGrowth,
  loadOperations,
  loadOpportunities,
} from './admin-read-special-pages.ts'
import { loadTaskManagementPage } from './admin-task-management.ts'
import { loadBannerManagementPage } from './admin-banner-management.ts'
import { loadGameManagementPage } from './admin-game-management.ts'
import {
  branchRowActions,
  eventCatalogRowActions,
  eventPolicyRowActions,
  messageTemplateRowActions,
  rolePolicyRowActions,
} from './admin-row-operations.ts'

export type {
  AdminListQuery,
  AdminListRoute,
  AdminReadPage,
  AdminReadRouteDefinition,
  AdminRequest,
  AdminTableColumn,
  AdminTableRow,
  AdminTableSection,
  AdminReadAccess,
} from './admin-read-contracts.ts'

const commonStatus = [{ value: '', label: '全部状态' }]

const routeDefinitions: Record<AdminListRoute, AdminReadRouteDefinition> = {
  users: {
    searchPlaceholder: '搜索姓名、手机号或简介',
    statusOptions: [...commonStatus, ...options(['ACTIVE', 'BLOCKED', 'CLOSED'])],
    paginated: true,
  },
  events: {
    searchPlaceholder: '搜索活动名称、城市或服务器',
    statusOptions: [...commonStatus, ...options(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED', 'ARCHIVED'])],
    paginated: true,
  },
  orders: {
    searchPlaceholder: '搜索订单号、姓名或活动',
    statusOptions: [...commonStatus, ...options(['CREATED', 'PAYMENT_CREATED', 'PAID', 'FAILED', 'CLOSED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'])],
    paginated: true,
  },
  tasks: {
    searchPlaceholder: '搜索任务或完成人',
    statusOptions: [...commonStatus, ...options(['DRAFT', 'PUBLISHED', 'UNPUBLISHED'])],
    paginated: true,
  },
  banners: {
    searchPlaceholder: '搜索名称、图片说明或跳转地址',
    statusOptions: [...commonStatus, ...options(['ACTIVE', 'INACTIVE', 'DELETED'])],
    paginated: false,
  },
  game: {
    searchPlaceholder: '搜索赛季、规则或盲盒目录',
    statusOptions: [...commonStatus, ...options(['DRAFT', 'ACTIVE', 'CLOSED', 'PUBLISHED', 'UNPUBLISHED'])],
    paginated: false,
  },
  permissions: {
    searchPlaceholder: '筛选成员、角色、服务器或城市',
    statusOptions: [...commonStatus, ...options(['ACTIVE', 'REVOKED', 'INACTIVE'])],
    paginated: false,
  },
  messages: {
    searchPlaceholder: '搜索消息或模板',
    statusOptions: [...commonStatus, ...options(['DRAFT', 'READY', 'PUBLISHED', 'WITHDRAWN', 'ACTIVE', 'ARCHIVED'])],
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
  access?: AdminReadAccess,
): Promise<AdminReadPage> {
  switch (route) {
    case 'users': return loadUsers(query, request)
    case 'events': return loadEvents(query, request, access)
    case 'orders': return loadOrders(query, request)
    case 'tasks': return loadTaskManagementPage(query, request)
    case 'banners': return loadBannerManagementPage(query, request)
    case 'game': return loadGameManagementPage(query, request)
    case 'permissions': return loadPermissions(query, request, access)
    case 'messages': return loadMessages(query, request)
    case 'knowledge': return loadKnowledge(query, request)
    case 'opportunities': return loadOpportunities(query, request)
    case 'growth': return loadGrowth(query, request, access)
    case 'operations': return loadOperations(query, request, access)
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
        ['branch', '所属服务器'], ['level', '等级'], ['state', '账号状态'],
      ]),
    }],
    nextCursor: page.nextCursor,
  }
}

async function loadEvents(
  query: AdminListQuery,
  request: AdminRequest,
  access?: AdminReadAccess,
): Promise<AdminReadPage> {
  const canManagePolicy = access?.hasCapability('events.write', 'PLATFORM') === true
  const canManageCatalog = access?.hasCapability('events.catalog.manage', 'PLATFORM') === true
  const [eventPayload, policyPayload, typePayload, tagPayload] = await Promise.all([
    request('mip.admin.events.list', listInput(query, {
      sort: { field: 'startsAt', direction: 'DESC' },
    })),
    canManagePolicy ? request('mip.admin.events.policy.get') : null,
    canManageCatalog ? request('mip.admin.events.catalog.list', {
      kind: 'TYPE', query: query.query, limit: query.limit,
    }) : null,
    canManageCatalog ? request('mip.admin.events.catalog.list', {
      kind: 'TAG', query: query.query, limit: query.limit,
    }) : null,
  ])
  const page = pageValue(eventPayload)
  const policy = record(policyPayload)
  const catalogRows = (payload: unknown) => pageValue(payload).items.map(item => ({
    key: valueOf(item, 'key'),
    name: valueOf(item, 'name'),
    description: valueOf(item, 'description'),
    sort: numberLabel(item.sortOrder),
    usage: numberLabel(item.usageCount),
    updatedAt: formatDateTime(item.updatedAt),
    state: label(valueOf(item, 'status')),
    rowActions: eventCatalogRowActions(item),
  }))
  return {
    sections: [{
      key: 'events',
      title: '活动',
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
        ['title', '活动名称'], ['time', '开始时间'], ['location', '城市与服务器'],
        ['access', '活动类型'], ['registrations', '报名人数'], ['attended', '签到人数'], ['state', '状态'],
      ]),
    }, policyPayload ? {
      key: 'policy',
      title: '活动政策',
      detailTarget: null,
      rows: [{
        cancellation: `${numberLabel(policy.cancellationHoursBeforeStart)} 小时`,
        version: numberLabel(policy.version),
        rowActions: eventPolicyRowActions(policy),
      }],
      columns: columns([['cancellation', '默认取消提前时间'], ['version', '版本']]),
    } : null, typePayload ? {
      key: 'event-types',
      title: '活动类型',
      detailTarget: null,
      rows: catalogRows(typePayload),
      columns: columns([['key', '目录标识'], ['name', '名称'], ['description', '说明'], ['sort', '排序'], ['usage', '使用数'], ['updatedAt', '更新时间'], ['state', '状态']]),
    } : null, tagPayload ? {
      key: 'event-tags',
      title: '活动标签',
      detailTarget: null,
      rows: catalogRows(tagPayload),
      columns: columns([['key', '目录标识'], ['name', '名称'], ['description', '说明'], ['sort', '排序'], ['usage', '使用数'], ['updatedAt', '更新时间'], ['state', '状态']]),
    } : null].filter(isSection),
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

async function loadPermissions(query: AdminListQuery, request: AdminRequest, access?: AdminReadAccess): Promise<AdminReadPage> {
  const [rolePayload, branchPayload, policyPayload, auditPayload] = await Promise.all([
    canRead(access, 'roles.change') ? request('mip.admin.roles.list') : null,
    canRead(access, 'branches.manage', 'PLATFORM') ? request('mip.admin.branches.list') : null,
    canRead(access, 'roles.change', 'PLATFORM') ? request('mip.admin.rolePolicies.list') : null,
    canRead(access, 'audit.read') ? request('mip.admin.audit.list', { limit: query.limit }) : null,
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
    rowActions: branchRowActions(item),
  })), query)
  const policies = pageValue(policyPayload).items.map(item => ({
    role: roleLabel(valueOf(item, 'roleKey')),
    scope: scopeLabel(item.scopeType),
    effective: capabilityListLabel(item.capabilities),
    allowed: capabilityListLabel(item.allowedCapabilities),
    source: label(valueOf(item, 'source')),
    version: numberLabel(item.version),
    updatedAt: formatDateTime(item.updatedAt),
    rowActions: rolePolicyRowActions(item),
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
      rolePayload ? { key: 'members', title: '运营成员', rows: roles, columns: columns([['name', '姓名'], ['role', '角色'], ['scope', '作用范围'], ['grantedAt', '授权时间'], ['state', '状态']]) } : null,
      policyPayload ? { key: 'policies', title: '角色策略摘要', rows: policies, columns: columns([['role', '角色'], ['scope', '作用范围'], ['effective', '当前能力'], ['allowed', '可用能力边界'], ['source', '策略来源'], ['version', '版本'], ['updatedAt', '更新时间']]) } : null,
      branchPayload ? { key: 'branches', title: '服务器', rows: branches, columns: columns([['name', '服务器'], ['city', '城市'], ['summary', '说明'], ['players', '有效会员'], ['admins', '管理员'], ['blockers', '关联数据'], ['state', '状态']]) } : null,
      auditPayload ? { key: 'audit', title: '最近审计记录', rows: audits, columns: columns([['actor', '操作人'], ['action', '操作'], ['resource', '资源'], ['role', '生效角色'], ['scope', '作用范围'], ['createdAt', '时间']]) } : null,
    ].filter(isSection),
    nextCursor: null,
  }
}

function canRead(access: AdminReadAccess | undefined, capability: string, scopeType?: string) {
  return !access || access.hasCapability(capability, scopeType)
}

function isSection<T extends AdminReadPage['sections'][number]>(value: T | null): value is T {
  return value !== null
}

async function loadMessages(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const campaignFilter = {
    query: query.query,
    status: ['DRAFT', 'READY', 'PUBLISHED', 'WITHDRAWN'].includes(query.status) ? query.status : '',
    limit: query.limit,
  }
  const templateFilter = {
    query: query.query,
    status: ['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(query.status) ? query.status : '',
    limit: query.limit,
  }
  const [campaignPayload, templatePayload] = await Promise.all([
    request('mip.admin.messageCampaigns.list', campaignFilter),
    request('mip.admin.messageTemplates.list', templateFilter),
  ])
  return {
    sections: [{
      key: 'campaigns',
      title: '消息活动',
      rows: pageValue(campaignPayload).items.map(item => ({
        detailId: valueOf(item, 'id', 'campaignId'),
        title: valueOf(item, 'title', 'name'),
        audience: item.audienceType === 'ALL' ? '全部用户' : `${numberLabel(item.recipientCount)} 人`,
        scope: item.branchName || label(valueOf(item, 'scopeType')),
        updatedAt: formatDateTime(item.updatedAt),
        state: label(valueOf(item, 'status')),
      })),
      columns: columns([['title', '消息标题'], ['audience', '发送范围'], ['scope', '作用范围'], ['updatedAt', '更新时间'], ['state', '状态']]),
    }, {
      key: 'templates',
      title: '消息模板',
      detailTarget: null,
      rows: pageValue(templatePayload).items.map(item => ({
        name: valueOf(item, 'name'),
        title: valueOf(item, 'title'),
        scope: item.branchName || label(valueOf(item, 'scopeType')),
        safety: label(valueOf(item, 'contentSafetyStatus')),
        updatedAt: formatDateTime(item.updatedAt),
        state: label(valueOf(item, 'status')),
        rowActions: messageTemplateRowActions(item),
      })),
      columns: columns([['name', '模板名称'], ['title', '消息标题'], ['scope', '作用范围'], ['safety', '内容安全'], ['updatedAt', '更新时间'], ['state', '状态']]),
    }],
    nextCursor: null,
  }
}

async function loadKnowledge(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const payload = pageValue(await request('mip.admin.knowledge.list', {
    section: 'CONTENTS',
    status: query.status,
    query: query.query || undefined,
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
