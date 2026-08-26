'use strict'

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} = require('node:crypto')

const CURSOR_VERSION = 'mct1'
const TALENT_KEY_VERSION = 'mctk1'
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function keyFromPepper(label, pepper) {
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  return createHash('sha256').update(`mip-cooperation:${label}:v1\0`).update(pepper).digest()
}

function normalizedText(value, maximum) {
  const result = typeof value === 'string' ? value : ''
  if (result.length > maximum) throw new Error('VALIDATION_FAILED')
  return result
}

function normalizeFilterContext(value) {
  const appId = normalizedText(value?.appId, 64)
  const viewerId = normalizedText(value?.viewerId, 36)
  const keyword = normalizedText(value?.keyword, 80)
  const branchId = normalizedText(value?.branchId, 36)
  const roleKey = normalizedText(value?.roleKey, 32)
  const industryTagIds = Array.isArray(value?.industryTagIds)
    ? [...value.industryTagIds].map(item => normalizedText(item, 36)).sort()
    : []
  if (!appId
    || (viewerId && !USER_ID_PATTERN.test(viewerId))
    || industryTagIds.length > 8
    || new Set(industryTagIds).size !== industryTagIds.length) {
    throw new Error('VALIDATION_FAILED')
  }
  return { appId, viewerId, keyword, branchId, roleKey, industryTagIds }
}

function aad(context) {
  return Buffer.from(JSON.stringify(normalizeFilterContext(context)), 'utf8')
}

function normalizedTimestamp(value) {
  if (!(value instanceof Date) && typeof value !== 'string') throw new Error('VALIDATION_FAILED')
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error('VALIDATION_FAILED')
  return parsed.toISOString()
}

function normalizeCursorPayload(value) {
  const snapshotAt = normalizedTimestamp(value?.snapshotAt)
  const createdAt = normalizedTimestamp(value?.createdAt)
  const userId = typeof value?.userId === 'string' ? value.userId : ''
  if (!USER_ID_PATTERN.test(userId) || new Date(createdAt).getTime() > new Date(snapshotAt).getTime()) {
    throw new Error('VALIDATION_FAILED')
  }
  return { snapshotAt, createdAt, userId }
}

function createTalentCursor(context, payload, pepper) {
  const normalized = normalizeCursorPayload(payload)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFromPepper('talent-cursor', pepper), iv)
  cipher.setAAD(aad(context))
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(normalized), 'utf8'),
    cipher.final(),
  ])
  return [
    CURSOR_VERSION,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.')
}

function readTalentCursor(cursor, context, pepper) {
  if (typeof cursor !== 'string' || cursor.length > 768) throw new Error('VALIDATION_FAILED')
  const [version, ivValue, encryptedValue, tagValue, extra] = cursor.split('.')
  if (version !== CURSOR_VERSION || extra !== undefined || !ivValue || !encryptedValue || !tagValue) {
    throw new Error('VALIDATION_FAILED')
  }
  try {
    const iv = Buffer.from(ivValue, 'base64url')
    const encrypted = Buffer.from(encryptedValue, 'base64url')
    const tag = Buffer.from(tagValue, 'base64url')
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length < 1) {
      throw new Error('INVALID_CURSOR')
    }
    const decipher = createDecipheriv('aes-256-gcm', keyFromPepper('talent-cursor', pepper), iv)
    decipher.setAAD(aad(context))
    decipher.setAuthTag(tag)
    const payload = JSON.parse(Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8'))
    if (!payload || Object.keys(payload).sort().join(',') !== 'createdAt,snapshotAt,userId') {
      throw new Error('INVALID_CURSOR')
    }
    return normalizeCursorPayload(payload)
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
    throw new Error('VALIDATION_FAILED')
  }
}

function createTalentKey({ appId, userId }, pepper) {
  if (typeof appId !== 'string' || !appId || !USER_ID_PATTERN.test(userId)) {
    throw new Error('VALIDATION_FAILED')
  }
  const digest = createHmac('sha256', keyFromPepper('talent-key', pepper))
    .update('talent\0')
    .update(appId)
    .update('\0')
    .update(userId)
    .digest('base64url')
  return `${TALENT_KEY_VERSION}.${digest}`
}

module.exports = {
  createTalentCursor,
  createTalentKey,
  normalizeFilterContext,
  readTalentCursor,
}
