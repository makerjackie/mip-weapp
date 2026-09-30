import type { AdminListQuery, AdminReadAccess, AdminReadPage, AdminRequest, AdminTableSection } from './admin-read-contracts.ts'
import type { RecordDetail } from './admin-record-detail'
import { opportunityQueryFilters } from './opportunity-query.ts'
import { growthSections } from './growth-sections.ts'
import type { AdminOperationAction, AdminRequestInput } from '../domain/contracts.ts'
import {
  arrayCodeLabel,
  arrayLabel,
  booleanLabel,
  columns,
  dateRange,
  filterRows,
  formatDateTime,
  label,
  nestedNames,
  numberLabel,
  pageValue,
  reasonLabel,
  record,
  scopeLabel,
  sourceEventLabel,
  valueOf,
} from './admin-read-formatters.ts'
import {
  announcementRowActions,
  communityReportRowActions,
} from './admin-row-operations.ts'

export async function loadOpportunities(query: AdminListQuery, request: AdminRequest, access?: AdminReadAccess): Promise<AdminReadPage> {
  const selected = query.filters?.section || ''
  if (selected && !['opportunities', 'content', 'matching'].includes(selected)) throw new Error('机会分区无效')
  const contentStatus = ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].includes(query.status)
    ? query.status
    : 'ALL'
  // mip.admin.matching.get authorizes opportunities.moderate at PLATFORM scope, so a branch-scoped
  // operator must not issue it: the rejected request would fail the whole page.
  const canReadMatching = canRead(access, 'opportunities.moderate', 'PLATFORM')
  const canReadOpportunities = canRead(access, 'opportunities.moderate')
  const canReadContent = canRead(access, 'userContent.moderate')
  const sectionFailure = (reason: unknown) => ({ items: [], nextCursor: null, loadError: reason instanceof Error ? reason.message : '数据暂不可用，请重试。' })
  const [opportunityPayload, contentPayload, matchingPayload] = await Promise.all([
    canReadOpportunities && (!selected || selected === 'opportunities') ? request('mip.admin.opportunities.list', {
      cursor: query.cursor || undefined,
      limit: query.limit,
      filters: opportunityQueryFilters(query),
    }).catch(sectionFailure) : null,
    canReadContent && (!selected || selected === 'content') ? request('mip.admin.userContent.list', {
      query: query.query,
      status: contentStatus,
      limit: query.limit,
      ...(selected === 'content' && query.cursor ? { cursor: query.cursor } : {}),
      ...(query.filters?.ownerUserId ? { ownerUserId: query.filters.ownerUserId } : {}),
    }).catch(sectionFailure) : null,
    canReadMatching && (!selected || selected === 'matching') ? request('mip.admin.matching.get', {}).catch(() => null) : null,
  ])
  const opportunityItems = pageValue(opportunityPayload).items
  const opportunityRows = opportunityItems.map(item => ({
    detailId: valueOf(item, 'id', 'opportunityId'),
    title: valueOf(item, 'title'),
    owner: valueOf(item, 'ownerNickname'),
    location: String(record(item.commercialTerms).locationDisplay || [item.cityName, item.branchName].filter(Boolean).join(' · ') || scopeLabel(item.scopeType)),
    value: opportunityValueInWan(item.commercialTerms),
    valueSummary: valueOf(item, 'valueSummary'),
    publishedAt: formatDateTime(item.publishedAt),
    target: valueOf(item, 'targetSummary'),
    roles: arrayCodeLabel(item.roleKeys),
    referrals: numberLabel(item.referralCount),
    safety: label(valueOf(item, 'contentSafetyStatus')),
    updatedAt: formatDateTime(item.updatedAt),
    state: label(valueOf(item, 'status')),
  }))
  const contentRows = pageValue(contentPayload).items.map(item => {
    const owner = record(item.owner)
    const kind = String(valueOf(item, 'kind'))
    const contentId = valueOf(item, 'id', 'contentId')
    return {
      detailId: ['COOPERATION_CARD', 'SUPER_CASE'].includes(kind) && contentId !== '—'
        ? `${kind}:${contentId}`
        : undefined,
      title: valueOf(item, 'title'),
      kind: label(valueOf(item, 'kind')),
      owner: valueOf(owner, 'nickname'),
      location: [owner.cityName, owner.branchName].filter(Boolean).join(' · ') || '—',
      summary: valueOf(item, 'summary'),
      safety: label(valueOf(item, 'contentSafetyStatus')),
      updatedAt: formatDateTime(item.updatedAt),
      state: label(valueOf(item, 'status')),
    }
  })
  const matching = record(matchingPayload)
  const settings = record(matching.settings)
  const requests = Array.isArray(matching.requests) ? matching.requests : []

  return {
    sections: [
      ...(canReadOpportunities && (!selected || selected === 'opportunities') ? [{ title: '机会', error: record(opportunityPayload).loadError as string | undefined, rows: opportunityRows, columns: columns([['title', '标题'], ['owner', '发布人'], ['value', '价值（万元）'], ['valueSummary', '价值说明'], ['location', '城市与服务器'], ['publishedAt', '发布时间'], ['target', '目标'], ['roles', '合作角色'], ['referrals', '引荐数'], ['safety', '内容安全'], ['updatedAt', '更新时间'], ['state', '状态']]) }] : []),
      ...(canReadContent && (!selected || selected === 'content') ? [{ title: '用户内容', error: record(contentPayload).loadError as string | undefined, rows: contentRows, columns: columns([['title', '标题'], ['kind', '内容类型'], ['owner', '发布人'], ['location', '城市与服务器'], ['summary', '摘要'], ['safety', '内容安全'], ['updatedAt', '更新时间'], ['state', '状态']]) }] : []),
      ...(!selected || selected === 'matching' ? [{ title: '撮合设置', rows: settings.scopeKey ? [{
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
      }), columns: columns([['opportunity', '机会'], ['initiator', '发起方'], ['provider', '服务来源'], ['results', '结果数'], ['fallback', '回退原因'], ['createdAt', '创建时间']]) }] : []),
    ],
    nextCursor: selected === 'content' ? pageValue(contentPayload).nextCursor : pageValue(opportunityPayload).nextCursor,
  }
}

export async function loadGrowth(query: AdminListQuery, request: AdminRequest, access?: AdminReadAccess): Promise<AdminReadPage> {
  const canReadGrowth = canRead(access, 'growth.read')
  const canReadBadges = canRead(access, 'badges.manage', 'PLATFORM')
  const selected = query.filters?.section || ''
  if (selected && !growthSections.some(section => section.value === selected)) throw new Error('成长分区无效')
  const localQuery = { query: query.query, status: query.status }
  const serverQuery = selected ? { query: '', status: '' } : localQuery
  const filters = { ...query.filters }
  delete filters.section
  const pagedInput = { filters: { ...filters, query: query.query }, limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}) }
  const read = (key: string, allowed: boolean, action: AdminOperationAction, input?: AdminRequestInput) =>
    allowed && (!selected || selected === key) ? request(action, input).catch(reason => ({ items: [], nextCursor: null, loadError: reason instanceof Error ? reason.message : '读取失败，请重试' })) : null
  const [levelsPayload, benefitsPayload, rulesPayload, entriesPayload, transitionsPayload, badgesPayload, awardsPayload, entitlementsPayload, contributionRulesPayload, contributionTxnsPayload] = await Promise.all([
    read('levels', canReadGrowth, 'mip.admin.growth.levels'),
    read('benefits', canReadGrowth, 'mip.admin.growth.benefits'),
    read('rules', canReadGrowth, 'mip.admin.growth.rules'),
    read('entries', canReadGrowth, 'mip.admin.growth.entries', pagedInput),
    read('transitions', canReadGrowth, 'mip.admin.growth.levelTransitions', pagedInput),
    read('badges', canReadBadges, 'mip.admin.badges.list'),
    read('awards', canReadBadges, 'mip.admin.badges.awards', {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      query: query.query,
      status: ['ACTIVE', 'REVOKED'].includes(query.status) ? query.status : '',
    }),
    read('entitlements', canRead(access, 'memberships.read', 'PLATFORM'), 'mip.admin.entitlements.transactions.list', pagedInput),
    read('contributionRules', canRead(access, 'growth.read', 'PLATFORM'), 'mip.admin.contribution.rules.list', { ...pagedInput, filters: { ...pagedInput.filters, status: ['ACTIVE', 'INACTIVE'].includes(query.status) ? query.status : '' } }),
    read('contributionTransactions', canRead(access, 'growth.read', 'PLATFORM'), 'mip.admin.contribution.transactions.list', pagedInput),
  ])
  const levels = filterRows(pageValue(levelsPayload).items.map(item => ({
    name: valueOf(item, 'name'), threshold: numberLabel(item.minimumExperience), badge: valueOf(item, 'displayBadge'), benefits: nestedNames(item.benefits).concat(arrayLabel(item.legacyBenefits) === '—' ? [] : [arrayLabel(item.legacyBenefits)]).join('、') || '—', users: numberLabel(item.currentUserCount), share: `${numberLabel(item.currentUserPercentage)}%`, state: label(valueOf(item, 'status')),
  })), localQuery)
  const benefits = filterRows(pageValue(benefitsPayload).items.map(item => ({ name: valueOf(item, 'name'), description: valueOf(item, 'description'), sort: numberLabel(item.sortOrder), state: label(valueOf(item, 'status')) })), localQuery)
  const rules = filterRows(pageValue(rulesPayload).items.map(item => ({ name: valueOf(item, 'name', 'ruleKey'), metric: label(valueOf(item, 'metric')), delta: numberLabel(item.deltaValue), dailyLimit: numberLabel(item.dailyLimitValue), source: sourceEventLabel(item.sourceEventType), scope: scopeLabel(item.scopeType), effective: dateRange(item.effectiveFrom, item.effectiveTo), state: label(valueOf(item, 'status')) })), localQuery)
  const entries = filterRows(pageValue(entriesPayload).items.map(item => ({ user: valueOf(item, 'nickname') === '—' ? '未知用户' : valueOf(item, 'nickname'), metric: label(valueOf(item, 'metric')), delta: numberLabel(item.deltaValue), balance: `${numberLabel(item.balanceBefore)} → ${numberLabel(item.balanceAfter)}`, source: sourceEventLabel(item.sourceEventType), reason: reasonLabel(item.adjustmentReason), createdAt: formatDateTime(item.createdAt) })), serverQuery)
  const transitions = filterRows(pageValue(transitionsPayload).items.map(item => { const from = record(item.fromLevel); const to = record(item.toLevel); return { user: valueOf(item, 'nickname') === '—' ? '未知用户' : valueOf(item, 'nickname'), direction: `${valueOf(from, 'name')} → ${valueOf(to, 'name')}`, experience: `${numberLabel(item.experienceBefore)} → ${numberLabel(item.experienceAfter)}`, source: sourceEventLabel(item.sourceEventType), createdAt: formatDateTime(item.createdAt) } }), serverQuery)
  const badges = filterRows(pageValue(badgesPayload).items.map(item => ({ name: valueOf(item, 'name'), description: valueOf(item, 'description'), shape: label(valueOf(item, 'placeholderShape')), updatedAt: formatDateTime(item.updatedAt), state: label(valueOf(item, 'status')) })), localQuery)
  const awards = filterRows(pageValue(awardsPayload).items.map(item => ({ user: valueOf(item, 'nickname') === '—' ? '未知用户' : valueOf(item, 'nickname'), badge: valueOf(item, 'badgeName'), reason: reasonLabel(item.awardReason), awardedAt: formatDateTime(item.awardedAt), equipped: booleanLabel(item.equipped), state: label(valueOf(item, 'status')) })), serverQuery)
  const entitlementRows = filterRows(pageValue(entitlementsPayload).items.map(item => ({
    entitlementNo: valueOf(item, 'entitlementNo', 'id'),
    user: valueOf(item, 'nickname') === '—' ? '未知用户' : valueOf(item, 'nickname'),
    type: label(valueOf(item, 'entitlementType')),
    content: valueOf(item, 'entitlementContent'),
    order: valueOf(item, 'relatedOrderNo'),
    grantor: valueOf(item, 'grantor'),
    validity: dateRange(item.startsAt, item.endsAt),
    detailLinks: [
      ...(canRead(access, 'users.read', 'PLATFORM') && typeof item.userId === 'string' ? [{ route: 'users' as const, id: item.userId, label: '用户档案' }] : []),
      ...(canRead(access, 'orders.read', 'PLATFORM') && typeof item.relatedOrderId === 'string' ? [{ route: 'orders' as const, id: item.relatedOrderId, label: '关联订单' }] : []),
    ],
    source: label(valueOf(item, 'source')),
    grantedAt: formatDateTime(item.grantedAt),
  })), serverQuery)
  const contributionRuleRows = filterRows(pageValue(contributionRulesPayload).items.map(item => ({
    behavior: valueOf(item, 'behaviorLabel', 'behavior'),
    rewardExp: numberLabel(item.rewardExp),
    rewardLimit: contributionLimit(item.rewardLimit),
    scope: Array.isArray(item.scopeServers) && item.scopeServers.length === 0 ? '全部服务器' : arrayLabel(item.scopeServerNames) === '—' ? '服务器名称暂不可用' : arrayLabel(item.scopeServerNames),
    effective: dateRange(item.effectiveFrom, item.effectiveTo),
    state: label(valueOf(item, 'status')),
  })), serverQuery)
  const contributionTxnRows = filterRows(pageValue(contributionTxnsPayload).items.map(item => ({
    txnNo: valueOf(item, 'txnNo', 'id'),
    user: valueOf(item, 'nickname') === '—' ? '未知用户' : valueOf(item, 'nickname'),
    behavior: valueOf(item, 'behavior'),
    delta: numberLabel(item.deltaValue),
    createdAt: formatDateTime(item.createdAt),
  })), serverQuery)
  const payloads = [levelsPayload, benefitsPayload, rulesPayload, entriesPayload, transitionsPayload, badgesPayload, awardsPayload, entitlementsPayload, contributionRulesPayload, contributionTxnsPayload]
  const sections = [
    levelsPayload ? { title: '等级', rows: levels, columns: columns([['name', '等级'], ['threshold', '最低经验'], ['badge', '展示徽章'], ['benefits', '权益'], ['users', '用户数'], ['share', '用户占比'], ['state', '状态']]) } : null,
    benefitsPayload ? { title: '等级权益', rows: benefits, columns: columns([['name', '权益'], ['description', '说明'], ['sort', '排序'], ['state', '状态']]) } : null,
    rulesPayload ? { title: '成长规则', rows: rules, columns: columns([['name', '规则'], ['metric', '指标'], ['delta', '增量'], ['dailyLimit', '每日上限'], ['source', '来源事件'], ['scope', '作用范围'], ['effective', '生效区间'], ['state', '状态']]) } : null,
    entriesPayload ? { title: '成长流水', rows: entries, columns: columns([['user', '用户'], ['metric', '指标'], ['delta', '变动'], ['balance', '余额变化'], ['source', '来源事件'], ['reason', '原因'], ['createdAt', '时间']]) } : null,
    transitionsPayload ? { title: '等级变更', rows: transitions, columns: columns([['user', '用户'], ['direction', '等级变化'], ['experience', '经验变化'], ['source', '来源事件'], ['createdAt', '时间']]) } : null,
    badgesPayload ? { title: '徽章', rows: badges, columns: columns([['name', '徽章'], ['description', '说明'], ['shape', '图形'], ['updatedAt', '更新时间'], ['state', '状态']]) } : null,
    awardsPayload ? { title: '徽章获得记录', rows: awards, columns: columns([['user', '用户'], ['badge', '徽章'], ['reason', '原因'], ['awardedAt', '获得时间'], ['equipped', '佩戴'], ['state', '状态']]) } : null,
    entitlementsPayload ? { title: '权益流水', rows: entitlementRows, columns: columns([['entitlementNo', '权益号'], ['user', '用户'], ['type', '类型'], ['content', '权益内容'], ['order', '关联订单'], ['grantor', '发放人'], ['source', '来源'], ['validity', '有效期'], ['grantedAt', '发放时间']]) } : null,
    contributionRulesPayload ? { title: '贡献值规则', rows: contributionRuleRows, columns: columns([['behavior', '行为'], ['rewardExp', '经验奖励'], ['rewardLimit', '上限'], ['scope', '范围'], ['effective', '生效期'], ['state', '状态']]) } : null,
    contributionTxnsPayload ? { title: '贡献值流水', rows: contributionTxnRows, columns: columns([['txnNo', '流水号'], ['user', '用户'], ['behavior', '行为'], ['delta', '变化值'], ['createdAt', '时间']]) } : null,
  ].filter(isSection)
  return { sections: sections.map((section, index) => {
    const visiblePayloads = payloads.filter(value => value !== null)
    const error = record(visiblePayloads[index]).loadError
    return { ...section, ...(typeof error === 'string' ? { error } : {}) }
  }), nextCursor: selected ? pageValue(payloads[growthSections.findIndex(section => section.value === selected)]).nextCursor : null }

}

export async function loadOperations(query: AdminListQuery, request: AdminRequest, access?: AdminReadAccess): Promise<AdminReadPage> {
  const reportStatuses = ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED']
  const canReadReports = canRead(access, 'community.reports.manage', 'PLATFORM')
  const canReadAnnouncements = canRead(access, 'announcements.manage')
  const canReadExceptions = canRead(access, 'operations.exceptions.read', 'PLATFORM')
  const canReadQueue = canReadExceptions || canRead(access, 'messages.delivery.review', 'PLATFORM')
  const reportRequests = canReadReports
    ? (query.status && reportStatuses.includes(query.status) ? [query.status] : reportStatuses).map(status => request('mip.admin.communityReports.list', { status, limit: query.limit }))
    : []
  const [announcementPayload, exceptionsPayload, queuePayload, ...reportPayloads] = await Promise.all([
    canReadAnnouncements ? request('mip.admin.announcements.list', { status: ['DRAFT', 'PUBLISHED', 'WITHDRAWN'].includes(query.status) ? query.status : '', query: query.query, limit: query.limit }) : null,
    canReadExceptions ? request('mip.admin.exceptions.list', { status: ['FAILED', 'STALLED', 'REJECTED', 'EXPIRED', 'CLEANUP_PENDING'].includes(query.status) ? query.status : '', limit: query.limit }) : null,
    canReadQueue ? request('mip.admin.operations.queue.list', { state: ['PENDING', 'PROCESSING', 'MANUAL_REVIEW'].includes(query.status) ? query.status : '', limit: query.limit }) : null,
    ...reportRequests,
  ])
  const announcements = filterRows(pageValue(announcementPayload).items.map(item => ({
    title: valueOf(item, 'title'),
    scope: valueOf(item, 'branchName') !== '—' ? valueOf(item, 'branchName') : scopeLabel(item.scopeType),
    target: item.targetType ? label(item.targetType) : '—',
    safety: label(valueOf(item, 'contentSafetyStatus')),
    pinned: booleanLabel(item.isPinned),
    updatedAt: formatDateTime(item.updatedAt),
    state: label(valueOf(item, 'status')),
    rowActions: announcementRowActions(item),
  })), { ...query, status: '' })
  const exceptions = filterRows(pageValue(exceptionsPayload).items.map(item => { const target = record(item.target); return { title: valueOf(item, 'title'), source: label(valueOf(item, 'source')), summary: valueOf(item, 'summary'), reason: reasonLabel(item.reasonCode), target: target.type ? label(target.type) : '—', occurredAt: formatDateTime(item.occurredAt), state: label(valueOf(item, 'status')) } }), { ...query, status: '' })
  const queue = filterRows(pageValue(queuePayload).items.map(item => ({ title: valueOf(item, 'title'), source: `${label(valueOf(item, 'source'))} · ${label(valueOf(item, 'sourceType'))}`, summary: valueOf(item, 'summary'), reason: reasonLabel(item.reasonCode), occurredAt: formatDateTime(item.occurredAt), state: label(valueOf(item, 'state')) })), { ...query, status: '' })
  const reports = filterRows(reportPayloads.flatMap(payload => pageValue(payload).items).map(item => {
    const reporter = record(item.reporter)
    const target = record(item.target)
    return {
      category: label(valueOf(item, 'category')),
      description: valueOf(item, 'description'),
      reporter: valueOf(reporter, 'nickname'),
      target: `${valueOf(target, 'nickname')} · ${valueOf(target, 'cityName')}`,
      updatedAt: formatDateTime(item.updatedAt),
      state: label(valueOf(item, 'status')),
      rowActions: communityReportRowActions(item),
      rowDetail: communityReportDetail(item),
    }
  }), { ...query, status: '' })
  return { sections: [
    announcementPayload ? { key: 'announcements', title: '公告', rows: announcements, columns: columns([['title', '标题'], ['scope', '作用范围'], ['target', '关联对象'], ['safety', '内容安全'], ['pinned', '置顶'], ['updatedAt', '更新时间'], ['state', '状态']]) } : null,
    canReadReports ? { key: 'reports', title: '社区举报', rows: reports, columns: columns([['category', '分类'], ['description', '描述'], ['reporter', '举报人'], ['target', '被举报对象'], ['updatedAt', '更新时间'], ['state', '状态']]) } : null,
    exceptionsPayload ? { key: 'exceptions', title: '运营异常', rows: exceptions, columns: columns([['title', '异常'], ['source', '来源'], ['summary', '摘要'], ['reason', '原因'], ['target', '关联对象'], ['occurredAt', '发生时间'], ['state', '状态']]) } : null,
    queuePayload ? { key: 'queue', title: '运营待办', rows: queue, columns: columns([['title', '待办'], ['source', '来源'], ['summary', '摘要'], ['reason', '原因'], ['occurredAt', '发生时间'], ['state', '状态']]) } : null,
  ].filter(isSection), nextCursor: null }
}

function communityReportDetail(item: Record<string, unknown>): RecordDetail {
  const reporter = record(item.reporter)
  const target = record(item.target)
  const party = (value: Record<string, unknown>) => [valueOf(value, 'nickname'), valueOf(value, 'headline'), valueOf(value, 'cityName')]
    .filter(part => part !== '—').join(' · ') || '—'
  return {
    title: `举报详情 · ${label(valueOf(item, 'category'))}`,
    entries: [
      { label: '分类', value: label(valueOf(item, 'category')) },
      { label: '描述', value: String(valueOf(item, 'description') ?? '') || '—' },
      { label: '举报人', value: party(reporter) },
      { label: '被举报对象', value: party(target) },
      { label: '状态', value: label(valueOf(item, 'status')) },
      { label: '创建时间', value: formatDateTime(item.createdAt) },
      { label: '更新时间', value: formatDateTime(item.updatedAt) },
      { label: '处理时间', value: item.reviewedAt ? formatDateTime(item.reviewedAt) : '—' },
      { label: '处理说明', value: String(valueOf(item, 'resolutionReason') ?? '') || '—' },
    ],
  }
}

function canRead(access: AdminReadAccess | undefined, capability: string, scopeType?: string) {
  return !access || access.hasCapability(capability, scopeType)
}
function opportunityValueInWan(value: unknown) {
  const terms = record(value)
  const min = terms.minAmountCents, max = terms.maxAmountCents
  const display = (amount: unknown) => Number.isSafeInteger(amount) ? (Number(amount) / 1000000).toLocaleString('zh-CN', { maximumFractionDigits: 6 }) : '不限'
  return min === null || min === undefined ? max === null || max === undefined ? '—' : `≤ ${display(max)}`
    : max === null || max === undefined ? `≥ ${display(min)}` : min === max ? display(min) : `${display(min)} ～ ${display(max)}`
}

function isSection<T extends AdminTableSection>(value: T | null): value is T {
  return value !== null
}

function contributionLimit(value: unknown) {
  const limit = record(value)
  if (!['PER_EVENT', 'PER_DAY'].includes(String(limit.kind)) || !Number.isSafeInteger(limit.value) || Number(limit.value) < 1) return '—'
  return `${limit.kind === 'PER_EVENT' ? '每次' : '每日'}最多 ${Number(limit.value)}`
}
