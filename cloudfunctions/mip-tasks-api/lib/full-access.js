'use strict'

const defaultAgreements = Object.freeze([
  Object.freeze({ key: 'SERVICE_AGREEMENT', version: 'draft-2026-08-24' }),
  Object.freeze({ key: 'PRIVACY_POLICY', version: 'draft-2026-08-24' }),
])

function configuredAgreements(source = process.env.MIP_AGREEMENTS_JSON) {
  const normalized = String(source || '').trim()
  if (!normalized) return defaultAgreements.map(item => ({ ...item }))
  let parsed
  try {
    parsed = JSON.parse(normalized)
  }
  catch {
    throw new Error('AGREEMENT_CONFIG_INVALID')
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 5) {
    throw new Error('AGREEMENT_CONFIG_INVALID')
  }
  return parsed.map((item) => {
    if (!item || typeof item.key !== 'string'
      || !/^[A-Z][A-Z0-9_]{2,63}$/.test(item.key)
      || typeof item.version !== 'string') {
      throw new Error('AGREEMENT_CONFIG_INVALID')
    }
    return { key: item.key, version: item.version.slice(0, 32) }
  })
}

async function assertFullAccessReady(database, caller, agreements = configuredAgreements()) {
  const facts = await database.one(
    `SELECT u.status, u.primary_branch_id, profile.nickname,
            private_profile.phone_verified_at
     FROM mip_users u
     LEFT JOIN mip_profiles profile
       ON profile.app_id = u.app_id AND profile.user_id = u.id
     LEFT JOIN mip_private_profiles private_profile
       ON private_profile.app_id = u.app_id AND private_profile.user_id = u.id
     WHERE u.app_id = ? AND u.id = ?`,
    [caller.appId, caller.userId],
  )
  if (!facts) throw new Error('AUTH_REQUIRED')
  if (facts.status !== 'ACTIVE') throw new Error('FORBIDDEN')
  const acceptedRows = await database.query(
    `SELECT agreement_key, agreement_version FROM mip_agreement_acceptances
     WHERE app_id = ? AND user_id = ?`,
    [caller.appId, caller.userId],
  )
  const accepted = new Set((Array.isArray(acceptedRows) ? acceptedRows : []).map(
    row => `${row.agreement_key}:${row.agreement_version}`,
  ))
  if (!agreements.every(item => accepted.has(`${item.key}:${item.version}`))) {
    throw new Error('AGREEMENT_REQUIRED')
  }
  if (!facts.phone_verified_at) throw new Error('PHONE_REQUIRED')
  if (!facts.primary_branch_id || typeof facts.nickname !== 'string' || !facts.nickname.trim()) {
    throw new Error('PROFILE_REQUIRED')
  }
}

module.exports = { assertFullAccessReady, configuredAgreements, defaultAgreements }
