const SEED_TABLES = Object.freeze({
  branches: 'mip_city_branches',
  tags: 'mip_tags',
  membershipPlans: 'mip_membership_plans',
  growthLevels: 'mip_growth_levels',
  growthRules: 'mip_growth_rules',
  badges: 'mip_badges',
})

export function buildSeedOwnershipQuery(appId, seed) {
  if (!/^wx[0-9a-f]{16}$/i.test(String(appId || ''))) {
    throw new Error('MINI_PROGRAM_APP_ID is invalid')
  }
  const selects = []
  for (const [group, table] of Object.entries(SEED_TABLES)) {
    const ids = Array.isArray(seed?.[group]) ? seed[group].map(item => String(item?.id || '')) : []
    if (!ids.length || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      throw new Error(`MIP demo seed ${group} identities are invalid`)
    }
    selects.push(`SELECT id FROM ${table}
      WHERE id IN (${ids.map(id => `'${id}'`).join(', ')}) AND app_id <> '${appId}'`)
  }
  return `SELECT COUNT(*) AS conflicts FROM (\n${selects.join('\nUNION ALL\n')}\n) seed_ownership_conflicts`
}

export function seedOwnershipConflictCount(value) {
  if (!value || typeof value !== 'object') {
    return null
  }
  if (!Array.isArray(value) && Object.hasOwn(value, 'conflicts')) {
    const count = Number(value.conflicts)
    return Number.isInteger(count) && count >= 0 ? count : null
  }
  for (const child of Object.values(value)) {
    const found = seedOwnershipConflictCount(child)
    if (found !== null) {
      return found
    }
  }
  return null
}

export { SEED_TABLES }
