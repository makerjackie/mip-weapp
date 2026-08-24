'use strict'

const { createCipheriv, createDecipheriv, createHash, createHmac } = require('node:crypto')

const VERSION = 'p1'
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function keyFromPepper(pepper) {
  if (typeof pepper !== 'string' || pepper.length < 32) throw new Error('IDENTITY_CONFIG_REQUIRED')
  return createHash('sha256').update('mip-profile-ref:v1\0').update(pepper).digest()
}

function createProfileRef({ appId, userId }, pepper) {
  if (typeof appId !== 'string' || !appId || !USER_ID_PATTERN.test(userId)) {
    throw new Error('PROFILE_REF_INVALID')
  }
  const key = keyFromPepper(pepper)
  const iv = createHmac('sha256', key)
    .update('mip-admin-profile-ref:v1\0')
    .update(appId)
    .update('\0')
    .update(userId)
    .digest()
    .subarray(0, 12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(appId, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(userId, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')
}

function readProfileRef(profileRef, appId, pepper) {
  if (typeof profileRef !== 'string' || profileRef.length > 200 || !appId) throw new Error('TARGET_NOT_FOUND')
  const [version, ivValue, encryptedValue, tagValue, extra] = profileRef.split('.')
  if (version !== VERSION || extra !== undefined || !ivValue || !encryptedValue || !tagValue) {
    throw new Error('TARGET_NOT_FOUND')
  }
  try {
    const iv = Buffer.from(ivValue, 'base64url')
    const encrypted = Buffer.from(encryptedValue, 'base64url')
    const tag = Buffer.from(tagValue, 'base64url')
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length < 1) throw new Error('INVALID_REF')
    const decipher = createDecipheriv('aes-256-gcm', keyFromPepper(pepper), iv)
    decipher.setAAD(Buffer.from(appId, 'utf8'))
    decipher.setAuthTag(tag)
    const userId = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    if (!USER_ID_PATTERN.test(userId)) throw new Error('INVALID_REF')
    return userId
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
    throw new Error('TARGET_NOT_FOUND')
  }
}

module.exports = { createProfileRef, readProfileRef }
