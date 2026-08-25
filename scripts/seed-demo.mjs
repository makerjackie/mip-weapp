#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
  sqlJson,
  sqlLiteral,
} from './lib/example-cloudbase.mjs'
import {
  buildSeedCollisionQuery,
  buildSeedOwnershipQuery,
  seedOwnershipConflictCount,
} from './lib/mip-seed-safety.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = String(env.CLOUDBASE_ENV_ID || '').trim()
const appId = String(env.MINI_PROGRAM_APP_ID || '').trim()
const stage = String(env.MIP_DEPLOYMENT_STAGE || '').trim().toLowerCase()
const catalogStage = String(env.MIP_CATALOG_STAGE || 'TEST').trim().toUpperCase()
const confirmedEnv = process.argv.find(value => value.startsWith('--confirm-env='))?.slice('--confirm-env='.length)

if (!process.argv.includes('--confirm-demo') || !envId || confirmedEnv !== envId) {
  throw new Error('MIP demo seed requires --confirm-demo and --confirm-env=<exact CLOUDBASE_ENV_ID>')
}
if (!/^wx[0-9a-f]{16}$/i.test(appId)) {
  throw new Error('MINI_PROGRAM_APP_ID is invalid')
}
if (!['development', 'test'].includes(stage) || catalogStage !== 'TEST') {
  throw new Error('MIP demo seed is restricted to development/test with MIP_CATALOG_STAGE=TEST')
}
if (String(env.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase() === 'live') {
  throw new Error('MIP demo seed cannot run while live payment is enabled')
}

const seedPath = path.join(root, 'database', 'mysql', 'mip', 'seed.demo.json')
const seedSource = fs.readFileSync(seedPath, 'utf8')
const seed = JSON.parse(seedSource)
const seedSha256 = createHash('sha256').update(seedSource).digest('hex')
assertSeed(seed)
bindAndRequireMysqlEnvironment(root, envId, { development: true, stage })
assertTablesExist([
  'mip_city_branches',
  'mip_tags',
  'mip_membership_plans',
  'mip_growth_levels',
  'mip_growth_rules',
  'mip_badges',
  'mip_users',
  'mip_branch_memberships',
  'mip_profiles',
  'mip_profile_tags',
  'mip_growth_accounts',
  'mip_orders',
  'mip_membership_entitlements',
  'mip_events',
  'mip_event_registrations',
  'mip_opportunities',
  'mip_opportunity_roles',
  'mip_opportunity_tags',
  'mip_cooperation_cards',
  'mip_super_cases',
  'mip_app_settings',
])

const ownershipProbe = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildSeedOwnershipQuery(appId, seed),
})
const ownershipConflicts = seedOwnershipConflictCount(ownershipProbe)
if (ownershipConflicts === null) {
  throw new Error('MIP demo seed ownership preflight could not be verified')
}
if (ownershipConflicts > 0) {
  throw new Error('MIP demo seed IDs already belong to another AppID; no seed writes were attempted')
}
const collisionProbe = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: buildSeedCollisionQuery(appId, seed),
})
const sameAppCollisions = seedOwnershipConflictCount(collisionProbe)
if (sameAppCollisions === null) {
  throw new Error('MIP demo seed same-AppID collision preflight could not be verified')
}
if (sameAppCollisions > 0) {
  throw new Error('MIP demo seed conflicts with records outside the demo manifest; no seed writes were attempted')
}

const statements = [
  demoManifestStatement(seed, 'PENDING'),
  branchStatement(seed.branches),
  ...tagStatements(seed.tags),
  membershipPlanStatement(seed.membershipPlans),
  growthLevelStatement(seed.growthLevels),
  growthRuleStatement(seed.growthRules),
  badgeStatement(seed.badges),
  userStatement(seed.users),
  branchMembershipResetStatement(seed.users),
  branchMembershipStatement(seed.users),
  userPrimaryBranchStatement(seed.users),
  profileStatement(seed.users),
  profileTagResetStatement(seed.users),
  profileTagStatement(seed.users),
  growthAccountStatement(seed.users),
  membershipOrderStatement(seed.membershipOrders, seed.membershipPlans),
  entitlementStatement(seed.entitlements, seed.membershipPlans),
  eventStatement(seed.events),
  eventRegistrationStatement(seed.eventRegistrations),
  opportunityStatement(seed.opportunities),
  opportunityRoleResetStatement(seed.opportunities),
  opportunityRoleStatement(seed.opportunities),
  opportunityTagResetStatement(seed.opportunities),
  opportunityTagStatement(seed.opportunities, seed.tags),
  cooperationCardStatement(seed.cooperationCards),
  superCaseStatement(seed.superCases),
  `INSERT INTO mip_app_settings (
     app_id, setting_key, value_json, version, updated_by_user_id
   ) VALUES (
     ${sqlLiteral(appId)}, 'placeholder_catalog',
     ${sqlJson({ version: seed.version, replaceBeforeProduction: true })}, 1, NULL
   ) ON DUPLICATE KEY UPDATE
     value_json = VALUES(value_json), version = version + 1, updated_by_user_id = NULL`,
  demoManifestStatement(seed, 'READY'),
]

for (const [index, sql] of statements.entries()) {
  try {
    const result = callCloudbase(root, 'manageMysqlDatabase', {
      action: 'runStatement',
      sql,
    }, 300000)
    if (result?.success === false) {
      throw new Error('management API reported failure')
    }
  }
  catch (error) {
    throw new Error(`MIP demo seed step ${index + 1}/${statements.length} did not converge: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const verification = callCloudbase(root, 'queryMysqlDatabase', {
  action: 'runQuery',
  sql: `SELECT
    (SELECT COUNT(*) FROM mip_city_branches
      WHERE app_id = ${sqlLiteral(appId)}
        AND branch_key IN (${seed.branches.map(item => sqlLiteral(item.key)).join(', ')})) AS branches,
    (SELECT COUNT(*) FROM mip_tags
      WHERE app_id = ${sqlLiteral(appId)}
        AND CONCAT(kind, ':', tag_key) IN (${seed.tags.map(item => sqlLiteral(`${item.kind}:${item.key}`)).join(', ')})) AS tags,
    (SELECT COUNT(*) FROM mip_membership_plans
      WHERE app_id = ${sqlLiteral(appId)} AND catalog_stage = 'TEST'
        AND plan_key IN (${seed.membershipPlans.map(item => sqlLiteral(item.key)).join(', ')})) AS plans,
    (SELECT COUNT(*) FROM mip_growth_levels
      WHERE app_id = ${sqlLiteral(appId)}
        AND level_key IN (${seed.growthLevels.map(item => sqlLiteral(item.key)).join(', ')})) AS levels,
    (SELECT COUNT(*) FROM mip_growth_rules
      WHERE app_id = ${sqlLiteral(appId)}
        AND rule_key IN (${seed.growthRules.map(item => sqlLiteral(item.key)).join(', ')})) AS rules,
    (SELECT COUNT(*) FROM mip_badges
      WHERE app_id = ${sqlLiteral(appId)}
        AND badge_key IN (${seed.badges.map(item => sqlLiteral(item.key)).join(', ')})) AS badges,
    (SELECT COUNT(*) FROM mip_users
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.users.map(item => sqlLiteral(item.id)).join(', ')})) AS users,
    (SELECT COUNT(*) FROM mip_orders
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.membershipOrders.map(item => sqlLiteral(item.id)).join(', ')})) AS membershipOrders,
    (SELECT COUNT(*) FROM mip_membership_entitlements
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.entitlements.map(item => sqlLiteral(item.id)).join(', ')})) AS entitlements,
    (SELECT COUNT(*) FROM mip_events
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.events.map(item => sqlLiteral(item.id)).join(', ')})) AS events,
    (SELECT COUNT(*) FROM mip_event_registrations
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.eventRegistrations.map(item => sqlLiteral(item.id)).join(', ')})) AS eventRegistrations,
    (SELECT COUNT(*) FROM mip_opportunities
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.opportunities.map(item => sqlLiteral(item.id)).join(', ')})) AS opportunities,
    (SELECT COUNT(*) FROM mip_cooperation_cards
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.cooperationCards.map(item => sqlLiteral(item.id)).join(', ')})) AS cooperationCards,
    (SELECT COUNT(*) FROM mip_super_cases
      WHERE app_id = ${sqlLiteral(appId)}
        AND id IN (${seed.superCases.map(item => sqlLiteral(item.id)).join(', ')})) AS superCases`,
})
const expected = {
  branches: seed.branches.length,
  tags: seed.tags.length,
  plans: seed.membershipPlans.length,
  levels: seed.growthLevels.length,
  rules: seed.growthRules.length,
  badges: seed.badges.length,
  users: seed.users.length,
  membershipOrders: seed.membershipOrders.length,
  entitlements: seed.entitlements.length,
  events: seed.events.length,
  eventRegistrations: seed.eventRegistrations.length,
  opportunities: seed.opportunities.length,
  cooperationCards: seed.cooperationCards.length,
  superCases: seed.superCases.length,
}
const counts = findCountRow(verification, Object.keys(expected))
if (!counts || Object.entries(expected).some(([key, value]) => Number(counts[key]) !== value)) {
  throw new Error('MIP demo catalog verification failed')
}

fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
fs.writeFileSync(path.join(root, '.tmp', 'seed-demo-result.json'), `${JSON.stringify({
  environmentVerified: true,
  catalogStage: 'TEST',
  seedVersion: seed.version,
  replaceBeforeProduction: true,
  recordsVerified: expected,
  seededAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log('[mip-seed] placeholder catalogs and fixed-ID demo fixtures verified; no environment or AppID was persisted')

function branchStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)},
    ${sqlLiteral(item.name)}, ${sqlLiteral(item.cityName)}, ${sqlLiteral(item.summary)},
    'ACTIVE', NULL, 1
  )`).join(',\n')
  return `INSERT INTO mip_city_branches (
    id, app_id, branch_key, name, city_name, summary, status, created_by_user_id, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    name = VALUES(name), city_name = VALUES(city_name), summary = VALUES(summary),
    status = 'ACTIVE', version = version + 1`
}

function tagStatements(items) {
  const roots = items.filter(item => !item.parentId)
  const children = items.filter(item => item.parentId)
  return [roots, children].filter(group => group.length).map(tagStatement)
}

function tagStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.kind)}, ${sqlLiteral(item.parentId)},
    ${sqlLiteral(item.key)}, ${sqlLiteral(item.label)}, ${item.selectable ? 1 : 0}, ${item.popular ? 1 : 0}, 1,
    ${Number(item.sortOrder)}
  )`).join(',\n')
  return `INSERT INTO mip_tags (
    id, app_id, kind, parent_id, tag_key, label, selectable, popular, enabled, sort_order
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    parent_id = VALUES(parent_id), label = VALUES(label), selectable = VALUES(selectable),
    popular = VALUES(popular), enabled = 1,
    sort_order = VALUES(sort_order)`
}

function membershipPlanStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, 'TEST',
    ${sqlLiteral(item.name)}, ${sqlLiteral(item.description)}, ${Number(item.durationDays)},
    ${Number(item.priceCents)}, 'CNY', ${sqlJson(item.benefits)}, 'ACTIVE', 1
  )`).join(',\n')
  return `INSERT INTO mip_membership_plans (
    id, app_id, plan_key, catalog_stage, name, description, duration_days,
    price_cents, currency, benefits_json, status, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    plan_key = VALUES(plan_key), name = VALUES(name), description = VALUES(description),
    duration_days = VALUES(duration_days), price_cents = VALUES(price_cents),
    benefits_json = VALUES(benefits_json), status = 'ACTIVE', version = version + 1`
}

function growthLevelStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.displayBadge)}, ${Number(item.minimumExperience)}, ${Number(item.sortOrder)},
    ${sqlJson(item.benefits)}, 'ACTIVE', 1
  )`).join(',\n')
  return `INSERT INTO mip_growth_levels (
    id, app_id, level_key, name, display_badge, minimum_experience, sort_order,
    benefits_json, status, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    level_key = VALUES(level_key), name = VALUES(name), display_badge = VALUES(display_badge),
    minimum_experience = VALUES(minimum_experience), sort_order = VALUES(sort_order),
    benefits_json = VALUES(benefits_json), status = 'ACTIVE', version = version + 1`
}

function growthRuleStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.metric)}, ${Number(item.deltaValue)},
    ${item.dailyLimitValue === null ? 'NULL' : Number(item.dailyLimitValue)},
    ${sqlLiteral(item.sourceEventType)}, ${sqlLiteral(item.status)}, 1
  )`).join(',\n')
  return `INSERT INTO mip_growth_rules (
    id, app_id, rule_key, name, metric, delta_value, daily_limit_value,
    source_event_type, status, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    name = VALUES(name), metric = VALUES(metric), delta_value = VALUES(delta_value),
    daily_limit_value = VALUES(daily_limit_value), source_event_type = VALUES(source_event_type),
    status = VALUES(status), version = version + 1`
}

function badgeStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${sqlLiteral(item.description)}, ${sqlLiteral(item.iconName)}, ${sqlLiteral(item.imageUrl)},
    ${sqlLiteral(item.placeholderShape)}, ${Number(item.sortOrder)}, 'ACTIVE', 1, NULL
  )`).join(',\n')
  return `INSERT INTO mip_badges (
    id, app_id, badge_key, name, description, icon_name, image_url,
    placeholder_shape, sort_order, status, version, created_by_user_id
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    name = VALUES(name), description = VALUES(description), icon_name = VALUES(icon_name),
    image_url = VALUES(image_url), placeholder_shape = VALUES(placeholder_shape),
    sort_order = VALUES(sort_order), status = 'ACTIVE', version = version + 1`
}

function userStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, 'ACTIVE', NULL, NULL, 1
  )`).join(',\n')
  return `INSERT INTO mip_users (
    id, app_id, status, closed_at, primary_branch_id, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    status = 'ACTIVE', closed_at = NULL, primary_branch_id = NULL, version = version + 1`
}

function branchMembershipResetStatement(items) {
  return `DELETE FROM mip_branch_memberships
    WHERE app_id = ${sqlLiteral(appId)}
      AND user_id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function branchMembershipStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.branchId)}, ${sqlLiteral(item.id)},
    'ACTIVE', '2026-08-25 00:00:00.000', NULL
  )`).join(',\n')
  return `INSERT INTO mip_branch_memberships (
    app_id, branch_id, user_id, status, joined_at, ended_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    status = 'ACTIVE', joined_at = VALUES(joined_at), ended_at = NULL`
}

function userPrimaryBranchStatement(items) {
  const cases = items
    .map(item => `WHEN ${sqlLiteral(item.id)} THEN ${sqlLiteral(item.branchId)}`)
    .join('\n      ')
  return `UPDATE mip_users
    SET primary_branch_id = CASE id
      ${cases}
      ELSE primary_branch_id
    END
    WHERE app_id = ${sqlLiteral(appId)}
      AND id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function profileStatement(items) {
  const visibility = {
    nickname: true,
    avatar: true,
    identityStatus: true,
    headline: true,
    introduction: true,
    companies: true,
    organizations: true,
    primaryBranch: true,
    industry: true,
    abilities: true,
    influence: true,
  }
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.id)}, ${sqlLiteral(item.nickname)}, NULL,
    ${sqlLiteral(item.identityStatus)}, ${sqlLiteral(item.headline)}, ${sqlLiteral(item.introduction)},
    ${sqlJson(item.companies)}, ${sqlJson(item.organizations)}, ${sqlJson(visibility)}, 1
  )`).join(',\n')
  return `INSERT INTO mip_profiles (
    app_id, user_id, nickname, avatar_asset_id, identity_status, headline, introduction,
    companies_json, organizations_json, visibility_json, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    nickname = VALUES(nickname), avatar_asset_id = NULL,
    identity_status = VALUES(identity_status), headline = VALUES(headline),
    introduction = VALUES(introduction), companies_json = VALUES(companies_json),
    organizations_json = VALUES(organizations_json), visibility_json = VALUES(visibility_json),
    version = version + 1`
}

function profileTagStatement(items) {
  const relations = items.flatMap(item => [
    { userId: item.id, tagId: item.industryTagId, relation: 'PRIMARY_INDUSTRY' },
    ...item.abilityTagIds.map(tagId => ({ userId: item.id, tagId, relation: 'ABILITY' })),
  ])
  const values = relations.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)}, ${sqlLiteral(item.tagId)}, ${sqlLiteral(item.relation)}
  )`).join(',\n')
  return `INSERT INTO mip_profile_tags (
    app_id, user_id, tag_id, relation
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE tag_id = VALUES(tag_id)`
}

function profileTagResetStatement(items) {
  return `DELETE FROM mip_profile_tags
    WHERE app_id = ${sqlLiteral(appId)}
      AND user_id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function growthAccountStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.id)}, ${Number(item.experienceBalance)},
    ${Number(item.contributionBalance)}, 0, 1
  )`).join(',\n')
  return `INSERT INTO mip_growth_accounts (
    app_id, user_id, experience_balance, contribution_balance, coin_balance, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    experience_balance = VALUES(experience_balance),
    contribution_balance = VALUES(contribution_balance),
    coin_balance = VALUES(coin_balance), version = version + 1`
}

function membershipOrderStatement(items, plans) {
  const planById = new Map(plans.map(item => [item.id, item]))
  const values = items.map((item, index) => {
    const plan = planById.get(item.planId)
    const snapshot = {
      planKey: plan.key,
      name: plan.name,
      durationDays: plan.durationDays,
      priceCents: plan.priceCents,
      currency: 'CNY',
      catalogStage: 'TEST',
      benefits: plan.benefits,
      seedVersion: seed.version,
      demo: true,
    }
    return `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)},
    'MEMBERSHIP', NULL, ${sqlLiteral(item.planId)}, ${sqlLiteral(`MIP-DEMO-MEMBER-${index + 1}`)},
    NULL, ${sqlLiteral(item.key)}, ${Number(plan.priceCents)}, 'CNY', 'PAID',
    ${sqlJson(snapshot)}, '2026-08-25 12:00:00.000', NULL, 1
  )`
  }).join(',\n')
  return `INSERT INTO mip_orders (
    id, app_id, user_id, order_type, resource_id, membership_plan_id,
    merchant_order_no, provider_transaction_id, idempotency_key, amount_cents,
    currency, status, product_snapshot_json, paid_at, closed_at, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    user_id = VALUES(user_id), order_type = 'MEMBERSHIP', resource_id = NULL,
    membership_plan_id = VALUES(membership_plan_id), merchant_order_no = VALUES(merchant_order_no),
    provider_transaction_id = NULL, idempotency_key = VALUES(idempotency_key),
    amount_cents = VALUES(amount_cents), currency = 'CNY', status = 'PAID',
    product_snapshot_json = VALUES(product_snapshot_json), paid_at = VALUES(paid_at),
    closed_at = NULL, version = version + 1`
}

function entitlementStatement(items, plans) {
  const planIds = new Set(plans.map(item => item.id))
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.userId)},
    ${sqlLiteral(item.orderId)}, ${sqlLiteral(planIds.has(item.planId) ? item.planId : null)}, 'ACTIVE',
    '2026-08-25 12:00:00.000', '2031-08-24 12:00:00.000', NULL, NULL, 1
  )`).join(',\n')
  return `INSERT INTO mip_membership_entitlements (
    id, app_id, user_id, order_id, plan_id, status, starts_at, ends_at,
    revoked_at, revocation_reason, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    user_id = VALUES(user_id), order_id = VALUES(order_id), plan_id = VALUES(plan_id),
    status = 'ACTIVE', starts_at = VALUES(starts_at), ends_at = VALUES(ends_at),
    revoked_at = NULL, revocation_reason = NULL, version = version + 1`
}

function eventStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, 'BRANCH', ${sqlLiteral(item.branchId)},
    ${sqlLiteral(item.organizerUserId)}, ${sqlLiteral(item.title)}, ${sqlLiteral(item.summary)},
    ${sqlLiteral(item.description)}, ${sqlLiteral(item.notices)}, NULL,
    ${sqlLiteral(item.eventTypeKey)}, ${sqlLiteral(item.eventMode)}, ${sqlLiteral(item.accessType)},
    'AUTO', 'PUBLISHED', 'PASSED', ${sqlLiteral(item.startsAt)}, ${sqlLiteral(item.endsAt)},
    ${sqlLiteral(item.registrationOpensAt)}, ${sqlLiteral(item.registrationDeadline)},
    ${sqlLiteral(item.cancellationDeadline)}, ${sqlLiteral(item.venueName)}, ${sqlLiteral(item.address)},
    ${sqlLiteral(item.cityName)}, NULL, NULL, NULL, ${Number(item.capacity)}, 0, 0, 'CNY',
    ${sqlJson([])}, 1, 1, '2026-08-25 12:00:00.000', NULL, NULL, NULL
  )`).join(',\n')
  return `INSERT INTO mip_events (
    id, app_id, scope_type, branch_id, organizer_user_id, title, summary, description,
    notices, cover_asset_id, event_type_key, event_mode, access_type, registration_policy,
    status, content_safety_status, starts_at, ends_at, registration_opens_at,
    registration_deadline, cancellation_deadline, venue_name, address, city_name,
    latitude, longitude, online_url, capacity, waitlist_enabled, price_cents, currency,
    registration_schema_json, form_version, version, published_at, unpublished_at,
    cancelled_at, ended_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    scope_type = 'BRANCH', branch_id = VALUES(branch_id), organizer_user_id = VALUES(organizer_user_id),
    title = VALUES(title), summary = VALUES(summary), description = VALUES(description),
    notices = VALUES(notices), cover_asset_id = NULL, event_type_key = VALUES(event_type_key),
    event_mode = VALUES(event_mode), access_type = VALUES(access_type), registration_policy = 'AUTO',
    status = 'PUBLISHED', content_safety_status = 'PASSED', starts_at = VALUES(starts_at),
    ends_at = VALUES(ends_at), registration_opens_at = VALUES(registration_opens_at),
    registration_deadline = VALUES(registration_deadline),
    cancellation_deadline = VALUES(cancellation_deadline), venue_name = VALUES(venue_name),
    address = VALUES(address), city_name = VALUES(city_name), latitude = NULL, longitude = NULL,
    online_url = NULL, capacity = VALUES(capacity), waitlist_enabled = 0, price_cents = 0,
    currency = 'CNY', registration_schema_json = VALUES(registration_schema_json),
    form_version = 1, version = version + 1, published_at = VALUES(published_at),
    unpublished_at = NULL, cancelled_at = NULL, ended_at = NULL,
    archived_at = NULL, archived_by_user_id = NULL, archive_reason = NULL`
}

function eventRegistrationStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.eventId)},
    ${sqlLiteral(item.userId)}, NULL, 'REGISTERED', ${sqlJson({})}, 1, 1, NULL,
    NULL, '2026-08-25 13:00:00.000', NULL, NULL, NULL, 1
  )`).join(',\n')
  return `INSERT INTO mip_event_registrations (
    id, app_id, event_id, user_id, order_id, status, answers_json, form_version,
    share_profile, ticket_hash, waitlisted_at, registered_at, cancelled_at,
    cancellation_reason, cancelled_by_type, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    event_id = VALUES(event_id), user_id = VALUES(user_id), order_id = NULL,
    status = 'REGISTERED', answers_json = VALUES(answers_json), form_version = 1,
    share_profile = 1, ticket_hash = NULL, waitlisted_at = NULL,
    registered_at = VALUES(registered_at), cancelled_at = NULL,
    cancellation_reason = NULL, cancelled_by_type = NULL, version = version + 1`
}

function opportunityStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.ownerUserId)},
    'BRANCH', ${sqlLiteral(item.branchId)}, ${sqlLiteral(item.title)},
    ${sqlLiteral(item.valueSummary)}, ${sqlLiteral(item.targetSummary)}, ${sqlLiteral(item.description)},
    ${sqlLiteral(item.cityTagId)}, NULL, 'PUBLISHED', 'APPROVED', 0, 1,
    '2026-08-25 12:00:00.000', NULL, NULL, NULL, NULL, '2030-12-31 23:59:59.000',
    NULL, NULL, NULL
  )`).join(',\n')
  return `INSERT INTO mip_opportunities (
    id, app_id, owner_user_id, scope_type, branch_id, title, value_summary,
    target_summary, description, city_tag_id, cover_asset_id, status,
    content_safety_status, referral_count, version, published_at, ended_at,
    moderated_at, moderated_by_user_id, moderation_reason, deadline_at,
    archived_at, archived_by_user_id, archive_reason
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    owner_user_id = VALUES(owner_user_id), scope_type = 'BRANCH', branch_id = VALUES(branch_id),
    title = VALUES(title), value_summary = VALUES(value_summary), target_summary = VALUES(target_summary),
    description = VALUES(description), city_tag_id = VALUES(city_tag_id), cover_asset_id = NULL,
    status = 'PUBLISHED', content_safety_status = 'APPROVED', referral_count = 0,
    version = version + 1, published_at = VALUES(published_at), ended_at = NULL,
    moderated_at = NULL, moderated_by_user_id = NULL, moderation_reason = NULL,
    deadline_at = VALUES(deadline_at), archived_at = NULL, archived_by_user_id = NULL,
    archive_reason = NULL`
}

function opportunityRoleStatement(items) {
  const values = items.flatMap(item => item.roleKeys.map(roleKey => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.id)}, ${sqlLiteral(roleKey)}
  )`)).join(',\n')
  return `INSERT INTO mip_opportunity_roles (
    app_id, opportunity_id, role_key
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE role_key = VALUES(role_key)`
}

function opportunityRoleResetStatement(items) {
  return `DELETE FROM mip_opportunity_roles
    WHERE app_id = ${sqlLiteral(appId)}
      AND opportunity_id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function opportunityTagStatement(items, tags) {
  const kindById = new Map(tags.map(item => [item.id, item.kind]))
  const values = items.flatMap(item => item.tagIds.map(tagId => `(
    ${sqlLiteral(appId)}, ${sqlLiteral(item.id)}, ${sqlLiteral(tagId)},
    ${sqlLiteral(kindById.get(tagId) === 'ABILITY' ? 'ABILITY' : 'INDUSTRY')}
  )`)).join(',\n')
  return `INSERT INTO mip_opportunity_tags (
    app_id, opportunity_id, tag_id, relation
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE tag_id = VALUES(tag_id)`
}

function opportunityTagResetStatement(items) {
  return `DELETE FROM mip_opportunity_tags
    WHERE app_id = ${sqlLiteral(appId)}
      AND opportunity_id IN (${items.map(item => sqlLiteral(item.id)).join(', ')})`
}

function cooperationCardStatement(items) {
  const scores = {
    connector: [5, 5, 2, 3, 2, 3],
    business_builder: [4, 4, 3, 5, 2, 4],
    capital_operator: [3, 5, 5, 4, 1, 3],
    strategist: [3, 3, 2, 5, 4, 4],
    visual_designer: [2, 2, 1, 4, 5, 4],
    delivery_lead: [3, 4, 2, 4, 3, 5],
  }
  const dimensions = [
    'business_development',
    'resource_integration',
    'capital_operation',
    'strategy_planning',
    'visual_design',
    'delivery_management',
  ]
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.ownerUserId)},
    ${sqlLiteral(item.roleKey)}, ${sqlLiteral(item.positioning)}, ${sqlLiteral(item.targetSummary)},
    ${sqlJson(item.roleFields)},
    ${sqlJson(Object.fromEntries(dimensions.map((key, index) => [key, scores[item.roleKey][index]])))},
    'PUBLISHED', 'APPROVED', 1, '2026-08-25 12:00:00.000', NULL
  )`).join(',\n')
  return `INSERT INTO mip_cooperation_cards (
    id, app_id, owner_user_id, role_key, positioning, target_summary,
    role_fields_json, ability_scores_json, status, content_safety_status,
    version, published_at, archived_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    owner_user_id = VALUES(owner_user_id), role_key = VALUES(role_key),
    positioning = VALUES(positioning), target_summary = VALUES(target_summary),
    role_fields_json = VALUES(role_fields_json), ability_scores_json = VALUES(ability_scores_json),
    status = 'PUBLISHED', content_safety_status = 'APPROVED', version = version + 1,
    published_at = VALUES(published_at), archived_at = NULL`
}

function superCaseStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.ownerUserId)},
    ${sqlLiteral(item.projectName)}, ${sqlLiteral(item.summary)}, ${sqlLiteral(item.startedOn)},
    ${sqlLiteral(item.endedOn)}, ${sqlLiteral(item.responsibility)}, ${sqlLiteral(item.cityTagId)},
    ${sqlLiteral(item.industryTagId)}, ${sqlLiteral(item.caseType)}, ${sqlLiteral(item.description)},
    NULL, 'PUBLISHED', 'APPROVED', 1, '2026-08-25 12:00:00.000', NULL
  )`).join(',\n')
  return `INSERT INTO mip_super_cases (
    id, app_id, owner_user_id, project_name, summary, started_on, ended_on,
    responsibility, city_tag_id, industry_tag_id, case_type, description,
    cover_asset_id, status, content_safety_status, version, published_at, archived_at
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    id = IF(id = VALUES(id), id, NULL),
    owner_user_id = VALUES(owner_user_id), project_name = VALUES(project_name),
    summary = VALUES(summary), started_on = VALUES(started_on), ended_on = VALUES(ended_on),
    responsibility = VALUES(responsibility), city_tag_id = VALUES(city_tag_id),
    industry_tag_id = VALUES(industry_tag_id), case_type = VALUES(case_type),
    description = VALUES(description), cover_asset_id = NULL, status = 'PUBLISHED',
    content_safety_status = 'APPROVED', version = version + 1,
    published_at = VALUES(published_at), archived_at = NULL`
}

function demoManifestStatement(value, state) {
  const manifest = buildDemoManifest(value, state)
  const versionedKey = `demo_seed_manifest:${value.version}`
  return `INSERT INTO mip_app_settings (
    app_id, setting_key, value_json, version, updated_by_user_id
  ) VALUES
    (${sqlLiteral(appId)}, 'demo_seed_manifest', ${sqlJson(manifest)}, 1, NULL),
    (${sqlLiteral(appId)}, ${sqlLiteral(versionedKey)}, ${sqlJson(manifest)}, 1, NULL)
  ON DUPLICATE KEY UPDATE
    value_json = VALUES(value_json), version = version + 1, updated_by_user_id = NULL`
}

function buildDemoManifest(value, state) {
  const tagKindById = new Map(value.tags.map(item => [item.id, item.kind]))
  return {
    is_demo: 1,
    version: value.version,
    seedSha256,
    state,
    replaceBeforeProduction: true,
    recordIds: Object.fromEntries(Object.entries(value)
      .filter(([, items]) => Array.isArray(items))
      .map(([key, items]) => [key, items.map(item => item.id)])),
    dependentRows: {
      branchMembershipUserIds: value.users.map(item => item.id),
      profileUserIds: value.users.map(item => item.id),
      opportunityIds: value.opportunities.map(item => item.id),
    },
    recordsByTable: {
      mip_city_branches: value.branches.map(item => ({ id: item.id })),
      mip_tags: value.tags.map(item => ({ id: item.id })),
      mip_membership_plans: value.membershipPlans.map(item => ({ id: item.id })),
      mip_growth_levels: value.growthLevels.map(item => ({ id: item.id })),
      mip_growth_rules: value.growthRules.map(item => ({ id: item.id })),
      mip_badges: value.badges.map(item => ({ id: item.id })),
      mip_users: value.users.map(item => ({ id: item.id })),
      mip_branch_memberships: value.users.map(item => ({ branchId: item.branchId, userId: item.id })),
      mip_profiles: value.users.map(item => ({ userId: item.id })),
      mip_profile_tags: value.users.flatMap(item => [
        { userId: item.id, tagId: item.industryTagId, relation: 'PRIMARY_INDUSTRY' },
        ...item.abilityTagIds.map(tagId => ({ userId: item.id, tagId, relation: 'ABILITY' })),
      ]),
      mip_growth_accounts: value.users.map(item => ({ userId: item.id })),
      mip_orders: value.membershipOrders.map(item => ({ id: item.id })),
      mip_membership_entitlements: value.entitlements.map(item => ({ id: item.id })),
      mip_events: value.events.map(item => ({ id: item.id })),
      mip_event_registrations: value.eventRegistrations.map(item => ({ id: item.id })),
      mip_opportunities: value.opportunities.map(item => ({ id: item.id })),
      mip_opportunity_roles: value.opportunities.flatMap(item => item.roleKeys
        .map(roleKey => ({ opportunityId: item.id, roleKey }))),
      mip_opportunity_tags: value.opportunities.flatMap(item => item.tagIds.map(tagId => ({
        opportunityId: item.id,
        tagId,
        relation: tagKindById.get(tagId) === 'ABILITY' ? 'ABILITY' : 'INDUSTRY',
      }))),
      mip_cooperation_cards: value.cooperationCards.map(item => ({ id: item.id })),
      mip_super_cases: value.superCases.map(item => ({ id: item.id })),
      mip_app_settings: [{ settingKey: 'placeholder_catalog' }],
    },
  }
}

function assertSeed(value) {
  if (!value || value.replaceBeforeProduction !== true || typeof value.version !== 'string') {
    throw new Error('MIP demo seed metadata is invalid')
  }
  const groups = [
    'branches',
    'tags',
    'membershipPlans',
    'growthLevels',
    'growthRules',
    'badges',
    'users',
    'membershipOrders',
    'entitlements',
    'events',
    'eventRegistrations',
    'opportunities',
    'cooperationCards',
    'superCases',
  ]
  const allIds = new Set()
  for (const key of groups) {
    if (!Array.isArray(value[key]) || value[key].length === 0) {
      throw new Error(`MIP demo seed ${key} is empty`)
    }
    for (const item of value[key]) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)
        || !/^[a-z][a-z0-9_]{1,79}$/.test(item.key)) {
        throw new Error(`MIP demo seed contains an invalid ${key} identity`)
      }
      if (allIds.has(item.id)) {
        throw new Error('MIP demo seed contains duplicate fixed IDs')
      }
      allIds.add(item.id)
    }
  }
  if (value.growthRules.some(item => !['ACTIVE', 'DRAFT'].includes(item.status))) {
    throw new Error('Demo growth rule status must be ACTIVE or DRAFT')
  }
  assertTagCatalog(value.tags)
  assertDemoRelations(value)
}

function assertDemoRelations(value) {
  const branchIds = new Set(value.branches.map(item => item.id))
  const tagById = new Map(value.tags.map(item => [item.id, item]))
  const userIds = new Set(value.users.map(item => item.id))
  const planById = new Map(value.membershipPlans.map(item => [item.id, item]))
  const orderById = new Map(value.membershipOrders.map(item => [item.id, item]))
  const eventIds = new Set(value.events.map(item => item.id))
  const roleKeys = new Set([
    'connector',
    'business_builder',
    'capital_operator',
    'strategist',
    'visual_designer',
    'delivery_lead',
  ])
  for (const user of value.users) {
    if (!branchIds.has(user.branchId)
      || tagById.get(user.industryTagId)?.kind !== 'INDUSTRY'
      || !Array.isArray(user.abilityTagIds)
      || user.abilityTagIds.some(tagId => tagById.get(tagId)?.kind !== 'ABILITY')
      || !Number.isInteger(user.experienceBalance)
      || !Number.isInteger(user.contributionBalance)
      || user.experienceBalance !== 0
      || user.contributionBalance !== 0) {
      throw new Error('Demo user references are invalid')
    }
  }
  for (const order of value.membershipOrders) {
    if (!userIds.has(order.userId) || !planById.has(order.planId)) {
      throw new Error('Demo membership order user is invalid')
    }
  }
  for (const entitlement of value.entitlements) {
    if (!userIds.has(entitlement.userId)
      || orderById.get(entitlement.orderId)?.userId !== entitlement.userId
      || orderById.get(entitlement.orderId)?.planId !== entitlement.planId
      || !planById.has(entitlement.planId)) {
      throw new Error('Demo membership entitlement references are invalid')
    }
  }
  if (value.membershipOrders.length !== value.entitlements.length) {
    throw new Error('Demo players require one order and one entitlement each')
  }
  for (const event of value.events) {
    if (!branchIds.has(event.branchId)
      || !userIds.has(event.organizerUserId)
      || !String(event.startsAt).startsWith('2030-')
      || !String(event.endsAt).startsWith('2030-')
      || event.endsAt <= event.startsAt) {
      throw new Error('Demo events must be valid 2030 fixtures')
    }
  }
  for (const registration of value.eventRegistrations) {
    if (!eventIds.has(registration.eventId) || !userIds.has(registration.userId)) {
      throw new Error('Demo event registration references are invalid')
    }
  }
  for (const opportunity of value.opportunities) {
    if (!userIds.has(opportunity.ownerUserId)
      || !branchIds.has(opportunity.branchId)
      || tagById.get(opportunity.cityTagId)?.kind !== 'CITY'
      || opportunity.roleKeys.some(roleKey => !roleKeys.has(roleKey))
      || opportunity.tagIds.some(tagId => !['INDUSTRY', 'ABILITY'].includes(tagById.get(tagId)?.kind))) {
      throw new Error('Demo opportunity references are invalid')
    }
  }
  if (value.cooperationCards.length !== roleKeys.size
    || new Set(value.cooperationCards.map(item => item.roleKey)).size !== roleKeys.size
    || value.cooperationCards.some(item => !userIds.has(item.ownerUserId) || !roleKeys.has(item.roleKey))) {
    throw new Error('Demo cooperation cards must cover the six roles')
  }
  for (const item of value.superCases) {
    if (!userIds.has(item.ownerUserId)
      || tagById.get(item.cityTagId)?.kind !== 'CITY'
      || tagById.get(item.industryTagId)?.kind !== 'INDUSTRY') {
      throw new Error('Demo case references are invalid')
    }
  }
}

function assertTagCatalog(tags) {
  const byId = new Map(tags.map(item => [item.id, item]))
  const keys = new Set()
  if (byId.size !== tags.length) {
    throw new Error('Demo tags contain duplicate IDs')
  }
  for (const tag of tags) {
    const scopedKey = `${tag.kind}:${tag.key}`
    if (keys.has(scopedKey)
      || !['CITY', 'INDUSTRY', 'ABILITY'].includes(tag.kind)
      || typeof tag.selectable !== 'boolean'
      || !Number.isInteger(tag.sortOrder)) {
      throw new Error('Demo tag catalog is invalid')
    }
    keys.add(scopedKey)
    if (tag.kind === 'INDUSTRY') {
      if (!tag.parentId && tag.selectable) {
        throw new Error('Top-level industry tags must be grouping-only')
      }
      if (tag.parentId) {
        const parent = byId.get(tag.parentId)
        if (!tag.selectable
          || parent?.kind !== 'INDUSTRY'
          || parent.parentId
          || parent.selectable) {
          throw new Error('Selectable industries require one non-selectable industry parent')
        }
      }
    }
    else if (tag.parentId || !tag.selectable) {
      throw new Error('City and ability tags must be selectable roots')
    }
  }
}

function assertTablesExist(tableNames) {
  const result = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_name AS tableName FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${tableNames.map(sqlLiteral).join(', ')})`,
  })
  const found = new Set(collectFieldValues(result, ['tableName', 'table_name']))
  const missing = tableNames.filter(table => !found.has(table))
  if (missing.length) {
    throw new Error(`Apply MIP migrations before seeding; missing table ${missing[0]}`)
  }
}

function collectFieldValues(value, names, output = []) {
  if (!value || typeof value !== 'object') {
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFieldValues(item, names, output)
    }
    return output
  }
  const expected = new Set(names.map(name => name.toLowerCase()))
  for (const [key, child] of Object.entries(value)) {
    if (expected.has(key.toLowerCase()) && typeof child === 'string') {
      output.push(child)
    }
    else if (child && typeof child === 'object') {
      collectFieldValues(child, names, output)
    }
  }
  return output
}

function findCountRow(value, keys) {
  if (!value || typeof value !== 'object') {
    return null
  }
  if (!Array.isArray(value)
    && keys.every(key => key in value)) {
    return value
  }
  for (const child of Object.values(value)) {
    const found = findCountRow(child, keys)
    if (found) {
      return found
    }
  }
  return null
}
