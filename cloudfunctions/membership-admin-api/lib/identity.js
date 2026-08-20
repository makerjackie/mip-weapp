'use strict'

/**
 * Atomic trusted WeChat identity.
 * Either the FROM_* pair is complete, or the APPID/OPENID pair is complete.
 * Mixed/partial pairs are rejected. Client ownership is never accepted.
 */
function resolveTrustedIdentity(context = {}, { errorCode = 'FORBIDDEN' } = {}) {
  const fromAppId = typeof context.FROM_APPID === 'string' ? context.FROM_APPID.trim() : ''
  const fromOpenId = typeof context.FROM_OPENID === 'string' ? context.FROM_OPENID.trim() : ''
  const appId = typeof context.APPID === 'string' ? context.APPID.trim() : ''
  const openId = typeof context.OPENID === 'string' ? context.OPENID.trim() : ''

  const hasAnyFrom = Boolean(fromAppId || fromOpenId)
  if (hasAnyFrom) {
    if (!fromAppId || !fromOpenId) {
      throw new Error(errorCode)
    }
    return { appId: fromAppId, openId: fromOpenId, source: 'from' }
  }

  if (!appId || !openId) {
    throw new Error(errorCode)
  }
  return { appId, openId, source: 'direct' }
}

module.exports = {
  resolveTrustedIdentity,
}
