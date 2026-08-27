'use strict'

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} = require('node:crypto')

function protectPhone(phoneInfo, secret, context = {}) {
  const phoneNumber = normalizePhone(phoneInfo)
  const keys = privateKeys(secret)
  if (!context.appId || !context.userId) {
    throw new Error('PHONE_ENCRYPTION_NOT_CONFIGURED')
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keys.encryption, iv)
  cipher.setAAD(Buffer.from(`${context.appId}\0${context.userId}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(phoneNumber, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    phoneHash: hashNormalizedPhone(phoneNumber, keys.hash, context.appId),
    phoneCiphertext: Buffer.concat([Buffer.from([1]), iv, authTag, ciphertext]),
  }
}

function protectContact(value, secret, context = {}) {
  const normalized = normalizeContact(value)
  if (!context.appId || !context.userId) throw new Error('CONTACT_ENCRYPTION_NOT_CONFIGURED')
  return encryptValue(normalized, secret, context, 'mip-contact-encryption-v1')
}

function revealPhone(ciphertext, secret, context = {}) {
  return decryptValue(ciphertext, secret, context, 'mip-phone-encryption-v1')
}

function revealContact(ciphertext, secret, context = {}) {
  return decryptValue(ciphertext, secret, context, 'mip-contact-encryption-v1')
}

function hashPhone(phoneInfo, secret, context = {}) {
  const phoneNumber = normalizePhone(phoneInfo)
  const keys = privateKeys(secret)
  if (!context.appId) {
    throw new Error('PHONE_ENCRYPTION_NOT_CONFIGURED')
  }
  return hashNormalizedPhone(phoneNumber, keys.hash, context.appId)
}

function normalizePhone(phoneInfo = {}) {
  const number = typeof phoneInfo.purePhoneNumber === 'string'
    ? phoneInfo.purePhoneNumber.trim()
    : String(phoneInfo.phoneNumber || '').replace(/^\+/, '').trim()
  const countryCode = String(phoneInfo.countryCode || '86').replace(/^\+/, '').trim()
  if (!/^\d{6,20}$/.test(number) || !/^\d{1,4}$/.test(countryCode)) {
    throw new Error('PHONE_BIND_FAILED')
  }
  return `+${countryCode}:${number}`
}

function normalizeContact(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (result.length > 500) throw new Error('VALIDATION_FAILED')
  return result
}

function encryptValue(value, secret, context, purpose) {
  const keys = privateKeys(secret, purpose)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keys.encryption, iv)
  cipher.setAAD(Buffer.from(`${context.appId}\0${context.userId}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])
}

function decryptValue(ciphertext, secret, context = {}, purpose) {
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 29 || !context.appId || !context.userId) return ''
  const keys = privateKeys(secret, purpose)
  const raw = Buffer.from(ciphertext)
  if (raw[0] !== 1) return ''
  const decipher = createDecipheriv('aes-256-gcm', keys.encryption, raw.subarray(1, 13))
  decipher.setAAD(Buffer.from(`${context.appId}\0${context.userId}`, 'utf8'))
  decipher.setAuthTag(raw.subarray(13, 29))
  return Buffer.concat([decipher.update(raw.subarray(29)), decipher.final()]).toString('utf8')
}

function privateKeys(secret, purpose = 'mip-phone-encryption-v1') {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('PHONE_ENCRYPTION_NOT_CONFIGURED')
  }
  const master = createHash('sha256').update(secret).digest()
  return {
    encryption: createHmac('sha256', master).update(purpose).digest(),
    hash: createHmac('sha256', master).update('mip-phone-hash-v1').digest(),
  }
}

function hashNormalizedPhone(phoneNumber, hashKey, appId) {
  return createHmac('sha256', hashKey)
    .update(`${appId}\0${phoneNumber}`)
    .digest('hex')
}

module.exports = {
  hashPhone,
  normalizePhone,
  protectPhone,
  protectContact,
  revealPhone,
  revealContact,
}
