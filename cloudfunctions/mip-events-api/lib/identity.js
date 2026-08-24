'use strict'

const { createHmac } = require('node:crypto')
const { DomainError } = require('../domain/rules')

function trustedWechatIdentity(context = {}, {
  requireUser = false,
  allowedAppIds = configuredAllowedAppIds(),
} = {}) {
  const fromAppId = typeof context.FROM_APPID === 'string' ? context.FROM_APPID.trim() : ''
  const fromOpenId = typeof context.FROM_OPENID === 'string' ? context.FROM_OPENID.trim() : ''
  const appId = typeof context.APPID === 'string' ? context.APPID.trim() : ''
  const openId = typeof context.OPENID === 'string' ? context.OPENID.trim() : ''
  if (fromAppId || fromOpenId) {
    if (!fromAppId || (requireUser && !fromOpenId)) {
      throw new DomainError('AUTH_REQUIRED', '请登录后继续')
    }
    assertAllowedAppId(fromAppId, allowedAppIds)
    return { appId: fromAppId, openId: fromOpenId || null }
  }
  if (!appId || (requireUser && !openId)) {
    throw new DomainError('AUTH_REQUIRED', '请登录后继续')
  }
  assertAllowedAppId(appId, allowedAppIds)
  return { appId, openId: openId || null }
}

function configuredAllowedAppIds() {
  return new Set(String(process.env.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean))
}

function assertAllowedAppId(appId, allowedAppIds) {
  if (!(allowedAppIds instanceof Set) || allowedAppIds.size === 0) {
    throw new DomainError('IDENTITY_CONFIG_REQUIRED', '身份服务尚未配置')
  }
  if (!allowedAppIds.has(appId)) {
    throw new DomainError('AUTH_REQUIRED', '请登录后继续')
  }
}

function identityKey(appId, openId, pepper = process.env.MIP_IDENTITY_PEPPER) {
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  return createHmac('sha256', pepper)
    .update(`${appId}\0${openId}`)
    .digest('hex')
}

async function resolveMipUser(db, identity, {
  required = false,
  lock = false,
  pepper = process.env.MIP_IDENTITY_PEPPER,
} = {}) {
  if (!identity.openId) {
    if (required) {
      throw new DomainError('AUTH_REQUIRED', '请登录后继续')
    }
    return null
  }
  const sql = `SELECT u.id, u.status, u.primary_branch_id
    FROM mip_user_identities i
    JOIN mip_users u ON u.app_id = i.app_id AND u.id = i.user_id
    WHERE i.app_id = ? AND i.provider = 'WECHAT_MINIPROGRAM' AND i.identity_key = ?
    ${lock ? 'FOR UPDATE' : ''}`
  const user = await db.one(sql, [identity.appId, identityKey(identity.appId, identity.openId, pepper)])
  if (!user || user.status !== 'ACTIVE') {
    if (required) {
      throw new DomainError('AUTH_REQUIRED', '请登录后继续')
    }
    return null
  }
  return user
}

module.exports = { configuredAllowedAppIds, identityKey, resolveMipUser, trustedWechatIdentity }
