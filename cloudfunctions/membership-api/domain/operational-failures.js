'use strict'

const { randomUUID } = require('node:crypto')

const CATEGORIES = new Set(['MEDIA_REVIEW', 'MEDIA_UPLOAD'])
const RESOURCE_TYPES = new Set(['avatar', 'event-photo', 'event-cover'])
const SAFE_ERROR_CODES = new Set([
  'AVATAR_CONTENT_REJECTED',
  'AVATAR_IMAGE_INVALID',
  'AVATAR_IMAGE_TOO_LARGE',
  'AVATAR_SAFETY_NOT_CONFIGURED',
  'AVATAR_UPLOAD_FAILED',
  'PHOTO_CONTENT_REJECTED',
  'PHOTO_IMAGE_INVALID',
  'PHOTO_IMAGE_TOO_LARGE',
  'PHOTO_UPLOAD_FAILED',
])

async function recordOperationalFailure(database, input) {
  if (!CATEGORIES.has(input.category)
    || !RESOURCE_TYPES.has(input.resourceType)
    || !SAFE_ERROR_CODES.has(input.errorCode)) {
    throw new Error('OPERATIONAL_FAILURE_INVALID')
  }
  await database.query(
    `INSERT INTO member_operational_failures (
       id, app_id, user_id, category, resource_type, resource_id, error_code, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
    [
      randomUUID(),
      input.appId,
      input.userId,
      input.category,
      input.resourceType,
      input.resourceId || null,
      input.errorCode,
    ],
  )
}

module.exports = { recordOperationalFailure }
