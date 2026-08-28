#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import {
  assertMipAppScopeForeignKeyMetadata,
  buildMediaInventory,
  buildMipAppScopeCountSelect,
  buildMipAppScopePrimaryKeySelect,
  buildMipAppScopeSelect,
  buildMipAppScopeTablePlan,
  buildUnionIdentityInventory,
  createPrivateExportDirectories,
  encodeMipExportRow,
  field,
  MIP_APP_SCOPE_EXPORT_FORMAT,
  mipAppScopePrimaryKeyCursor,
  resolveMipAppScopeTableNames,
  sha256,
  sha256File,
  writePrivateFile,
  writePrivateJson,
} from './lib/mip-app-scope-export.mjs'
import { loadMipMigrationLock } from './lib/mip-migrations.mjs'

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = env.CLOUDBASE_ENV_ID
const options = parseArguments(process.argv.slice(2))

if (!envId || options.confirmEnv !== envId) {
  throw new Error('MIP app-scope export requires --confirm-env=<exact source environment>')
}
if (!options.sourceWritesFrozen) {
  throw new Error('MIP app-scope export requires --confirm-source-writes-frozen')
}

const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
const backupRoot = path.join(os.homedir(), 'Backups', 'mip-weapp')
const outputDirectory = path.resolve(
  options.output || path.join(backupRoot, `app-scope-${timestamp}`),
)
if ([envId, options.sourceAppId].some(identifier => outputDirectory.includes(identifier))) {
  throw new Error('MIP app-scope export path must not contain environment or application identifiers')
}
const partialDirectory = `${outputDirectory}.partial-${randomBytes(4).toString('hex')}`
createPrivateExportDirectories({ outputDirectory: partialDirectory, repoRoot: root })

const startedAt = new Date().toISOString()
const migrationLock = loadMipMigrationLock(root)
const tableNames = resolveMipAppScopeTableNames(migrationLock)
const tableNameList = tableNames.map(sqlString).join(', ')

bindAndRequireMysqlEnvironment(root, envId)
console.log(`[mip-app-export] verified ${tableNames.length} migration-lock tables`)
console.log(`[mip-app-export] writing private files outside repository: ${outputDirectory}`)

const schemaQueries = {
  tables: {
    sql: `SELECT table_name, table_type, engine, row_format, table_rows,
      avg_row_length, data_length, index_length, table_collation, create_options
    FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN (${tableNameList})
    ORDER BY table_name`,
    orderBy: 'table_name',
  },
  columns: {
    sql: `SELECT table_name, column_name, ordinal_position, is_nullable,
      data_type, character_maximum_length, numeric_precision, numeric_scale,
      datetime_precision, character_set_name, collation_name, column_type,
      column_key, extra, generation_expression
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name IN (${tableNameList})
    ORDER BY table_name, ordinal_position`,
    orderBy: 'table_name, ordinal_position',
  },
  statistics: {
    sql: `SELECT table_name, non_unique, index_name, seq_in_index,
      column_name, collation, sub_part, nullable, index_type, is_visible,
      expression
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name IN (${tableNameList})
    ORDER BY table_name, index_name, seq_in_index`,
    orderBy: 'table_name, index_name, seq_in_index',
  },
  key_column_usage: {
    sql: `SELECT constraint_name, table_name, column_name,
      ordinal_position, position_in_unique_constraint, referenced_table_name,
      referenced_column_name
    FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE() AND table_name IN (${tableNameList})
    ORDER BY table_name, constraint_name, ordinal_position`,
    orderBy: 'table_name, constraint_name, ordinal_position',
  },
  referential_constraints: {
    sql: `SELECT constraint_name, unique_constraint_name,
      match_option, update_rule, delete_rule, table_name, referenced_table_name
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name IN (${tableNameList})
    ORDER BY table_name, constraint_name`,
    orderBy: 'table_name, constraint_name',
  },
}

const schema = {}
for (const [name, query] of Object.entries(schemaQueries)) {
  schema[name] = queryRowsPaged(query.sql, query.orderBy, `schema ${name}`)
  writePrivateJson(path.join(partialDirectory, 'schema', `${name}.json`), schema[name])
}

const tablePlan = buildMipAppScopeTablePlan({
  migrationLock,
  tables: schema.tables,
  columns: schema.columns,
  statistics: schema.statistics,
})
assertMipAppScopeForeignKeyMetadata({
  migrationLock,
  keyColumnUsage: schema.key_column_usage,
  referentialConstraints: schema.referential_constraints,
})
const tableResults = []
const inventorySourceRows = new Map()

for (const [index, plan] of tablePlan.entries()) {
  const rowsBefore = countRows(plan)
  const relativeFile = path.posix.join('data', `${encodeURIComponent(plan.table)}.jsonl`)
  const filePath = path.join(partialDirectory, ...relativeFile.split('/'))
  const descriptor = fs.openSync(filePath, 'wx', 0o600)
  let rowsExported = 0
  let afterPrimaryKey = null
  const exportedPrimaryKeys = createHash('sha256')
  try {
    while (rowsExported < rowsBefore) {
      let limit = Math.min(options.pageSize, rowsBefore - rowsExported)
      let rows
      while (rows === undefined) {
        try {
          rows = queryRows(
            buildMipAppScopeSelect({
              tablePlan: plan,
              sourceAppId: options.sourceAppId,
              limit,
              afterPrimaryKey,
            }),
            `data ${plan.table}`,
          )
        }
        catch (error) {
          if (limit === 1) {
            throw error
          }
          limit = Math.max(1, Math.floor(limit / 2))
          console.log(`[mip-app-export] reducing page size for ${plan.table}`)
        }
      }
      if (rows.length === 0) {
        break
      }
      for (const row of rows) {
        if (plan.scope === 'source-app' && field(row, 'app_id') !== options.sourceAppId) {
          throw new Error(`Scoped export returned an out-of-scope row for ${plan.table}`)
        }
        fs.writeSync(descriptor, `${JSON.stringify(encodeMipExportRow(row, plan.binaryColumns))}\n`)
        const cursor = mipAppScopePrimaryKeyCursor(plan, row)
        exportedPrimaryKeys.update(`${JSON.stringify(cursor)}\n`)
        afterPrimaryKey = cursor
      }
      if (['mip_user_identities', 'mip_media_assets'].includes(plan.table)) {
        const collected = inventorySourceRows.get(plan.table) || []
        collected.push(...rows)
        inventorySourceRows.set(plan.table, collected)
      }
      rowsExported += rows.length
    }
  }
  finally {
    fs.closeSync(descriptor)
  }
  fs.chmodSync(filePath, 0o600)

  const rowsAfter = countRows(plan)
  const exportedPrimaryKeySha256 = exportedPrimaryKeys.digest('hex')
  const finalPrimaryKeys = digestPrimaryKeyInventory(plan)
  const primaryKeyInventoryStable = finalPrimaryKeys.rowCount === rowsExported
    && finalPrimaryKeys.sha256 === exportedPrimaryKeySha256
  const rowCountStable = rowsBefore === rowsExported
    && rowsBefore === rowsAfter
    && primaryKeyInventoryStable
  tableResults.push({
    table: plan.table,
    scope: plan.scope,
    relativeFile,
    primaryKey: plan.primaryKey,
    rowsBefore,
    rowsExported,
    rowsAfter,
    rowCountStable,
    primaryKeyInventoryStable,
    primaryKeyInventorySha256: exportedPrimaryKeySha256,
    bytes: fs.statSync(filePath).size,
    sha256: sha256File(filePath),
  })
  console.log(`[mip-app-export] data ${index + 1}/${tablePlan.length}: ${plan.table} (${rowsExported} rows)`)
}

const unionIdentityInventory = buildUnionIdentityInventory(
  inventorySourceRows.get('mip_user_identities') || [],
)
const mediaInventory = buildMediaInventory(
  inventorySourceRows.get('mip_media_assets') || [],
)
const unionIdentityFile = path.join(partialDirectory, 'inventory', 'union-identities.json')
const mediaFile = path.join(partialDirectory, 'inventory', 'media.json')
writePrivateJson(unionIdentityFile, unionIdentityInventory)
writePrivateJson(mediaFile, mediaInventory)

const filesBeforeManifest = listFiles(partialDirectory)
const checksums = filesBeforeManifest.map((filePath) => {
  const relative = path.relative(partialDirectory, filePath).split(path.sep).join('/')
  return `${sha256File(filePath)}  ${relative}`
})
writePrivateFile(path.join(partialDirectory, 'checksums.sha256'), `${checksums.join('\n')}\n`)

const rowCountsStable = tableResults.every(table => table.rowCountStable)
const manifest = {
  format: MIP_APP_SCOPE_EXPORT_FORMAT,
  startedAt,
  completedAt: new Date().toISOString(),
  sourceEnvironmentFingerprint: sha256(envId).slice(0, 16),
  sourceAppScopeFingerprint: sha256(options.sourceAppId).slice(0, 16),
  consistency: rowCountsStable ? 'row-count-verified' : 'row-count-changed-during-export',
  transactionalSnapshot: false,
  sourceWritesFrozen: true,
  primaryKeyInventoryVerified: rowCountsStable,
  migrationLock: {
    version: migrationLock.version,
    migrationCount: migrationLock.migrations.length,
    latestVersion: migrationLock.migrations.at(-1)?.version || null,
    sha256: sha256File(path.join(root, 'database', 'mysql', 'mip', 'migrations.lock.json')),
  },
  tableCount: tableResults.length,
  rowCount: tableResults.reduce((total, table) => total + table.rowsExported, 0),
  pageSize: options.pageSize,
  binaryEncoding: { marker: '$binaryBase64', mysqlProjection: 'TO_BASE64' },
  schemaFiles: Object.keys(schemaQueries).map(name => `schema/${name}.json`),
  tables: tableResults,
  unionIdentityInventory: {
    relativeFile: 'inventory/union-identities.json',
    sha256: sha256File(unionIdentityFile),
    totalIdentityRows: unionIdentityInventory.totalIdentityRows,
    populatedUnionIdentityRows: unionIdentityInventory.populatedUnionIdentityRows,
    distinctUnionIdentityKeys: unionIdentityInventory.distinctUnionIdentityKeys,
    duplicateKeyGroups: unionIdentityInventory.duplicateKeyGroups,
    duplicateRows: unionIdentityInventory.duplicateRows,
  },
  mediaInventory: {
    relativeFile: 'inventory/media.json',
    sha256: sha256File(mediaFile),
    objectCount: mediaInventory.objectCount,
    readyObjectCount: mediaInventory.readyObjectCount,
    contentBytes: mediaInventory.contentBytes,
  },
  migrationReadiness: !rowCountsStable
    ? 'blocked-row-count-drift'
    : unionIdentityInventory.duplicateKeyGroups > 0
      ? 'blocked-union-identity-duplicates'
      : 'export-verified',
}
writePrivateJson(path.join(partialDirectory, 'manifest.json'), manifest)
writePrivateFile(path.join(partialDirectory, 'README.txt'), [
  'MIP source AppID scoped export',
  '',
  'This directory contains private MIP user, order, identity, and media metadata.',
  'Keep it outside Git and do not upload or share it.',
  'Business rows are limited to one source AppID. Only migration ledgers are exported without an AppID predicate.',
  'The UnionID inventory contains stored identity digests, never raw UnionID values.',
  'The media inventory is a copy plan; this command does not download or modify cloud objects.',
  'This export uses read-only paginated queries and is not a transactional snapshot.',
  'The operator confirmed source writes were frozen; keyset pagination and a final primary-key inventory prove scope stability.',
  '',
].join('\n'))

fs.renameSync(partialDirectory, outputDirectory)
console.log(`[mip-app-export] complete: ${manifest.tableCount} tables, ${manifest.rowCount} rows`)
console.log(`[mip-app-export] consistency: ${manifest.consistency}`)
console.log(`[mip-app-export] migration readiness: ${manifest.migrationReadiness}`)
console.log(`[mip-app-export] output: ${outputDirectory}`)

if (!rowCountsStable) {
  throw new Error('MIP source rows changed during export; keep the marked export and rerun after writes are frozen')
}

function parseArguments(argv) {
  const definitions = new Map([
    ['--confirm-env=', 'confirmEnv'],
    ['--source-app-id=', 'sourceAppId'],
    ['--output=', 'output'],
    ['--page-size=', 'pageSize'],
  ])
  const result = { pageSize: 200, sourceWritesFrozen: false }
  const provided = new Set()
  for (const argument of argv) {
    if (argument === '--confirm-source-writes-frozen') {
      if (provided.has('sourceWritesFrozen')) {
        throw new Error('MIP app-scope export arguments must be non-empty and unique')
      }
      provided.add('sourceWritesFrozen')
      result.sourceWritesFrozen = true
      continue
    }
    const definition = [...definitions].find(([prefix]) => argument.startsWith(prefix))
    if (!definition) {
      throw new Error('MIP app-scope export received an unsupported argument')
    }
    const [prefix, key] = definition
    const rawValue = argument.slice(prefix.length)
    if (!rawValue || provided.has(key)) {
      throw new Error('MIP app-scope export arguments must be non-empty and unique')
    }
    provided.add(key)
    result[key] = key === 'pageSize' ? Number(rawValue) : rawValue
  }
  if (!result.confirmEnv || !result.sourceAppId) {
    throw new Error('MIP app-scope export requires source environment and AppID confirmation')
  }
  if (!/^wx[0-9a-f]{16}$/.test(result.sourceAppId)) {
    throw new Error('MIP app-scope export requires a valid source Mini Program AppID')
  }
  if (!Number.isInteger(result.pageSize) || result.pageSize < 1 || result.pageSize > 500) {
    throw new Error('--page-size must be an integer between 1 and 500')
  }
  return result
}

function queryRows(sql, label) {
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error('MIP app-scope export attempted a non-read-only SQL statement')
  }
  let response
  try {
    response = callCloudbase(root, 'queryMysqlDatabase', {
      action: 'runQuery',
      sql,
    }, 300000)
  }
  catch {
    throw new Error(`CloudBase MySQL read failed during ${label}`)
  }
  if (response?.success !== true || !Array.isArray(response?.data?.rows)) {
    throw new Error(`CloudBase MySQL returned no verified row set during ${label}`)
  }
  return response.data.rows
}

function queryRowsPaged(sql, orderBy, label, preferredPageSize = 50) {
  if (!/^[a-z_]+(?:, [a-z_]+)*$/.test(orderBy)) {
    throw new Error('MIP app-scope metadata order is invalid')
  }
  const rows = []
  let offset = 0
  while (true) {
    const page = queryRows(
      `SELECT * FROM (${sql}) AS mip_scoped_metadata ORDER BY ${orderBy} LIMIT ${preferredPageSize} OFFSET ${offset}`,
      label,
    )
    rows.push(...page)
    offset += page.length
    if (page.length < preferredPageSize) {
      return rows
    }
  }
}

function digestPrimaryKeyInventory(plan) {
  const digest = createHash('sha256')
  let afterPrimaryKey = null
  let rowCount = 0
  while (true) {
    const rows = queryRows(buildMipAppScopePrimaryKeySelect({
      tablePlan: plan,
      sourceAppId: options.sourceAppId,
      limit: options.pageSize,
      afterPrimaryKey,
    }), `primary-key inventory ${plan.table}`)
    for (const row of rows) {
      const cursor = mipAppScopePrimaryKeyCursor(plan, row)
      digest.update(`${JSON.stringify(cursor)}\n`)
      afterPrimaryKey = cursor
      rowCount += 1
    }
    if (rows.length < options.pageSize) {
      return { rowCount, sha256: digest.digest('hex') }
    }
  }
}

function countRows(plan) {
  const rows = queryRows(buildMipAppScopeCountSelect({
    tablePlan: plan,
    sourceAppId: options.sourceAppId,
  }), `count ${plan.table}`)
  const count = Number(field(rows[0] || {}, 'row_count'))
  if (!Number.isSafeInteger(count) || count < 0 || rows.length !== 1) {
    throw new Error(`CloudBase MySQL returned an invalid scoped count for ${plan.table}`)
  }
  return count
}

function listFiles(directory) {
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const targetPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...listFiles(targetPath))
    }
    else if (entry.isFile()) {
      result.push(targetPath)
    }
  }
  return result.sort()
}

function sqlString(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`
}
