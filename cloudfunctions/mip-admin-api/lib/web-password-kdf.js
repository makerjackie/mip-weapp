'use strict'

const { createHash, createHmac, pbkdf2, timingSafeEqual } = require('node:crypto')
const { promisify } = require('node:util')
const { canonicalJson } = require('./web-bff-auth')
const derive = promisify(pbkdf2)
const TRANSPORT = 'MIP_WEB_PASSWORD_KDF_V1'
const keys = ['transport', 'appId', 'nonce', 'timestamp', 'pepperedPassword', 'salt', 'signature']

function isWebPasswordKdfEvent(value) { return Boolean(value && value.transport === TRANSPORT) }

// A signed service operation, not a user identity or a public admin action.
// Raw passwords never leave the BFF; the fixed-size input is already HMAC-peppered there.
function createWebPasswordKdfRoute({ allowedAppIds, replayGuard, secret, now = Date.now }) {
  return async function passwordKdf(event) {
    try {
      if (typeof secret !== 'string' || secret.length < 32) throw new Error('KDF_UNAVAILABLE')
      if (!event || typeof event !== 'object' || Array.isArray(event)
        || Object.keys(event).length !== keys.length || keys.some(key => !Object.hasOwn(event, key))
        || event.transport !== TRANSPORT || !allowedAppIds.has(event.appId)
        || !Number.isSafeInteger(event.timestamp) || Math.abs(now() - event.timestamp) > 60_000
        || !/^[A-Za-z0-9_-]{24,128}$/.test(event.nonce || '')
        || typeof event.pepperedPassword !== 'string' || !/^[a-f0-9]{64}$/.test(event.pepperedPassword)
        || typeof event.salt !== 'string' || !/^[a-f0-9]{32}$/.test(event.salt)
        || !/^[a-f0-9]{64}$/.test(event.signature || '')) throw new Error('KDF_AUTH_REQUIRED')
      const { signature, ...unsigned } = event
      const expected = createHmac('sha256', secret).update(canonicalJson(unsigned)).digest()
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new Error('KDF_AUTH_REQUIRED')
      await replayGuard.consume({
        appId: event.appId,
        nonce: event.nonce,
        principalIdentityKey: createHash('sha256').update(`mip-web-password-kdf-service\0${event.appId}`).digest('hex'),
        action: 'mip.internal.webPassword.derive',
        requestHash: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
      })
      const derived = await derive(event.pepperedPassword, event.salt, 600_000, 32, 'sha256')
      return { ok: true, data: { derivedKey: derived.toString('hex') } }
    }
    catch (error) {
      const denied = ['KDF_AUTH_REQUIRED', 'WEB_BFF_REPLAYED'].includes(error?.message)
      return { ok: false, error: { code: denied ? 'AUTH_REQUIRED' : 'SERVICE_UNAVAILABLE', message: '凭证服务暂时不可用', retryable: false } }
    }
  }
}
module.exports = { createWebPasswordKdfRoute, isWebPasswordKdfEvent }
