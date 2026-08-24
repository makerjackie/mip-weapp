'use strict'

const {
  createCipheriv,
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
    phoneHash: createHmac('sha256', keys.hash)
      .update(`${context.appId}\0${phoneNumber}`)
      .digest('hex'),
    phoneCiphertext: Buffer.concat([Buffer.from([1]), iv, authTag, ciphertext]),
  }
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

function privateKeys(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('PHONE_ENCRYPTION_NOT_CONFIGURED')
  }
  const master = createHash('sha256').update(secret).digest()
  return {
    encryption: createHmac('sha256', master).update('mip-phone-encryption-v1').digest(),
    hash: createHmac('sha256', master).update('mip-phone-hash-v1').digest(),
  }
}

module.exports = { normalizePhone, protectPhone }
