import type { AdminListQuery, AdminReadPage, AdminRequest } from './admin-read-contracts.ts'
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

export async function loadOpportunities(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
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

export async function loadGrowth(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
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

export async function loadOperations(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
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
