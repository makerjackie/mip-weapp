'use strict'

const { createHmac } = require('node:crypto')

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveTrustedIdentity(context = {}, { allowedAppIds, pepper } = {}) {
  const fromAppId = text(context.FROM_APPID)
  const fromOpenId = text(context.FROM_OPENID)
  const appId = text(context.APPID)
  const openId = text(context.OPENID)
  const delegated = Boolean(fromAppId || fromOpenId)
  const trustedAppId = delegated ? fromAppId : appId
  const trustedOpenId = delegated ? fromOpenId : openId

  if (!trustedAppId || !trustedOpenId) {
    throw new Error('AUTH_REQUIRED')
  }
  if (!(allowedAppIds instanceof Set) || allowedAppIds.size === 0 || !allowedAppIds.has(trustedAppId)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  return {
    appId: trustedAppId,
    openId: trustedOpenId,
    identityKey: createHmac('sha256', pepper)
      .update(`${trustedAppId}\0${trustedOpenId}`)
      .digest('hex'),
  }
}

function createTrustedPrincipalIssuer(options = {}) {
  const identityOptions = {
    allowedAppIds: options.allowedAppIds instanceof Set
      ? new Set(options.allowedAppIds)
      : options.allowedAppIds,
    pepper: options.pepper,
  }
  const issuedPrincipals = new WeakSet()

  function issue(context) {
    const principal = Object.freeze(resolveTrustedIdentity(context, identityOptions))
    issuedPrincipals.add(principal)
    return principal
  }

  function assert(principal) {
    if (!issuedPrincipals.has(principal)) throw new Error('AUTH_REQUIRED')
    return principal
  }

  return Object.freeze({ assert, issue })
}

module.exports = { createTrustedPrincipalIssuer, resolveTrustedIdentity }
