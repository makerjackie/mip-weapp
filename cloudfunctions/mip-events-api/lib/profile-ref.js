'use strict'

const { createCipheriv, createHash, randomBytes } = require('node:crypto')

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createProfileRef({ appId, userId }, pepper) {
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  if (typeof appId !== 'string' || !appId || !USER_ID_PATTERN.test(userId)) {
    throw new Error('PROFILE_REF_INVALID')
  }
  const key = createHash('sha256').update('mip-profile-ref:v1\0').update(pepper).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(appId, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(userId, 'utf8'), cipher.final()])
  return ['p1', iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')
}

module.exports = { createProfileRef }
