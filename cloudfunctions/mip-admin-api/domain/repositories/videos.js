'use strict'
const { randomUUID } = require('node:crypto')
const { claimOptional, complete } = require('../idempotency')
const { cursorPredicateFor, pageRows } = require('../pagination')
const { lockMutationAuthorization, assertMutationScope } = require('../mutation-authorization')
const { AdminError } = require('../validation')
const PLATFORM = { scopeType: 'PLATFORM', scopeId: null }
const iso = value => value ? new Date(value).toISOString() : null
function videoDto(row) {
  return { videoId: String(row.video_id), id: String(row.video_id), coverAssetId: row.cover_asset_id,
    coverUrl: row.cover_url || '', jumpUrl: row.jump_url, title: row.title, status: row.status,
    version: Number(row.version), contentSafetyStatus: row.content_safety_status,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}
function createVideoRepository(database, options = {}) {
  const lockMutation = options.lockMutationAuthorization || lockMutationAuthorization
  const assertScope = options.assertMutationScope || assertMutationScope
  const writeAudit = options.writeAudit
  async function listVideos(appId, input) {
    const clauses = ['v.app_id = ?']; const params = [appId]
    if (input.status) { clauses.push('v.status = ?'); params.push(input.status) }
    if (input.query) { clauses.push("v.title LIKE ? ESCAPE '='"); params.push(`%${input.query.replace(/[=%_]/g, x => `=${x}`)}%`) }
    const cursor = cursorPredicateFor('v.updated_at', input.cursor, 'updatedAt', 'v.video_id')
    const rows = await database.query(
      `SELECT v.*, a.cloud_file_id AS cover_url FROM mip_videos v LEFT JOIN mip_media_assets a ON a.app_id = v.app_id AND a.id = v.cover_asset_id AND a.status = 'READY'
       WHERE ${clauses.join(' AND ')} ${cursor.sql} ORDER BY v.updated_at DESC, v.video_id DESC LIMIT ?`,
      [...params, ...cursor.params, input.limit + 1])
    return pageRows(rows.map(videoDto), input.limit, row => ({ updatedAt: row.updatedAt, id: row.videoId }))
  }
  async function requireCover(tx, appId, coverAssetId) {
    const asset = await tx.one("SELECT id FROM mip_media_assets WHERE app_id = ? AND id = ? AND status = 'READY' FOR UPDATE", [appId, coverAssetId])
    if (!asset) throw new AdminError('VALIDATION_FAILED', '请上传有效的视频封面')
  }
  async function saveVideo(input) {
    return database.transaction(async tx => {
      const authorization = await lockMutation(tx, input); assertScope(authorization, PLATFORM)
      const claim = await claimOptional(tx, input, 'admin.videos.save', { videoId: input.videoId, expectedVersion: input.expectedVersion, draft: input.draft }, randomUUID)
      if (claim.replay) return claim.replay
      const existing = input.videoId ? await tx.one('SELECT * FROM mip_videos WHERE app_id = ? AND video_id = ? FOR UPDATE', [input.appId, input.videoId]) : null
      if (input.videoId && !existing) throw new AdminError('NOT_FOUND', '视频不存在')
      if (existing && Number(existing.version) !== input.expectedVersion) throw new AdminError('CONFLICT', '视频已变化，请刷新')
      if (existing?.status === 'ARCHIVED') throw new AdminError('INVALID_STATE', '已归档视频不能编辑')
      await requireCover(tx, input.appId, input.draft.coverAssetId)
      const d = input.draft
      let videoId = input.videoId
      if (existing) {
        await tx.query(`UPDATE mip_videos SET title = ?, cover_asset_id = ?, jump_url = ?, status = ?, content_safety_status = ?, version = version + 1 WHERE app_id = ? AND video_id = ? AND version = ?`,
          [d.title, d.coverAssetId, d.jumpUrl, d.status, input.contentSafetyStatus, input.appId, videoId, input.expectedVersion])
      }
      else {
        const result = await tx.query(`INSERT INTO mip_videos (app_id, title, cover_asset_id, jump_url, status, content_safety_status) VALUES (?, ?, ?, ?, ?, ?)`,
          [input.appId, d.title, d.coverAssetId, d.jumpUrl, d.status, input.contentSafetyStatus])
        videoId = String(result.insertId)
      }
      const result = { videoId, id: videoId, status: d.status, version: existing ? input.expectedVersion + 1 : 1 }
      await writeAudit(tx, input.audit(videoId))
      await complete(tx, input, 'admin.videos.save', claim.requestHash, result)
      return result
    })
  }
  async function changeVideoStatus(input) {
    return database.transaction(async tx => {
      const authorization = await lockMutation(tx, input); assertScope(authorization, PLATFORM)
      const row = await tx.one('SELECT * FROM mip_videos WHERE app_id = ? AND video_id = ? FOR UPDATE', [input.appId, input.videoId])
      if (!row) throw new AdminError('NOT_FOUND', '视频不存在')
      if (Number(row.version) !== input.expectedVersion) throw new AdminError('CONFLICT', '视频已变化，请刷新')
      if (row.status === 'ARCHIVED') throw new AdminError('INVALID_STATE', '已归档视频不能变更')
      if (input.status === 'PUBLISHED') {
        require('../videos').videoDraft({ title: row.title, coverAssetId: row.cover_asset_id, jumpUrl: row.jump_url })
        await requireCover(tx, input.appId, row.cover_asset_id)
        if (row.content_safety_status !== 'APPROVED') throw new AdminError('CONTENT_SAFETY_REQUIRED', '内容安全检查未通过，暂不能发布')
      }
      await tx.query('UPDATE mip_videos SET status = ?, version = version + 1 WHERE app_id = ? AND video_id = ? AND version = ?', [input.status, input.appId, input.videoId, input.expectedVersion])
      await writeAudit(tx, input.audit)
      return { videoId: input.videoId, id: input.videoId, status: input.status, version: input.expectedVersion + 1 }
    })
  }
  return { listVideos, saveVideo, changeVideoStatus }
}
module.exports = { createVideoRepository }
