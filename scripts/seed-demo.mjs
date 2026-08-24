#!/usr/bin/env node

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
import { buildSeedOwnershipQuery, seedOwnershipConflictCount } from './lib/mip-seed-safety.mjs'

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
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
assertSeed(seed)
bindAndRequireMysqlEnvironment(root, envId, { development: true, stage })
assertTablesExist([
  'mip_city_branches',
  'mip_tags',
  'mip_membership_plans',
  'mip_growth_levels',
  'mip_growth_rules',
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

const statements = [
  branchStatement(seed.branches),
  ...tagStatements(seed.tags),
  membershipPlanStatement(seed.membershipPlans),
  growthLevelStatement(seed.growthLevels),
  growthRuleStatement(seed.growthRules),
  `INSERT INTO mip_app_settings (
     app_id, setting_key, value_json, version, updated_by_user_id
   ) VALUES (
     ${sqlLiteral(appId)}, 'placeholder_catalog',
     ${sqlJson({ version: seed.version, replaceBeforeProduction: true })}, 1, NULL
   ) ON DUPLICATE KEY UPDATE
     value_json = VALUES(value_json), version = version + 1, updated_by_user_id = NULL`,
]

for (const sql of statements) {
  const result = callCloudbase(root, 'manageMysqlDatabase', {
    action: 'runStatement',
    sql,
  }, 300000)
  if (result?.success === false) {
    throw new Error('MIP demo catalog seed did not converge')
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
        AND rule_key IN (${seed.growthRules.map(item => sqlLiteral(item.key)).join(', ')})) AS rules`,
})
const counts = findCountRow(verification)
const expected = {
  branches: seed.branches.length,
  tags: seed.tags.length,
  plans: seed.membershipPlans.length,
  levels: seed.growthLevels.length,
  rules: seed.growthRules.length,
}
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
console.log('[mip-seed] placeholder branches, tags, test plan, and growth catalog verified; no environment or AppID was persisted')

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
    name = VALUES(name), description = VALUES(description),
    duration_days = VALUES(duration_days), price_cents = VALUES(price_cents),
    benefits_json = VALUES(benefits_json), status = 'ACTIVE', version = version + 1`
}

function growthLevelStatement(items) {
  const values = items.map(item => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(appId)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.name)},
    ${Number(item.minimumExperience)}, ${sqlJson(item.benefits)}, 'ACTIVE', 1
  )`).join(',\n')
  return `INSERT INTO mip_growth_levels (
    id, app_id, level_key, name, minimum_experience, benefits_json, status, version
  ) VALUES ${values}
  ON DUPLICATE KEY UPDATE
    app_id = IF(app_id = VALUES(app_id), app_id, NULL),
    name = VALUES(name), minimum_experience = VALUES(minimum_experience),
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
    name = VALUES(name), metric = VALUES(metric), delta_value = VALUES(delta_value),
    daily_limit_value = VALUES(daily_limit_value), source_event_type = VALUES(source_event_type),
    status = VALUES(status), version = version + 1`
}

function assertSeed(value) {
  if (!value || value.replaceBeforeProduction !== true || typeof value.version !== 'string') {
    throw new Error('MIP demo seed metadata is invalid')
  }
  for (const key of ['branches', 'tags', 'membershipPlans', 'growthLevels', 'growthRules']) {
    if (!Array.isArray(value[key]) || value[key].length === 0) {
      throw new Error(`MIP demo seed ${key} is empty`)
    }
    for (const item of value[key]) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)
        || !/^[a-z][a-z0-9_]{1,79}$/.test(item.key)) {
        throw new Error(`MIP demo seed contains an invalid ${key} identity`)
      }
    }
  }
  if (value.growthRules.some(item => !['ACTIVE', 'DRAFT'].includes(item.status))) {
    throw new Error('Demo growth rule status must be ACTIVE or DRAFT')
  }
  assertTagCatalog(value.tags)
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

function findCountRow(value) {
  if (!value || typeof value !== 'object') {
    return null
  }
  if (!Array.isArray(value)
    && ['branches', 'tags', 'plans', 'levels', 'rules'].every(key => key in value)) {
    return value
  }
  for (const child of Object.values(value)) {
    const found = findCountRow(child)
    if (found) {
      return found
    }
  }
  return null
}
