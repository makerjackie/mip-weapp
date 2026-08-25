const SEED_TABLES = Object.freeze({
  branches: 'mip_city_branches',
  tags: 'mip_tags',
  membershipPlans: 'mip_membership_plans',
  growthLevels: 'mip_growth_levels',
  growthRules: 'mip_growth_rules',
  badges: 'mip_badges',
  users: 'mip_users',
  membershipOrders: 'mip_orders',
  entitlements: 'mip_membership_entitlements',
  events: 'mip_events',
  eventRegistrations: 'mip_event_registrations',
  opportunities: 'mip_opportunities',
  cooperationCards: 'mip_cooperation_cards',
  superCases: 'mip_super_cases',
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

export function buildSeedCollisionQuery(appId, seed) {
  if (!/^wx[0-9a-f]{16}$/i.test(String(appId || ''))) {
    throw new Error('MINI_PROGRAM_APP_ID is invalid')
  }
  const selects = []
  for (const [group, table] of Object.entries(SEED_TABLES)) {
    const ids = seedIds(seed, group)
    selects.push(`SELECT id FROM ${table} candidate
      WHERE candidate.app_id = ${literal(appId)}
        AND candidate.id IN (${ids.map(literal).join(', ')})
        AND NOT EXISTS (
          SELECT 1 FROM mip_app_settings demo_manifest
          WHERE demo_manifest.app_id = candidate.app_id
            AND demo_manifest.setting_key LIKE 'demo_seed_manifest%'
            AND JSON_UNQUOTE(JSON_EXTRACT(demo_manifest.value_json, '$.is_demo')) = '1'
            AND JSON_SEARCH(
              JSON_EXTRACT(demo_manifest.value_json, '$.recordIds.${group}'),
              'one', candidate.id
            ) IS NOT NULL
        )`)
  }
  selects.push(alternateKeySelect(appId, 'mip_city_branches', seed.branches, item => `branch_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_tags', seed.tags, item => `kind = ${literal(item.kind)} AND tag_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_membership_plans', seed.membershipPlans, item => `catalog_stage = 'TEST' AND plan_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_growth_levels', seed.growthLevels, item => `(level_key = ${literal(item.key)} OR minimum_experience = ${Number(item.minimumExperience)})`))
  selects.push(alternateKeySelect(appId, 'mip_growth_rules', seed.growthRules, item => `rule_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_badges', seed.badges, item => `badge_key = ${literal(item.key)}`))
  selects.push(alternateKeySelect(appId, 'mip_orders', seed.membershipOrders, (item, index) => `(merchant_order_no = ${literal(`MIP-DEMO-MEMBER-${index + 1}`)}
      OR (user_id = ${literal(item.userId)} AND order_type = 'MEMBERSHIP'
        AND idempotency_key = ${literal(item.key)}))`))
  selects.push(alternateKeySelect(appId, 'mip_membership_entitlements', seed.entitlements, item => `order_id = ${literal(item.orderId)}`))
  selects.push(alternateKeySelect(appId, 'mip_event_registrations', seed.eventRegistrations, item => `event_id = ${literal(item.eventId)} AND user_id = ${literal(item.userId)}`))
  selects.push(alternateKeySelect(appId, 'mip_cooperation_cards', seed.cooperationCards, item => `owner_user_id = ${literal(item.ownerUserId)}
      AND role_key = ${literal(item.roleKey)} AND status <> 'ARCHIVED'`))
  return `SELECT COUNT(*) AS conflicts FROM (\n${selects.join('\nUNION ALL\n')}\n) seed_same_app_collisions`
}

function seedIds(seed, group) {
  const ids = Array.isArray(seed?.[group]) ? seed[group].map(item => String(item?.id || '')) : []
  if (!ids.length || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error(`MIP demo seed ${group} identities are invalid`)
  }
  return ids
}

function alternateKeySelect(appId, table, items, condition) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error(`MIP demo seed ${table} alternate identities are invalid`)
  }
  return `SELECT id FROM ${table}
    WHERE app_id = ${literal(appId)}
      AND (${items.map((item, index) => `((${condition(item, index)}) AND id <> ${literal(item.id)})`).join('\n        OR ')})`
}

function literal(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`
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
