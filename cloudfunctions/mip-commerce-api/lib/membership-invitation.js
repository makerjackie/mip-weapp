'use strict'

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} = require('node:crypto')

const VERSION = 'm1'
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SCENE_PATTERN = /^[A-Za-z0-9_-]{32}$/

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

function sceneSignature(body, appId, secret) {
  return createHmac('sha256', keyFromSecret(secret))
    .update('membership-scene:v1\0')
    .update(appId)
    .update('\0')
    .update(body)
    .digest('base64url')
}

function uuidBytes(userId) {
  return Buffer.from(userId.replaceAll('-', ''), 'hex')
}

function bytesUuid(value) {
  const hex = value.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

function createMembershipInvitationScene({ appId, inviterUserId, expiresAt }, secret) {
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  const expiryDay = Math.ceil(expiry.getTime() / 86_400_000)
  if (typeof appId !== 'string' || !appId || !USER_ID_PATTERN.test(inviterUserId)
    || !Number.isInteger(expiryDay) || expiryDay < 1 || expiryDay > 0xffff) {
    throw new Error('MEMBERSHIP_INVITATION_INVALID')
  }
  const expiryBytes = Buffer.alloc(2)
  expiryBytes.writeUInt16BE(expiryDay)
  const body = Buffer.concat([uuidBytes(inviterUserId), expiryBytes]).toString('base64url')
  return `${body}${sceneSignature(body, appId, secret).slice(0, 8)}`
}

function readMembershipInvitationScene(scene, appId, secret, now = new Date()) {
  if (!SCENE_PATTERN.test(String(scene || '')) || typeof appId !== 'string' || !appId
    || !Number.isFinite(now.getTime())) {
    throw new Error('MEMBERSHIP_INVITATION_INVALID')
  }
  try {
    const body = scene.slice(0, 24)
    const suppliedSignature = Buffer.from(scene.slice(24), 'utf8')
    const expectedSignature = Buffer.from(sceneSignature(body, appId, secret).slice(0, 8), 'utf8')
    if (!timingSafeEqual(suppliedSignature, expectedSignature)) throw new Error('INVALID_SCENE')
    const payload = Buffer.from(body, 'base64url')
    if (payload.length !== 18) throw new Error('INVALID_SCENE')
    const inviterUserId = bytesUuid(payload.subarray(0, 16))
    const expiresAt = new Date(payload.readUInt16BE(16) * 86_400_000)
    if (!USER_ID_PATTERN.test(inviterUserId) || expiresAt.getTime() <= now.getTime()) {
      throw new Error('INVALID_SCENE')
    }
    return { inviterUserId, expiresAt: expiresAt.toISOString() }
  }
  catch (error) {
    if (error?.message === 'IDENTITY_CONFIG_REQUIRED') throw error
    throw new Error('MEMBERSHIP_INVITATION_INVALID')
  }
}

module.exports = {
  createMembershipInvitation,
  createMembershipInvitationScene,
  hashMembershipInvitation,
  readMembershipInvitation,
  readMembershipInvitationScene,
}
