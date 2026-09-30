import type { AdminRequest } from './admin-read-contracts'
import { userRelatedSections, type AdminDetailView } from './admin-details'
import { record, label as codeLabel, formatDateTime as dateTime, auditActionLabel } from './admin-read-formatters.ts'
import { cardHistoryFields } from './admin-profile-cards.ts'
const text = (value: unknown) => value === null || value === undefined ? '—' : String(value)

export type UserRecordTab = 'invitations' | 'hearts' | 'logs' | 'history' | 'content'
export interface UserRecordQuery { cursor?: string; direction?: string; status?: string; sinceTime?: string; relatedSection?: string }
export async function loadUserProfileRecords(userId: string, tab: UserRecordTab, query: UserRecordQuery, request: AdminRequest) {
  if (tab === 'content') {
    const value = record(await request('mip.admin.users.get', { userId, includePhone: false, relatedSection: query.relatedSection || 'superCases', limit: 20, cursor: query.cursor }))
    if (value.id !== userId) throw new Error('关联记录身份不匹配，请重新加载。')
    const related = record(value.relatedRecords)
    if (related.section !== (query.relatedSection || 'superCases') || !Array.isArray(related[String(related.section)])) throw new Error('关联记录字段不完整，请重新加载。')
    return { sections: userRelatedSections(related), nextCursor: typeof related.nextCursor === 'string' ? related.nextCursor : null }
  }
  const value = await request(tab === 'invitations' ? 'mip.admin.users.invitedGuests.list'
    : tab === 'hearts' ? 'mip.admin.users.likeRelations.list'
      : tab === 'history' ? 'mip.admin.cards.history' : 'mip.admin.users.operationLogs.list', {
    ...(tab === 'history' ? { cardId: userId } : { userId }), limit: 20, ...query,
  })
  const page = record(value)
  if (!Array.isArray(page.items)) throw new Error('档案记录字段不完整，请重新加载。')
  const items = page.items.map(record)
  const sections: AdminDetailView['sections'] = tab === 'logs' ? [{ title: '用户操作日志', rows: items.map(item => ({
    id: text(item.id), action: auditActionLabel(item.action), actor: text(item.actorNickname), role: codeLabel(item.effectiveRole),
    source: item.actorType === 'SYSTEM' ? '系统' : item.actorType === 'USER' ? '小程序' : '后台', createdAt: dateTime(item.createdAt),
  })), columns: [{ key: 'action', label: '操作' }, { key: 'actor', label: '操作者' }, { key: 'role', label: '角色' }, { key: 'source', label: '来源' }, { key: 'createdAt', label: '时间' }] }]
    : tab === 'history' ? items.map(item => ({ title: `资料版本 ${item.version} · ${dateTime(item.createdAt)}`, fields: cardHistoryFields(record(item.snapshot)) }))
      : [{ title: tab === 'hearts' ? '心动明细' : '邀请嘉宾', detailTarget: 'users', rows: items.map(item => ({
        id: text(item.id), detailId: typeof item.userId === 'string' ? item.userId : '', nickname: text(item.nickname),
        eventId: text(item.eventId), eventTitle: text(item.eventTitle), direction: codeLabel(item.direction),
        state: codeLabel(item.status || item.registrationStatus), createdAt: dateTime(item.createdAt),
      })), columns: [{ key: 'nickname', label: '用户' }, { key: 'eventTitle', label: '活动' }, ...(tab === 'hearts' ? [{ key: 'direction', label: '方向' }] : []), { key: 'state', label: '状态' }, { key: 'createdAt', label: '时间' }] }]
  return { sections, nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null }
}

export function userProfileHref(userId: string) { return `#/users/${encodeURIComponent(userId)}` }
