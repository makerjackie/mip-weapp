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
// MIW-57 往期活动回顾跳转视频号：finderUserName 对应 wx.openChannelsActivity/Profile 的
// 视频号 ID；feedId 选填，配置后打开具体视频号动态，否则打开视频号主页。
function videoDraft(input) {
  const title = text(input.title, 255, { required: true, label: '视频标题' })
  const coverAssetId = requiredId(input.coverAssetId, '视频封面')
  const finderUserName = text(input.finderUserName, 128, { required: true, label: '视频号 ID' })
  if (!/^sph[A-Za-z0-9]+$/.test(finderUserName)) throw new AdminError('VALIDATION_FAILED', '请输入以 sph 开头的视频号 ID')
  const feedId = input.feedId === undefined || input.feedId === null || input.feedId === ''
    ? null
    : text(input.feedId, 256, { label: '视频号动态 ID' })
  if (feedId && !/^[\w=:+/.-]+$/.test(feedId)) throw new AdminError('VALIDATION_FAILED', '视频号动态 ID 格式无效')
  return { title, coverAssetId, finderUserName, feedId, status: videoStatus(input.status) }
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
      videoId: input.videoId ? requiredId(String(input.videoId), '视频') : null,
      cursor: decodeCursor(input.cursor, ['updatedAt', 'id']), limit: limit(input.limit, 100),
    })
  }
  async function saveVideo(caller, input = {}) {
    const { context, grant } = await contextFor(caller)
    const draft = videoDraft(input)
    // 内容安全只覆盖可自由编辑的文案；finder/feed ID 受格式白名单约束，不进入文本检查。
    const safety = await contentSafety({ title: draft.title }, caller)
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
      idempotencyKey: stableKey(input.idempotencyKey, '请求', 128),
      authorization: access.mutationAuthorization(grant, CAPABILITIES.EVENTS_RECAPS_MANAGE),
      audit: access.audit(context, grant, { ...PLATFORM, action: 'admin.videos.status.change', resourceType: 'VIDEO', resourceId: videoId, metadata: { status } }),
    })
  }
  return { listVideos, saveVideo, changeVideoStatus }
}
module.exports = { createVideos, videoDraft }
