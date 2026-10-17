import type { AdminRequest } from './admin-read-contracts'
import { userRelatedSections, type AdminDetailRow, type AdminDetailSection } from './admin-details.ts'
import { record, label as codeLabel, formatDateTime as dateTime, auditActionLabel } from './admin-read-formatters.ts'
import { cardHistoryFields } from './admin-profile-cards.ts'
const text = (value: unknown) => value === null || value === undefined ? '—' : String(value)

export type UserRecordTab = 'superCases' | 'cooperationCards' | 'records'
export interface UserRecordQuery { cursor?: string; logCursor?: string }
export interface UserRecordPage { sections: AdminDetailSection[]; nextCursor: string | null; logNextCursor?: string | null }
export async function loadUserProfileRecords(userId: string, tab: UserRecordTab, query: UserRecordQuery, request: AdminRequest): Promise<UserRecordPage> {
  if (tab !== 'records') {
    const value = record(await request('mip.admin.users.get', { userId, includePhone: false, relatedSection: tab, limit: 20, cursor: query.cursor }))
    if (value.id !== userId) throw new Error('关联记录身份不匹配，请重新加载。')
    const related = record(value.relatedRecords)
    if (related.section !== tab || !Array.isArray(related[tab])) throw new Error('关联记录字段不完整，请重新加载。')
    return { sections: userRelatedSections(related), nextCursor: typeof related.nextCursor === 'string' ? related.nextCursor : null }
  }
  const [historyValue, logsValue] = await Promise.all([
    request('mip.admin.cards.history', { cardId: userId, limit: 20, ...(query.cursor ? { cursor: query.cursor } : {}) }),
    request('mip.admin.users.operationLogs.list', { userId, limit: 20, ...(query.logCursor ? { cursor: query.logCursor } : {}) }),
  ])
  const historyPage = record(historyValue)
  const logsPage = record(logsValue)
  if (!Array.isArray(historyPage.items) || !Array.isArray(logsPage.items)) throw new Error('档案记录字段不完整，请重新加载。')
  const historySections = historyPage.items.map(record).map(item => ({ title: `资料版本 ${item.version} · ${dateTime(item.createdAt)}`, fields: cardHistoryFields(record(item.snapshot)) }))
  return {
    sections: [...historySections, userLogSection(logsPage.items.map(record))],
    nextCursor: cursorOf(historyPage),
    logNextCursor: cursorOf(logsPage),
  }
}

export interface UserBadgeSummaryItem { id: string; badgeName: string; equipped: boolean }

/** `mip.admin.badges.awards` 需要 badges.manage 能力，由调用方先做能力判定再启用查询。 */
export async function loadUserBadgeSummary(userId: string, request: AdminRequest): Promise<UserBadgeSummaryItem[]> {
  const page = record(await request('mip.admin.badges.awards', { userId, status: 'ACTIVE', limit: 100 }))
  if (!Array.isArray(page.items)) throw new Error('勋章记录字段不完整，请重新加载。')
  return page.items.map(record).map(item => ({ id: text(item.id), badgeName: text(item.badgeName), equipped: item.equipped === true }))
}

/** 成长信息 Tab 下半区：邀请嘉宾与心动明细的概要（最近记录，无分页）。 */
export async function loadUserProfileGrowthSummaries(userId: string, request: AdminRequest): Promise<{ sections: AdminDetailSection[] }> {
  const [guestsValue, heartsValue] = await Promise.all([
    request('mip.admin.users.invitedGuests.list', { userId, limit: 5 }),
    request('mip.admin.users.likeRelations.list', { userId, limit: 5, direction: 'ALL', status: '' }),
  ])
  const guests = record(guestsValue)
  const hearts = record(heartsValue)
  if (!Array.isArray(guests.items) || !Array.isArray(hearts.items)) throw new Error('成长概要字段不完整，请重新加载。')
  return { sections: [guestSummarySection(guests.items.map(record)), heartSummarySection(hearts.items.map(record))] }
}

function guestSummarySection(items: AdminDetailRow[]): AdminDetailSection {
  return { title: '邀请嘉宾', detailTarget: 'users', rows: items.map(personRow), columns: [{ key: 'nickname', label: '用户' }, { key: 'source', label: '来源' }, { key: 'eventTitle', label: '活动' }, { key: 'state', label: '状态' }, { key: 'createdAt', label: '时间' }] }
}

function heartSummarySection(items: AdminDetailRow[]): AdminDetailSection {
  return { title: '心动明细', detailTarget: 'users', rows: items.map(personRow), columns: [{ key: 'nickname', label: '用户' }, { key: 'source', label: '来源' }, { key: 'eventTitle', label: '活动' }, { key: 'direction', label: '方向' }, { key: 'state', label: '状态' }, { key: 'createdAt', label: '时间' }] }
}

function personRow(item: AdminDetailRow) {
  return {
    id: text(item.id), detailId: typeof item.userId === 'string' ? item.userId : '', nickname: text(item.nickname),
    source: item.source === 'MEMBERSHIP' ? '会员邀请' : '活动邀请',
    eventId: text(item.eventId), eventTitle: text(item.eventTitle), direction: codeLabel(item.direction),
    state: item.source === 'MEMBERSHIP'
      ? (item.kind === 'PLAYER' ? '玩家' : '嘉宾')
      : codeLabel(item.status || item.registrationStatus),
    createdAt: dateTime(item.createdAt),
  }
}

function userLogSection(items: AdminDetailRow[]): AdminDetailSection {
  return { title: '用户操作日志', rows: items.map(item => ({
    id: text(item.id), action: auditActionLabel(item.action), actor: text(item.actorNickname), role: codeLabel(item.effectiveRole),
    source: item.actorType === 'SYSTEM' ? '系统' : item.actorType === 'USER' ? '小程序' : '后台', createdAt: dateTime(item.createdAt),
  })), columns: [{ key: 'action', label: '操作' }, { key: 'actor', label: '操作者' }, { key: 'role', label: '角色' }, { key: 'source', label: '来源' }, { key: 'createdAt', label: '时间' }] }
}

function cursorOf(page: Record<string, unknown>) {
  return typeof page.nextCursor === 'string' ? page.nextCursor : null
}

export function userProfileHref(userId: string) { return `#/users/${encodeURIComponent(userId)}` }
