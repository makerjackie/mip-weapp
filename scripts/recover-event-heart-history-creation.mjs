#!/usr/bin/env node

// A narrow recovery for migration 086 step 3. The CloudBase DDL call may fail
// after its RUNNING journal insert; only reset that journal entry when the new
// table is provably absent. Never mark an uncertain DDL step as APPLIED.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import { assertBackupCompletedWithinMaxAge } from './lib/mip-backup-policy.mjs'
import { loadMipMigrationLock, splitMipSqlStatements } from './lib/mip-migrations.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const version = '20260922086000'
const failedStep = 3
const confirm = `--confirm-failed-step=${version}#${failedStep}:table-absent`
const backupPath = process.argv.find(arg => arg.startsWith('--backup-manifest='))?.slice('--backup-manifest='.length)
const apply = process.argv.includes('--apply')

if (env.MIP_DEPLOYMENT_STAGE !== 'staging'
  || env.MIP_PAYMENT_MODE !== 'test'
  || env.MIP_CATALOG_STAGE !== 'TEST'
  || !env.CLOUDBASE_ENV_ID
  || !process.argv.includes(`--confirm-env=${env.CLOUDBASE_ENV_ID}`)
  || !process.argv.includes(confirm)) {
  throw new Error('This recovery is limited to the confirmed TEST staging environment and failed step')
}

validateBackup(backupPath)
const lock = loadMipMigrationLock(root)
const prerequisite = lock.migrations.find(item => item.version === '20260922085500')
const migration = lock.migrations.find(item => item.version === version)
if (prerequisite?.name !== 'event_heart_parent_key' || migration?.name !== 'admin_profile_video_runtime') {
  throw new Error('Migration lock does not contain the reviewed parent-key prerequisite and history migration')
}
const statements = splitMipSqlStatements(fs.readFileSync(migration.sqlPath, 'utf8'))
if (statements.length !== 4 || !/CREATE TABLE IF NOT EXISTS mip_event_heart_history\b/i.test(statements[2])) {
  throw new Error('Failed DDL statement no longer matches the reviewed migration')
}
const hashes = statements.map(statement => createHash('sha256').update(statement).digest('hex'))

bindAndRequireMysqlEnvironment(root, env.CLOUDBASE_ENV_ID)
const journal = rows(`SELECT migration_version AS version, step_index AS stepIndex,
    statement_sha256 AS statementSha256, status
  FROM mip_schema_migration_steps WHERE migration_version = '${version}' ORDER BY step_index`, ['version', 'stepIndex', 'statementSha256', 'status'])
if (journal.length !== 3 || journal.some((row, index) =>
  Number(row.stepIndex) !== index + 1
  || row.statementSha256 !== hashes[index]
  || row.status !== (index === failedStep - 1 ? 'RUNNING' : 'APPLIED'))) {
  throw new Error('Migration journal is not the exact reviewed two-applied/one-failed state')
}
const running = rows(`SELECT migration_version AS version, step_index AS stepIndex
  FROM mip_schema_migration_steps WHERE status = 'RUNNING'`, ['version', 'stepIndex'])
if (running.length !== 1 || running[0].version !== version || Number(running[0].stepIndex) !== failedStep) {
  throw new Error('Another uncertain migration step exists; recovery stopped')
}
if (rows(`SELECT version FROM mip_schema_migrations WHERE version = '${version}'`, ['version']).length) {
  throw new Error('The migration was already recorded as applied')
}
const historyTable = rows(`SELECT table_name AS tableName FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'mip_event_heart_history'`, ['tableName'])
if (historyTable.length) {
  throw new Error('The history table exists; do not reset an uncertain DDL step')
}
const parentTable = rows(`SELECT table_name AS tableName FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'mip_event_hearts'`, ['tableName'])
if (parentTable.length !== 1) {
  throw new Error('The heart parent table is missing')
}
const parentKey = rows(`SELECT index_name AS indexName FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'mip_event_hearts'
    AND index_name = 'mip_event_hearts_app_id_uk'`, ['indexName'])
if (parentKey.length) {
  throw new Error('The prerequisite key already exists; recovery state has changed')
}
for (const [table, expected] of [
  ['mip_videos', ['app_id', 'version', 'content_safety_status']],
  ['mip_cooperation_cards', ['card_real_name', 'card_game_name', 'referral_needed']],
]) {
  const columns = new Set(rows(`SELECT column_name AS columnName FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = '${table}'`, ['columnName']).map(row => row.columnName))
  if (expected.some(name => !columns.has(name))) {
    throw new Error(`Previously applied migration columns are incomplete in ${table}`)
  }
}

console.log('[mip-schema-recovery] exact failed DDL state and stable backup verified; history table absent')
if (!apply) {
  console.log('[mip-schema-recovery] dry-run only; add --apply to remove the failed RUNNING journal entry')
  process.exit(0)
}

let uncertainAck = false
try {
  callCloudbase(root, 'manageMysqlDatabase', {
    action: 'runStatement',
    sql: `DELETE FROM mip_schema_migration_steps
      WHERE migration_version = '${version}' AND step_index = ${failedStep}
        AND statement_sha256 = '${hashes[failedStep - 1]}' AND status = 'RUNNING'`,
  }, 300000)
}
catch {
  uncertainAck = true
}
const after = rows(`SELECT step_index AS stepIndex, status FROM mip_schema_migration_steps
  WHERE migration_version = '${version}' ORDER BY step_index`, ['stepIndex', 'status'])
if (after.length !== 2 || after.some((row, index) => Number(row.stepIndex) !== index + 1 || row.status !== 'APPLIED')) {
  throw new Error('Failed journal reset was not confirmed by readback; stop without rerunning migrations')
}
console.log(`[mip-schema-recovery] failed RUNNING entry removed after absence proof${uncertainAck ? ' (write acknowledgement uncertain; readback confirmed)' : ''}`)

function rows(sql, requiredFields) {
  const response = callCloudbase(root, 'queryMysqlDatabase', { action: 'runQuery', sql })
  const found = []
  const walk = (value) => {
    if (!value || typeof value !== 'object') {
      return
    }
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    if (requiredFields.every(field => Object.hasOwn(value, field))) {
      found.push(value)
    }
    Object.values(value).forEach(walk)
  }
  walk(response)
  return found
}

function validateBackup(manifestPath) {
  if (!manifestPath || !path.isAbsolute(manifestPath) || path.basename(manifestPath) !== 'manifest.json') {
    throw new Error('Recovery requires an absolute --backup-manifest path')
  }
  const relative = path.relative(root, manifestPath)
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('Recovery backup must be outside the repository')
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const fingerprint = createHash('sha256').update(env.CLOUDBASE_ENV_ID).digest('hex').slice(0, 16)
  if (manifest.format !== 'mip-cloudbase-mysql-logical-backup-v1'
    || manifest.environmentFingerprint !== fingerprint
    || manifest.consistency !== 'row-count-verified'
    || manifest.transactionalSnapshot !== false
    || !Array.isArray(manifest.tables)
    || manifest.tableCount !== manifest.tables.length) {
    throw new Error('Recovery backup is incompatible or belongs to another environment')
  }
  assertBackupCompletedWithinMaxAge({ completedAt: manifest.completedAt })
  for (const table of manifest.tables) {
    const dataPath = path.resolve(path.dirname(manifestPath), table.relativeFile)
    const dataRelative = path.relative(path.dirname(manifestPath), dataPath)
    if (dataRelative.startsWith('..') || path.isAbsolute(dataRelative)) {
      throw new Error('Recovery backup contains an unsafe data path')
    }
    const hash = createHash('sha256').update(fs.readFileSync(dataPath)).digest('hex')
    if (hash !== table.sha256 || table.rowsBefore !== table.rowsExported || table.rowsAfter !== table.rowsExported) {
      throw new Error('Recovery backup is incomplete')
    }
  }
}
