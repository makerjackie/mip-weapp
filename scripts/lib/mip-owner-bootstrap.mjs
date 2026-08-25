import { createRequire } from 'node:module'
import { sqlLiteral } from './example-cloudbase.mjs'

const require = createRequire(import.meta.url)
const { defaultAgreements } = require('../../cloudfunctions/mip-identity-api/domain/service.js')
const { hashPhone } = require('../../cloudfunctions/mip-identity-api/lib/private-data.js')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const APP_ID_PATTERN = /^wx[0-9a-f]{16}$/i
const PHONE_HASH_PATTERN = /^[0-9a-f]{64}$/
const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'

export function resolveOwnerPhoneHash({ appId, ownerPhone, phoneEncryptionKey }) {
  if (!APP_ID_PATTERN.test(String(appId || ''))) {
    throw new Error('MINI_PROGRAM_APP_ID is invalid')
  }
  const phoneInfo = ownerPhoneInfo(ownerPhone)
  try {
    return hashPhone(phoneInfo, phoneEncryptionKey, { appId })
  }
  catch {
    throw new Error('MIP_PHONE_ENCRYPTION_KEY is missing or invalid')
  }
}

export function currentAgreementVersions(source) {
  const normalized = String(source || '').trim()
  let agreements = defaultAgreements
  if (normalized) {
    try {
      agreements = JSON.parse(normalized)
    }
    catch {
      throw new Error('MIP_AGREEMENTS_JSON is invalid')
    }
  }
  if (!Array.isArray(agreements) || agreements.length < 1 || agreements.length > 5) {
    throw new Error('MIP_AGREEMENTS_JSON is invalid')
  }
  return agreements.map((agreement) => {
    if (!agreement
      || typeof agreement.key !== 'string'
      || !/^[A-Z][A-Z0-9_]{2,63}$/.test(agreement.key)
      || typeof agreement.label !== 'string'
      || typeof agreement.version !== 'string'
      || typeof agreement.documentPath !== 'string'
      || !/^\/[\w/-]+$/.test(agreement.documentPath)) {
      throw new Error('MIP_AGREEMENTS_JSON is invalid')
    }
    return {
      key: agreement.key,
      version: agreement.version.slice(0, 32),
    }
  })
}

export function buildOwnerCandidateQuery({
  agreements,
  appId,
  demoUserIds = [],
  phoneHash,
  userId = '',
}) {
  const eligibilityWhere = buildOwnerEligibilityWhere({
    agreements,
    appId,
    demoUserIds,
    phoneHash,
    userId,
  })

  return `SELECT u.id AS candidateId
    FROM mip_users u
    INNER JOIN mip_profiles profile
      ON profile.app_id = u.app_id AND profile.user_id = u.id
    INNER JOIN mip_private_profiles private_profile
      ON private_profile.app_id = u.app_id AND private_profile.user_id = u.id
    WHERE ${eligibilityWhere}
    ORDER BY u.id
    LIMIT 2`
}

export function buildOwnerRoleUpsertQuery({
  agreements,
  appId,
  demoUserIds = [],
  phoneHash,
  userId,
}) {
  assertSelectedOwnerUserId(userId)
  const eligibilityWhere = buildOwnerEligibilityWhere({
    agreements,
    appId,
    demoUserIds,
    phoneHash,
    userId,
  })

  return `INSERT INTO mip_admin_role_bindings (
      id, app_id, user_id, scope_type, scope_id, role_key, status,
      granted_by_user_id, granted_at, revoked_at
    ) SELECT
      UUID(), ${sqlLiteral(appId)}, u.id, 'PLATFORM',
      ${sqlLiteral(PLATFORM_SCOPE_ID)}, 'PLATFORM_OWNER', 'ACTIVE',
      u.id, UTC_TIMESTAMP(3), NULL
    FROM mip_users u
    INNER JOIN mip_profiles profile
      ON profile.app_id = u.app_id AND profile.user_id = u.id
    INNER JOIN mip_private_profiles private_profile
      ON private_profile.app_id = u.app_id AND private_profile.user_id = u.id
    WHERE ${eligibilityWhere}
    ON DUPLICATE KEY UPDATE
      status = 'ACTIVE', granted_by_user_id = VALUES(granted_by_user_id),
      granted_at = UTC_TIMESTAMP(3), revoked_at = NULL`
}

export function buildOwnerVerificationQuery({
  agreements,
  appId,
  demoUserIds = [],
  phoneHash,
  userId,
}) {
  assertSelectedOwnerUserId(userId)
  const eligibilityWhere = buildOwnerEligibilityWhere({
    agreements,
    appId,
    demoUserIds,
    phoneHash,
    userId,
  })

  return `SELECT COUNT(*) AS ownerCount
    FROM mip_admin_role_bindings binding
    INNER JOIN mip_users u
      ON u.app_id = binding.app_id AND u.id = binding.user_id
    INNER JOIN mip_profiles profile
      ON profile.app_id = u.app_id AND profile.user_id = u.id
    INNER JOIN mip_private_profiles private_profile
      ON private_profile.app_id = u.app_id AND private_profile.user_id = u.id
    WHERE ${eligibilityWhere}
      AND binding.scope_type = 'PLATFORM'
      AND binding.scope_id = ${sqlLiteral(PLATFORM_SCOPE_ID)}
      AND binding.role_key = 'PLATFORM_OWNER'
      AND binding.status = 'ACTIVE'`
}

export function selectOwnerCandidateId(response, expectedUserId = '') {
  const candidateIds = [...new Set(collectCandidateIds(response))]
  if (candidateIds.length !== 1) {
    throw new Error(expectedUserId
      ? 'The selected verified MIP owner is not eligible'
      : 'Expected exactly one eligible verified-phone MIP owner')
  }
  if (expectedUserId && candidateIds[0] !== expectedUserId) {
    throw new Error('The selected verified MIP owner is not eligible')
  }
  return candidateIds[0]
}

function ownerPhoneInfo(value) {
  const normalized = String(value || '').trim()
  const match = normalized.match(/^(?:\+?86)?(1\d{10})$/)
  if (!match) {
    throw new Error('MIP_OWNER_PHONE is missing or invalid')
  }
  return { countryCode: '86', purePhoneNumber: match[1] }
}

function buildOwnerEligibilityWhere({ agreements, appId, demoUserIds, phoneHash, userId }) {
  assertOwnerQueryInput({ agreements, appId, demoUserIds, phoneHash, userId })
  const predicates = [
    `u.app_id = ${sqlLiteral(appId)}`,
    'u.status = \'ACTIVE\'',
    'u.primary_branch_id IS NOT NULL',
    'CHAR_LENGTH(TRIM(profile.nickname)) > 0',
    `private_profile.phone_hash = ${sqlLiteral(phoneHash)}`,
    'private_profile.phone_verified_at IS NOT NULL',
  ]
  if (userId) {
    predicates.push(`u.id = ${sqlLiteral(userId)}`)
  }
  if (demoUserIds.length) {
    predicates.push(`u.id NOT IN (${demoUserIds.map(sqlLiteral).join(', ')})`)
  }
  predicates.push(`NOT EXISTS (
        SELECT 1
        FROM mip_app_settings demo_manifest
        WHERE demo_manifest.app_id = u.app_id
          AND demo_manifest.setting_key LIKE 'demo_seed_manifest%'
          AND JSON_UNQUOTE(JSON_EXTRACT(demo_manifest.value_json, '$.is_demo')) = '1'
          AND JSON_SEARCH(
            JSON_EXTRACT(demo_manifest.value_json, '$.recordIds.users'),
            'one', u.id
          ) IS NOT NULL
      )`)
  for (const agreement of agreements) {
    predicates.push(`EXISTS (
        SELECT 1
        FROM mip_agreement_acceptances agreement
        WHERE agreement.app_id = u.app_id
          AND agreement.user_id = u.id
          AND agreement.agreement_key = ${sqlLiteral(agreement.key)}
          AND agreement.agreement_version = ${sqlLiteral(agreement.version)}
      )`)
  }
  return predicates.join('\n      AND ')
}

function assertOwnerQueryInput({ agreements, appId, demoUserIds, phoneHash, userId }) {
  if (!APP_ID_PATTERN.test(String(appId || ''))
    || !PHONE_HASH_PATTERN.test(String(phoneHash || ''))
    || !Array.isArray(agreements)
    || agreements.length < 1
    || agreements.length > 5
    || agreements.some(agreement => !agreement
      || typeof agreement.key !== 'string'
      || !/^[A-Z][A-Z0-9_]{2,63}$/.test(agreement.key)
      || typeof agreement.version !== 'string')
    || (userId && !UUID_PATTERN.test(userId))
    || !Array.isArray(demoUserIds)
    || demoUserIds.some(id => !UUID_PATTERN.test(id))) {
    throw new Error('Owner candidate query configuration is invalid')
  }
}

function assertSelectedOwnerUserId(userId) {
  if (!UUID_PATTERN.test(String(userId || ''))) {
    throw new Error('Selected owner query configuration is invalid')
  }
}

function collectCandidateIds(value, output = []) {
  if (!value || typeof value !== 'object') {
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCandidateIds(item, output)
    }
    return output
  }
  for (const [key, child] of Object.entries(value)) {
    if (['candidateid', 'candidate_id'].includes(key.toLowerCase()) && UUID_PATTERN.test(String(child || ''))) {
      output.push(String(child))
    }
    else if (child && typeof child === 'object') {
      collectCandidateIds(child, output)
    }
  }
  return output
}
