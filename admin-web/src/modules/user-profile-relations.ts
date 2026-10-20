import type { AdminRequest } from './admin-read-contracts'
import type { AdminDetailSection } from './admin-details'
import { label, formatUserDateTime, record } from './admin-read-formatters.ts'

export type UserRelationKind = 'invitations' | 'hearts'
export interface UserRelationQuery { q?: string; source?: string; direction?: string; status?: string; eventId?: string; sinceTime?: string; untilTime?: string; cursor?: string }
export async function loadUserRelations(userId: string, kind: UserRelationKind, query: UserRelationQuery, request: AdminRequest): Promise<{ section: AdminDetailSection; nextCursor: string | null }> {
  const input = { userId, limit: 20, ...Object.fromEntries(['cursor', 'eventId', 'sinceTime', 'untilTime'].flatMap(key => query[key as keyof UserRelationQuery] ? [[key, query[key as keyof UserRelationQuery]]] : [])),
    ...(query.q ? { query: query.q } : {}), ...(kind === 'hearts' ? { direction: query.direction || 'ALL', status: query.status || '' } : query.source ? { source: query.source } : {}),
  }
  const page = record(await request(kind === 'hearts' ? 'mip.admin.users.likeRelations.list' : 'mip.admin.users.invitedGuests.list', input))
  if (!Array.isArray(page.items)) throw new Error('关系明细字段不完整，请重新加载。')
  return { nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null, section: {
    title: kind === 'hearts' ? '心动明细' : '邀请嘉宾',
    columns: [{ key: 'nickname', label: '关联用户' }, { key: 'source', label: '来源' }, { key: 'eventTitle', label: '关联活动' }, ...(kind === 'hearts' ? [{ key: 'direction', label: '关系方向' }] : []), { key: 'state', label: '状态' }, { key: 'createdAt', label: '发生时间' }],
    rows: page.items.map(record).map(item => ({
      id: item.id, nickname: item.nickname || '历史对象未保留', source: item.source === 'MEMBERSHIP' ? '会员邀请' : kind === 'hearts' ? '活动心动' : '活动邀请',
      eventTitle: item.eventTitle || '—', direction: label(item.direction),
      state: kind === 'hearts' ? ({ ACTIVE: '有效', CANCELLED: '已撤销', INVALID: '已失效' }[String(item.status)] || label(item.status)) : label(item.registrationStatus || item.kind),
      createdAt: formatUserDateTime(item.createdAt),
      detailLinks: [
        ...(typeof item.userId === 'string' && item.userId ? [{ route: 'users' as const, id: item.userId, label: '用户档案' }] : []),
        ...(item.eventDetailAllowed === true && typeof item.eventId === 'string' ? [{ route: 'events' as const, id: item.eventId, label: '活动详情' }] : []),
      ],
    })),
  } }
}
