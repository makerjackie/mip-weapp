import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  APP_ID_MIGRATION_EXCLUSIONS,
  APP_ID_MIGRATION_MEDIA_EXCLUSION_REASON,
  APP_ID_MIGRATION_ROW_EXCLUSIONS,
  assertNoAppIdMigrationResidue,
} from './mip-app-id-migration-transform.mjs'
import {
  MIP_APP_SCOPE_TRACKING_TABLES,
  sha256,
  sha256File,
} from './mip-app-scope-export.mjs'
import {
  assertImportSqlKeepsForeignKeysEnforced,
  buildMipAppScopeImportPlan,
  digestPrimaryKeyInventory,
  orderSelfReferentialRows,
} from './mip-app-scope-import-plan.mjs'
import {
  decodeMipExportValue,
  MIP_APP_SCOPE_TRANSFORM_FORMAT,
} from './mip-app-scope-transform-package.mjs'

const APP_ID_PATTERN = /^wx[0-9a-f]{16}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/
const TABLE_PATTERN = /^mip_[a-z0-9_]+$/
const STANDARD_FILES = new Set(['README.txt', 'checksums.sha256', 'manifest.json'])

export const MIP_APP_SCOPE_IMPORT_CHECKPOINT_FORMAT = 'mip-app-scope-import-checkpoint-v1'

export function validateMipAppScopeTransformPackage({
  inputDirectory,
  repoRoot,
  migrationLock,
  migrationLockSha256,
  sourceAppId,
  targetAppId,
  targetEnvironmentId,
}) {
  assertAppId(sourceAppId)
  assertAppId(targetAppId)
  if (sourceAppId === targetAppId) {
    throw new Error('MIP_IMPORT_APP_SCOPE_MUST_CHANGE')
  }
  const input = privatePackageDirectory(inputDirectory, repoRoot)
  const manifestPath = packageFile(input, 'manifest.json')
  const manifest = jsonObject(fs.readFileSync(manifestPath, 'utf8'), 'MIP_IMPORT_MANIFEST_INVALID')
  const requiredTables = lockedTables(migrationLock)
  validateTransformManifest({
    manifest,
    migrationLockSha256,
    requiredTables,
    sourceAppId,
    targetAppId,
    targetEnvironmentId,
  })

  const checksumPath = packageFile(input, 'checksums.sha256')
  const checksums = checksumManifest(fs.readFileSync(checksumPath, 'utf8'))
  const payloadFiles = new Set([
    ...manifest.schemaFiles,
    manifest.unionIdentityInventory.relativeFile,
    manifest.mediaInventory.relativeFile,
    ...manifest.tables.map(table => table.relativeFile),
  ])
  exactSet(checksums.keys(), payloadFiles, 'MIP_IMPORT_CHECKSUM_MANIFEST_INVALID')
  exactSet(packageFiles(input), new Set([...payloadFiles, ...STANDARD_FILES]), 'MIP_IMPORT_PACKAGE_FILE_SET_INVALID')
  for (const [relativeFile, digest] of checksums) {
    if (sha256File(packageFile(input, relativeFile)) !== digest) {
      throw new Error('MIP_IMPORT_CHECKSUM_MISMATCH')
    }
  }
  if (sha256File(packageFile(input, manifest.unionIdentityInventory.relativeFile))
    !== manifest.unionIdentityInventory.sha256
    || sha256File(packageFile(input, manifest.mediaInventory.relativeFile))
    !== manifest.mediaInventory.sha256) {
    throw new Error('MIP_IMPORT_INVENTORY_INTEGRITY_INVALID')
  }

  const rowsByTable = new Map()
  const tableMetadata = new Map()
  let rowCount = 0
  for (const table of manifest.tables) {
    const rows = jsonLines(fs.readFileSync(packageFile(input, table.relativeFile), 'utf8'))
      .map(decodeMipExportValue)
    if (rows.length !== table.rowsExported || sha256File(packageFile(input, table.relativeFile)) !== table.sha256) {
      throw new Error('MIP_IMPORT_TABLE_INTEGRITY_INVALID')
    }
    validateTransformedRows({ table, rows, sourceAppId, targetAppId })
    rowsByTable.set(table.table, Object.freeze(rows))
    tableMetadata.set(table.table, Object.freeze({ ...table }))
    rowCount += rows.length
  }
  if (rowCount !== manifest.rowCount) {
    throw new Error('MIP_IMPORT_ROW_COUNT_INVALID')
  }

  const importTables = requiredTables.filter(table => (
    !MIP_APP_SCOPE_TRACKING_TABLES.includes(table)
    && !Object.hasOwn(APP_ID_MIGRATION_EXCLUSIONS, table)
  ))
  return Object.freeze({
    inputDirectory: input,
    manifest,
    manifestSha256: sha256File(manifestPath),
    rowsByTable,
    tableMetadata,
    allBusinessTables: Object.freeze(requiredTables.filter(
      table => !MIP_APP_SCOPE_TRACKING_TABLES.includes(table),
    )),
    importTables: Object.freeze(importTables),
  })
}

export function buildMipTargetImportPlan({ packageData, metadata, targetRowCounts }) {
  const importSet = new Set(packageData.importTables)
  const allBusinessSet = new Set(packageData.allBusinessTables)
  assertTargetMipBusinessState({
    businessTables: packageData.allBusinessTables,
    targetRowCounts,
    allowExisting: false,
  })
  const tableRows = metadata.tableRows.filter(row => importSet.has(metadataField(row, 'table_name')))
  const columnRows = metadata.columnRows.filter(row => importSet.has(metadataField(row, 'table_name')))
  const primaryKeyRows = metadata.primaryKeyRows.filter(row => importSet.has(metadataField(row, 'table_name')))
  const foreignKeyRows = metadata.foreignKeyRows.filter((row) => {
    const child = metadataField(row, 'table_name')
    const parent = metadataField(row, 'referenced_table_name')
    if (!child || !allBusinessSet.has(child) || !parent) {
      return false
    }
    return importSet.has(child) && importSet.has(parent)
  })
  assertCrossImportReferencesAreCleared({
    packageData,
    foreignKeyRows: metadata.foreignKeyRows,
  })
  const plan = buildMipAppScopeImportPlan({
    tableRows,
    columnRows,
    primaryKeyRows,
    foreignKeyRows,
    targetRowCounts,
  })
  return Object.freeze({
    ...plan,
    allBusinessTables: packageData.allBusinessTables,
    columnsByTable: normalizeColumns(metadata.columnRows, importSet),
  })
}

export function assertTargetMipBusinessState({
  businessTables,
  targetRowCounts,
  allowExisting,
  expectedMaximums,
}) {
  const counts = countMap(targetRowCounts)
  for (const table of businessTables) {
    assertMipTable(table)
    if (!counts.has(table)) {
      throw new Error('MIP_IMPORT_TARGET_COUNT_EVIDENCE_MISSING')
    }
    const count = counts.get(table)
    if (!allowExisting && count !== 0) {
      throw new Error('MIP_IMPORT_TARGET_NOT_EMPTY')
    }
    if (allowExisting) {
      const maximum = Number(expectedMaximums?.get?.(table) ?? expectedMaximums?.[table] ?? 0)
      if (!Number.isSafeInteger(maximum) || maximum < 0 || count > maximum) {
        throw new Error('MIP_IMPORT_TARGET_RESUME_STATE_INVALID')
      }
    }
  }
  return true
}

export function orderedMipImportRows({ table, rows, plan }) {
  const reference = plan.selfReferences.find(item => item.table === table)
  return reference
    ? orderSelfReferentialRows({
        rows,
        childColumns: reference.childColumns,
        parentColumns: reference.parentColumns,
      })
    : [...rows]
}

export function buildMipInsertStatements({
  table,
  rows,
  columns,
  setNullColumns = [],
  maximumBytes = 256 * 1024,
  maximumRows = 50,
}) {
  assertMipTable(table)
  if (!Array.isArray(rows) || !Array.isArray(columns) || columns.length === 0) {
    throw new Error('MIP_IMPORT_INSERT_INPUT_INVALID')
  }
  const definitions = normalizedColumnDefinitions(columns)
  const insertable = definitions.filter(column => !column.generated)
  const setNull = new Set(setNullColumns)
  for (const column of setNull) {
    if (!insertable.some(item => item.name === column)) {
      throw new Error('MIP_IMPORT_DEFERRED_COLUMN_INVALID')
    }
  }
  const statements = []
  let values = []
  let rowIndexes = []
  const prefix = `INSERT INTO ${quoteIdentifier(table)} (${insertable.map(column => quoteIdentifier(column.name)).join(', ')}) VALUES `
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    validateRowColumns(row, definitions)
    const tuple = `(${insertable.map(column => sqlValue(
      setNull.has(column.name) ? null : row[column.name],
      column,
    )).join(', ')})`
    if (Buffer.byteLength(prefix + tuple) > maximumBytes) {
      throw new Error('MIP_IMPORT_ROW_TOO_LARGE')
    }
    const candidate = [...values, tuple]
    if (values.length > 0 && (
      candidate.length > maximumRows
      || Buffer.byteLength(prefix + candidate.join(', ')) > maximumBytes
    )) {
      statements.push(statementRecord(prefix, values, rowIndexes))
      values = []
      rowIndexes = []
    }
    values.push(tuple)
    rowIndexes.push(rowIndex)
  }
  if (values.length > 0) {
    statements.push(statementRecord(prefix, values, rowIndexes))
  }
  return Object.freeze(statements)
}

export function buildMipPointerRestoreStatements({ pointer, rows, columns }) {
  const definitions = normalizedColumnDefinitions(columns)
  const definitionsByName = new Map(definitions.map(column => [column.name, column]))
  const statements = []
  for (const row of rows) {
    const assignments = pointer.deferredColumns
      .filter(column => row[column] !== null && row[column] !== undefined)
      .map(column => `${quoteIdentifier(column)} = ${sqlValue(row[column], definitionsByName.get(column))}`)
    if (assignments.length === 0) {
      continue
    }
    const predicates = pointer.primaryKey.map((column) => {
      if (row[column] === null || row[column] === undefined) {
        throw new Error('MIP_IMPORT_PRIMARY_KEY_INVALID')
      }
      return `${quoteIdentifier(column)} = ${sqlValue(row[column], definitionsByName.get(column))}`
    })
    const sql = `UPDATE ${quoteIdentifier(pointer.table)} SET ${assignments.join(', ')} WHERE ${predicates.join(' AND ')}`
    const verificationSql = `SELECT COUNT(*) AS matched_row_count FROM ${quoteIdentifier(pointer.table)} WHERE ${[
      ...predicates,
      ...pointer.deferredColumns
        .filter(column => row[column] !== null && row[column] !== undefined)
        .map(column => `${quoteIdentifier(column)} = ${sqlValue(row[column], definitionsByName.get(column))}`),
    ].join(' AND ')}`
    assertImportSqlKeepsForeignKeysEnforced(sql)
    statements.push(Object.freeze({ sql, verificationSql, rowCount: 1 }))
  }
  return Object.freeze(statements)
}

export function primaryKeyRecord(row, columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('MIP_IMPORT_PRIMARY_KEY_INVALID')
  }
  const record = {}
  for (const column of columns) {
    if (!Object.hasOwn(row, column) || row[column] === null || row[column] === undefined) {
      throw new Error('MIP_IMPORT_PRIMARY_KEY_INVALID')
    }
    record[column] = row[column]
  }
  return record
}

export function primaryKeyFingerprint(row, columns) {
  return createHash('sha256').update(JSON.stringify(
    columns.map(column => canonicalKeyValue(primaryKeyRecord(row, columns)[column])),
  )).digest('hex')
}

export function createMipImportCheckpoint({ packageData, targetEnvironmentId, targetAppId }) {
  return Object.freeze({
    format: MIP_APP_SCOPE_IMPORT_CHECKPOINT_FORMAT,
    packageManifestSha256: packageData.manifestSha256,
    targetEnvironmentFingerprint: sha256(targetEnvironmentId).slice(0, 16),
    targetAppScopeFingerprint: sha256(targetAppId).slice(0, 16),
    completedTables: [],
    pointerRestoreIndex: 0,
  })
}

export function validateMipImportCheckpoint({
  checkpoint,
  packageData,
  targetEnvironmentId,
  targetAppId,
}) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)
    || checkpoint.format !== MIP_APP_SCOPE_IMPORT_CHECKPOINT_FORMAT
    || checkpoint.packageManifestSha256 !== packageData.manifestSha256
    || checkpoint.targetEnvironmentFingerprint !== sha256(targetEnvironmentId).slice(0, 16)
    || checkpoint.targetAppScopeFingerprint !== sha256(targetAppId).slice(0, 16)
    || !Array.isArray(checkpoint.completedTables)
    || checkpoint.completedTables.some(table => !packageData.importTables.includes(table))
    || new Set(checkpoint.completedTables).size !== checkpoint.completedTables.length
    || !Number.isSafeInteger(checkpoint.pointerRestoreIndex)
    || checkpoint.pointerRestoreIndex < 0) {
    throw new Error('MIP_IMPORT_CHECKPOINT_INVALID')
  }
  return true
}

export function assertMipImportVerification({ packageData, evidence }) {
  const counts = countMap(evidence?.rowCounts)
  const keys = evidence?.primaryKeys
  const sourceResiduals = countMap(evidence?.sourceAppIdResiduals)
  const orphanCounts = countMap(evidence?.orphanCounts)
  for (const table of packageData.allBusinessTables) {
    const expected = packageData.rowsByTable.get(table)?.length ?? 0
    if (counts.get(table) !== expected || sourceResiduals.get(table) !== 0) {
      throw new Error('MIP_IMPORT_POST_VERIFICATION_FAILED')
    }
    if (expected > 0 && packageData.importTables.includes(table)) {
      const primaryKey = packageData.tableMetadata.get(table).primaryKey
      const expectedDigest = digestPrimaryKeyInventory(packageData.rowsByTable.get(table), primaryKey)
      const actualDigest = digestPrimaryKeyInventory(keys?.get?.(table) ?? keys?.[table], primaryKey)
      if (expectedDigest !== actualDigest) {
        throw new Error('MIP_IMPORT_POST_VERIFICATION_FAILED')
      }
    }
  }
  for (const value of orphanCounts.values()) {
    if (value !== 0) {
      throw new Error('MIP_IMPORT_POST_VERIFICATION_FAILED')
    }
  }
  return true
}

function validateTransformManifest({
  manifest,
  migrationLockSha256,
  requiredTables,
  sourceAppId,
  targetAppId,
  targetEnvironmentId,
}) {
  if (manifest.format !== MIP_APP_SCOPE_TRANSFORM_FORMAT
    || manifest.migrationReadiness !== 'transformed-verified'
    || manifest.sourceAppScopeFingerprint !== sha256(sourceAppId).slice(0, 16)
    || manifest.targetAppScopeFingerprint !== sha256(targetAppId).slice(0, 16)
    || manifest.targetEnvironmentFingerprint !== sha256(targetEnvironmentId).slice(0, 16)
    || manifest.migrationLock?.sha256 !== migrationLockSha256
    || manifest.binaryEncoding?.marker !== '$binaryBase64'
    || !Array.isArray(manifest.tables)
    || manifest.tableCount !== manifest.tables.length
    || !Number.isSafeInteger(manifest.rowCount)
    || manifest.rowCount < 0
    || manifest.validation?.outputChecksums !== 'verified'
    || manifest.validation?.outputJsonLines !== 'verified') {
    throw new Error('MIP_IMPORT_MANIFEST_INVALID')
  }
  const seen = new Set()
  let rowCount = 0
  for (const table of manifest.tables) {
    if (!table || typeof table !== 'object' || Array.isArray(table)
      || !TABLE_PATTERN.test(table.table)
      || seen.has(table.table)
      || table.relativeFile !== `data/${encodeURIComponent(table.table)}.jsonl`
      || !Array.isArray(table.primaryKey)
      || table.primaryKey.length === 0
      || table.primaryKey.some(column => !IDENTIFIER_PATTERN.test(column))
      || !Number.isSafeInteger(table.rowsExported)
      || table.rowsExported < 0
      || table.rowsBefore !== table.rowsExported
      || table.rowsAfter !== table.rowsExported
      || table.rowCountStable !== true
      || !Number.isSafeInteger(table.sourceRows)
      || table.sourceRows < table.rowsExported
      || !HASH_PATTERN.test(table.sha256)) {
      throw new Error('MIP_IMPORT_MANIFEST_INVALID')
    }
    const tracking = MIP_APP_SCOPE_TRACKING_TABLES.includes(table.table)
    if (table.scope !== (tracking ? 'migration-ledger' : 'source-app')) {
      throw new Error('MIP_IMPORT_MANIFEST_INVALID')
    }
    if (Object.hasOwn(APP_ID_MIGRATION_EXCLUSIONS, table.table) && table.rowsExported !== 0) {
      throw new Error('MIP_IMPORT_EXCLUSION_INVALID')
    }
    const staticExclusion = Object.hasOwn(APP_ID_MIGRATION_EXCLUSIONS, table.table)
      || Object.hasOwn(APP_ID_MIGRATION_ROW_EXCLUSIONS, table.table)
    const mediaExclusion = table.table === 'mip_media_assets'
      && Number.isSafeInteger(manifest.mediaCopy?.excludedCount)
      && manifest.mediaCopy.excludedCount > 0
    if (!Number.isSafeInteger(table.excludedRows) || table.excludedRows < 0
      || (!staticExclusion && !mediaExclusion && table.excludedRows !== 0)
      || table.sourceRows !== table.rowsExported + table.excludedRows) {
      throw new Error('MIP_IMPORT_EXCLUSION_INVALID')
    }
    rowCount += table.rowsExported
    seen.add(table.table)
  }
  exactSet(seen, new Set(requiredTables), 'MIP_IMPORT_LOCK_TABLE_SET_MISMATCH')
  if (rowCount !== manifest.rowCount) {
    throw new Error('MIP_IMPORT_ROW_COUNT_INVALID')
  }
  const expectedExclusions = new Map()
  for (const table of requiredTables) {
    const reason = APP_ID_MIGRATION_EXCLUSIONS[table]
      || APP_ID_MIGRATION_ROW_EXCLUSIONS[table]
    if (reason) {
      expectedExclusions.set(table, reason)
    }
  }
  if (Number.isSafeInteger(manifest.mediaCopy?.excludedCount)
    && manifest.mediaCopy.excludedCount > 0) {
    expectedExclusions.set('mip_media_assets', APP_ID_MIGRATION_MEDIA_EXCLUSION_REASON)
  }
  if (!Array.isArray(manifest.exclusions)
    || manifest.exclusions.length !== expectedExclusions.size) {
    throw new Error('MIP_IMPORT_EXCLUSION_INVALID')
  }
  const exclusionsByTable = new Map(manifest.exclusions.map(item => [item?.table, item]))
  if (exclusionsByTable.size !== manifest.exclusions.length) {
    throw new Error('MIP_IMPORT_EXCLUSION_INVALID')
  }
  let excludedRowCount = 0
  for (const [table, reason] of expectedExclusions) {
    const exclusion = exclusionsByTable.get(table)
    const tableEntry = manifest.tables.find(item => item.table === table)
    if (!exclusion || !tableEntry
      || exclusion.reason !== reason
      || exclusion.excludedRows !== tableEntry.excludedRows) {
      throw new Error('MIP_IMPORT_EXCLUSION_INVALID')
    }
    excludedRowCount += exclusion.excludedRows
  }
  if (excludedRowCount !== manifest.excludedRowCount) {
    throw new Error('MIP_IMPORT_EXCLUSION_INVALID')
  }
  const mediaTable = manifest.tables.find(table => table.table === 'mip_media_assets')
  if (mediaTable?.sourceRows > 0
    && (manifest.mediaCopy?.format !== 'mip-long-term-media-copy-result-v1'
      || manifest.mediaCopy.copiedCount !== mediaTable.rowsExported
      || manifest.mediaCopy.excludedCount !== mediaTable.excludedRows
      || manifest.mediaCopy.copiedCount + manifest.mediaCopy.excludedCount !== mediaTable.sourceRows
      || manifest.mediaCopy.excludedReferences !== 'verified-absent')) {
    throw new Error('MIP_IMPORT_MEDIA_COPY_INVALID')
  }
  if (!Array.isArray(manifest.schemaFiles) || manifest.schemaFiles.length === 0
    || new Set(manifest.schemaFiles).size !== manifest.schemaFiles.length
    || manifest.schemaFiles.some(file => !safeRelativeFile(file).startsWith('schema/'))
    || !manifest.unionIdentityInventory?.relativeFile
    || !HASH_PATTERN.test(String(manifest.unionIdentityInventory?.sha256 || ''))
    || !manifest.mediaInventory?.relativeFile
    || !HASH_PATTERN.test(String(manifest.mediaInventory?.sha256 || ''))) {
    throw new Error('MIP_IMPORT_MANIFEST_INVALID')
  }
}

function validateTransformedRows({ table, rows, sourceAppId, targetAppId }) {
  const excluded = Object.hasOwn(APP_ID_MIGRATION_EXCLUSIONS, table.table)
  if (excluded && rows.length !== 0) {
    throw new Error('MIP_IMPORT_EXCLUSION_INVALID')
  }
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Buffer.isBuffer(row)) {
      throw new Error('MIP_IMPORT_ROW_INVALID')
    }
    if (table.scope === 'source-app' && row.app_id !== targetAppId) {
      throw new Error('MIP_IMPORT_TARGET_APP_SCOPE_INVALID')
    }
    if (containsExactString(row, sourceAppId)) {
      throw new Error('MIP_IMPORT_SOURCE_APP_RESIDUE')
    }
  }
  if (table.scope === 'source-app') {
    try {
      assertNoAppIdMigrationResidue({
        sourceAppId,
        targetAppId,
        tables: { [table.table]: rows },
      })
    }
    catch {
      throw new Error('MIP_IMPORT_ROW_POLICY_INVALID')
    }
  }
}

function assertCrossImportReferencesAreCleared({ packageData, foreignKeyRows }) {
  const importSet = new Set(packageData.importTables)
  const grouped = new Map()
  for (const row of foreignKeyRows) {
    const child = metadataField(row, 'table_name')
    const parent = metadataField(row, 'referenced_table_name')
    if (!importSet.has(child) || !parent || importSet.has(parent)) {
      continue
    }
    const constraint = metadataField(row, 'constraint_name')
    const column = metadataField(row, 'column_name')
    if (!constraint || !column) {
      throw new Error('MIP_IMPORT_FOREIGN_KEY_METADATA_INVALID')
    }
    const key = `${child}\0${constraint}`
    const entry = grouped.get(key) ?? { table: child, columns: [] }
    entry.columns.push(column)
    grouped.set(key, entry)
  }
  for (const entry of grouped.values()) {
    const nullableColumns = entry.columns.filter(column => column !== 'app_id')
    for (const row of packageData.rowsByTable.get(entry.table) ?? []) {
      if (nullableColumns.every(column => row[column] !== null && row[column] !== undefined)) {
        throw new Error('MIP_IMPORT_EXCLUDED_REFERENCE_NOT_CLEARED')
      }
    }
  }
}

function normalizeColumns(rows, tableSet) {
  const result = new Map([...tableSet].map(table => [table, []]))
  for (const row of rows) {
    const table = metadataField(row, 'table_name')
    if (!tableSet.has(table)) {
      continue
    }
    const name = metadataField(row, 'column_name')
    if (!IDENTIFIER_PATTERN.test(String(name || ''))) {
      throw new Error('MIP_IMPORT_COLUMN_METADATA_INVALID')
    }
    result.get(table).push({
      name,
      dataType: String(metadataField(row, 'data_type') || '').toLowerCase(),
      ordinal: Number(metadataField(row, 'ordinal_position')),
      generated: Boolean(String(metadataField(row, 'generation_expression') || ''))
        || /generated/i.test(String(metadataField(row, 'extra') || '')),
    })
  }
  for (const [table, columns] of result) {
    columns.sort((left, right) => left.ordinal - right.ordinal)
    if (columns.length === 0 || columns.some((column, index) => column.ordinal !== index + 1)) {
      throw new Error(`MIP_IMPORT_COLUMN_METADATA_INVALID:${table}`)
    }
    result.set(table, Object.freeze(columns))
  }
  return result
}

function normalizedColumnDefinitions(columns) {
  return columns.map((column) => {
    const normalized = typeof column === 'string'
      ? { name: column, dataType: '', generated: false }
      : column
    if (!IDENTIFIER_PATTERN.test(String(normalized?.name || ''))) {
      throw new Error('MIP_IMPORT_COLUMN_METADATA_INVALID')
    }
    return normalized
  })
}

function validateRowColumns(row, definitions) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || Buffer.isBuffer(row)) {
    throw new Error('MIP_IMPORT_ROW_INVALID')
  }
  const known = new Set(definitions.map(column => column.name))
  if (Object.keys(row).some(column => !known.has(column))
    || definitions.some(column => !column.generated && !Object.hasOwn(row, column.name))) {
    throw new Error('MIP_IMPORT_ROW_SCHEMA_MISMATCH')
  }
}

function sqlValue(value, column) {
  if (!column) {
    throw new Error('MIP_IMPORT_COLUMN_METADATA_INVALID')
  }
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (Buffer.isBuffer(value)) {
    return `FROM_BASE64(${sqlString(value.toString('base64'))})`
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('MIP_IMPORT_VALUE_INVALID')
    }
    return sqlString(value.toISOString().replace('T', ' ').replace('Z', ''))
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('MIP_IMPORT_VALUE_INVALID')
    }
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0'
  }
  if (typeof value === 'string') {
    return sqlString(value)
  }
  if ((Array.isArray(value) || isPlainObject(value)) && column.dataType === 'json') {
    return `CAST(${sqlString(JSON.stringify(value))} AS JSON)`
  }
  throw new Error('MIP_IMPORT_VALUE_INVALID')
}

function statementRecord(prefix, values, rowIndexes) {
  const sql = prefix + values.join(', ')
  assertImportSqlKeepsForeignKeysEnforced(sql)
  return Object.freeze({ sql, rowCount: values.length, rowIndexes: Object.freeze([...rowIndexes]) })
}

function lockedTables(migrationLock) {
  const tables = migrationLock?.requiredTables
  if (!Array.isArray(tables) || tables.length === 0
    || tables.some(table => !TABLE_PATTERN.test(table))
    || new Set(tables).size !== tables.length) {
    throw new Error('MIP_IMPORT_MIGRATION_LOCK_INVALID')
  }
  return [...tables]
}

function countMap(value) {
  const result = value instanceof Map ? new Map(value) : new Map(Object.entries(value || {}))
  for (const [table, raw] of result) {
    assertMipTable(table)
    const count = Number(raw)
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('MIP_IMPORT_COUNT_EVIDENCE_INVALID')
    }
    result.set(table, count)
  }
  return result
}

function metadataField(row, name) {
  if (!row || typeof row !== 'object') {
    return undefined
  }
  const found = Object.keys(row).find(key => key.toLowerCase() === name.toLowerCase())
  return found ? row[found] : undefined
}

function canonicalKeyValue(value) {
  return Buffer.isBuffer(value) ? { $binaryBase64: value.toString('base64') } : value
}

function containsExactString(value, needle) {
  if (value === needle) {
    return true
  }
  if (Array.isArray(value)) {
    return value.some(item => containsExactString(item, needle))
  }
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.values(value).some(item => containsExactString(item, needle))
  }
  return false
}

function privatePackageDirectory(inputDirectory, repoRoot) {
  const input = path.resolve(String(inputDirectory || ''))
  const repository = path.resolve(String(repoRoot || ''))
  const relative = path.relative(repository, input)
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('MIP_IMPORT_PACKAGE_MUST_BE_OUTSIDE_REPOSITORY')
  }
  const stat = fs.statSync(input, { throwIfNoEntry: false })
  if (!stat?.isDirectory() || fs.lstatSync(input).isSymbolicLink()) {
    throw new Error('MIP_IMPORT_PACKAGE_INVALID')
  }
  return input
}

function packageFile(directory, relativeFile) {
  const normalized = safeRelativeFile(relativeFile)
  const resolved = path.resolve(directory, ...normalized.split('/'))
  const relative = path.relative(directory, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('MIP_IMPORT_PACKAGE_PATH_INVALID')
  }
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error('MIP_IMPORT_PACKAGE_FILE_INVALID')
  }
  return resolved
}

function packageFiles(directory, prefix = '') {
  const root = prefix ? path.join(directory, ...prefix.split('/')) : directory
  const result = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolute = path.join(root, entry.name)
    if (fs.lstatSync(absolute).isSymbolicLink()) {
      throw new Error('MIP_IMPORT_PACKAGE_SYMLINK_FORBIDDEN')
    }
    if (entry.isDirectory()) {
      result.push(...packageFiles(directory, relative))
    }
    else if (entry.isFile()) {
      result.push(safeRelativeFile(relative))
    }
    else {
      throw new Error('MIP_IMPORT_PACKAGE_FILE_INVALID')
    }
  }
  return result.sort()
}

function safeRelativeFile(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')
    || path.posix.isAbsolute(value) || path.posix.normalize(value) !== value
    || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('MIP_IMPORT_PACKAGE_PATH_INVALID')
  }
  return value
}

function checksumManifest(content) {
  if (!content.endsWith('\n')) {
    throw new Error('MIP_IMPORT_CHECKSUM_MANIFEST_INVALID')
  }
  const result = new Map()
  for (const line of content.slice(0, -1).split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\x20{2}(\S.*)$/.exec(line)
    if (!match || result.has(safeRelativeFile(match[2]))) {
      throw new Error('MIP_IMPORT_CHECKSUM_MANIFEST_INVALID')
    }
    result.set(match[2], match[1])
  }
  return result
}

function jsonLines(content) {
  if (content === '') {
    return []
  }
  if (!content.endsWith('\n')) {
    throw new Error('MIP_IMPORT_JSONL_INVALID')
  }
  const lines = content.slice(0, -1).split('\n')
  if (lines.some(line => !line.trim())) {
    throw new Error('MIP_IMPORT_JSONL_INVALID')
  }
  return lines.map(line => jsonObject(line, 'MIP_IMPORT_JSONL_INVALID'))
}

function jsonObject(content, code) {
  try {
    const value = JSON.parse(content)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(code)
    }
    return value
  }
  catch {
    throw new Error(code)
  }
}

function exactSet(values, expected, code) {
  const actual = new Set(values)
  if (actual.size !== expected.size || [...actual].some(item => !expected.has(item))) {
    throw new Error(code)
  }
}

function sqlString(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll('\u0027', '\u0027\u0027')}'`
}

function quoteIdentifier(value) {
  if (!IDENTIFIER_PATTERN.test(String(value || ''))) {
    throw new Error('MIP_IMPORT_IDENTIFIER_INVALID')
  }
  return `\`${value}\``
}

function assertMipTable(value) {
  if (!TABLE_PATTERN.test(String(value || ''))) {
    throw new Error('MIP_IMPORT_TABLE_INVALID')
  }
}

function assertAppId(value) {
  if (!APP_ID_PATTERN.test(String(value || ''))) {
    throw new Error('MIP_IMPORT_APP_ID_INVALID')
  }
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}
