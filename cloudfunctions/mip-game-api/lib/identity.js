'use strict'

const { createHmac } = require('node:crypto')

function trustedWechatIdentity(context = {}, options = {}) {
  const fromAppId = text(context.FROM_APPID)
  const fromOpenId = text(context.FROM_OPENID)
  const delegated = Boolean(fromAppId || fromOpenId)
  const appId = delegated ? fromAppId : text(context.APPID)
  const openId = delegated ? fromOpenId : text(context.OPENID)
  if (!appId || !openId || (delegated && (!fromAppId || !fromOpenId))) throw new Error('AUTH_REQUIRED')
  if (!(options.allowedAppIds instanceof Set) || !options.allowedAppIds.has(appId)) throw new Error('AUTH_REQUIRED')
  if (typeof options.pepper !== 'string' || options.pepper.length < 32) throw new Error('IDENTITY_CONFIG_REQUIRED')
  return {
    appId,
    identityKey: createHmac('sha256', options.pepper).update(`${appId}\0${openId}`).digest('hex'),
  }
}

async function resolveCaller(database, identity) {
  const user = await database.one(
    `SELECT user.id, user.status FROM mip_user_identities identity
     INNER JOIN mip_users user ON user.app_id = identity.app_id AND user.id = identity.user_id
     WHERE identity.app_id = ? AND identity.provider = 'WECHAT_MINIPROGRAM' AND identity.identity_key = ?`,
    [identity.appId, identity.identityKey],
  )
  if (!user) throw new Error('AUTH_REQUIRED')
  if (user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
  return { appId: identity.appId, userId: user.id }
}

function text(value) { return typeof value === 'string' ? value.trim() : '' }

module.exports = { resolveCaller, trustedWechatIdentity }
