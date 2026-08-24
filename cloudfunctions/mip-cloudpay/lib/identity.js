'use strict'

const { createHmac } = require('node:crypto')

function resolveTrustedIdentity(context = {}, options = {}) {
  const fromAppId = text(context.FROM_APPID)
  const fromOpenId = text(context.FROM_OPENID)
  const appId = text(context.APPID)
  const openId = text(context.OPENID)
  const hasAnyFrom = Boolean(fromAppId || fromOpenId)
  const trustedAppId = hasAnyFrom ? fromAppId : appId
  const trustedOpenId = hasAnyFrom ? fromOpenId : openId
  if (!trustedAppId || !trustedOpenId) {
    throw new Error('IDENTITY_REQUIRED')
  }
  if (!(options.allowedAppIds instanceof Set) || !options.allowedAppIds.has(trustedAppId)) {
    throw new Error('IDENTITY_REQUIRED')
  }
  return {
    appId: trustedAppId,
    openId: trustedOpenId,
    identityKey: identityKey(trustedAppId, trustedOpenId, options.pepper),
  }
}

function identityKey(appId, openId, pepper) {
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  return createHmac('sha256', pepper).update(`${appId}\0${openId}`).digest('hex')
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { identityKey, resolveTrustedIdentity }
