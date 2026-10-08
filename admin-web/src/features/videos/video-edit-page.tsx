import { useCallback, useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { useAdminSession } from '../../app/session-provider'
import { buildVideoInput, loadVideos, videoEditorValues } from '../../modules/admin-video-management'
import { IndependentFormPage } from '../form-pages/independent-form-page'
export function VideoEditPage() {
  const { videoId: routeId } = useParams({ strict: false }) as { videoId: string }
  const videoId = routeId === 'new' ? '' : routeId
  const { request } = useAdminSession()
  const key = useMemo(() => `web-video-${crypto.randomUUID()}`, [])
  const load = useCallback(async () => {
    const page = await loadVideos(request, { videoId })
    if (!page.items[0] || page.items[0].id !== videoId) throw new Error('视频不存在或无权查看。')
    return videoEditorValues(page.items[0])
  }, [request, videoId])
  return <IndependentFormPage key={videoId || 'new'} loadDetail={videoId ? load : undefined} config={{
    title: videoId ? '编辑视频回顾' : '新增视频回顾', description: '发布后在「活动」Tab 的往期活动列表展示；用户点击后跳转视频号。填写动态 ID 打开具体视频，仅填视频号 ID 则打开视频号主页。', action: 'mip.admin.videos.save', capability: 'events.recaps.manage', backTarget: '/videos', idempotencyKey: key,
    values: { title: '', coverAssetId: '', finderUserName: '', feedId: '', status: 'DRAFT' }, buildInput: buildVideoInput,
    fields: [{ key: 'title', label: '标题', kind: 'text', required: true, maxLength: 255 }, { key: 'coverAssetId', label: '封面', kind: 'asset', assetPurpose: 'VIDEO_RECAP_COVER', required: true }, { key: 'finderUserName', label: '视频号 ID', kind: 'text', required: true, maxLength: 128 }, { key: 'feedId', label: '视频号动态 ID（选填）', kind: 'text', maxLength: 256 }, { key: 'status', label: '状态', kind: 'select', options: [{ value: 'DRAFT', label: '草稿' }, { value: 'PUBLISHED', label: '发布' }, { value: 'UNPUBLISHED', label: '下架' }] }],
  }} />
}
