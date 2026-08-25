'use strict'

const { createHmac } = require('node:crypto')

const defaultAgreementRequirements = Object.freeze([
  Object.freeze({ key: 'SERVICE_AGREEMENT', version: 'draft-2026-08-24' }),
  Object.freeze({ key: 'PRIVACY_POLICY', version: 'draft-2026-08-24' }),
])

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

function configuredAgreementRequirements(source = process.env.MIP_AGREEMENTS_JSON) {
  const serialized = String(source || '').trim()
  if (!serialized) {
    return defaultAgreementRequirements.map(requirement => ({ ...requirement }))
  }
  let parsed
  try {
    parsed = JSON.parse(serialized)
  }
  catch {
    throw new Error('AGREEMENT_CONFIG_INVALID')
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 5) {
    throw new Error('AGREEMENT_CONFIG_INVALID')
  }
  return parsed.map((agreement) => {
    if (!agreement
      || typeof agreement.key !== 'string'
      || !/^[A-Z][A-Z0-9_]{2,63}$/.test(agreement.key)
      || typeof agreement.version !== 'string') {
      throw new Error('AGREEMENT_CONFIG_INVALID')
    }
    return {
      key: agreement.key,
      version: agreement.version.slice(0, 32),
    }
  })
}

async function assertInteractionReady(
  database,
  caller,
  agreementRequirements = configuredAgreementRequirements(),
) {
  if (!Array.isArray(agreementRequirements) || !agreementRequirements.length) {
    throw new Error('AGREEMENT_CONFIG_INVALID')
  }
  const facts = await database.one(
    `SELECT user.status AS user_status, user.primary_branch_id,
            profile.nickname, private_profile.phone_verified_at
     FROM mip_users user
     LEFT JOIN mip_profiles profile
       ON profile.app_id = user.app_id AND profile.user_id = user.id
     LEFT JOIN mip_private_profiles private_profile
       ON private_profile.app_id = user.app_id AND private_profile.user_id = user.id
     WHERE user.app_id = ? AND user.id = ?
     LIMIT 1 FOR UPDATE`,
    [caller.appId, caller.userId],
  )
  if (!facts || facts.user_status !== 'ACTIVE') throw new Error('FORBIDDEN')
  const acceptances = await database.query(
    `SELECT agreement_key, agreement_version
     FROM mip_agreement_acceptances
     WHERE app_id = ? AND user_id = ?`,
    [caller.appId, caller.userId],
  )
  const accepted = new Set((Array.isArray(acceptances) ? acceptances : []).map(
    row => `${row.agreement_key}:${row.agreement_version}`,
  ))
  if (!agreementRequirements.every(
    requirement => accepted.has(`${requirement.key}:${requirement.version}`),
  )) throw new Error('AGREEMENT_REQUIRED')
  if (!facts.phone_verified_at) throw new Error('PHONE_REQUIRED')
  if (!facts.primary_branch_id
    || typeof facts.nickname !== 'string'
    || !facts.nickname.trim()) throw new Error('PROFILE_REQUIRED')
}

module.exports = {
  assertInteractionReady,
  configuredAgreementRequirements,
  configuredAllowedAppIds,
  defaultAgreementRequirements,
  resolveActiveUser,
  trustedWechatIdentity,
}
