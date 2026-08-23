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

const root = path.resolve(import.meta.dirname, '..')
const env = loadCaseEnv(root)
const envId = env.CLOUDBASE_ENV_ID
const confirmedEnv = argumentValue('--confirm-env=')
const requestedOutput = argumentValue('--output=')
const pageSize = Number(argumentValue('--page-size=') || 200)

if (!envId || confirmedEnv !== envId) {
  throw new Error('Database backup requires --confirm-env=<exact CLOUDBASE_ENV_ID>')
}
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
  throw new Error('--page-size must be an integer between 1 and 500')
}

const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
const backupRoot = path.join(os.homedir(), 'Backups', 'mip-weapp')
const outputDirectory = path.resolve(requestedOutput || path.join(backupRoot, timestamp))
if (isInside(outputDirectory, root)) {
  throw new Error('Database backups must be written outside the repository')
}
if (fs.existsSync(outputDirectory)) {
  throw new Error(`Backup destination already exists: ${outputDirectory}`)
}

const partialDirectory = `${outputDirectory}.partial-${randomBytes(4).toString('hex')}`
fs.mkdirSync(path.dirname(outputDirectory), { recursive: true, mode: 0o700 })
fs.chmodSync(path.dirname(outputDirectory), 0o700)
fs.mkdirSync(partialDirectory, { mode: 0o700 })
fs.mkdirSync(path.join(partialDirectory, 'schema'), { mode: 0o700 })
fs.mkdirSync(path.join(partialDirectory, 'data'), { mode: 0o700 })

const startedAt = new Date().toISOString()
const target = bindAndRequireMysqlEnvironment(root, envId)
const schemaName = findString(target.mysql, new Set(['schema', 'database', 'databasename']))
const environmentFingerprint = sha256(envId).slice(0, 16)

console.log(`[database-backup] target verified (${environmentFingerprint})`)
console.log(`[database-backup] writing outside repository: ${outputDirectory}`)

const metadataQueries = {
  tables: `SELECT table_name, table_type, engine, version, row_format, table_rows,
      avg_row_length, data_length, max_data_length, index_length, data_free,
      auto_increment, create_time, update_time, check_time, table_collation,
      checksum, create_options, table_comment
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
    ORDER BY table_name`,
  columns: `SELECT table_name, column_name, ordinal_position, column_default,
      is_nullable, data_type, character_maximum_length, character_octet_length,
      numeric_precision, numeric_scale, datetime_precision, character_set_name,
      collation_name, column_type, column_key, extra, privileges, column_comment,
      generation_expression
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
    ORDER BY table_name, ordinal_position`,
  statistics: `SELECT table_name, non_unique, index_name, seq_in_index, column_name,
      collation, cardinality, sub_part, packed, nullable, index_type, comment,
      index_comment, is_visible, expression
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    ORDER BY table_name, index_name, seq_in_index`,
  table_constraints: `SELECT constraint_name, table_name, constraint_type,
      enforced
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
    ORDER BY table_name, constraint_name`,
  key_column_usage: `SELECT constraint_name, table_name, column_name,
      ordinal_position, position_in_unique_constraint, referenced_table_name,
      referenced_column_name
    FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE()
    ORDER BY table_name, constraint_name, ordinal_position`,
  referential_constraints: `SELECT constraint_name, unique_constraint_name,
      match_option, update_rule, delete_rule, table_name, referenced_table_name
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
    ORDER BY table_name, constraint_name`,
  check_constraints: `SELECT constraint_name, check_clause
    FROM information_schema.check_constraints
    WHERE constraint_schema = DATABASE()
    ORDER BY constraint_name`,
  triggers: `SELECT trigger_name, event_manipulation, event_object_table,
      action_order, action_condition, action_statement, action_orientation,
      action_timing, action_reference_old_table, action_reference_new_table,
      action_reference_old_row, action_reference_new_row, created, sql_mode,
      definer, character_set_client, collation_connection, database_collation
    FROM information_schema.triggers
    WHERE trigger_schema = DATABASE()
    ORDER BY event_object_table, trigger_name`,
  routines: `SELECT routine_name, routine_type, data_type, routine_body,
      routine_definition, external_language, parameter_style, is_deterministic,
      sql_data_access, sql_path, security_type, created, last_altered, sql_mode,
      routine_comment, definer, character_set_client, collation_connection,
      database_collation
    FROM information_schema.routines
    WHERE routine_schema = DATABASE()
    ORDER BY routine_name`,
  events: `SELECT event_name, definer, time_zone, event_body, event_definition,
      event_type, execute_at, interval_value, interval_field, sql_mode,
      starts, ends, status, on_completion, created, last_altered,
      last_executed, event_comment, originator, character_set_client,
      collation_connection, database_collation
    FROM information_schema.events
    WHERE event_schema = DATABASE()
    ORDER BY event_name`,
}

const metadata = {}
for (const [name, sql] of Object.entries(metadataQueries)) {
  metadata[name] = queryRowsPaged(sql)
  writeJson(path.join(partialDirectory, 'schema', `${name}.json`), metadata[name])
  console.log(`[database-backup] schema ${name}: ${metadata[name].length}`)
}

const tables = metadata.tables
  .filter(row => String(field(row, 'table_type')) === 'BASE TABLE')
  .map(row => String(field(row, 'table_name')))
const primaryKeys = primaryKeysByTable(metadata.statistics)
const tableMetadata = new Map(metadata.tables.map(row => [String(field(row, 'table_name')), row]))
const tableColumns = columnsByTable(metadata.columns)
const countsBefore = exactCounts(tables)
const tableResults = []

for (const [index, table] of tables.entries()) {
  const expectedRows = countsBefore.get(table) ?? 0
  const relativeFile = path.posix.join('data', `${encodeURIComponent(table)}.jsonl`)
  const dataPath = path.join(partialDirectory, ...relativeFile.split('/'))
  const descriptor = fs.openSync(dataPath, 'wx', 0o600)
  let exportedRows = 0
  try {
    const orderColumns = primaryKeys.get(table) || []
    const averageRowBytes = Math.max(Number(field(tableMetadata.get(table) || {}, 'avg_row_length')) || 0, 256)
    let currentPageSize = Math.max(1, Math.min(pageSize, Math.floor(40_000 / averageRowBytes)))
    let offset = 0
    while (offset < expectedRows) {
      const orderClause = orderColumns.length > 0
        ? ` ORDER BY ${orderColumns.map(quoteIdentifier).join(', ')}`
        : ''
      let rows
      try {
        rows = queryRows(
          `SELECT * FROM ${quoteIdentifier(table)}${orderClause} LIMIT ${currentPageSize} OFFSET ${offset}`,
        )
      }
      catch (error) {
        if (!isResponseTruncation(error)) {
          throw error
        }
        if (currentPageSize === 1) {
          const largeRow = queryLargeRow({
            table,
            columns: tableColumns.get(table) || [],
            orderClause,
            offset,
          })
          rows = largeRow ? [largeRow] : []
          console.log(`[database-backup] chunked oversized row in ${table} at offset ${offset}`)
          for (const row of rows) {
            fs.writeSync(descriptor, `${JSON.stringify(row)}\n`)
          }
          exportedRows += rows.length
          offset += rows.length
          if (rows.length === 0) {
            break
          }
          continue
        }
        currentPageSize = Math.max(1, Math.floor(currentPageSize / 2))
        console.log(`[database-backup] response too large for ${table}; page size -> ${currentPageSize}`)
        continue
      }
      for (const row of rows) {
        fs.writeSync(descriptor, `${JSON.stringify(row)}\n`)
      }
      exportedRows += rows.length
      offset += rows.length
      if (rows.length === 0) {
        break
      }
    }
  }
  finally {
    fs.closeSync(descriptor)
  }
  fs.chmodSync(dataPath, 0o600)
  tableResults.push({
    table,
    relativeFile,
    primaryKey: primaryKeys.get(table) || [],
    rowsBefore: expectedRows,
    rowsExported: exportedRows,
    sha256: sha256File(dataPath),
    bytes: fs.statSync(dataPath).size,
  })
  console.log(`[database-backup] data ${index + 1}/${tables.length}: ${table} (${exportedRows} rows)`)
}

const countsAfter = exactCounts(tables)
let consistent = true
for (const result of tableResults) {
  result.rowsAfter = countsAfter.get(result.table) ?? 0
  result.rowCountStable = result.rowsBefore === result.rowsAfter
    && result.rowsBefore === result.rowsExported
  consistent &&= result.rowCountStable
}

const checksums = []
for (const filePath of listFiles(partialDirectory)) {
  const relative = path.relative(partialDirectory, filePath).split(path.sep).join('/')
  checksums.push(`${sha256File(filePath)}  ${relative}`)
}
writeText(path.join(partialDirectory, 'checksums.sha256'), `${checksums.join('\n')}\n`)

const manifest = {
  format: 'mip-cloudbase-mysql-logical-backup-v1',
  startedAt,
  completedAt: new Date().toISOString(),
  environmentFingerprint,
  databaseName: schemaName || null,
  consistency: consistent ? 'row-count-verified' : 'row-count-changed-during-export',
  transactionalSnapshot: false,
  tableCount: tables.length,
  rowCount: tableResults.reduce((total, item) => total + item.rowsExported, 0),
  pageSize,
  schemaFiles: Object.keys(metadataQueries).map(name => `schema/${name}.json`),
  tables: tableResults,
}
writeJson(path.join(partialDirectory, 'manifest.json'), manifest)
writeText(path.join(partialDirectory, 'README.txt'), [
  'MIP CloudBase MySQL logical backup',
  '',
  'This directory contains private application, user, order, and audit data.',
  'Keep it outside Git and do not upload or share it.',
  'Schema metadata is under schema/. Table rows are JSON Lines under data/.',
  'Values larger than the query transport limit use a $mipBackupEncoding=base64 marker.',
  'manifest.json records exact row counts and per-table SHA-256 values.',
  'checksums.sha256 covers the schema and data files created before the manifest.',
  'This export uses read-only paginated queries and is not a transactional snapshot.',
  '',
].join('\n'))

fs.renameSync(partialDirectory, outputDirectory)
console.log(`[database-backup] complete: ${tables.length} tables, ${manifest.rowCount} rows`)
console.log(`[database-backup] consistency: ${manifest.consistency}`)
console.log(`[database-backup] output: ${outputDirectory}`)

if (!consistent) {
  throw new Error('Database rows changed during export; keep the marked backup and rerun for a stable copy')
}

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function field(row, expectedName) {
  const actual = Object.keys(row).find(key => key.toLowerCase() === expectedName.toLowerCase())
  return actual ? row[actual] : undefined
}

function findString(value, names) {
  if (!value || typeof value !== 'object') {
    return null
  }
  for (const [name, child] of Object.entries(value)) {
    if (names.has(name.toLowerCase()) && typeof child === 'string' && child.trim()) {
      return child.trim()
    }
  }
  for (const child of Object.values(value)) {
    const found = findString(child, names)
    if (found) {
      return found
    }
  }
  return null
}

function queryRows(sql) {
  if (!/^\s*(?:SELECT|SHOW|WITH|EXPLAIN|DESCRIBE)\b/i.test(sql)) {
    throw new Error('Backup attempted a non-read-only SQL statement')
  }
  const response = callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql,
  }, 300000)
  if (response?.success !== true || !Array.isArray(response?.data?.rows)) {
    throw new Error('CloudBase MySQL did not return a successful row set')
  }
  return response.data.rows
}

function queryRowsPaged(sql, preferredPageSize = 20) {
  const rows = []
  let offset = 0
  let currentPageSize = preferredPageSize
  while (true) {
    let page
    try {
      page = queryRows(`SELECT * FROM (${sql}) AS backup_metadata LIMIT ${currentPageSize} OFFSET ${offset}`)
    }
    catch (error) {
      if (currentPageSize === 1 || !isResponseTruncation(error)) {
        throw error
      }
      currentPageSize = Math.max(1, Math.floor(currentPageSize / 2))
      continue
    }
    rows.push(...page)
    offset += page.length
    if (page.length < currentPageSize) {
      return rows
    }
  }
}

function isResponseTruncation(error) {
  return /JSON|Unexpected|unterminated|truncat|position\s+\d+/i.test(String(error))
}

function exactCounts(tablesToCount) {
  const counts = new Map()
  for (let index = 0; index < tablesToCount.length; index += 30) {
    const group = tablesToCount.slice(index, index + 30)
    const sql = group.map(table => `SELECT ${sqlString(table)} AS table_name, COUNT(*) AS row_count FROM ${quoteIdentifier(table)}`)
      .join(' UNION ALL ')
    for (const row of queryRows(sql)) {
      counts.set(String(field(row, 'table_name')), Number(field(row, 'row_count')))
    }
  }
  return counts
}

function primaryKeysByTable(statistics) {
  const result = new Map()
  for (const row of statistics) {
    if (String(field(row, 'index_name')) !== 'PRIMARY') {
      continue
    }
    const table = String(field(row, 'table_name'))
    const values = result.get(table) || []
    values.push({
      column: String(field(row, 'column_name')),
      position: Number(field(row, 'seq_in_index')),
    })
    result.set(table, values)
  }
  for (const [table, values] of result) {
    result.set(table, values.sort((left, right) => left.position - right.position).map(item => item.column))
  }
  return result
}

function columnsByTable(columns) {
  const result = new Map()
  for (const row of columns) {
    const table = String(field(row, 'table_name'))
    const values = result.get(table) || []
    values.push({
      name: String(field(row, 'column_name')),
      dataType: String(field(row, 'data_type') || ''),
      position: Number(field(row, 'ordinal_position')),
    })
    result.set(table, values)
  }
  for (const [table, values] of result) {
    result.set(table, values.sort((left, right) => left.position - right.position))
  }
  return result
}

function queryLargeRow({ table, columns, orderClause, offset }) {
  const result = {}
  let found = false
  for (const column of columns) {
    try {
      const rows = queryRows(
        `SELECT ${quoteIdentifier(column.name)} AS backup_value FROM ${quoteIdentifier(table)}${orderClause} LIMIT 1 OFFSET ${offset}`,
      )
      if (rows.length === 0) {
        return null
      }
      result[column.name] = field(rows[0], 'backup_value')
      found = true
    }
    catch (error) {
      if (!isResponseTruncation(error)) {
        throw error
      }
      result[column.name] = queryLargeColumn({
        table,
        column,
        orderClause,
        offset,
      })
      found = true
    }
  }
  return found ? result : null
}

function queryLargeColumn({ table, column, orderClause, offset }) {
  const lengthRows = queryRows(
    `SELECT OCTET_LENGTH(${quoteIdentifier(column.name)}) AS backup_length FROM ${quoteIdentifier(table)}${orderClause} LIMIT 1 OFFSET ${offset}`,
  )
  const byteLengthValue = field(lengthRows[0] || {}, 'backup_length')
  if (byteLengthValue === null || byteLengthValue === undefined) {
    return null
  }
  const byteLength = Number(byteLengthValue)
  const chunkBytes = 24_000
  const chunks = []
  for (let start = 1; start <= byteLength; start += chunkBytes) {
    const rows = queryRows(
      `SELECT TO_BASE64(SUBSTRING(CAST(${quoteIdentifier(column.name)} AS BINARY), ${start}, ${chunkBytes})) AS backup_chunk FROM ${quoteIdentifier(table)}${orderClause} LIMIT 1 OFFSET ${offset}`,
    )
    const chunk = String(field(rows[0] || {}, 'backup_chunk') || '').replaceAll(/\s/g, '')
    chunks.push(chunk)
  }
  return {
    $mipBackupEncoding: 'base64',
    mysqlDataType: column.dataType,
    byteLength,
    data: chunks.join(''),
  }
}

function quoteIdentifier(value) {
  return `\`${String(value).replaceAll('`', '``')}\``
}

function sqlString(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  fs.chmodSync(filePath, 0o600)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath))
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
