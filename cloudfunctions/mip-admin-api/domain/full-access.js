'use strict'

const defaultAgreements = Object.freeze([
  Object.freeze({
    key: 'SERVICE_AGREEMENT',
    label: '用户协议',
    version: 'draft-2026-08-24',
    documentPath: '/packages/member/user-agreement/index',
  }),
  Object.freeze({
    key: 'PRIVACY_POLICY',
    label: '隐私政策',
    version: 'draft-2026-08-24',
    documentPath: '/packages/member/privacy-policy/index',
  }),
])

function configuredAgreements(source = process.env.MIP_AGREEMENTS_JSON) {
  const normalized = String(source || '').trim()
  if (!normalized) return defaultAgreements.map(agreement => ({ ...agreement }))
  const parsed = JSON.parse(normalized)
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
      label: agreement.label.slice(0, 40),
      version: agreement.version.slice(0, 32),
      documentPath: agreement.documentPath,
    }
  })
}

function createFullAccessPolicy(options = {}) {
  const agreements = normalizeAgreementRequirements(options.agreements || defaultAgreements)

  async function loadByIdentity(queryable, caller, options = {}) {
    const lock = options.lock === true
    const agreementFacts = agreementSelections(agreements)
    const row = await queryable.one(
      `SELECT u.id, u.status, u.primary_branch_id,
              profile.nickname, private_profile.phone_verified_at,
              ${agreementFacts.sql}
       FROM mip_user_identities identity
       INNER JOIN mip_users u
         ON u.app_id = identity.app_id AND u.id = identity.user_id
       LEFT JOIN mip_profiles profile
         ON profile.app_id = u.app_id AND profile.user_id = u.id
       LEFT JOIN mip_private_profiles private_profile
         ON private_profile.app_id = u.app_id AND private_profile.user_id = u.id
       WHERE identity.app_id = ?
         AND identity.provider = 'WECHAT_MINIPROGRAM'
         AND identity.identity_key = ?
       LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [...agreementFacts.params, caller.appId, caller.identityKey],
    )
    return accessUser(row, agreements)
  }

  async function loadByUserId(queryable, appId, userId, options = {}) {
    const agreementFacts = agreementSelections(agreements)
    const row = await queryable.one(
      `SELECT u.id, u.status, u.primary_branch_id,
              profile.nickname, private_profile.phone_verified_at,
              ${agreementFacts.sql}
       FROM mip_users u
       LEFT JOIN mip_profiles profile
         ON profile.app_id = u.app_id AND profile.user_id = u.id
       LEFT JOIN mip_private_profiles private_profile
         ON private_profile.app_id = u.app_id AND private_profile.user_id = u.id
       WHERE u.app_id = ? AND u.id = ?
       LIMIT 1${options.lock === true ? ' FOR UPDATE' : ''}`,
      [...agreementFacts.params, appId, userId],
    )
    return accessUser(row, agreements)
  }

  return { agreements, loadByIdentity, loadByUserId }
}

function agreementSelections(agreements) {
  return {
    sql: agreements.map((_, index) => `EXISTS (
                SELECT 1 FROM mip_agreement_acceptances agreement_${index}
                WHERE agreement_${index}.app_id = u.app_id
                  AND agreement_${index}.user_id = u.id
                  AND agreement_${index}.agreement_key = ?
                  AND agreement_${index}.agreement_version = ?
              ) AS agreement_${index}_accepted`).join(',\n              '),
    params: agreements.flatMap(agreement => [agreement.key, agreement.version]),
  }
}

function normalizeAgreementRequirements(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    throw new Error('AGREEMENT_CONFIG_INVALID')
  }
  return value.map((agreement) => {
    if (!agreement
      || typeof agreement.key !== 'string'
      || !/^[A-Z][A-Z0-9_]{2,63}$/.test(agreement.key)
      || typeof agreement.version !== 'string') {
      throw new Error('AGREEMENT_CONFIG_INVALID')
    }
    return { key: agreement.key, version: agreement.version.slice(0, 32) }
  })
}

function accessUser(row, agreements) {
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    phoneBound: Boolean(row.phone_verified_at),
    profileComplete: Boolean(
      row.primary_branch_id
      && typeof row.nickname === 'string'
      && row.nickname.trim(),
    ),
    agreementsAccepted: agreements.every(
      (_, index) => Number(row[`agreement_${index}_accepted`]) === 1,
    ),
  }
}

function assertFullAccessUser(user) {
  if (!user) throw new Error('AUTH_REQUIRED')
  if (user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
  if (!user.agreementsAccepted) throw new Error('AGREEMENT_REQUIRED')
  if (!user.phoneBound) throw new Error('PHONE_REQUIRED')
  if (!user.profileComplete) throw new Error('PROFILE_REQUIRED')
  return user
}

module.exports = {
  assertFullAccessUser,
  configuredAgreements,
  createFullAccessPolicy,
  defaultAgreements,
}
