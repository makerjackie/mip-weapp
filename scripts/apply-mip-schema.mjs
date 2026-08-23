#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
  sqlLiteral,
} from './lib/example-cloudbase.mjs'
import {
  assertMipMigrationSql,
  loadMipMigrationLock,
  MIP_MIGRATION_TRACKING_TABLE,
  MIP_TABLE_PREFIX,
} from './lib/mip-migrations.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = env.CLOUDBASE_ENV_ID
const confirmedEnv = argumentValue('--confirm-env=')
const confirmedPrefix = argumentValue('--confirm-prefix=')
const backupManifestPath = argumentValue('--backup-manifest=')
const dryRun = process.argv.includes('--dry-run')

if (!envId || confirmedEnv !== envId) {
  throw new Error('MIP schema application requires --confirm-env=<exact CLOUDBASE_ENV_ID>')
}
if (confirmedPrefix !== MIP_TABLE_PREFIX) {
  throw new Error(`MIP schema application requires --confirm-prefix=${MIP_TABLE_PREFIX}`)
}

const lock = loadMipMigrationLock(root)
if (dryRun) {
  console.log(`[mip-schema] table prefix: ${lock.tablePrefix}`)
  console.log(`[mip-schema] tracking table: ${lock.trackingTable}`)
  for (const migration of lock.migrations) {
    const sql = fs.readFileSync(migration.sqlPath, 'utf8')
    const statements = assertMipMigrationSql(sql)
    console.log(
      `[mip-schema] ${migration.version} ${migration.name}: ${statements.length} statements, creates ${migration.createsTables.join(', ')}`,
    )
  }
  process.exit(0)
}

bindAndRequireMysqlEnvironment(root, envId)
const existingTables = listMipTables()
const trackingExists = existingTables.has(MIP_MIGRATION_TRACKING_TABLE)
const applied = trackingExists ? loadAppliedMigrations() : new Map()

for (const migration of lock.migrations) {
  const row = applied.get(migration.version)
  if (!row) {
    continue
  }
  if (row.name !== migration.name || row.checksum !== migration.sqlSha256) {
    throw new Error(`MIP migration checksum or name mismatch: ${migration.version}`)
  }
  const missing = migration.createsTables.filter(table => !existingTables.has(table))
  if (missing.length) {
    throw new Error(`Recorded MIP migration is incomplete: ${migration.version}; missing ${missing.join(', ')}`)
  }
}

const pending = lock.migrations.filter(migration => !applied.has(migration.version))
if (pending.length === 0) {
  console.log('[mip-schema] all migrations already applied')
  verifyRequiredTables(lock.requiredTables)
  process.exit(0)
}

for (const migration of pending) {
  const partial = migration.createsTables.filter(table => existingTables.has(table))
  if (partial.length) {
    throw new Error(
      `Unrecorded partial MIP migration detected: ${migration.version}; existing ${partial.join(', ')}`,
    )
  }
}

const backup = validateBackupManifest({
  manifestPath: backupManifestPath,
  envId,
  repoRoot: root,
})
console.log(
  `[mip-schema] stable backup verified (${backup.tableCount} tables, ${backup.rowCount} rows)`,
)

if (!trackingExists) {
  callCloudbase(root, 'manageMysqlDatabase', {
    action: 'runStatement',
    sql: `CREATE TABLE IF NOT EXISTS ${MIP_MIGRATION_TRACKING_TABLE} (
      version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  })
  existingTables.add(MIP_MIGRATION_TRACKING_TABLE)
}

for (const migration of pending) {
  const sql = fs.readFileSync(migration.sqlPath, 'utf8')
  const statements = assertMipMigrationSql(sql)
  statements.push(
    `INSERT INTO ${MIP_MIGRATION_TRACKING_TABLE} (version, name, checksum)
      VALUES (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(migration.sqlSha256)})`,
  )
  callCloudbase(root, 'manageMysqlDatabase', {
    action: 'initializeSchema',
    statements,
    requireReady: true,
  }, 300000)

  const after = listMipTables()
  const missing = migration.createsTables.filter(table => !after.has(table))
  if (missing.length) {
    throw new Error(`MIP migration apply incomplete: ${migration.version}; missing ${missing.join(', ')}`)
  }
  for (const table of after) {
    existingTables.add(table)
  }
  console.log(`[mip-schema] applied: ${migration.name} ${migration.version}`)
}

verifyRequiredTables(lock.requiredTables)
console.log('[mip-schema] isolated schema verified')

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function collectRows(value, requiredFields, output = []) {
  if (!value || typeof value !== 'object') {
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRows(item, requiredFields, output)
    }
    return output
  }
  const keys = new Map(Object.keys(value).map(key => [key.toLowerCase(), key]))
  const row = {}
  let matched = true
  for (const field of requiredFields) {
    const actual = keys.get(field.toLowerCase())
    if (!actual) {
      matched = false
      break
    }
    row[field] = value[actual]
  }
  if (matched) {
    output.push(row)
  }
  for (const child of Object.values(value)) {
    collectRows(child, requiredFields, output)
  }
  return output
}

function listMipTables() {
  const response = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT table_name AS tableName
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name LIKE 'mip\\_%'
      ORDER BY table_name`,
  })
  return new Set(
    collectRows(response, ['tableName'])
      .map(row => String(row.tableName))
      .filter(table => table.startsWith(MIP_TABLE_PREFIX)),
  )
}

function loadAppliedMigrations() {
  const response = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql: `SELECT version, name, checksum FROM ${MIP_MIGRATION_TRACKING_TABLE} ORDER BY version`,
  })
  return new Map(
    collectRows(response, ['version', 'name', 'checksum'])
      .map(row => [String(row.version), {
        name: String(row.name),
        checksum: String(row.checksum),
      }]),
  )
}

function verifyRequiredTables(requiredTables) {
  const tables = listMipTables()
  const unexpected = [...tables].filter(table => !table.startsWith(MIP_TABLE_PREFIX))
  if (unexpected.length) {
    throw new Error(`MIP verification returned non-MIP tables: ${unexpected.join(', ')}`)
  }
  const missing = requiredTables.filter(table => !tables.has(table))
  if (missing.length) {
    throw new Error(`MIP schema verification missed: ${missing.join(', ')}`)
  }
}

function validateBackupManifest({ manifestPath, envId, repoRoot }) {
  if (!manifestPath) {
    throw new Error('Pending MIP migrations require --backup-manifest=<absolute manifest.json>')
  }
  const absoluteManifest = path.resolve(manifestPath)
  const relativeToRepo = path.relative(repoRoot, absoluteManifest)
  if (relativeToRepo === '' || (!relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo))) {
    throw new Error('Database backup manifest must be outside the repository')
  }
  if (path.basename(absoluteManifest) !== 'manifest.json') {
    throw new Error('Database backup confirmation must point to manifest.json')
  }

  const manifest = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8'))
  const expectedFingerprint = crypto.createHash('sha256').update(envId).digest('hex').slice(0, 16)
  if (
    manifest.format !== 'mip-cloudbase-mysql-logical-backup-v1'
    || manifest.environmentFingerprint !== expectedFingerprint
    || manifest.consistency !== 'row-count-verified'
    || manifest.transactionalSnapshot !== false
  ) {
    throw new Error('Database backup manifest is incompatible, unstable, or for another environment')
  }

  const completedAt = Date.parse(manifest.completedAt)
  const age = Date.now() - completedAt
  if (!Number.isFinite(completedAt) || age < -300_000 || age > 86_400_000) {
    throw new Error('Database backup must be completed within the last 24 hours')
  }
  if (!Array.isArray(manifest.tables) || manifest.tables.length !== manifest.tableCount) {
    throw new Error('Database backup table manifest is incomplete')
  }

  const backupDirectory = path.dirname(absoluteManifest)
  for (const table of manifest.tables) {
    const dataPath = path.resolve(backupDirectory, table.relativeFile)
    const relative = path.relative(backupDirectory, dataPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Database backup contains an unsafe data path')
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(dataPath)).digest('hex')
    if (digest !== table.sha256 || table.rowsBefore !== table.rowsExported || table.rowsAfter !== table.rowsExported) {
      throw new Error(`Database backup validation failed for table: ${table.table}`)
    }
  }
  return manifest
}
