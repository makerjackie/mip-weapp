'use strict'

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} = require('node:crypto')

const VERSION = 'm1'
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function keyFromSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  return createHash('sha256')
    .update('mip-membership-invitation:v1\0')
    .update(secret)
    .digest()
}

function createMembershipInvitation({ appId, inviterUserId, expiresAt }, secret) {
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (typeof appId !== 'string'
    || !appId
    || !USER_ID_PATTERN.test(inviterUserId)
    || !Number.isFinite(expiry.getTime())) {
    throw new Error('MEMBERSHIP_INVITATION_INVALID')
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv)
  cipher.setAAD(Buffer.from(appId, 'utf8'))
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ inviterUserId, expiresAt: expiry.toISOString() }), 'utf8'),
    cipher.final(),
  ])
  return [
    VERSION,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.')
}

function readMembershipInvitation(token, appId, secret, now = new Date()) {
  if (typeof token !== 'string'
    || token.length > 512
    || typeof appId !== 'string'
    || !appId
    || !Number.isFinite(now.getTime())) {
    throw new Error('MEMBERSHIP_INVITATION_INVALID')
  }
  const [version, ivValue, encryptedValue, tagValue, extra] = token.split('.')
  if (version !== VERSION || extra !== undefined || !ivValue || !encryptedValue || !tagValue) {
    throw new Error('MEMBERSHIP_INVITATION_INVALID')
  }
  try {
    const iv = Buffer.from(ivValue, 'base64url')
    const encrypted = Buffer.from(encryptedValue, 'base64url')
    const tag = Buffer.from(tagValue, 'base64url')
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length < 1) {
      throw new Error('INVALID_TOKEN')
    }
    const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv)
    decipher.setAAD(Buffer.from(appId, 'utf8'))
    decipher.setAuthTag(tag)
    const payload = JSON.parse(Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8'))
    const expiresAt = new Date(payload?.expiresAt)
    if (!USER_ID_PATTERN.test(payload?.inviterUserId)
      || !Number.isFinite(expiresAt.getTime())
      || expiresAt.getTime() <= now.getTime()) {
      throw new Error('INVALID_TOKEN')
    }
    return { inviterUserId: payload.inviterUserId, expiresAt: expiresAt.toISOString() }
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') {
      throw error
    }
    throw new Error('MEMBERSHIP_INVITATION_INVALID')
  }
}

function hashMembershipInvitation(token) {
  if (typeof token !== 'string' || !token) {
    throw new Error('MEMBERSHIP_INVITATION_INVALID')
  }
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

module.exports = {
  createMembershipInvitation,
  hashMembershipInvitation,
  readMembershipInvitation,
}
