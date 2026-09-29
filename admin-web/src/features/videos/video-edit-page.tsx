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
    title: videoId ? '编辑视频回顾' : '新增视频回顾', description: '保存后回读封面、标题和目标；发布后可在首页查看。', action: 'mip.admin.videos.save', capability: 'events.recaps.manage', backTarget: '/videos', idempotencyKey: key,
    values: { title: '', coverAssetId: '', jumpUrl: '', status: 'DRAFT' }, buildInput: buildVideoInput,
    fields: [{ key: 'title', label: '标题', kind: 'text', required: true, maxLength: 255 }, { key: 'coverAssetId', label: '封面', kind: 'asset', assetPurpose: 'VIDEO_RECAP_COVER', required: true }, { key: 'jumpUrl', label: '视频跳转地址', kind: 'url', required: true, maxLength: 512 }, { key: 'status', label: '状态', kind: 'select', options: [{ value: 'DRAFT', label: '草稿' }, { value: 'PUBLISHED', label: '发布' }, { value: 'UNPUBLISHED', label: '下架' }] }],
  }} />
}
