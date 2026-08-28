'use strict'

const { CAPABILITIES, authorize } = require('./capabilities')
const { AdminError } = require('./validation')

const MEDIA_ADMIN_OPERATION = 'mip.admin.media.uploadImage'
const MEDIA_ADMIN_PURPOSE_CAPABILITIES = Object.freeze({
  BANNER: CAPABILITIES.BANNERS_MANAGE,
  EVENT_ALBUM: CAPABILITIES.EVENTS_ALBUM_MANAGE,
  EVENT_CONTENT: CAPABILITIES.EVENTS_WRITE,
  EVENT_COVER: CAPABILITIES.EVENTS_WRITE,
  OPPORTUNITY_COVER: CAPABILITIES.OPPORTUNITIES_MODERATE,
  SUPER_CASE_COVER: CAPABILITIES.USER_CONTENT_MODERATE,
  SUPER_CASE_MEDIA: CAPABILITIES.USER_CONTENT_MODERATE,
  TASK_TEMPLATE: CAPABILITIES.TASKS_MANAGE,
})
const UPLOAD_INPUT_KEYS = new Set(['purpose', 'imageBase64'])

function createAdminMedia({ access, client } = {}) {
  if (!access || typeof access.session !== 'function' || !client || typeof client.execute !== 'function') {
    throw new Error('MEDIA_ADAPTER_CONFIG_INVALID')
  }

  async function uploadMediaImage(caller, input) {
    const context = await access.session(caller)
    const normalized = normalizeUploadInput(input)
    authorize(
      context.bindings,
      MEDIA_ADMIN_PURPOSE_CAPABILITIES[normalized.purpose],
      { scopeType: 'PLATFORM', scopeId: null },
    )
    return client.execute({
      appId: context.caller.appId,
      actorUserId: context.caller.userId,
      action: MEDIA_ADMIN_OPERATION,
      input: normalized,
    })
  }

  return Object.freeze({ uploadMediaImage })
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
  createAdminMedia,
  normalizeUploadInput,
}
