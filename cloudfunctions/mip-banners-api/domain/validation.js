'use strict'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MINIPROGRAM_PATH_ALLOWLIST = Object.freeze({
  '/pages/index/index': Object.freeze([]),
  '/pages/events/index': Object.freeze([]),
  '/pages/opportunities/index': Object.freeze([]),
  '/pages/profile/index': Object.freeze([]),
  '/pages/membership/index': Object.freeze([]),
  '/packages/member/mip-branches/index': Object.freeze([]),
  '/packages/member/mip-cases/list/index': Object.freeze([]),
  '/packages/member/mip-people/index': Object.freeze([]),
  '/packages/member/mip-tasks/index': Object.freeze([]),
  '/packages/member/mip-tasks/detail/index': Object.freeze(['taskId']),
  '/packages/member/mip-game/index': Object.freeze([]),
  '/packages/member/mip-game/team/index': Object.freeze(['teamId']),
  '/packages/member/mip-events/detail/index': Object.freeze(['eventId']),
  '/packages/member/mip-opportunities/detail/index': Object.freeze(['id']),
  '/packages/member/mip-cases/detail/index': Object.freeze(['id']),
  '/packages/member/announcement-detail/index': Object.freeze(['announcementId']),
})

function requiredId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!UUID_PATTERN.test(result)) throw new Error('VALIDATION_FAILED')
  return result
}

function expectedVersion(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('VALIDATION_FAILED')
  return result
}

function boundedText(value, maximum, required = false) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) throw new Error('VALIDATION_FAILED')
  return result
}

function normalizeBannerDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const targetType = boundedText(value.targetType, 24, true).toUpperCase()
  if (!['MINIPROGRAM_PATH', 'ARTICLE_URL'].includes(targetType)) throw new Error('TARGET_INVALID')
  return {
    title: boundedText(value.title, 100, true),
    accessibilityLabel: boundedText(value.accessibilityLabel, 120, true),
    imageAssetId: requiredId(value.imageAssetId),
    targetType,
    targetValue: normalizeBannerTarget(targetType, value.targetValue),
  }
}

function normalizeBannerTarget(targetType, rawValue) {
  const value = boundedText(rawValue, 1024, true)
  if (targetType === 'MINIPROGRAM_PATH') return normalizeMiniprogramPath(value)
  if (targetType === 'ARTICLE_URL') return normalizeArticleUrl(value)
  throw new Error('TARGET_INVALID')
}

function normalizeMiniprogramPath(value) {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('#') || value.includes('\\')) {
    throw new Error('TARGET_INVALID')
  }
  const [path, query = '', ...rest] = value.split('?')
  if (rest.length || !Object.hasOwn(MINIPROGRAM_PATH_ALLOWLIST, path)) throw new Error('TARGET_INVALID')
  const requiredKeys = MINIPROGRAM_PATH_ALLOWLIST[path]
  const params = new URLSearchParams(query)
  const actualKeys = [...params.keys()]
  if (actualKeys.length !== requiredKeys.length
    || new Set(actualKeys).size !== actualKeys.length
    || requiredKeys.some(key => !UUID_PATTERN.test(params.get(key) || ''))
    || actualKeys.some(key => !requiredKeys.includes(key))) {
    throw new Error('TARGET_INVALID')
  }
  if (!requiredKeys.length) return path
  return `${path}?${requiredKeys.map(key => `${key}=${encodeURIComponent(params.get(key))}`).join('&')}`
}

function normalizeArticleUrl(value) {
  let url
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('TARGET_INVALID')
  }
  if (url.protocol !== 'https:' || url.hostname !== 'mp.weixin.qq.com'
    || url.username || url.password || url.port || url.hash
    || !(url.pathname === '/s' || url.pathname.startsWith('/s/'))) {
    throw new Error('TARGET_INVALID')
  }
  const normalized = url.toString()
  if (normalized.length > 1024) throw new Error('TARGET_INVALID')
  return normalized
}

function normalizeAdminFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const status = boundedText(value.status, 16).toUpperCase()
  if (status && !['ACTIVE', 'INACTIVE', 'DELETED'].includes(status)) throw new Error('VALIDATION_FAILED')
  return { status, query: boundedText(value.query, 80) }
}

function normalizeStatus(value) {
  const status = boundedText(value, 16, true).toUpperCase()
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new Error('VALIDATION_FAILED')
  return status
}

function normalizeDirection(value) {
  const direction = boundedText(value, 8, true).toUpperCase()
  if (!['UP', 'DOWN'].includes(direction)) throw new Error('VALIDATION_FAILED')
  return direction
}

function assertBannerAsset(asset, options = {}) {
  if (!asset || asset.status !== 'READY' || asset.purpose !== 'BANNER'
    || !UUID_PATTERN.test(asset.owner_user_id || '')
    || !['image/jpeg', 'image/png'].includes(asset.content_type)
    || typeof asset.cloud_file_id !== 'string' || !asset.cloud_file_id.startsWith('cloud://')) {
    throw new Error('IMAGE_ASSET_INVALID')
  }
  if (options.actorUserId && asset.owner_user_id !== options.actorUserId
    && asset.id !== options.currentAssetId) {
    throw new Error('IMAGE_NOT_OWNED')
  }
  const width = Number(asset.width_px)
  const height = Number(asset.height_px)
  const ratio = width / height
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 750 || height < 300 || ratio < 1.8 || ratio > 3.2) {
    throw new Error('IMAGE_DIMENSIONS_INVALID')
  }
  return { width, height }
}

module.exports = {
  MINIPROGRAM_PATH_ALLOWLIST,
  assertBannerAsset,
  expectedVersion,
  normalizeAdminFilters,
  normalizeArticleUrl,
  normalizeBannerDraft,
  normalizeBannerTarget,
  normalizeDirection,
  normalizeMiniprogramPath,
  normalizeStatus,
  requiredId,
}
