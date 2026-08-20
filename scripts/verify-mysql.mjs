#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import mysql from 'mysql2/promise'
import {
  ACTIVITY_OPERATION_CHECKS,
  ACTIVITY_OPERATION_COLUMNS,
  ACTIVITY_OPERATION_INDEXES,
  ACTIVITY_OPERATIONS_NAME,
  ACTIVITY_OPERATIONS_VERSION,
  ensureActivityOperations,
  inspectActivityOperations,
  MEMBERSHIP_TEST_RESET_TOKEN,
} from './lib/activity-operations-schema.mjs'
import {
  ensureExportIntegrity,
  EXPORT_INTEGRITY_NAME,
  EXPORT_INTEGRITY_VERSION,
  inspectExportIntegrity,
} from './lib/export-integrity-schema.mjs'
import { loadVerifiedMigrations } from './lib/migrations.mjs'

const root = path.resolve(import.meta.dirname, '..')
const connectionUri = process.env.MEMBERSHIP_TEST_DATABASE_URL || ''
const resetToken = process.env.MEMBERSHIP_TEST_RESET_TOKEN || ''
const allowSkip = process.argv.includes('--allow-skip')

if (!process.argv.includes('--confirm-test-database')) {
  throw new Error('MySQL contract verification requires --confirm-test-database')
}
if (!connectionUri) {
  if (allowSkip) {
    console.log('SKIP: local MySQL 8 not configured (MEMBERSHIP_TEST_DATABASE_URL missing)')
    process.exit(0)
  }
  throw new Error('MySQL contract verification requires MEMBERSHIP_TEST_DATABASE_URL (or pass --allow-skip)')
}
if (resetToken !== MEMBERSHIP_TEST_RESET_TOKEN) {
  if (allowSkip) {
    console.log(
      `SKIP: local MySQL 8 reset token missing (need MEMBERSHIP_TEST_RESET_TOKEN=${MEMBERSHIP_TEST_RESET_TOKEN})`,
    )
    process.exit(0)
  }
  throw new Error(
    `MySQL contract verification requires MEMBERSHIP_TEST_RESET_TOKEN=${MEMBERSHIP_TEST_RESET_TOKEN} (refuses wipe/reset by database name alone)`,
  )
}

const target = new URL(connectionUri)
const databaseName = target.pathname.replace(/^\//, '')
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname) || !/^membership[_-]test$/i.test(databaseName)) {
  throw new Error('MySQL contract verification is restricted to a local database named membership_test')
}

const BASE_TABLES = [
  'member_profiles',
  'member_private_profiles',
  'member_media_assets',
  'member_plans',
  'member_entitlements',
  'member_events',
  'member_event_changes',
  'member_orders',
  'member_registrations',
  'member_admin_roles',
  'member_refunds',
  'member_audit_logs',
  'member_schema_migrations',
]
const EXPORT_TABLES = [
  'member_export_tickets',
  'member_mutation_idempotency',
  'member_media_cleanup_outbox',
]
const ALL_TABLES = [...BASE_TABLES, ...EXPORT_TABLES]

function assertMigrationsLockContract() {
  const migrations = loadVerifiedMigrations(root)
  if (migrations.length < 4) {
    throw new Error('MySQL migration lock must include 001–004 (schema, activity ops, export integrity, media cleanup outbox)')
  }
  // Generic: every lock entry must resolve and checksum; do not hard-code first/second only.
  for (const migration of migrations) {
    if (!migration.name || !migration.version || !migration.sqlSha256 || !migration.rollbackSha256) {
      throw new Error(`Migration lock entry incomplete: ${migration.name || migration.version}`)
    }
    const sqlPath = path.join(root, migration.sql)
    const rollbackPath = path.join(root, migration.rollback)
    if (!fs.existsSync(sqlPath) || !fs.existsSync(rollbackPath)) {
      throw new Error(`Migration files missing for ${migration.name}`)
    }
  }

  const activity = migrations.find(item => item.name === ACTIVITY_OPERATIONS_NAME)
  if (!activity || activity.version !== ACTIVITY_OPERATIONS_VERSION) {
    throw new Error(`MySQL migration lock missing ${ACTIVITY_OPERATIONS_NAME} ${ACTIVITY_OPERATIONS_VERSION}`)
  }
  const sql = fs.readFileSync(path.join(root, activity.sql), 'utf8')
  for (const token of [
    'venue_name',
    'cancellation_policy',
    'ticket_code',
    'member_registrations_ticket_uk',
    'member_registrations_roster_idx',
  ]) {
    if (!sql.includes(token)) {
      throw new Error(`002 migration SQL missing required token: ${token}`)
    }
  }
  if (/ADD COLUMN\s+(?:registration_deadline|cover_asset_id|address)\b/i.test(sql)) {
    throw new Error('002 must not re-create registration_deadline, cover_asset_id, or address')
  }
  const rollback = fs.readFileSync(path.join(root, activity.rollback), 'utf8')
  if (/DROP TABLE/i.test(rollback)) {
    throw new Error('002 rollback must not drop 001 business tables')
  }

  const exportIntegrity = migrations.find(item => item.name === EXPORT_INTEGRITY_NAME)
  if (!exportIntegrity || exportIntegrity.version !== EXPORT_INTEGRITY_VERSION) {
    throw new Error(`MySQL migration lock missing ${EXPORT_INTEGRITY_NAME} ${EXPORT_INTEGRITY_VERSION}`)
  }
  const exportSql = fs.readFileSync(path.join(root, exportIntegrity.sql), 'utf8')
  for (const token of [
    'member_export_tickets',
    'member_mutation_idempotency',
    'member_events_app_id_uk',
    'member_registrations_event_app_fk',
    'token_hash',
    'file_id',
    'content_sha256',
    'RESERVED',
    'ON DELETE RESTRICT',
  ]) {
    if (!exportSql.includes(token)) {
      throw new Error(`003 migration SQL missing required token: ${token}`)
    }
  }
  // Composite FKs include NOT NULL app_id — SET NULL is illegal.
  if (/avatar_asset_id[\s\S]{0,120}ON DELETE SET NULL/i.test(exportSql)
    || /cover_asset_id[\s\S]{0,120}ON DELETE SET NULL/i.test(exportSql)) {
    throw new Error('003 composite media FKs must not use ON DELETE SET NULL')
  }
  const exportRollback = fs.readFileSync(path.join(root, exportIntegrity.rollback), 'utf8')
  if (!exportRollback.includes('DROP TABLE IF EXISTS member_export_tickets')) {
    throw new Error('003 rollback must drop export ticket table')
  }
  return migrations
}

async function listMemberTables(connection) {
  const [tables] = await connection.execute(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name LIKE 'member\\_%'`,
  )
  return new Set(tables.map(row => row.name))
}

async function assertTablesPresent(connection, required) {
  const tableNames = await listMemberTables(connection)
  for (const table of required) {
    if (!tableNames.has(table)) {
      throw new Error(`MySQL schema missing required table: ${table}`)
    }
  }
  return tableNames
}

async function assertTablesAbsent(connection, forbidden) {
  const tableNames = await listMemberTables(connection)
  for (const table of forbidden) {
    if (tableNames.has(table)) {
      throw new Error(`MySQL schema unexpectedly has table after earlier migration only: ${table}`)
    }
  }
}

async function columnSet(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT column_name AS name
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?
     ORDER BY ordinal_position`,
    [tableName],
  )
  return new Set(rows.map(row => row.name))
}

async function indexMeta(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    `SELECT index_name AS name, non_unique AS nonUnique, column_name AS columnName, seq_in_index AS seq
     FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
     ORDER BY seq_in_index`,
    [tableName, indexName],
  )
  return rows
}

async function checkConstraintNames(connection) {
  const [rows] = await connection.execute(
    `SELECT constraint_name AS name
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND constraint_type = 'CHECK'
       AND table_name IN ('member_events', 'member_registrations')`,
  )
  return new Set(rows.map(row => row.name))
}

function isMissingObjectError(error) {
  const message = String(error?.message || error)
  return /Unknown (?:column|key|check constraint)|check that (?:column|key|table)|Can't DROP|Cannot drop|doesn't exist/i.test(message)
}

async function applySql(connection, relativePath, { allowMissingObjects = false } = {}) {
  try {
    await connection.query(fs.readFileSync(path.join(root, relativePath), 'utf8'))
  }
  catch (error) {
    if (allowMissingObjects && isMissingObjectError(error)) {
      return
    }
    throw error
  }
}

async function assertActivityColumnsAndIndexes(connection) {
  for (const [table, columns] of Object.entries(ACTIVITY_OPERATION_COLUMNS)) {
    const present = await columnSet(connection, table)
    for (const column of columns) {
      if (!present.has(column.name)) {
        throw new Error(`MySQL schema missing ${table}.${column.name}`)
      }
    }
  }

  for (const index of ACTIVITY_OPERATION_INDEXES) {
    const rows = await indexMeta(connection, index.table, index.name)
    if (!rows.length) {
      throw new Error(`MySQL schema missing index ${index.name}`)
    }
    const isUnique = Number(rows[0].nonUnique) === 0
    if (index.unique !== isUnique) {
      throw new Error(`MySQL index uniqueness mismatch: ${index.name}`)
    }
    const columns = rows.map(row => row.columnName).join(',')
    if (columns !== index.columns.join(',')) {
      throw new Error(`Index columns mismatch for ${index.name}: ${columns}`)
    }
  }

  const checks = await checkConstraintNames(connection)
  for (const name of ACTIVITY_OPERATION_CHECKS) {
    if (!checks.has(name)) {
      throw new Error(`MySQL schema missing CHECK constraint: ${name}`)
    }
  }
}

async function assertExportIntegrityObjects(connection) {
  await assertTablesPresent(connection, EXPORT_TABLES)
  // Prefer the shared 003 inspect contract (uniques, composite FKs, columns, checks).
  const state = await inspectExportIntegrity(connection)
  if (!state.complete) {
    if (state.incompatible.length) {
      throw new Error(`003 export integrity incompatible: ${state.incompatible.join('; ')}`)
    }
    throw new Error(`003 export integrity incomplete; missing: ${state.missing.join(', ')}`)
  }
  const [fkRows] = await connection.execute(
    `SELECT constraint_name AS name, delete_rule AS deleteRule
     FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE()
       AND constraint_name IN (
         'member_profiles_avatar_app_fk',
         'member_events_cover_app_fk'
       )`,
  )
  if (fkRows.length < 2) {
    throw new Error('003 composite media FKs missing')
  }
  for (const row of fkRows) {
    if (String(row.deleteRule).toUpperCase() !== 'RESTRICT') {
      throw new Error(`003 FK ${row.name} must use RESTRICT, got ${row.deleteRule}`)
    }
  }
}

async function insertProbeEvent(connection, marker, appId = 'wx-verify-mysql') {
  const eventId = randomUUID()
  await connection.execute(
    `INSERT INTO member_events (
       id, app_id, title, summary, description, starts_at, ends_at,
       location, address, capacity, member_free, price_cents, status
     ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3) + INTERVAL 2 DAY, UTC_TIMESTAMP(3) + INTERVAL 2 DAY + INTERVAL 2 HOUR,
       ?, ?, 10, 0, 0, 'DRAFT')`,
    [
      eventId,
      appId,
      marker,
      marker,
      'verify-mysql probe row',
      'probe-location',
      'probe-address',
    ],
  )
  return eventId
}

async function countProbe(connection, marker) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS total FROM member_events WHERE app_id = ? AND title = ?',
    ['wx-verify-mysql', marker],
  )
  return Number(rows[0]?.total || 0)
}

async function recordMigration(connection, migration) {
  await connection.execute(
    `INSERT INTO member_schema_migrations (version, name, checksum)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), name = VALUES(name)`,
    [migration.version, migration.name, migration.sqlSha256],
  )
}

async function assertMigrationRows(connection, migrations) {
  const [rows] = await connection.execute(
    'SELECT version, name, checksum FROM member_schema_migrations ORDER BY version',
  )
  const byVersion = new Map(rows.map(row => [row.version, row]))
  for (const migration of migrations) {
    const row = byVersion.get(migration.version)
    if (!row) {
      throw new Error(`Migration row missing for ${migration.name} ${migration.version}`)
    }
    if (row.checksum !== migration.sqlSha256 || row.name !== migration.name) {
      throw new Error(`Migration checksum/name mismatch for ${migration.version}`)
    }
  }
}

async function assertCrossAppFk(connection) {
  const appA = 'wx-verify-app-a'
  const appB = 'wx-verify-app-b'
  const eventA = await insertProbeEvent(connection, `cross-app-a-${Date.now()}`, appA)
  // Registration for app B pointing at app A's event must fail under composite FK.
  try {
    await connection.execute(
      `INSERT INTO member_registrations (
         id, app_id, event_id, user_id, status
       ) VALUES (?, ?, ?, ?, 'REGISTERED')`,
      [randomUUID(), appB, eventA, 'user-cross'],
    )
    throw new Error('Cross-app registration FK should have failed')
  }
  catch (error) {
    if (!/foreign key|ER_NO_REFERENCED_ROW/i.test(String(error?.message || error?.code || error))) {
      throw error
    }
  }
}

const migrations = assertMigrationsLockContract()
const migration001 = migrations.find(item => item.version === '20260719010100') || migrations[0]
const migration002 = migrations.find(item => item.name === ACTIVITY_OPERATIONS_NAME)
const migration003 = migrations.find(item => item.name === 'export_integrity')
if (!migration001 || !migration002 || !migration003) {
  throw new Error('Migration lock must resolve 001, 002, and 003 by identity')
}

const connection = await mysql.createConnection({
  host: target.hostname,
  port: Number(target.port || 3306),
  user: decodeURIComponent(target.username),
  password: decodeURIComponent(target.password),
  database: databaseName,
  multipleStatements: true,
  timezone: 'Z',
})

try {
  // Full reset is gated by the explicit reset token above.
  for (const migration of [...migrations].reverse()) {
    await applySql(connection, migration.rollback, { allowMissingObjects: true })
  }

  // 1) Apply 001 only — must NOT require 003 tables.
  await applySql(connection, migration001.sql)
  await assertTablesPresent(connection, BASE_TABLES)
  await assertTablesAbsent(connection, EXPORT_TABLES)
  const marker = `verify-mysql-marker-${Date.now()}`
  await insertProbeEvent(connection, marker)
  if (await countProbe(connection, marker) !== 1) {
    throw new Error('Failed to plant 001 probe row')
  }
  await recordMigration(connection, migration001)

  // 2) Apply 002 and assert 002 objects; still no 003 tables.
  const before002 = await inspectActivityOperations(connection)
  if (!before002.empty) {
    throw new Error('002 objects must be absent after 001-only apply')
  }
  await applySql(connection, migration002.sql)
  await ensureActivityOperations(connection)
  if (await countProbe(connection, marker) !== 1) {
    throw new Error('002 apply must preserve 001 probe data')
  }
  await assertActivityColumnsAndIndexes(connection)
  await assertTablesAbsent(connection, EXPORT_TABLES)
  await recordMigration(connection, migration002)

  // 3) Apply 003 and assert all tables + composite FK policy via inspect/ensure.
  await applySql(connection, migration003.sql)
  await ensureExportIntegrity(connection)
  await assertTablesPresent(connection, ALL_TABLES)
  await assertExportIntegrityObjects(connection)
  await recordMigration(connection, migration003)
  await assertMigrationRows(connection, migrations)
  await assertCrossAppFk(connection)
  if (await countProbe(connection, marker) !== 1) {
    throw new Error('003 apply must preserve 001 probe data')
  }

  // 4) Rollback only 003; 001/002 tables and probe data remain.
  await applySql(connection, migration003.rollback)
  await connection.execute(
    'DELETE FROM member_schema_migrations WHERE version = ?',
    [migration003.version],
  )
  await assertTablesAbsent(connection, EXPORT_TABLES)
  await assertTablesPresent(connection, BASE_TABLES)
  await assertActivityColumnsAndIndexes(connection)
  if (await countProbe(connection, marker) !== 1) {
    throw new Error('003 rollback must preserve 001/002 probe data')
  }
  // 001/002 migration rows must still be present.
  await assertMigrationRows(connection, [migration001, migration002])

  // 5) Re-apply 003 and prove recovery completeness (inspect must be complete before row).
  await applySql(connection, migration003.sql)
  const after003 = await ensureExportIntegrity(connection)
  if (!after003.state.complete) {
    throw new Error('003 ensure after re-apply did not reach complete state')
  }
  await recordMigration(connection, migration003)
  await assertTablesPresent(connection, ALL_TABLES)
  await assertExportIntegrityObjects(connection)
  await assertMigrationRows(connection, migrations)

  // Bonus: 002 partial recovery still works after 003 is present.
  await connection.query('ALTER TABLE member_events DROP COLUMN cancellation_policy')
  // Dropping a 002 column while 003 FKs exist is fine; recovery must restore it.
  const partial = await inspectActivityOperations(connection)
  if (!partial.partial) {
    throw new Error('Expected partial 002 state after dropping cancellation_policy')
  }
  const recovery = await ensureActivityOperations(connection)
  if (recovery.action !== 'recovered') {
    throw new Error('Expected ensureActivityOperations to recover partial 002')
  }
  await assertActivityColumnsAndIndexes(connection)
}
finally {
  await connection.end()
}

console.log(
  'Membership MySQL 8 schema contract passed (staged 001→002→003, 003-only rollback, checksums, cross-app FK, grants objects)',
)
