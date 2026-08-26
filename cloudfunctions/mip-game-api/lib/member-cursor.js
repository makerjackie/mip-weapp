'use strict'

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} = require('node:crypto')

const CURSOR_VERSION = 'gm1'
const CANDIDATE_KEY_VERSION = 'gmk1'
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function keyFromPepper(pepper) {
  if (typeof pepper !== 'string' || pepper.length < 32) throw new Error('IDENTITY_CONFIG_REQUIRED')
  return createHash('sha256').update('mip-game-member-cursor:v1\0').update(pepper).digest()
}

function createMemberCursor(context, pepper) {
  const normalized = normalizeContext(context)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFromPepper(pepper), iv)
  cipher.setAAD(Buffer.from(normalized.appId, 'utf8'))
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({
      seasonId: normalized.seasonId,
      query: normalized.query,
      userId: normalized.userId,
    }), 'utf8'),
    cipher.final(),
  ])
  return [
    CURSOR_VERSION,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.')
}

function readMemberCursor(cursor, context, pepper) {
  const normalized = normalizeReadContext(context)
  if (typeof cursor !== 'string' || cursor.length > 600) throw new Error('VALIDATION_FAILED')
  const [version, ivValue, encryptedValue, tagValue, extra] = cursor.split('.')
  if (version !== CURSOR_VERSION || extra !== undefined
    || !ivValue || !encryptedValue || !tagValue) throw new Error('VALIDATION_FAILED')
  try {
    const iv = Buffer.from(ivValue, 'base64url')
    const encrypted = Buffer.from(encryptedValue, 'base64url')
    const tag = Buffer.from(tagValue, 'base64url')
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length < 1) {
      throw new Error('INVALID_CURSOR')
    }
    const decipher = createDecipheriv('aes-256-gcm', keyFromPepper(pepper), iv)
    decipher.setAAD(Buffer.from(normalized.appId, 'utf8'))
    decipher.setAuthTag(tag)
    const payload = JSON.parse(Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8'))
    if (!payload || Object.keys(payload).sort().join(',') !== 'query,seasonId,userId'
      || payload.seasonId !== normalized.seasonId
      || payload.query !== normalized.query
      || !USER_ID_PATTERN.test(payload.userId)) {
      throw new Error('INVALID_CURSOR')
    }
    return payload.userId
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
    throw new Error('VALIDATION_FAILED')
  }
}

function createCandidateKey(context, pepper) {
  const normalized = normalizeContext(context)
  const value = createHmac('sha256', keyFromPepper(pepper))
    .update('candidate\0')
    .update(normalized.appId)
    .update('\0')
    .update(normalized.seasonId)
    .update('\0')
    .update(normalized.userId)
    .digest('base64url')
  return `${CANDIDATE_KEY_VERSION}.${value}`
}

function normalizeContext(value) {
  const { appId, seasonId, query } = normalizeReadContext(value)
  const userId = typeof value?.userId === 'string' ? value.userId : ''
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error('VALIDATION_FAILED')
  }
  return { appId, seasonId, query, userId }
}

function normalizeReadContext(value) {
  const appId = typeof value?.appId === 'string' ? value.appId : ''
  const seasonId = typeof value?.seasonId === 'string' ? value.seasonId : ''
  const query = typeof value?.query === 'string' ? value.query : ''
  if (!appId || !USER_ID_PATTERN.test(seasonId) || query.length > 80) {
    throw new Error('VALIDATION_FAILED')
  }
  return { appId, seasonId, query }
}

module.exports = { createCandidateKey, createMemberCursor, readMemberCursor }
