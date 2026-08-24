'use strict'

const { createHmac } = require('node:crypto')

function trustedWechatIdentity(context = {}, options = {}) {
  const fromAppId = text(context.FROM_APPID)
  const fromOpenId = text(context.FROM_OPENID)
  const appId = text(context.APPID)
  const openId = text(context.OPENID)
  const hasFrom = Boolean(fromAppId || fromOpenId)
  const trustedAppId = hasFrom ? fromAppId : appId
  const trustedOpenId = hasFrom ? fromOpenId : openId
  if (!trustedAppId || !trustedOpenId || (hasFrom && (!fromAppId || !fromOpenId))) {
    throw new Error('AUTH_REQUIRED')
  }
  if (!(options.allowedAppIds instanceof Set) || !options.allowedAppIds.has(trustedAppId)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (typeof options.pepper !== 'string' || options.pepper.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  return {
    appId: trustedAppId,
    openId: trustedOpenId,
    identityKey: createHmac('sha256', options.pepper)
      .update(`${trustedAppId}\0${trustedOpenId}`)
      .digest('hex'),
  }
}

async function resolveMipUser(database, identity) {
  const user = await database.one(
    `SELECT u.id, u.status
     FROM mip_user_identities i
     INNER JOIN mip_users u ON u.app_id = i.app_id AND u.id = i.user_id
     WHERE i.app_id = ? AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?`,
    [identity.appId, identity.identityKey],
  )
  if (!user) throw new Error('AUTH_REQUIRED')
  if (user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
  return { appId: identity.appId, userId: user.id, openId: identity.openId }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = { resolveMipUser, trustedWechatIdentity }
