'use strict'

const { createHmac } = require('node:crypto')

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function trustedWechatIdentity(context = {}, options = {}) {
  const fromAppId = text(context.FROM_APPID)
  const fromOpenId = text(context.FROM_OPENID)
  const appId = text(context.APPID)
  const openId = text(context.OPENID)
  const delegated = Boolean(fromAppId || fromOpenId)
  const trustedAppId = delegated ? fromAppId : appId
  const trustedOpenId = delegated ? fromOpenId : openId
  if (!trustedAppId || !trustedOpenId || (delegated && (!fromAppId || !fromOpenId))) {
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

async function resolveCaller(database, identity) {
  const user = await database.one(
    `SELECT u.id, u.status
     FROM mip_user_identities identity
     INNER JOIN mip_users u ON u.app_id = identity.app_id AND u.id = identity.user_id
     WHERE identity.app_id = ? AND identity.provider = 'WECHAT_MINIPROGRAM'
       AND identity.identity_key = ?`,
    [identity.appId, identity.identityKey],
  )
  if (!user) throw new Error('AUTH_REQUIRED')
  if (user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
  return { appId: identity.appId, userId: user.id, openId: identity.openId }
}

module.exports = { resolveCaller, trustedWechatIdentity }
