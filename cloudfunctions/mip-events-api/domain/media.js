'use strict'

const { DomainError } = require('./rules')

// Storage remains private. Only published event references (or the caller's
// own historical event orders) can be exchanged for short-lived image URLs.
async function eventMediaUrls(db, cloud, { appId, userId = null, fileIds }) {
  if (!Array.isArray(fileIds) || fileIds.length < 1 || fileIds.length > 30
    || fileIds.some(value => typeof value !== 'string' || !/^cloud:\/\/[^\s]{1,1016}$/.test(value))) {
    throw new DomainError('VALIDATION_FAILED', '图片请求无效')
  }
  const requested = [...new Set(fileIds)]
  const rows = await db.query(
    `SELECT asset.cloud_file_id
     FROM mip_media_assets asset
     WHERE asset.app_id = ? AND asset.status = 'READY'
       AND asset.cloud_file_id IN (${requested.map(() => '?').join(',')})
       AND (
         EXISTS (
           SELECT 1 FROM mip_events event
           WHERE event.app_id = asset.app_id
             AND (event.status IN ('PUBLISHED','CANCELLED','ENDED') AND event.published_at IS NOT NULL
               OR EXISTS (SELECT 1 FROM mip_orders owned_order
                 WHERE owned_order.app_id = event.app_id AND owned_order.user_id = ?
                   AND owned_order.order_type = 'EVENT' AND owned_order.resource_id = event.id))
             AND (event.cover_asset_id = asset.id
               OR EXISTS (SELECT 1 FROM mip_event_content_media media
                 WHERE media.app_id = event.app_id AND media.event_id = event.id
                   AND media.media_asset_id = asset.id AND media.status = 'ACTIVE')
               OR (asset.purpose = 'EVENT_CONTENT' AND (
                 LOCATE(asset.cloud_file_id, COALESCE(event.description, '')) > 0
                 OR LOCATE(asset.cloud_file_id, COALESCE(event.organizer_introduction, '')) > 0
                 OR LOCATE(asset.cloud_file_id, COALESCE(event.notices, '')) > 0
                 OR LOCATE(asset.object_key, COALESCE(event.description, '')) > 0
                 OR LOCATE(asset.object_key, COALESCE(event.organizer_introduction, '')) > 0
                 OR LOCATE(asset.object_key, COALESCE(event.notices, '')) > 0)))
         ) OR EXISTS (
           SELECT 1 FROM mip_videos video
           WHERE video.app_id = asset.app_id AND video.cover_asset_id = asset.id
             AND video.status = 'PUBLISHED' AND video.title <> ''
             AND video.finder_user_name REGEXP '^sph[A-Za-z0-9]+$'
             AND (video.feed_id IS NULL OR video.feed_id REGEXP '^[A-Za-z0-9_=+/.-]+$')
         )
       )`,
    [appId, ...requested, userId],
  )
  const allowed = new Set(rows.map(row => row.cloud_file_id).filter(value => requested.includes(value)))
  if (!allowed.size) return { urls: {} }
  const result = await cloud.getTempFileURL({ fileList: [...allowed].map(fileID => ({ fileID, maxAge: 600 })) })
  const urls = {}
  for (const item of result?.fileList || []) {
    if (allowed.has(item.fileID) && typeof item.tempFileURL === 'string'
      && /^https:\/\/[^\s/@]+(?:\/|$)/.test(item.tempFileURL)
      && (item.status === undefined || item.status === 0)) {
      urls[item.fileID] = item.tempFileURL
    }
  }
  return { urls }
}

module.exports = { eventMediaUrls }
