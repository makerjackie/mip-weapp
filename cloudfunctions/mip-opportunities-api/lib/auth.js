'use strict'

const { createHmac } = require('node:crypto')

const defaultAgreementRequirements = Object.freeze([
  Object.freeze({ key: 'SERVICE_AGREEMENT', version: 'draft-2026-08-24' }),
  Object.freeze({ key: 'PRIVACY_POLICY', version: 'draft-2026-08-24' }),
])

const fullAccessActions = new Set([
  'saveOpportunity',
  'endOpportunity',
  'setReferral',
  'setProfileInterest',
  'saveCooperationCard',
  'unpublishCooperationCard',
  'archiveCooperationCard',
  'saveSuperCase',
  'unpublishSuperCase',
  'archiveSuperCase',
  'getOpportunityCommentSettings',
  'listOpportunityComments',
  'saveOpportunityComment',
  'deleteOpportunityComment',
  'setOpportunityCommentCall',
  'reportOpportunityComment',
])

function allowedAppIds() {
  return new Set(String(process.env.MIP_ALLOWED_APP_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean))
}

function trustedWechatIdentity(context) {
  const fromAppId = String(context?.FROM_APPID || '').trim()
  const fromOpenId = String(context?.FROM_OPENID || '').trim()
  const directAppId = String(context?.APPID || '').trim()
  const directOpenId = String(context?.OPENID || '').trim()
  const hasSharedIdentity = Boolean(fromAppId || fromOpenId)
  if (hasSharedIdentity && (!fromAppId || !fromOpenId)) {
    throw new Error('AUTH_REQUIRED')
  }
  const appId = hasSharedIdentity ? fromAppId : directAppId
  const openId = hasSharedIdentity ? fromOpenId : directOpenId
  const allowed = allowedAppIds()
  const pepper = String(process.env.MIP_IDENTITY_PEPPER || '')
  if (!appId || !openId || !allowed.size || !allowed.has(appId) || pepper.length < 32) {
    throw new Error('SERVICE_UNAVAILABLE')
  }
  const identityKey = createHmac('sha256', pepper)
    .update(`${appId}\0${openId}`)
    .digest('hex')
  return { appId, identityKey, openId }
}

async function resolveCaller(database, identity, { required = false } = {}) {
  const user = await database.one(
    `SELECT u.id, u.primary_branch_id, u.status
     FROM mip_user_identities i
     INNER JOIN mip_users u ON u.app_id = i.app_id AND u.id = i.user_id
     WHERE i.app_id = ? AND i.provider = 'WECHAT_MINIPROGRAM'
       AND i.identity_key = ?
     LIMIT 1`,
    [identity.appId, identity.identityKey],
  )
  if (!user) {
    if (required) {
      throw new Error('AUTH_REQUIRED')
    }
    return { appId: identity.appId, openId: identity.openId, userId: null }
  }
  if (user.status !== 'ACTIVE') {
    throw new Error('FORBIDDEN')
  }
  return {
    appId: identity.appId,
    openId: identity.openId,
    userId: user.id,
    primaryBranchId: user.primary_branch_id || null,
  }
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
      || typeof agreement.label !== 'string'
      || typeof agreement.version !== 'string'
      || typeof agreement.documentPath !== 'string'
      || !/^\/[A-Za-z0-9_/-]+$/.test(agreement.documentPath)) {
      throw new Error('AGREEMENT_CONFIG_INVALID')
    }
    return {
      key: agreement.key,
      version: agreement.version.slice(0, 32),
    }
  })
}

function requiresFullAccessAction(action) {
  return fullAccessActions.has(action)
}

async function assertFullAccessReady(database, caller, agreementRequirements) {
  if (!caller.userId) {
    throw new Error('AUTH_REQUIRED')
  }
  if (!Array.isArray(agreementRequirements) || !agreementRequirements.length) {
    throw new Error('AGREEMENT_CONFIG_INVALID')
  }
  const facts = await database.one(
    `SELECT u.status AS user_status, u.primary_branch_id,
            p.nickname, private_profile.phone_verified_at
     FROM mip_users u
     LEFT JOIN mip_profiles p
       ON p.app_id = u.app_id AND p.user_id = u.id
     LEFT JOIN mip_private_profiles private_profile
       ON private_profile.app_id = u.app_id AND private_profile.user_id = u.id
     WHERE u.app_id = ? AND u.id = ?
     LIMIT 1`,
    [caller.appId, caller.userId],
  )
  if (!facts) {
    throw new Error('AUTH_REQUIRED')
  }
  if (facts.user_status !== 'ACTIVE') {
    throw new Error('FORBIDDEN')
  }
  const acceptanceRows = await database.query(
    `SELECT agreement_key, agreement_version
     FROM mip_agreement_acceptances
     WHERE app_id = ? AND user_id = ?`,
    [caller.appId, caller.userId],
  )
  const accepted = new Set((Array.isArray(acceptanceRows) ? acceptanceRows : []).map(
    row => `${row.agreement_key}:${row.agreement_version}`,
  ))
  if (!agreementRequirements.every(
    requirement => accepted.has(`${requirement.key}:${requirement.version}`),
  )) {
    throw new Error('AGREEMENT_REQUIRED')
  }
  if (!facts.phone_verified_at) {
    throw new Error('PHONE_REQUIRED')
  }
  if (typeof facts.nickname !== 'string'
    || !facts.nickname.trim()
    || !facts.primary_branch_id) {
    throw new Error('PROFILE_REQUIRED')
  }
}

async function lockActiveContributor(tx, caller) {
  const user = await tx.one(
    `SELECT id, status FROM mip_users
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [caller.appId, caller.userId],
  )
  if (!user || user.status !== 'ACTIVE') {
    throw new Error('FORBIDDEN')
  }
}

module.exports = {
  assertFullAccessReady,
  configuredAgreementRequirements,
  lockActiveContributor,
  requiresFullAccessAction,
  resolveCaller,
  trustedWechatIdentity,
}
