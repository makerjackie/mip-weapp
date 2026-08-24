'use strict'

const { createDecipheriv, createHash, createHmac } = require('node:crypto')

function encryptionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('PHONE_ENCRYPTION_NOT_CONFIGURED')
  }
  const master = createHash('sha256').update(secret).digest()
  return createHmac('sha256', master).update('mip-phone-encryption-v1').digest()
}

function decryptPhone(value, secret, context = {}) {
  if (!value) {
    return null
  }
  if (!context.appId || !context.userId) {
    throw new Error('PHONE_ENCRYPTION_NOT_CONFIGURED')
  }
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value)
  if (payload.length < 30 || payload[0] !== 1) {
    throw new Error('PHONE_CIPHERTEXT_INVALID')
  }
  const iv = payload.subarray(1, 13)
  const authTag = payload.subarray(13, 29)
  const ciphertext = payload.subarray(29)
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv)
  decipher.setAAD(Buffer.from(`${context.appId}\0${context.userId}`, 'utf8'))
  decipher.setAuthTag(authTag)
  const normalized = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  const match = /^\+(\d{1,4}):(\d{6,20})$/.exec(normalized)
  if (!match) {
    throw new Error('PHONE_CIPHERTEXT_INVALID')
  }
  return `+${match[1]} ${match[2]}`
}

function maskPhone(phone) {
  if (!phone) {
    return null
  }
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length < 7) {
    return '已绑定'
  }
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

module.exports = { decryptPhone, maskPhone }
