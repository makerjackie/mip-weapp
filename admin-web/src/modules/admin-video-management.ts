import type { AdminRequest } from './admin-read-contracts'
import type { OperationValues } from './admin-operation-ui'
import type { AdminRequestInput } from '../domain/contracts'
import { record } from './admin-read-formatters.ts'
export interface AdminVideo { id: string; title: string; coverAssetId: string; coverUrl: string; jumpUrl: string; status: string; version: number; updatedAt: string }
export function videoFromDto(value: unknown): AdminVideo {
  const item = record(value)
  if (typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.coverAssetId !== 'string' || typeof item.jumpUrl !== 'string' || !Number.isSafeInteger(item.version)) throw new Error('视频字段不完整，请重新加载。')
  return { id: item.id, title: item.title, coverAssetId: item.coverAssetId, coverUrl: typeof item.coverUrl === 'string' ? item.coverUrl : '', jumpUrl: item.jumpUrl, status: String(item.status), version: Number(item.version), updatedAt: String(item.updatedAt || '') }
}
export async function loadVideos(request: AdminRequest, query: { query?: string; status?: string; cursor?: string; videoId?: string }) {
  const page = record(await request('mip.admin.videos.list', { ...query, limit: query.videoId ? 1 : 20 }))
  if (!Array.isArray(page.items)) throw new Error('视频列表字段不完整，请重试。')
  return { items: page.items.map(videoFromDto), nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null }
}
export function videoEditorValues(item: AdminVideo): OperationValues {
  return { videoId: item.id, expectedVersion: item.version, title: item.title, coverAssetId: item.coverAssetId, jumpUrl: item.jumpUrl, status: item.status,
    _canSave: item.status !== 'ARCHIVED', _mediaUrls: { [item.coverAssetId]: item.coverUrl } }
}
export function buildVideoInput(values: OperationValues): { ok: true; input: AdminRequestInput } | { ok: false; errors: Record<string, string> } {
  const title = String(values.title || '').trim(), coverAssetId = String(values.coverAssetId || ''), jumpUrl = String(values.jumpUrl || '').trim(), status = String(values.status || 'DRAFT')
  if (!title || title.length > 255 || !coverAssetId || !['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(status)) return { ok: false as const, errors: { form: '请填写标题、封面和有效状态。' } }
  try { const url = new URL(jumpUrl); if (url.protocol !== 'https:' || url.username || url.password) throw new Error() }
  catch { return { ok: false as const, errors: { jumpUrl: '请输入有效的 HTTPS 视频地址。' } } }
  return { ok: true as const, input: { ...(values.videoId ? { videoId: String(values.videoId), expectedVersion: Number(values.expectedVersion) } : {}), title, coverAssetId, jumpUrl, status } }
}
