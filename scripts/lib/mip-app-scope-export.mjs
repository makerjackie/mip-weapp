import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  MIP_MIGRATION_STEP_TABLE,
  MIP_MIGRATION_TRACKING_TABLE,
} from './mip-migrations.mjs'

export const MIP_APP_SCOPE_EXPORT_FORMAT = 'mip-app-scope-export-v1'
export const MIP_APP_SCOPE_TRACKING_TABLES = Object.freeze([
  MIP_MIGRATION_TRACKING_TABLE,
  MIP_MIGRATION_STEP_TABLE,
])

const WECHAT_APP_ID_PATTERN = /^wx[0-9a-f]{16}$/
const MIP_TABLE_PATTERN = /^mip_[a-z0-9_]+$/
const MYSQL_BINARY_DATA_TYPES = new Set([
  'binary',
  'varbinary',
  'tinyblob',
  'blob',
  'mediumblob',
  'longblob',
  'bit',
])

export function assertSourceAppId(sourceAppId) {
  if (!WECHAT_APP_ID_PATTERN.test(String(sourceAppId || ''))) {
    throw new Error('A valid source Mini Program AppID is required')
  }
  return sourceAppId
}

export function resolveMipAppScopeTableNames(migrationLock, requestedTables) {
  const allowedTables = new Set(migrationLock?.requiredTables || [])
  if (allowedTables.size === 0) {
    throw new Error('MIP migration lock has no declared tables')
  }

  const candidates = requestedTables === undefined
    ? [...allowedTables]
    : requestedTables
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('MIP app-scope export requires at least one table')
  }

  const result = []
  const seen = new Set()
  for (const rawTable of candidates) {
    const table = String(rawTable || '')
    if (!MIP_TABLE_PATTERN.test(table) || !allowedTables.has(table)) {
      throw new Error('App-scope export only accepts migration-lock MIP tables')
    }
    if (seen.has(table)) {
      throw new Error('App-scope export table list contains a duplicate')
    }
    seen.add(table)
    result.push(table)
  }
  return result
}

export function buildMipAppScopeTablePlan({
  migrationLock,
  requestedTables,
  tables,
  columns,
  statistics,
}) {
  const tableNames = resolveMipAppScopeTableNames(migrationLock, requestedTables)
  const tableSet = new Set(tableNames)
  const baseTables = new Set(
    tables
      .filter(row => String(field(row, 'table_type')) === 'BASE TABLE')
      .map(row => String(field(row, 'table_name'))),
  )
  const columnsByTable = groupColumns(columns, tableSet)
  const primaryKeys = primaryKeysByTable(statistics, tableSet)

  for (const row of [...tables, ...columns, ...statistics]) {
    const table = String(field(row, 'table_name') || '')
    if (table && !tableSet.has(table)) {
      throw new Error('Scoped schema metadata contains a table outside the requested MIP lock set')
    }
  }

  return tableNames.map((table) => {
    if (!baseTables.has(table)) {
      throw new Error(`Required MIP export table is missing: ${table}`)
    }
    const columnDefinitions = columnsByTable.get(table) || []
    const columnNames = columnDefinitions.map(column => column.name)
    const primaryKey = primaryKeys.get(table) || []
    if (columnNames.length === 0) {
      throw new Error(`Required MIP export table has no columns: ${table}`)
    }
    if (primaryKey.length === 0) {
      throw new Error(`Required MIP export table has no primary key: ${table}`)
    }

    const migrationLedger = MIP_APP_SCOPE_TRACKING_TABLES.includes(table)
    if (!migrationLedger && !columnNames.includes('app_id')) {
      throw new Error(`MIP business table cannot be exported without app_id: ${table}`)
    }
    if (migrationLedger && columnNames.includes('app_id')) {
      throw new Error(`MIP migration ledger unexpectedly contains app_id: ${table}`)
    }

    return Object.freeze({
      table,
      scope: migrationLedger ? 'migration-ledger' : 'source-app',
      columns: Object.freeze(columnNames),
      binaryColumns: Object.freeze(
        columnDefinitions
          .filter(column => MYSQL_BINARY_DATA_TYPES.has(column.dataType))
          .map(column => column.name),
      ),
      primaryKey: Object.freeze(primaryKey),
    })
  })
}

export function assertMipAppScopeForeignKeyMetadata({
  migrationLock,
  keyColumnUsage,
  referentialConstraints,
}) {
  const allowed = new Set(resolveMipAppScopeTableNames(migrationLock))
  for (const row of [...keyColumnUsage, ...referentialConstraints]) {
    const table = String(field(row, 'table_name') || '')
    const referencedTable = field(row, 'referenced_table_name')
    if (!allowed.has(table)) {
      throw new Error('MIP export foreign-key metadata contains an unlocked table')
    }
    if (referencedTable && !allowed.has(String(referencedTable))) {
      throw new Error('MIP export table references a table outside the migration lock')
    }
  }
  return true
}

export function buildMipAppScopeSelect({ tablePlan, sourceAppId, limit, afterPrimaryKey = null }) {
  assertSafeTablePlan(tablePlan)
  assertSourceAppId(sourceAppId)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Scoped export query limit must be an integer from 1 to 500')
  }
  const predicate = buildScopeAndCursorPredicate(tablePlan, sourceAppId, afterPrimaryKey)
  const order = ` ORDER BY ${tablePlan.primaryKey.map(quoteIdentifier).join(', ')}`
  const binaryColumns = new Set(tablePlan.binaryColumns || [])
  const projection = tablePlan.columns.map((column) => {
    if (binaryColumns.has(column)) {
      return `TO_BASE64(${quoteIdentifier(column)}) AS ${quoteIdentifier(column)}`
    }
    return quoteIdentifier(column)
  }).join(', ')
  return `SELECT ${projection} FROM ${quoteIdentifier(tablePlan.table)}${predicate}${order} LIMIT ${limit}`
}

export function buildMipAppScopePrimaryKeySelect({
  tablePlan,
  sourceAppId,
  limit,
  afterPrimaryKey = null,
}) {
  assertSafeTablePlan(tablePlan)
  assertSourceAppId(sourceAppId)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Scoped export query limit must be an integer from 1 to 500')
  }
  const predicate = buildScopeAndCursorPredicate(tablePlan, sourceAppId, afterPrimaryKey)
  const projection = tablePlan.primaryKey.map(quoteIdentifier).join(', ')
  return `SELECT ${projection} FROM ${quoteIdentifier(tablePlan.table)}${predicate} ORDER BY ${projection} LIMIT ${limit}`
}

export function mipAppScopePrimaryKeyCursor(tablePlan, row) {
  assertSafeTablePlan(tablePlan)
  const cursor = tablePlan.primaryKey.map((column) => {
    const result = field(row, column)
    if (result === null || result === undefined) {
      throw new Error('Scoped export primary key is missing')
    }
    return result
  })
  return Object.freeze(cursor)
}

export function buildMipAppScopeCountSelect({ tablePlan, sourceAppId }) {
  assertSafeTablePlan(tablePlan)
  assertSourceAppId(sourceAppId)
  const predicate = tablePlan.scope === 'source-app'
    ? ` WHERE ${quoteIdentifier('app_id')} = ${sqlString(sourceAppId)}`
    : ''
  return `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tablePlan.table)}${predicate}`
}

export function buildUnionIdentityInventory(rows) {
  const populated = rows
    .filter(row => value(row, 'union_identity_key'))
    .map(row => ({
      userId: String(value(row, 'user_id')),
      provider: String(value(row, 'provider')),
      unionIdentityKey: String(value(row, 'union_identity_key')),
    }))
    .sort(compareInventoryRows(['unionIdentityKey', 'provider', 'userId']))

  const keyCounts = new Map()
  for (const row of populated) {
    const key = `${row.provider}\u0000${row.unionIdentityKey}`
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1)
  }
  const duplicateGroups = [...keyCounts.values()].filter(count => count > 1)

  return Object.freeze({
    format: 'mip-union-identity-inventory-v1',
    sourceTable: 'mip_user_identities',
    rows: Object.freeze(populated),
    totalIdentityRows: rows.length,
    populatedUnionIdentityRows: populated.length,
    distinctUnionIdentityKeys: keyCounts.size,
    duplicateKeyGroups: duplicateGroups.length,
    duplicateRows: duplicateGroups.reduce((total, count) => total + count, 0),
    recordsSha256: sha256(canonicalJsonLines(populated)),
  })
}

export function encodeMipExportRow(row, binaryColumns = []) {
  const result = { ...row }
  for (const column of binaryColumns) {
    const actualName = Object.keys(result).find(key => key.toLowerCase() === column.toLowerCase())
    if (!actualName || result[actualName] === null || result[actualName] === undefined) {
      continue
    }
    if (typeof result[actualName] !== 'string') {
      throw new TypeError('CloudBase MySQL returned an invalid encoded binary column')
    }
    const base64 = result[actualName].replaceAll(/\s/g, '')
    if (!isCanonicalBase64(base64)) {
      throw new Error('CloudBase MySQL returned malformed base64 for a binary column')
    }
    result[actualName] = { $binaryBase64: base64 }
  }
  return result
}

export function buildMediaInventory(rows) {
  const media = rows.map((row) => {
    const objectKey = String(value(row, 'object_key') || '')
    const cloudFileId = String(value(row, 'cloud_file_id') || '')
    if (!objectKey.startsWith('mip/') || !cloudFileId.startsWith('cloud://')) {
      throw new Error('MIP media inventory contains an out-of-scope object reference')
    }
    return {
      id: String(value(row, 'id')),
      ownerUserId: value(row, 'owner_user_id') === null
        ? null
        : String(value(row, 'owner_user_id') || ''),
      purpose: String(value(row, 'purpose')),
      objectKey,
      cloudFileId,
      contentSha256: String(value(row, 'content_sha256')),
      contentType: String(value(row, 'content_type')),
      contentBytes: Number(value(row, 'content_bytes')),
      status: String(value(row, 'status')),
    }
  }).sort(compareInventoryRows(['objectKey', 'id']))

  return Object.freeze({
    format: 'mip-media-inventory-v1',
    sourceTable: 'mip_media_assets',
    rows: Object.freeze(media),
    objectCount: media.length,
    readyObjectCount: media.filter(row => row.status === 'READY').length,
    contentBytes: media.reduce((total, row) => total + row.contentBytes, 0),
    recordsSha256: sha256(canonicalJsonLines(media)),
  })
}

export function assertPrivateExportDestination({ outputDirectory, repoRoot }) {
  const output = path.resolve(outputDirectory)
  const repository = path.resolve(repoRoot)
  const relative = path.relative(repository, output)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('MIP app-scope exports must be written outside the repository')
  }
  return output
}

export function createPrivateExportDirectories({ outputDirectory, repoRoot }) {
  const output = assertPrivateExportDestination({ outputDirectory, repoRoot })
  if (fs.existsSync(output)) {
    throw new Error('MIP app-scope export destination already exists')
  }
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  fs.chmodSync(path.dirname(output), 0o700)
  fs.mkdirSync(output, { mode: 0o700 })
  for (const child of ['schema', 'data', 'inventory']) {
    fs.mkdirSync(path.join(output, child), { mode: 0o700 })
  }
  return output
}

export function writePrivateFile(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  fs.chmodSync(filePath, 0o600)
}

export function writePrivateJson(filePath, value) {
  writePrivateFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath))
}

export function field(row, expectedName) {
  const actual = Object.keys(row || {}).find(key => key.toLowerCase() === expectedName.toLowerCase())
  return actual ? row[actual] : undefined
}

function value(row, expectedName) {
  return field(row, expectedName)
}

function groupColumns(rows, tableSet) {
  const result = new Map()
  for (const row of rows) {
    const table = String(field(row, 'table_name') || '')
    if (!tableSet.has(table)) {
      continue
    }
    const values = result.get(table) || []
    values.push({
      name: String(field(row, 'column_name')),
      dataType: String(field(row, 'data_type') || '').toLowerCase(),
      position: Number(field(row, 'ordinal_position')),
    })
    result.set(table, values)
  }
  for (const [table, values] of result) {
    result.set(table, values.sort((left, right) => left.position - right.position))
  }
  return result
}

function primaryKeysByTable(rows, tableSet) {
  const result = new Map()
  for (const row of rows) {
    const table = String(field(row, 'table_name') || '')
    if (!tableSet.has(table) || String(field(row, 'index_name')) !== 'PRIMARY') {
      continue
    }
    const values = result.get(table) || []
    values.push({
      name: String(field(row, 'column_name')),
      position: Number(field(row, 'seq_in_index')),
    })
    result.set(table, values)
  }
  for (const [table, values] of result) {
    result.set(table, values.sort((left, right) => left.position - right.position).map(item => item.name))
  }
  return result
}

function assertSafeTablePlan(tablePlan) {
  if (
    !tablePlan
    || !MIP_TABLE_PATTERN.test(String(tablePlan.table || ''))
    || !['source-app', 'migration-ledger'].includes(tablePlan.scope)
    || !Array.isArray(tablePlan.columns)
    || tablePlan.columns.length === 0
    || tablePlan.columns.some(column => !/^[a-z][a-z0-9_]*$/.test(column))
    || !Array.isArray(tablePlan.binaryColumns)
    || tablePlan.binaryColumns.some(column => !tablePlan.columns.includes(column))
    || !Array.isArray(tablePlan.primaryKey)
    || tablePlan.primaryKey.length === 0
    || tablePlan.primaryKey.some(column => !/^[a-z][a-z0-9_]*$/.test(column))
    || tablePlan.primaryKey.some(column => tablePlan.binaryColumns.includes(column))
  ) {
    throw new Error('MIP app-scope export query plan is invalid')
  }
  const migrationLedger = MIP_APP_SCOPE_TRACKING_TABLES.includes(tablePlan.table)
  if (migrationLedger !== (tablePlan.scope === 'migration-ledger')) {
    throw new Error('MIP app-scope export query plan has an invalid scope')
  }
}

function buildScopeAndCursorPredicate(tablePlan, sourceAppId, afterPrimaryKey) {
  const clauses = tablePlan.scope === 'source-app'
    ? [`${quoteIdentifier('app_id')} = ${sqlString(sourceAppId)}`]
    : []
  if (afterPrimaryKey !== null) {
    if (!Array.isArray(afterPrimaryKey) || afterPrimaryKey.length !== tablePlan.primaryKey.length) {
      throw new TypeError('Scoped export primary-key cursor is invalid')
    }
    const alternatives = tablePlan.primaryKey.map((column, index) => {
      const equalPrefix = tablePlan.primaryKey.slice(0, index).map((prefixColumn, prefixIndex) => (
        `${quoteIdentifier(prefixColumn)} = ${sqlPrimaryKeyValue(afterPrimaryKey[prefixIndex])}`
      ))
      return `(${[...equalPrefix, `${quoteIdentifier(column)} > ${sqlPrimaryKeyValue(afterPrimaryKey[index])}`].join(' AND ')})`
    })
    clauses.push(`(${alternatives.join(' OR ')})`)
  }
  return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
}

function sqlPrimaryKeyValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Scoped export primary-key cursor is invalid')
    }
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0'
  }
  if (typeof value !== 'string' || value.length > 4096) {
    throw new TypeError('Scoped export primary-key cursor is invalid')
  }
  return sqlString(value)
}

function isCanonicalBase64(value) {
  if (value === '') {
    return true
  }
  if (!/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(value)) {
    return false
  }
  return Buffer.from(value, 'base64').toString('base64') === value
}

function compareInventoryRows(keys) {
  return (left, right) => {
    for (const key of keys) {
      const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? ''))
      if (compared !== 0) {
        return compared
      }
    }
    return 0
  }
}

function canonicalJsonLines(rows) {
  return rows.map(row => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '')
}

function quoteIdentifier(value) {
  return `\`${String(value).replaceAll('`', '``')}\``
}

function sqlString(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`
}
