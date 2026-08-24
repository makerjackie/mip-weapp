'use strict'

const { createHmac } = require('node:crypto')

function configuredAllowedAppIds(env = process.env) {
  return new Set(String(env.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean))
}

function trustedWechatIdentity(context, env = process.env) {
  const fromAppId = String(context?.FROM_APPID || '').trim()
  const fromOpenId = String(context?.FROM_OPENID || '').trim()
  const appId = String(context?.APPID || '').trim()
  const openId = String(context?.OPENID || '').trim()
  const shared = Boolean(fromAppId || fromOpenId)
  if (shared && (!fromAppId || !fromOpenId)) {
    throw new Error('AUTH_REQUIRED')
  }
  const trustedAppId = shared ? fromAppId : appId
  const trustedOpenId = shared ? fromOpenId : openId
  const allowed = configuredAllowedAppIds(env)
  const pepper = String(env.MIP_IDENTITY_PEPPER || '')
  if (!trustedAppId || !trustedOpenId || !allowed.size || !allowed.has(trustedAppId)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (pepper.length < 32) {
    throw new Error('SERVICE_UNAVAILABLE')
  }
  return {
    appId: trustedAppId,
    identityKey: createHmac('sha256', pepper)
      .update(`${trustedAppId}\0${trustedOpenId}`)
      .digest('hex'),
  }
}

async function resolveActiveUser(database, identity) {
  const user = await database.one(
    `SELECT u.id, u.status
     FROM mip_user_identities i
     INNER JOIN mip_users u ON u.app_id = i.app_id AND u.id = i.user_id
     WHERE i.app_id = ? AND i.provider = 'WECHAT_MINIPROGRAM'
       AND i.identity_key = ?
     LIMIT 1`,
    [identity.appId, identity.identityKey],
  )
  if (!user) {
    throw new Error('AUTH_REQUIRED')
  }
  if (user.status !== 'ACTIVE') {
    throw new Error('FORBIDDEN')
  }
  return { appId: identity.appId, userId: user.id }
}

module.exports = { configuredAllowedAppIds, resolveActiveUser, trustedWechatIdentity }
