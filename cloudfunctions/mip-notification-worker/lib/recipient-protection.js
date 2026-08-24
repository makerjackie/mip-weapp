'use strict'

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} = require('node:crypto')

const header = Buffer.from([0x4d, 0x49, 0x50, 0x4e, 0x01])

function normalizeKey(value) {
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error('NOTIFICATION_ENCRYPTION_NOT_CONFIGURED')
  }
  if (value.startsWith('hex:')) {
    const key = Buffer.from(value.slice(4), 'hex')
    if (key.length !== 32) throw new Error('NOTIFICATION_ENCRYPTION_NOT_CONFIGURED')
    return key
  }
  if (value.startsWith('base64:')) {
    const key = Buffer.from(value.slice(7), 'base64')
    if (key.length !== 32) throw new Error('NOTIFICATION_ENCRYPTION_NOT_CONFIGURED')
    return key
  }
  return createHash('sha256').update(value, 'utf8').digest()
}

function aad(options) {
  const values = [options.appId, options.userId, options.grantId, options.templateKey]
  if (values.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('NOTIFICATION_RECIPIENT_CONTEXT_INVALID')
  }
  return Buffer.from(`MIP_NOTIFICATION_RECIPIENT_V1\0${values.join('\0')}`, 'utf8')
}

function protectRecipient(openId, keyValue, options, random = randomBytes) {
  if (typeof openId !== 'string' || !openId.trim()) {
    throw new Error('AUTH_REQUIRED')
  }
  const key = normalizeKey(keyValue)
  const iv = random(12)
  if (!Buffer.isBuffer(iv) || iv.length !== 12) {
    throw new Error('NOTIFICATION_ENCRYPTION_FAILED')
  }
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad(options))
  const ciphertext = Buffer.concat([cipher.update(openId.trim(), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    recipientHash: hashRecipient(openId, keyValue, options.appId),
    recipientCiphertext: Buffer.concat([header, iv, tag, ciphertext]),
  }
}

function hashRecipient(openId, keyValue, appId) {
  if (typeof openId !== 'string' || !openId.trim() || typeof appId !== 'string' || !appId.trim()) {
    throw new Error('NOTIFICATION_RECIPIENT_CONTEXT_INVALID')
  }
  return createHmac('sha256', normalizeKey(keyValue))
    .update(`MIP_NOTIFICATION_RECIPIENT_HASH_V1\0${appId.trim()}\0${openId.trim()}`)
    .digest('hex')
}

function revealRecipient(value, keyValue, options) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value || '')
  if (payload.length <= header.length + 12 + 16 || !payload.subarray(0, header.length).equals(header)) {
    throw new Error('NOTIFICATION_RECIPIENT_INVALID')
  }
  try {
    const key = normalizeKey(keyValue)
    const ivStart = header.length
    const tagStart = ivStart + 12
    const dataStart = tagStart + 16
    const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(ivStart, tagStart))
    decipher.setAAD(aad(options))
    decipher.setAuthTag(payload.subarray(tagStart, dataStart))
    return Buffer.concat([decipher.update(payload.subarray(dataStart)), decipher.final()]).toString('utf8')
  }
  catch (error) {
    if (error?.message === 'NOTIFICATION_ENCRYPTION_NOT_CONFIGURED'
      || error?.message === 'NOTIFICATION_RECIPIENT_CONTEXT_INVALID') {
      throw error
    }
    throw new Error('NOTIFICATION_RECIPIENT_INVALID')
  }
}

module.exports = { _header: header, hashRecipient, normalizeKey, protectRecipient, revealRecipient }
