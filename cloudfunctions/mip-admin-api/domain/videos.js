'use strict'
const { CAPABILITIES, authorize } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const { AdminError, expectedVersion, limit, requiredId, stableKey, text } = require('./validation')
const PLATFORM = { scopeType: 'PLATFORM', scopeId: null }

function videoStatus(value, fallback = 'DRAFT') {
  const status = ({ ACTIVE: 'PUBLISHED', INACTIVE: 'UNPUBLISHED' })[value] || value || fallback
  if (!['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].includes(status)) throw new AdminError('VALIDATION_FAILED', '视频状态无效')
  return status
}
function videoDraft(input) {
  const title = text(input.title, 255, { required: true, label: '视频标题' })
  const coverAssetId = requiredId(input.coverAssetId, '视频封面')
  const jumpUrl = text(input.jumpUrl, 512, { required: true, label: '视频跳转地址' })
  try {
    const url = new URL(jumpUrl)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error()
  }
  catch { throw new AdminError('VALIDATION_FAILED', '请输入有效的视频跳转地址') }
  return { title, coverAssetId, jumpUrl, status: videoStatus(input.status) }
}
function createVideos({ repository, access, contentSafety = async () => 'ERROR' }) {
  async function contextFor(caller) {
    const context = await access.session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.EVENTS_RECAPS_MANAGE, PLATFORM)
    return { context, grant }
  }
  async function listVideos(caller, input = {}) {
    const { context } = await contextFor(caller)
    return repository.listVideos(context.caller.appId, {
      status: input.status ? videoStatus(input.status) : '', query: text(input.query, 80),
      cursor: decodeCursor(input.cursor, ['updatedAt', 'id']), limit: limit(input.limit, 100),
    })
  }
  async function saveVideo(caller, input = {}) {
    const { context, grant } = await contextFor(caller)
    const draft = videoDraft(input)
    const safety = await contentSafety({ title: draft.title, jumpUrl: draft.jumpUrl }, caller)
    const contentSafetyStatus = ['PASSED', 'APPROVED'].includes(safety) ? 'APPROVED' : safety === 'REJECTED' ? 'REJECTED' : 'ERROR'
    if (draft.status === 'PUBLISHED' && contentSafetyStatus !== 'APPROVED') throw new AdminError('CONTENT_SAFETY_REQUIRED', '内容安全检查未通过，暂不能发布')
    return repository.saveVideo({ appId: context.caller.appId, actorUserId: context.caller.userId,
      videoId: input.videoId ? requiredId(String(input.videoId), '视频') : null,
      expectedVersion: input.videoId ? expectedVersion(input.expectedVersion) : 0,
      idempotencyKey: stableKey(input.idempotencyKey, '请求', 128), draft, contentSafetyStatus,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_RECAPS_MANAGE),
      audit: videoId => access.audit(context, grant, { ...PLATFORM, action: input.videoId ? 'admin.videos.update' : 'admin.videos.create', resourceType: 'VIDEO', resourceId: String(videoId), metadata: { status: draft.status } }),
    })
  }
  async function changeVideoStatus(caller, input = {}) {
    const { context, grant } = await contextFor(caller)
    const videoId = requiredId(String(input.videoId || ''), '视频')
    const status = videoStatus(input.status, '')
    return repository.changeVideoStatus({ appId: context.caller.appId, actorUserId: context.caller.userId, videoId,
      expectedVersion: expectedVersion(input.expectedVersion), status,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_RECAPS_MANAGE),
      audit: access.audit(context, grant, { ...PLATFORM, action: 'admin.videos.status.change', resourceType: 'VIDEO', resourceId: videoId, metadata: { status } }),
    })
  }
  return { listVideos, saveVideo, changeVideoStatus }
}
module.exports = { createVideos, videoDraft }
