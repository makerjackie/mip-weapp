'use strict'

/**
 * Atomic trusted WeChat identity for payment callers.
 * Either the FROM_* pair is complete, or the APPID/OPENID pair is complete.
 * Mixed/partial pairs are rejected.
 */
function resolveTrustedIdentity(context = {}, { errorCode = 'IDENTITY_REQUIRED' } = {}) {
  const fromAppId = typeof context.FROM_APPID === 'string' ? context.FROM_APPID.trim() : ''
  const fromOpenId = typeof context.FROM_OPENID === 'string' ? context.FROM_OPENID.trim() : ''
  const appId = typeof context.APPID === 'string' ? context.APPID.trim() : ''
  const openId = typeof context.OPENID === 'string' ? context.OPENID.trim() : ''

  const hasAnyFrom = Boolean(fromAppId || fromOpenId)
  if (hasAnyFrom) {
    if (!fromAppId || !fromOpenId) {
      throw new Error(errorCode)
    }
    return { appId: fromAppId, openId: fromOpenId, userId: fromOpenId, source: 'from' }
  }

  if (!appId || !openId) {
    throw new Error(errorCode)
  }
  return { appId, openId, userId: openId, source: 'direct' }
}

module.exports = {
  resolveTrustedIdentity,
}
