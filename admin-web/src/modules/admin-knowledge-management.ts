import type { AdminListQuery, AdminReadPage, AdminRequest } from './admin-read-contracts.ts'
import { columns, formatDateTime, label, numberLabel, pageValue, record, valueOf } from './admin-read-formatters.ts'

export async function loadKnowledge(query: AdminListQuery, request: AdminRequest): Promise<AdminReadPage> {
  const section = query.filters?.section || 'contents'
  const names: Record<string, string> = { contents: '知识内容', sources: '信息来源', categories: '分类', schedules: '采集计划', runs: '采集记录', comments: '评论', reports: '举报' }
  if (!names[section]) throw new Error('知识分区无效')
  const statuses: Record<string, string[]> = { sources: ['ACTIVE', 'INACTIVE'], categories: ['ACTIVE', 'INACTIVE'], contents: ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'WITHDRAWN'], schedules: ['ACTIVE', 'PAUSED'], comments: ['PENDING', 'PUBLISHED', 'HIDDEN'], reports: ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'] }
  const input = { section: section.toUpperCase(), cursor: query.cursor, status: (statuses[section] || []).includes(query.status) ? query.status : '', query: query.query || undefined, limit: query.limit, ...(['comments', 'reports'].includes(section) && query.filters?.contentId ? { contentId: query.filters.contentId } : {}) }
  const payload = pageValue(await request(section === 'schedules' ? 'mip.admin.knowledge.schedules.list' : 'mip.admin.knowledge.list', section === 'schedules' ? { status: input.status, query: input.query, cursor: query.cursor, limit: query.limit } : input))
  const rows = payload.items.map(item => {
    if (typeof item.id !== 'string' || !item.id) throw new Error('知识记录缺少对象标识')
    const id = item.id
    const version = Number(item.version)
    if (section !== 'runs' && (!Number.isSafeInteger(version) || version < 1)) throw new Error('知识记录缺少有效版本，请刷新后重试')
    if (section === 'sources') return { name: valueOf(item, 'name'), type: label(item.sourceType), url: valueOf(item, 'endpointUrl'), time: formatDateTime(item.lastFetchedAt), state: label(item.status), rowActions: [{ action: 'mip.admin.knowledge.sources.save' as const, label: '编辑', targetId: id, expectedVersion: version, values: { ...item, sourceId: id } }] }
    if (section === 'categories') return { name: valueOf(item, 'name'), summary: valueOf(item, 'summary'), sort: numberLabel(item.sortOrder), count: numberLabel(item.contentCount), state: label(item.status), rowActions: [{ action: 'mip.admin.knowledge.categories.save' as const, label: '编辑', targetId: id, expectedVersion: version, values: { ...item, categoryId: id } }] }
    if (section === 'schedules') return { source: valueOf(record(item.source), 'name'), category: valueOf(record(item.category), 'name'), time: `${item.dailyTime} (${item.timeZone})`, next: formatDateTime(item.nextRunAt), state: label(item.status), rowActions: [{ action: 'mip.admin.knowledge.schedules.save' as const, label: '编辑', targetId: id, expectedVersion: version, values: { ...item, sourceId: record(item.source).id, categoryId: record(item.category).id, scheduleId: id } }] }
    if (section === 'runs') return { source: valueOf(item, 'sourceName'), counts: `抓取 ${numberLabel(item.fetchedCount)} / 入库 ${numberLabel(item.createdCount)} / 重复 ${numberLabel(item.duplicateCount)} / 拒绝 ${numberLabel(item.rejectedCount)}`, time: formatDateTime(item.startedAt), state: label(item.status), error: valueOf(item, 'lastErrorCode') }
    if (section === 'comments' || section === 'reports') return { title: valueOf(item, 'contentTitle'), user: valueOf(item, section === 'comments' ? 'authorNickname' : 'reporterNickname'), body: valueOf(item, section === 'comments' ? 'body' : 'description'), time: formatDateTime(item.createdAt), state: label(item.status), rowActions: section === 'comments' && ['PENDING', 'PUBLISHED', 'HIDDEN'].includes(String(item.status)) ? [{ action: 'mip.admin.knowledge.comments.moderate' as const, label: '处置评论', targetId: id, expectedVersion: version, values: { commentId: id } }] : section === 'reports' && ['PENDING', 'REVIEWING'].includes(String(item.status)) ? [{ action: 'mip.admin.knowledge.reports.close' as const, label: '结案', targetId: id, expectedVersion: version, values: { reportId: id } }] : [] }
    const product = record(item.product)
    return { title: valueOf(item, 'title', 'name'), detailId: id, type: label(valueOf(item, 'contentType', 'type')), category: valueOf(record(item.category), 'name'), author: valueOf(item, 'authorName'), access: label(valueOf(item, 'accessType')), updatedAt: formatDateTime(item.updatedAt), state: label(valueOf(item, 'status')), rowActions: item.accessType === 'MEMBER_OR_PAID' ? [{ action: 'mip.admin.knowledge.products.save' as const, label: '解锁商品', targetId: typeof product.id === 'string' ? product.id : undefined, expectedVersion: Number(product.version) || undefined, values: { ...product, contentId: id, productId: product.id || '', name: product.name || '单内容解锁', priceCents: product.priceCents ?? '', refundPolicy: product.refundPolicy || 'BEFORE_ACCESS', refundWindowHours: product.refundWindowHours ?? 24, status: product.status || 'DRAFT' } }] : [] }
  })
  const fields: Record<string, Array<[string, string]>> = {
    contents: [['title', '文档标题'], ['type', '内容类型'], ['category', '分类'], ['author', '作者'], ['access', '访问范围'], ['updatedAt', '更新时间'], ['state', '状态']],
    sources: [['name', '名称'], ['type', '类型'], ['url', '来源地址'], ['time', '上次采集'], ['state', '状态']],
    categories: [['name', '分类'], ['summary', '说明'], ['sort', '排序'], ['count', '内容数量'], ['state', '状态']],
    schedules: [['source', '来源'], ['category', '分类'], ['time', '每日时间'], ['next', '下次执行'], ['state', '状态']],
    runs: [['source', '来源'], ['counts', '采集结果'], ['time', '开始时间'], ['state', '状态'], ['error', '错误']],
    comments: [['title', '业务内容'], ['user', '评论人'], ['body', '评论'], ['time', '时间'], ['state', '状态']],
    reports: [['title', '业务内容'], ['user', '举报人'], ['body', '举报说明'], ['time', '时间'], ['state', '状态']],
  }
  return { sections: [{ key: section, title: names[section], detailTarget: section === 'contents' ? 'knowledge' : null, rows, columns: columns(fields[section]) }], nextCursor: payload.nextCursor }
}
