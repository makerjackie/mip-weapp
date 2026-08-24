'use strict'

const { createHmac } = require('node:crypto')

function resolveTrustedIdentity(context = {}, { allowedAppIds, pepper, unionPepper } = {}) {
  const fromAppId = text(context.FROM_APPID)
  const fromOpenId = text(context.FROM_OPENID)
  const fromUnionId = text(context.FROM_UNIONID)
  const appId = text(context.APPID)
  const openId = text(context.OPENID)
  const unionId = text(context.UNIONID)
  const hasAnyFrom = Boolean(fromAppId || fromOpenId)

  let trustedAppId
  let trustedOpenId
  let trustedUnionId
  if (hasAnyFrom) {
    if (!fromAppId || !fromOpenId) {
      throw new Error('AUTH_REQUIRED')
    }
    trustedAppId = fromAppId
    trustedOpenId = fromOpenId
    trustedUnionId = fromUnionId
  }
  else {
    if (!appId || !openId) {
      throw new Error('AUTH_REQUIRED')
    }
    trustedAppId = appId
    trustedOpenId = openId
    trustedUnionId = unionId
  }

  if (!(allowedAppIds instanceof Set) || allowedAppIds.size === 0) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  if (!allowedAppIds.has(trustedAppId)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }

  const caller = {
    appId: trustedAppId,
    identityKey: createHmac('sha256', pepper)
      .update(`${trustedAppId}\0${trustedOpenId}`)
      .digest('hex'),
  }
  if (trustedUnionId && unionPepper) {
    if (typeof unionPepper !== 'string' || unionPepper.length < 32) {
      throw new Error('UNION_IDENTITY_CONFIG_REQUIRED')
    }
    caller.unionIdentityKey = createHmac('sha256', unionPepper)
      .update(trustedUnionId)
      .digest('hex')
  }
  return caller
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { resolveTrustedIdentity }
