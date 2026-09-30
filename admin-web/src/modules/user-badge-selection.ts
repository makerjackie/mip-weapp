import type { AdminRequest } from './admin-read-contracts'
import { record } from './admin-read-formatters.ts'
export interface UserBadgeOption { id: string; name: string; status: string }
export interface UserBadgeAward { id: string; badgeId: string; version: number; equipped: boolean }
export interface UserBadgeSelection { options: UserBadgeOption[]; awards: UserBadgeAward[] }
export async function loadUserBadgeSelection(userId: string, request: AdminRequest): Promise<UserBadgeSelection> {
  const [catalog, received] = await Promise.all([request('mip.admin.badges.list'), loadAllAwards(userId, request)])
  const items = record(catalog).items, awards = record(received).items
  if (!Array.isArray(items) || !Array.isArray(awards)) throw new Error('勋章目录或已获记录不完整，请重试')
  return { options: items.map(raw => { const row = record(raw)
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || !['ACTIVE', 'INACTIVE'].includes(String(row.status))) throw new Error('勋章目录字段不完整')
    return { id: row.id, name: row.name, status: String(row.status) }
  }), awards: awards.map(raw => { const row = record(raw)
    if (row.userId !== userId || typeof row.id !== 'string' || typeof row.badgeId !== 'string' || !Number.isSafeInteger(row.version) || Number(row.version) < 1) throw new Error('用户勋章记录不匹配')
    return { id: row.id, badgeId: row.badgeId, version: Number(row.version), equipped: row.equipped === true }
  }) }
}
export function userBadgeChanges(selection: UserBadgeSelection, selected: readonly string[]) {
  const selectedIds = new Set(selected), awarded = new Set(selection.awards.map(award => award.badgeId))
  const additions = [...selectedIds].filter(id => !awarded.has(id))
  if (additions.some(id => !selection.options.some(option => option.id === id && option.status === 'ACTIVE'))) throw new Error('有勋章已停用，请刷新目录核对')
  const removals = selection.awards.filter(award => !selectedIds.has(award.badgeId))
  if (removals.some(award => award.equipped)) throw new Error('正在佩戴的勋章不能撤销，请先由用户取消佩戴')
  return { additions, removals }
}

async function loadAllAwards(userId: string, request: AdminRequest) {
  const items: unknown[] = [], seen = new Set<string>()
  let cursor: string | null = null
  do {
    const response = record(await request('mip.admin.badges.awards', { userId, status: 'ACTIVE', limit: 100, ...(cursor ? { cursor } : {}) }))
    if (!Array.isArray(response.items)) throw new Error('用户勋章字段不完整')
    items.push(...response.items)
    cursor = typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null
    if (cursor && (seen.has(cursor) || seen.size >= 100)) throw new Error('用户勋章分页异常，请重试')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return { items }
}
