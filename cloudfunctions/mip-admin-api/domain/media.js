'use strict'

const { CAPABILITIES, firstAnyGrant, firstGrant } = require('./capabilities')
const { AdminError } = require('./validation')

const MEDIA_ADMIN_OPERATION = 'mip.admin.media.uploadImage'
const MEDIA_ADMIN_TEMPURLS_OPERATION = 'mip.admin.media.tempUrls'
const MEDIA_ADMIN_PURPOSE_CAPABILITIES = Object.freeze({
  BANNER: CAPABILITIES.BANNERS_MANAGE,
  EVENT_CONTENT: CAPABILITIES.EVENTS_WRITE,
  EVENT_COVER: CAPABILITIES.EVENTS_WRITE,
  OPPORTUNITY_COVER: CAPABILITIES.OPPORTUNITIES_MODERATE,
  SUPER_CASE_COVER: CAPABILITIES.USER_CONTENT_MODERATE,
  SUPER_CASE_MEDIA: CAPABILITIES.USER_CONTENT_MODERATE,
  TASK_TEMPLATE: CAPABILITIES.TASKS_MANAGE,
  VIDEO_RECAP_COVER: CAPABILITIES.EVENTS_RECAPS_MANAGE,
  BADGE_IMAGE: CAPABILITIES.BADGES_MANAGE,
})
const UPLOAD_INPUT_KEYS = new Set(['purpose', 'imageBase64'])
const TEMPURLS_INPUT_KEYS = new Set(['fileIds'])
const TEMPURLS_MAX_FILE_IDS = 30
const TEMPURLS_MAX_FILE_ID_LENGTH = 1024

function createAdminMedia({ access, client } = {}) {
  if (!access || typeof access.session !== 'function' || !client || typeof client.execute !== 'function') {
    throw new Error('MEDIA_ADAPTER_CONFIG_INVALID')
  }

  async function uploadMediaImage(caller, input) {
    const context = await access.session(caller)
    const normalized = normalizeUploadInput(input)
    // Upload creates an actor-owned, unpublished asset. The eventual binding authorizes the object scope again.
    firstGrant(
      context.bindings,
      MEDIA_ADMIN_PURPOSE_CAPABILITIES[normalized.purpose],
    )
    return client.execute({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      action: MEDIA_ADMIN_OPERATION,
      input: normalized,
    })
  }

  // 只读解析：具备任一 MEDIA 用途能力即可读；归属与时效由 mip-media-api 裁决。
  async function tempMediaFileUrls(caller, input) {
    const context = await access.session(caller)
    const fileIds = normalizeTempUrlsInput(input)
    firstAnyGrant(context.bindings, Object.values(MEDIA_ADMIN_PURPOSE_CAPABILITIES))
    const result = await client.tempFileUrls({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      fileIds,
    })
    return { urls: sanitizeTempUrls(result) }
  }

  return Object.freeze({ tempMediaFileUrls, uploadMediaImage })
}

function normalizeTempUrlsInput(input) {
  if (!isPlainRecord(input) || !hasExactKeys(input, TEMPURLS_INPUT_KEYS)) {
    throw new AdminError('VALIDATION_FAILED', '图片地址解析参数无效')
  }
  const raw = input.fileIds
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > TEMPURLS_MAX_FILE_IDS) {
    throw new AdminError('VALIDATION_FAILED', `fileIds 数量须为 1-${TEMPURLS_MAX_FILE_IDS}`)
  }
  const seen = new Set()
  const fileIds = []
  for (const item of raw) {
    const fileId = typeof item === 'string' ? item.trim() : ''
    if (!/^cloud:\/\/\S{1,1016}$/.test(fileId) || fileId.length > TEMPURLS_MAX_FILE_ID_LENGTH) {
      throw new AdminError('VALIDATION_FAILED', 'fileID 格式无效')
    }
    if (!seen.has(fileId)) {
      seen.add(fileId)
      fileIds.push(fileId)
    }
  }
  return fileIds
}

// 双保险：即使内部通道返回了意外形态，也只把 https 临时地址透传给调用方。
function sanitizeTempUrls(result) {
  const source = result && typeof result === 'object' && result.urls && typeof result.urls === 'object'
    ? result.urls
    : {}
  const urls = {}
  for (const [fileId, url] of Object.entries(source)) {
    if (typeof fileId === 'string' && fileId.startsWith('cloud://')
      && typeof url === 'string' && url.startsWith('https://')) {
      urls[fileId] = url
    }
  }
  return urls
}

function normalizeUploadInput(input) {
  if (!isPlainRecord(input) || !hasExactKeys(input, UPLOAD_INPUT_KEYS)) {
    throw new AdminError('VALIDATION_FAILED', '图片上传参数无效')
  }
  const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : ''
  if (!MEDIA_ADMIN_PURPOSE_CAPABILITIES[purpose]) {
    throw new AdminError('PURPOSE_INVALID', '图片用途无效')
  }
  if (typeof input.imageBase64 !== 'string') {
    throw new AdminError('IMAGE_INVALID', '图片内容无效')
  }
  return { purpose, imageBase64: input.imageBase64 }
}

function hasExactKeys(value, allowedKeys) {
  const keys = Reflect.ownKeys(value)
  return keys.length === allowedKeys.size
    && keys.every(key => typeof key === 'string' && allowedKeys.has(key))
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

module.exports = {
  MEDIA_ADMIN_OPERATION,
  MEDIA_ADMIN_PURPOSE_CAPABILITIES,
  MEDIA_ADMIN_TEMPURLS_OPERATION,
  TEMPURLS_MAX_FILE_IDS,
  createAdminMedia,
  normalizeTempUrlsInput,
  normalizeUploadInput,
}
