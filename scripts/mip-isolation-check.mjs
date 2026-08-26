#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { loadMipMigrationLock, MIP_TABLE_PREFIX } from './lib/mip-migrations.mjs'
import { findUnsafeMipSqlRelations } from './lib/mip-sql-isolation.mjs'

const root = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(read('package.json'))
const lock = loadMipMigrationLock(root)
const dynamicRelationAllowlist = Object.freeze({
  'scripts/apply-mip-schema.mjs': {
    MIP_MIGRATION_TRACKING_TABLE: ['mip_schema_migrations'],
    MIP_MIGRATION_STEP_TABLE: ['mip_schema_migration_steps'],
  },
  'cloudfunctions/mip-opportunities-api/domain/opportunities.js': {
    tableName: ['mip_opportunities', 'mip_cooperation_cards', 'mip_super_cases'],
  },
  'cloudfunctions/mip-admin-api/domain/knowledge.js': {
    table: [
      'mip_knowledge_sources',
      'mip_knowledge_categories',
      'mip_knowledge_contents',
      'mip_knowledge_products',
      'mip_content_comments',
      'mip_content_comment_reports',
    ],
  },
})

assert(
  packageJson.scripts['database:setup'] === 'node scripts/apply-mip-schema.mjs',
  'database:setup must use the isolated MIP migration runner',
)
assert(fs.existsSync(path.join(root, 'CONTEXT.md')), 'MIP domain CONTEXT.md is missing')
assert(fs.existsSync(path.join(root, 'docs/mip/REQUIREMENTS.md')), 'MIP requirement baseline is missing')
assert(fs.existsSync(path.join(root, 'src/assets/brand/mip-logo-yellow.png')), 'MIP primary logo is missing')

for (const table of lock.requiredTables) {
  assert(table.startsWith(MIP_TABLE_PREFIX), `MIP migration lock contains unsafe table: ${table}`)
}
const lockedTables = new Set(lock.requiredTables)
for (const [file, variables] of Object.entries(dynamicRelationAllowlist)) {
  for (const [variable, tables] of Object.entries(variables)) {
    for (const table of tables) {
      assert(
        lockedTables.has(table),
        `Dynamic SQL allowlist is outside the migration lock: ${file} (${variable} -> ${table})`,
      )
    }
  }
}

const activePaths = [
  ...listMipModuleDirectories(),
  'src/config/mip-catalogs.ts',
  'database/mysql/mip',
  'scripts/apply-mip-schema.mjs',
  'scripts/bootstrap-owner.mjs',
  'scripts/deploy-functions.mjs',
  'scripts/deploy-payment-function.mjs',
  'scripts/lib/mip-migrations.mjs',
  'scripts/lib/mip-owner-bootstrap.mjs',
  'scripts/lib/membership-chain-reconcile.mjs',
  'scripts/reconcile-membership-chains.mjs',
  'scripts/seed-demo.mjs',
  'scripts/verify-cloud.mjs',
  ...listMipCloudFunctionDirectories(),
]
for (const relativePath of activePaths) {
  for (const file of walk(relativePath)) {
    if (!/\.(?:js|mjs|ts|sql|json)$/.test(file)) {
      continue
    }
    const source = read(file)
    const table = findLegacyTableReference(source)
    assert(!table, `Active MIP code references a shared legacy table: ${file} (${table})`)
    if (!file.includes(`${path.sep}tests${path.sep}`)) {
      const unsafeRelations = findUnsafeMipSqlRelations(source, {
        allowedDynamicRelations: dynamicRelationAllowlist[file],
        sqlDocument: file.endsWith('.sql'),
      })
      assert(
        unsafeRelations.length === 0,
        `Active MIP code references an unowned SQL relation: ${file} (${unsafeRelations[0]?.relation || 'unknown'})`,
      )
    }
  }
}

const clientBuild = read('weapp-vite.config.ts')
assert(!/env\.MEMBERSHIP_[A-Z0-9_]+/.test(clientBuild), 'MIP client build must not fall back to legacy MEMBERSHIP_* configuration')

function findLegacyTableReference(source) {
  const sqlTableReference = /\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|REFERENCES|INSERT\s+INTO|UPDATE|JOIN|FROM|DELETE\s+FROM)\s+`?((?:member|dating|sewing)_\w+)`?/i
  return sqlTableReference.exec(source)?.[1]
}

console.log('MIP isolation check passed')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(relativePath) {
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath)) {
    return []
  }
  const stat = fs.statSync(absolutePath)
  if (stat.isFile()) {
    return [relativePath]
  }
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  })
}

function listMipCloudFunctionDirectories() {
  const cloudRoot = path.join(root, 'cloudfunctions')
  if (!fs.existsSync(cloudRoot)) {
    return []
  }
  return fs.readdirSync(cloudRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('mip-'))
    .map(entry => path.join('cloudfunctions', entry.name))
}

function listMipModuleDirectories() {
  const moduleRoot = path.join(root, 'src', 'modules')
  if (!fs.existsSync(moduleRoot)) {
    return []
  }
  return fs.readdirSync(moduleRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && (entry.name === 'mip' || entry.name.startsWith('mip-')))
    .map(entry => path.join('src', 'modules', entry.name))
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}
