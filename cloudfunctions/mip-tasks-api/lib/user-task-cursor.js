'use strict'

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} = require('node:crypto')

const CURSOR_VERSION = 'mtu1'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function keyFromSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('IDENTITY_CONFIG_REQUIRED')
  return createHash('sha256').update('mip-user-task-cursor:v1\0').update(secret).digest()
}

function createUserTaskCursor(context, payload, secret) {
  const normalizedContext = normalizeContext(context)
  const normalizedPayload = normalizePayload(payload)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv)
  cipher.setAAD(Buffer.from(aad(normalizedContext), 'utf8'))
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(normalizedPayload), 'utf8'),
    cipher.final(),
  ])
  return [
    CURSOR_VERSION,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.')
}

function readUserTaskCursor(cursor, context, secret) {
  const normalizedContext = normalizeContext(context)
  if (typeof cursor !== 'string' || cursor.length > 600) throw new Error('VALIDATION_FAILED')
  const [version, ivValue, encryptedValue, tagValue, extra] = cursor.split('.')
  if (version !== CURSOR_VERSION || extra !== undefined || !ivValue || !encryptedValue || !tagValue) {
    throw new Error('VALIDATION_FAILED')
  }
  try {
    const iv = Buffer.from(ivValue, 'base64url')
    const encrypted = Buffer.from(encryptedValue, 'base64url')
    const tag = Buffer.from(tagValue, 'base64url')
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length < 1) throw new Error('INVALID_CURSOR')
    const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv)
    decipher.setAAD(Buffer.from(aad(normalizedContext), 'utf8'))
    decipher.setAuthTag(tag)
    return normalizePayload(JSON.parse(Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8')))
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
    throw new Error('VALIDATION_FAILED')
  }
}

function normalizeContext(value) {
  const appId = typeof value?.appId === 'string' ? value.appId.trim() : ''
  const userId = typeof value?.userId === 'string' ? value.userId : ''
  if (!appId || appId.length > 64 || !UUID_PATTERN.test(userId)) throw new Error('VALIDATION_FAILED')
  return { appId, userId }
}

function normalizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'publishedAt,snapshotAt,taskId') {
    throw new Error('VALIDATION_FAILED')
  }
  const snapshotAt = exactIso(value.snapshotAt)
  const publishedAt = exactIso(value.publishedAt)
  const taskId = typeof value.taskId === 'string' ? value.taskId : ''
  if (!UUID_PATTERN.test(taskId) || Date.parse(publishedAt) > Date.parse(snapshotAt)) {
    throw new Error('VALIDATION_FAILED')
  }
  return { snapshotAt, publishedAt, taskId }
}

function exactIso(value) {
  if (typeof value !== 'string' || value.length > 30) throw new Error('VALIDATION_FAILED')
  const time = Date.parse(value)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('VALIDATION_FAILED')
  return value
}

function aad(context) {
  return `${context.appId}\0${context.userId}`
}

module.exports = { createUserTaskCursor, readUserTaskCursor }
