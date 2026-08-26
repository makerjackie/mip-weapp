export const MIP_MEMBERSHIP_CHAIN_RECONCILE_SQL = `INSERT INTO mip_membership_chains (
  app_id, user_id, version, created_at, updated_at
)
SELECT membership_user.app_id, membership_user.id, 1,
  UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM mip_users membership_user
ON DUPLICATE KEY UPDATE user_id = mip_membership_chains.user_id`

export const MIP_MEMBERSHIP_CHAIN_INVARIANT_SQL = `SELECT
  (SELECT COUNT(*) FROM mip_users) AS userCount,
  (SELECT COUNT(*) FROM mip_membership_chains) AS chainCount,
  (SELECT COUNT(*)
   FROM mip_users membership_user
   LEFT JOIN mip_membership_chains membership_chain
     ON membership_chain.app_id = membership_user.app_id
     AND membership_chain.user_id = membership_user.id
   WHERE membership_chain.user_id IS NULL) AS missingChains,
  (SELECT COUNT(*)
   FROM mip_membership_chains membership_chain
   LEFT JOIN mip_users membership_user
     ON membership_user.app_id = membership_chain.app_id
     AND membership_user.id = membership_chain.user_id
   WHERE membership_user.id IS NULL) AS orphanChains`

const INVARIANT_FIELDS = Object.freeze([
  'userCount',
  'chainCount',
  'missingChains',
  'orphanChains',
])

export function assertMembershipChainReconcileConfirmation({
  envId,
  confirmedEnv,
  confirmedPrefix,
}) {
  if (!String(envId || '').trim() || confirmedEnv !== envId) {
    throw new Error('Membership-chain reconcile requires --confirm-env=<exact CLOUDBASE_ENV_ID>')
  }
  if (confirmedPrefix !== 'mip_') {
    throw new Error('Membership-chain reconcile requires --confirm-prefix=mip_')
  }
  return Object.freeze({ envId, tablePrefix: 'mip_' })
}

export function parseMembershipChainInvariant(value) {
  const row = findInvariantRow(value)
  if (!row) {
    throw new Error('Membership-chain invariant query did not return a complete count row')
  }
  const result = Object.fromEntries(INVARIANT_FIELDS.map((field) => {
    const count = Number(fieldValue(row, field))
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Membership-chain invariant ${field} is invalid`)
    }
    return [field, count]
  }))
  return Object.freeze(result)
}

export function assertMembershipChainInvariant(value) {
  const counts = parseMembershipChainInvariant(value)
  if (counts.missingChains !== 0
    || counts.orphanChains !== 0
    || counts.userCount !== counts.chainCount) {
    throw new Error('Membership chains are not in a 1:1 relationship with MIP users')
  }
  return counts
}

function findInvariantRow(value) {
  if (!value || typeof value !== 'object') {
    return null
  }
  if (!Array.isArray(value)
    && INVARIANT_FIELDS.every(field => fieldValue(value, field) !== undefined)) {
    return value
  }
  for (const child of Object.values(value)) {
    const row = findInvariantRow(child)
    if (row) {
      return row
    }
  }
  return null
}

function fieldValue(row, expected) {
  const entry = Object.entries(row)
    .find(([key]) => key.toLowerCase() === expected.toLowerCase())
  return entry?.[1]
}
