import type { ReceivedInteractionPage, ReceivedVisitor } from './types'
import { MipOpportunityError } from './error'

/** The visitor service returns flat public profiles, unlike other interaction lists. */
export function parseReceivedVisitors(value: unknown): ReceivedInteractionPage {
  const invalid = () => new MipOpportunityError('INVALID_RESPONSE', '访客服务返回的数据格式不正确，请稍后重试', true)
  if (!value || typeof value !== 'object') {
    throw invalid()
  }
  const page = value as Record<string, unknown>
  if (!Array.isArray(page.items) || !Number.isInteger(page.unreadCount) || Number(page.unreadCount) < 0) {
    throw invalid()
  }
  if (page.totalViewCount !== undefined && (!Number.isInteger(page.totalViewCount) || Number(page.totalViewCount) < 0)) {
    throw invalid()
  }
  if (page.nextCursor !== undefined && typeof page.nextCursor !== 'string') {
    throw invalid()
  }
  const items: ReceivedVisitor[] = page.items.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') {
      throw invalid()
    }
    const row = entry as Record<string, unknown>
    if (typeof row.profileRef !== 'string' || !row.profileRef || typeof row.nickname !== 'string'
      || !Number.isInteger(row.visitCount) || Number(row.visitCount) < 0
      || typeof row.lastVisitedAt !== 'string' || !Number.isFinite(Date.parse(row.lastVisitedAt))
      || typeof row.unread !== 'boolean') {
      throw invalid()
    }
    return {
      kind: 'VISITOR',
      status: 'ACTIVE',
      actor: {
        profileRef: row.profileRef,
        nickname: row.nickname,
        avatarUrl: typeof row.avatarUrl === 'string' ? row.avatarUrl : undefined,
        headline: typeof row.headline === 'string' ? row.headline : undefined,
        userKind: row.userKind === 'PLAYER' ? 'PLAYER' : 'GUEST',
      },
      visitCount: Number(row.visitCount),
      lastVisitedAt: row.lastVisitedAt,
      unread: row.unread,
      updatedAt: row.lastVisitedAt,
    }
  })
  return { category: 'VISITOR', items, unreadCount: Number(page.unreadCount), totalViewCount: page.totalViewCount as number | undefined, nextCursor: page.nextCursor as string | undefined }
}
