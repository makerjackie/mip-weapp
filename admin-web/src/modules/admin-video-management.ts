import type { AdminRequest } from './admin-read-contracts'
import type { OperationValues } from './admin-operation-ui'
import type { AdminRequestInput } from '../domain/contracts'
import { record } from './admin-read-formatters.ts'

/** MIW-57 往期活动回顾：跳转目标固定为视频号（finderUserName 必填，feedId 选填跳具体动态）。 */
export const VIDEO_FINDER_USER_NAME_PATTERN = /^sph[A-Za-z0-9]+$/
export const VIDEO_FEED_ID_PATTERN = /^[\w=:+/.-]+$/

export interface AdminVideo { id: string; title: string; coverAssetId: string; coverUrl: string; finderUserName: string; feedId: string | null; status: string; version: number; updatedAt: string }
export function videoFromDto(value: unknown): AdminVideo {
  const item = record(value)
  if (typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.coverAssetId !== 'string' || typeof item.finderUserName !== 'string' || !Number.isSafeInteger(item.version)) throw new Error('视频字段不完整，请重新加载。')
  return { id: item.id, title: item.title, coverAssetId: item.coverAssetId, coverUrl: typeof item.coverUrl === 'string' ? item.coverUrl : '', finderUserName: item.finderUserName, feedId: typeof item.feedId === 'string' && item.feedId ? item.feedId : null, status: String(item.status), version: Number(item.version), updatedAt: String(item.updatedAt || '') }
}
export async function loadVideos(request: AdminRequest, query: { query?: string; status?: string; cursor?: string; videoId?: string }) {
  const page = record(await request('mip.admin.videos.list', { ...query, limit: query.videoId ? 1 : 20 }))
  if (!Array.isArray(page.items)) throw new Error('视频列表字段不完整，请重试。')
  return { items: page.items.map(videoFromDto), nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null }
}
export function videoEditorValues(item: AdminVideo): OperationValues {
  return { videoId: item.id, expectedVersion: item.version, title: item.title, coverAssetId: item.coverAssetId, finderUserName: item.finderUserName, feedId: item.feedId || '', status: item.status,
    _canSave: item.status !== 'ARCHIVED', _mediaUrls: { [item.coverAssetId]: item.coverUrl } }
}
export function buildVideoInput(values: OperationValues): { ok: true; input: AdminRequestInput } | { ok: false; errors: Record<string, string> } {
  const title = String(values.title || '').trim(), coverAssetId = String(values.coverAssetId || ''), finderUserName = String(values.finderUserName || '').trim(), feedId = String(values.feedId || '').trim(), status = String(values.status || 'DRAFT')
  if (!title || title.length > 255 || !coverAssetId || !['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(status)) return { ok: false as const, errors: { form: '请填写标题、封面和有效状态。' } }
  if (finderUserName.length > 128 || !VIDEO_FINDER_USER_NAME_PATTERN.test(finderUserName)) return { ok: false as const, errors: { finderUserName: '请输入以 sph 开头的视频号 ID。' } }
  if (feedId && (feedId.length > 256 || !VIDEO_FEED_ID_PATTERN.test(feedId))) return { ok: false as const, errors: { feedId: '视频号动态 ID 格式无效。' } }
  return { ok: true as const, input: { ...(values.videoId ? { videoId: String(values.videoId), expectedVersion: Number(values.expectedVersion) } : {}), title, coverAssetId, finderUserName, ...(feedId ? { feedId } : {}), status } }
}
