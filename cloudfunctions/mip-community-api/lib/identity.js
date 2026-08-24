'use strict'

const { createHmac } = require('node:crypto')

function configuredAllowedAppIds() {
  return new Set(String(process.env.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean))
}

function trustedWechatIdentity(context = {}, options = {}) {
  const fromAppId = String(context.FROM_APPID || '').trim()
  const fromOpenId = String(context.FROM_OPENID || '').trim()
  const directAppId = String(context.APPID || '').trim()
  const directOpenId = String(context.OPENID || '').trim()
  const hasSharedIdentity = Boolean(fromAppId || fromOpenId)
  if (hasSharedIdentity && (!fromAppId || !fromOpenId)) {
    throw new Error('AUTH_REQUIRED')
  }
  const appId = hasSharedIdentity ? fromAppId : directAppId
  const openId = hasSharedIdentity ? fromOpenId : directOpenId
  const allowedAppIds = options.allowedAppIds || configuredAllowedAppIds()
  const pepper = options.pepper || process.env.MIP_IDENTITY_PEPPER
  if (!appId || !openId || !allowedAppIds.size || !allowedAppIds.has(appId)) {
    throw new Error('AUTH_REQUIRED')
  }
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('IDENTITY_CONFIG_REQUIRED')
  }
  return {
    appId,
    identityKey: createHmac('sha256', pepper).update(`${appId}\0${openId}`).digest('hex'),
  }
}

async function resolveActiveUser(database, identity) {
  const user = await database.one(
    `SELECT u.id, u.status, u.primary_branch_id
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
  return { appId: identity.appId, userId: user.id, primaryBranchId: user.primary_branch_id || null }
}

async function assertInteractionReady(database, caller) {
  const facts = await database.one(
    `SELECT
       EXISTS(
         SELECT 1 FROM mip_profiles p
         WHERE p.app_id = ? AND p.user_id = ? AND p.nickname <> ''
       ) AS has_profile,
       EXISTS(
         SELECT 1 FROM mip_private_profiles private_profile
         WHERE private_profile.app_id = ? AND private_profile.user_id = ?
           AND private_profile.phone_verified_at IS NOT NULL
       ) AS has_phone,
       EXISTS(
         SELECT 1 FROM mip_agreement_acceptances acceptance
         WHERE acceptance.app_id = ? AND acceptance.user_id = ?
       ) AS has_agreement`,
    [caller.appId, caller.userId, caller.appId, caller.userId, caller.appId, caller.userId],
  )
  if (!Number(facts?.has_agreement)) throw new Error('AGREEMENT_REQUIRED')
  if (!Number(facts?.has_phone)) throw new Error('PHONE_REQUIRED')
  if (!Number(facts?.has_profile) || !caller.primaryBranchId) throw new Error('PROFILE_REQUIRED')
}

module.exports = {
  assertInteractionReady,
  configuredAllowedAppIds,
  resolveActiveUser,
  trustedWechatIdentity,
}
