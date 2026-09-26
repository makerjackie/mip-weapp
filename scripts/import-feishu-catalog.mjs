#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { bindAndRequireMysqlEnvironment, callCloudbase, loadCaseEnv, sqlLiteral } from './lib/example-cloudbase.mjs'
import { validateBackupManifest } from './lib/mip-backup-manifest.mjs'
import { buildFeishuCatalog } from './lib/mip-feishu-catalog.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const appId = env.MINI_PROGRAM_APP_ID
const envId = env.CLOUDBASE_ENV_ID
const argument = name => process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
const apply = process.argv.includes('--apply')
if (!/^wx[0-9a-f]{16}$/i.test(appId || '') || !envId || argument('--confirm-env') !== envId) {
  throw new Error('Catalog import requires configured AppID and --confirm-env=<exact environment>')
}
if (apply && env.MIP_DEPLOYMENT_STAGE === 'production' && !process.argv.includes('--confirm-production')) {
  throw new Error('Production catalog import requires --confirm-production')
}
const source = name => JSON.parse(fs.readFileSync(path.join(root, `docs/mip/sources/feishu/20260926/${name}.json`), 'utf8'))
bindAndRequireMysqlEnvironment(root, envId)
function query(sql) {
  const result = callCloudbase(root, 'queryMysqlDatabase', { action: 'runQuery', sql }, 300000)
  if (result?.success !== true || !Array.isArray(result.data?.rows)) {
    throw new Error('Catalog query failed')
  }
  return result.data.rows
}
const appSql = sqlLiteral(appId)
function readTags() {
  const rows = []
  let cursor = ''
  while (true) {
    const page = query(`SELECT id, kind, label, tag_key, parent_id, selectable, popular, enabled FROM mip_tags
      WHERE app_id = ${appSql} ${cursor ? `AND id > ${sqlLiteral(cursor)}` : ''} ORDER BY id LIMIT 100`)
    rows.push(...page)
    if (page.length < 100) {
      return rows
    }
    cursor = page.at(-1).id
  }
}
const readBadges = () => query(`SELECT id, name, badge_key, description, category, status FROM mip_badges WHERE app_id = ${appSql} ORDER BY id`)
const existingTags = readTags()
const existingBadges = readBadges()
const plan = buildFeishuCatalog({ appId, industries: source('industries'), cities: source('cities'), badges: source('badges'), existingTags, existingBadges })
console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', tags: plan.tags.length, badges: plan.badges.length, newTags: plan.tags.filter(row => !existingTags.some(prior => prior.id === row.id)).length, newBadges: plan.badges.filter(row => !existingBadges.some(prior => prior.id === row.id)).length, legacyEntriesPreserved: true, automaticBadgeGrants: false }))
if (!apply) {
  process.exit(0)
}
validateBackupManifest({ manifestPath: argument('--backup-manifest'), envId, repoRoot: root, maxAgeHours: 24 })
const statements = []
// Small batches fit the management API limits. Parents precede their children.
for (let offset = 0; offset < plan.tags.length; offset += 40) {
  const rows = plan.tags.slice(offset, offset + 40)
  statements.push(`INSERT INTO mip_tags (id, app_id, kind, parent_id, tag_key, label, selectable, popular, enabled, sort_order)
    VALUES ${rows.map(row => `(${[row.id, appId, row.kind, row.parentId, row.key, row.label].map(sqlLiteral).join(',')},${Number(row.selectable)},${Number(row.popular)},1,${row.sortOrder})`).join(',')}
    ON DUPLICATE KEY UPDATE app_id = IF(app_id = VALUES(app_id), app_id, NULL),
      id = IF(id = VALUES(id), id, NULL), parent_id = VALUES(parent_id), label = VALUES(label),
      selectable = VALUES(selectable), popular = VALUES(popular), enabled = 1, sort_order = VALUES(sort_order)`)
}
statements.push(`INSERT INTO mip_badges (id, app_id, badge_key, name, description, category, status, sort_order)
  VALUES ${plan.badges.map(row => `(${[row.id, appId, row.key, row.name, row.description, row.category, row.status].map(sqlLiteral).join(',')},${row.sortOrder})`).join(',')}
  ON DUPLICATE KEY UPDATE id = IF(id = VALUES(id), id, NULL), name = VALUES(name), description = VALUES(description),
    category = VALUES(category), status = VALUES(status), sort_order = VALUES(sort_order), version = version + 1`)
for (const sql of statements) {
  const result = callCloudbase(root, 'manageMysqlDatabase', { action: 'runStatement', sql }, 300000)
  if (result?.success !== true) {
    throw new Error('Catalog write failed; rerun preview before retrying')
  }
}
const actualTags = readTags()
const actualBadges = readBadges()
for (const row of plan.tags) {
  const actual = actualTags.find(item => item.id === row.id)
  if (!actual || actual.label !== row.label || actual.tag_key !== row.key || actual.parent_id !== row.parentId
    || Boolean(Number(actual.popular)) !== row.popular || Number(actual.enabled) !== 1) {
    throw new Error('Catalog tag readback mismatch')
  }
}
for (const row of plan.badges) {
  const actual = actualBadges.find(item => item.id === row.id)
  if (!actual || actual.name !== row.name || actual.description !== row.description || actual.status !== row.status) {
    throw new Error('Catalog badge readback mismatch')
  }
}
if (existingTags.some(row => !actualTags.some(item => item.id === row.id)) || existingBadges.some(row => !actualBadges.some(item => item.id === row.id))) {
  throw new Error('Legacy catalog retention check failed')
}
console.log('[feishu-catalog] source entries and preserved IDs verified; no member facts or automatic awards changed')
