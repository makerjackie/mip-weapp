#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  bindAndRequireMysqlEnvironment,
  callCloudbase,
  loadCaseEnv,
} from './lib/example-cloudbase.mjs'
import {
  sha256,
  sha256File,
} from './lib/mip-app-scope-export.mjs'
import {
  assertMipImportVerification,
  assertTargetMipBusinessState,
  buildMipInsertStatements,
  buildMipPointerRestoreStatements,
  buildMipTargetImportPlan,
  createMipImportCheckpoint,
  orderedMipImportRows,
  primaryKeyFingerprint,
  validateMipAppScopeTransformPackage,
  validateMipImportCheckpoint,
} from './lib/mip-app-scope-import.mjs'
import { loadMipMigrationLock } from './lib/mip-migrations.mjs'

const root = path.resolve(import.meta.dirname, '..')

try {
  const options = parseArguments(process.argv.slice(2))
  const env = loadCaseEnv(root)
  const environmentId = String(env.CLOUDBASE_ENV_ID || '').trim()
  const configuredAppId = String(env.MINI_PROGRAM_APP_ID || '').trim()
  if (!environmentId || options.confirmEnv !== environmentId
    || options.confirmPrefix !== 'mip_'
    || options.targetAppId !== configuredAppId) {
    throw new Error('MIP_IMPORT_TARGET_CONFIRMATION_INVALID')
  }

  const migrationLock = loadMipMigrationLock(root)
  const packageData = validateMipAppScopeTransformPackage({
    inputDirectory: options.input,
    repoRoot: root,
    migrationLock,
    migrationLockSha256: sha256File(
      path.join(root, 'database', 'mysql', 'mip', 'migrations.lock.json'),
    ),
    sourceAppId: options.sourceAppId,
    targetAppId: options.targetAppId,
    targetEnvironmentId: environmentId,
  })

  bindAndRequireMysqlEnvironment(root, environmentId)
  const metadata = loadTargetMetadata(migrationLock.requiredTables)
  assertExactTargetTableSet(metadata.tableRows, migrationLock.requiredTables)
  const countsBefore = loadGlobalCounts(packageData.allBusinessTables)
  const checkpointPath = options.checkpoint
    ? privateCheckpointPath(options.checkpoint)
    : privateCheckpointPath(`${packageData.inputDirectory}.import-checkpoint.json`)
  let checkpoint
  if (fs.existsSync(checkpointPath)) {
    checkpoint = readCheckpoint(checkpointPath)
    validateMipImportCheckpoint({
      checkpoint,
      packageData,
      targetEnvironmentId: environmentId,
      targetAppId: options.targetAppId,
    })
    assertTargetMipBusinessState({
      businessTables: packageData.allBusinessTables,
      targetRowCounts: countsBefore,
      allowExisting: true,
      expectedMaximums: new Map(packageData.allBusinessTables.map(table => [
        table,
        packageData.rowsByTable.get(table)?.length ?? 0,
      ])),
    })
    console.log('[mip-app-import] verified resumable target state')
  }
  else {
    assertTargetMipBusinessState({
      businessTables: packageData.allBusinessTables,
      targetRowCounts: countsBefore,
      allowExisting: false,
    })
    checkpoint = createMipImportCheckpoint({
      packageData,
      targetEnvironmentId: environmentId,
      targetAppId: options.targetAppId,
    })
    writeCheckpoint(checkpointPath, checkpoint)
    console.log('[mip-app-import] verified every target MIP business table is empty')
  }

  const zeroCounts = Object.fromEntries(packageData.allBusinessTables.map(table => [table, 0]))
  const plan = buildMipTargetImportPlan({ packageData, metadata, targetRowCounts: zeroCounts })
  const primaryKeys = primaryKeysByTable(metadata.primaryKeyRows, packageData.importTables)
  const importSteps = new Map(
    plan.phases.find(phase => phase.kind === 'INSERT').steps.map(step => [step.table, step]),
  )

  for (let tableIndex = 0; tableIndex < plan.importOrder.length; tableIndex += 1) {
    const table = plan.importOrder[tableIndex]
    const rows = orderedMipImportRows({
      table,
      rows: packageData.rowsByTable.get(table) || [],
      plan,
    })
    const primaryKey = primaryKeys.get(table)
    const existingRows = loadPrimaryKeys(table, primaryKey, options.targetAppId)
    if (existingRows.length !== countsBefore.get(table)) {
      throw new Error('MIP_IMPORT_TARGET_RESUME_SCOPE_INVALID')
    }
    const expectedKeys = new Set(rows.map(row => primaryKeyFingerprint(row, primaryKey)))
    const existingKeys = new Set(existingRows.map(row => primaryKeyFingerprint(row, primaryKey)))
    if (existingKeys.size !== existingRows.length
      || [...existingKeys].some(key => !expectedKeys.has(key))) {
      throw new Error('MIP_IMPORT_TARGET_RESUME_KEYS_INVALID')
    }
    const missingRows = rows.filter(row => !existingKeys.has(primaryKeyFingerprint(row, primaryKey)))
    const statements = buildMipInsertStatements({
      table,
      rows: missingRows,
      columns: plan.columnsByTable.get(table),
      setNullColumns: importSteps.get(table).setNullColumns,
    })
    for (const statement of statements) {
      executeWrite(statement.sql)
    }
    const completedTables = [...new Set([...checkpoint.completedTables, table])]
    checkpoint = { ...checkpoint, completedTables }
    writeCheckpoint(checkpointPath, checkpoint)
    console.log(`[mip-app-import] table ${tableIndex + 1}/${plan.importOrder.length}: ${table} (${rows.length} rows)`)
  }

  const pointerStatements = plan.pointerRestores.flatMap((pointer) => {
    return buildMipPointerRestoreStatements({
      pointer,
      rows: packageData.rowsByTable.get(pointer.table) || [],
      columns: plan.columnsByTable.get(pointer.table),
    })
  })
  for (let index = checkpoint.pointerRestoreIndex; index < pointerStatements.length; index += 1) {
    executeWrite(pointerStatements[index].sql)
    assertPointerRestore(pointerStatements[index])
    checkpoint = { ...checkpoint, pointerRestoreIndex: index + 1 }
    writeCheckpoint(checkpointPath, checkpoint)
  }
  for (const statement of pointerStatements) {
    assertPointerRestore(statement)
  }

  const evidence = collectVerificationEvidence({
    packageData,
    metadata,
    targetAppId: options.targetAppId,
    sourceAppId: options.sourceAppId,
  })
  assertMipImportVerification({ packageData, evidence })
  checkpoint = {
    ...checkpoint,
    complete: true,
    verificationFingerprint: sha256(JSON.stringify({
      tables: packageData.allBusinessTables.length,
      rows: packageData.manifest.rowCount,
      manifest: packageData.manifestSha256,
    })),
  }
  writeCheckpoint(checkpointPath, checkpoint)
  const importedRowCount = packageData.importTables.reduce(
    (total, table) => total + packageData.rowsByTable.get(table).length,
    0,
  )
  console.log(`[mip-app-import] complete: ${packageData.importTables.length} tables, ${importedRowCount} rows verified`)
}
catch (error) {
  const message = error instanceof Error ? error.message : 'MIP_IMPORT_FAILED'
  const safeMessage = /^MIP_IMPORT_[A-Z0-9_:.-]+$/.test(message)
    ? message
    : 'MIP_IMPORT_FAILED'
  console.error(`[mip-app-import] failed: ${safeMessage}`)
  process.exitCode = 1
}

export function parseArguments(argv) {
  const definitions = new Map([
    ['--input=', 'input'],
    ['--confirm-env=', 'confirmEnv'],
    ['--confirm-prefix=', 'confirmPrefix'],
    ['--source-app-id=', 'sourceAppId'],
    ['--target-app-id=', 'targetAppId'],
    ['--checkpoint=', 'checkpoint'],
  ])
  const values = {}
  const provided = new Set()
  for (const argument of argv) {
    const definition = [...definitions].find(([prefix]) => argument.startsWith(prefix))
    if (!definition) {
      throw new Error('MIP_IMPORT_ARGUMENT_INVALID')
    }
    const [prefix, key] = definition
    const value = argument.slice(prefix.length)
    if (!value || provided.has(key)) {
      throw new Error('MIP_IMPORT_ARGUMENT_INVALID')
    }
    provided.add(key)
    values[key] = value
  }
  const required = [...definitions.values()].filter(key => key !== 'checkpoint')
  if (required.some(key => !provided.has(key))) {
    throw new Error('MIP_IMPORT_ARGUMENT_MISSING')
  }
  return values
}

function loadTargetMetadata(tableNames) {
  const inList = tableNames.map(sqlString).join(', ')
  const tableRows = queryRowsPaged(`SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN (${inList})
    ORDER BY table_name`, 'table_name')
  const columnRows = queryRowsPaged(`SELECT table_name, column_name, ordinal_position,
      is_nullable, data_type, column_type, extra, generation_expression
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name IN (${inList})
    ORDER BY table_name, ordinal_position`, 'table_name, ordinal_position')
  const keyRows = queryRowsPaged(`SELECT constraint_name, table_name, column_name,
      ordinal_position, referenced_table_name, referenced_column_name
    FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE() AND table_name IN (${inList})
    ORDER BY table_name, constraint_name, ordinal_position`, 'table_name, constraint_name, ordinal_position')
  return {
    tableRows,
    columnRows,
    primaryKeyRows: keyRows.filter(row => field(row, 'constraint_name') === 'PRIMARY'),
    foreignKeyRows: keyRows.filter(row => field(row, 'referenced_table_name')),
  }
}

function assertExactTargetTableSet(rows, expectedTables) {
  const actual = new Set(rows.map(row => String(field(row, 'table_name') || '')))
  const expected = new Set(expectedTables)
  if (actual.size !== expected.size || [...actual].some(table => !expected.has(table))) {
    throw new Error('MIP_IMPORT_TARGET_SCHEMA_MISMATCH')
  }
}

function loadGlobalCounts(tables) {
  const result = new Map()
  for (const chunk of chunks(tables, 30)) {
    const sql = chunk.map(table => (
      `SELECT ${sqlString(table)} AS table_name, COUNT(*) AS row_count FROM ${quoteIdentifier(table)}`
    )).join(' UNION ALL ')
    for (const row of queryRows(sql)) {
      const table = String(field(row, 'table_name') || '')
      result.set(table, Number(field(row, 'row_count')))
    }
  }
  return result
}

function primaryKeysByTable(rows, tables) {
  const tableSet = new Set(tables)
  const result = new Map([...tableSet].map(table => [table, []]))
  for (const row of rows) {
    const table = String(field(row, 'table_name') || '')
    if (!tableSet.has(table)) {
      continue
    }
    result.get(table).push({
      column: String(field(row, 'column_name') || ''),
      ordinal: Number(field(row, 'ordinal_position')),
    })
  }
  for (const [table, columns] of result) {
    columns.sort((left, right) => left.ordinal - right.ordinal)
    if (columns.length === 0 || columns.some((column, index) => column.ordinal !== index + 1)) {
      throw new Error('MIP_IMPORT_TARGET_PRIMARY_KEY_INVALID')
    }
    result.set(table, columns.map(column => column.column))
  }
  return result
}

function loadPrimaryKeys(table, primaryKey, targetAppId) {
  const projection = primaryKey.map(quoteIdentifier).join(', ')
  return queryRows(`SELECT ${projection} FROM ${quoteIdentifier(table)}
    WHERE ${quoteIdentifier('app_id')} = ${sqlString(targetAppId)}
    ORDER BY ${projection}`)
}

function collectVerificationEvidence({ packageData, metadata, targetAppId, sourceAppId }) {
  const rowCounts = loadGlobalCounts(packageData.allBusinessTables)
  const primaryKeys = new Map()
  for (const table of packageData.importTables) {
    if ((packageData.rowsByTable.get(table)?.length ?? 0) > 0) {
      primaryKeys.set(
        table,
        loadPrimaryKeys(table, packageData.tableMetadata.get(table).primaryKey, targetAppId),
      )
    }
  }
  const sourceAppIdResiduals = new Map()
  for (const chunk of chunks(packageData.allBusinessTables, 25)) {
    const sql = chunk.map(table => (
      `SELECT ${sqlString(table)} AS table_name, COUNT(*) AS row_count FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier('app_id')} = ${sqlString(sourceAppId)}`
    )).join(' UNION ALL ')
    for (const row of queryRows(sql)) {
      sourceAppIdResiduals.set(
        String(field(row, 'table_name') || ''),
        Number(field(row, 'row_count')),
      )
    }
  }
  const orphanCounts = loadOrphanCounts(
    metadata.foreignKeyRows,
    new Set(packageData.importTables),
    targetAppId,
  )
  return { rowCounts, primaryKeys, sourceAppIdResiduals, orphanCounts }
}

function loadOrphanCounts(rows, importSet, targetAppId) {
  const foreignKeys = groupForeignKeys(rows, importSet)
  const result = new Map()
  for (const foreignKey of foreignKeys) {
    const join = foreignKey.columns.map(column => (
      `parent_row.${quoteIdentifier(column.parent)} = child_row.${quoteIdentifier(column.child)}`
    )).join(' AND ')
    const populated = foreignKey.columns
      .map(column => column.child)
      .filter(column => column !== 'app_id')
      .map(column => `child_row.${quoteIdentifier(column)} IS NOT NULL`)
      .join(' AND ') || '1 = 1'
    const marker = foreignKey.columns[0].parent
    const sql = `SELECT COUNT(*) AS orphan_count
      FROM ${quoteIdentifier(foreignKey.child)} child_row
      LEFT JOIN ${quoteIdentifier(foreignKey.parent)} parent_row ON ${join}
      WHERE child_row.${quoteIdentifier('app_id')} = ${sqlString(targetAppId)}
        AND ${populated}
        AND parent_row.${quoteIdentifier(marker)} IS NULL`
    const resultRows = queryRows(sql)
    result.set(foreignKey.constraint, Number(field(resultRows[0], 'orphan_count')))
  }
  return result
}

function groupForeignKeys(rows, importSet) {
  const result = new Map()
  for (const row of rows) {
    const child = String(field(row, 'table_name') || '')
    const parent = String(field(row, 'referenced_table_name') || '')
    if (!importSet.has(child) || !importSet.has(parent)) {
      continue
    }
    const constraint = String(field(row, 'constraint_name') || '')
    const key = `${child}\0${constraint}`
    const entry = result.get(key) ?? { child, parent, constraint, columns: [] }
    entry.columns.push({
      child: String(field(row, 'column_name') || ''),
      parent: String(field(row, 'referenced_column_name') || ''),
      ordinal: Number(field(row, 'ordinal_position')),
    })
    result.set(key, entry)
  }
  return [...result.values()].map((entry) => {
    entry.columns.sort((left, right) => left.ordinal - right.ordinal)
    return entry
  })
}

function queryRows(sql) {
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error('MIP_IMPORT_READ_QUERY_INVALID')
  }
  try {
    const response = callCloudbase(root, 'queryMysqlDatabase', {
      action: 'runQuery',
      sql,
    }, 300000)
    if (response?.success !== true || !Array.isArray(response?.data?.rows)) {
      throw new Error('MIP_IMPORT_DATABASE_READ_FAILED')
    }
    return response.data.rows
  }
  catch {
    throw new Error('MIP_IMPORT_DATABASE_READ_FAILED')
  }
}

function queryRowsPaged(sql, orderBy, pageSize = 50) {
  if (!/^[a-z_]+(?:, [a-z_]+)*$/.test(orderBy)) {
    throw new Error('MIP_IMPORT_METADATA_ORDER_INVALID')
  }
  const rows = []
  let offset = 0
  while (true) {
    const page = queryRows(
      `SELECT * FROM (${sql}) AS mip_import_metadata ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
    )
    rows.push(...page)
    offset += page.length
    if (page.length < pageSize) {
      return rows
    }
  }
}

function executeWrite(sql) {
  if (!/^\s*(?:INSERT|UPDATE)\b/i.test(sql) || /\bforeign_key_checks\b/i.test(sql)) {
    throw new Error('MIP_IMPORT_WRITE_STATEMENT_INVALID')
  }
  try {
    const response = callCloudbase(root, 'manageMysqlDatabase', {
      action: 'runStatement',
      sql,
    }, 300000)
    if (response?.success === false || response?.isError === true) {
      throw new Error('MIP_IMPORT_DATABASE_WRITE_FAILED')
    }
  }
  catch {
    throw new Error('MIP_IMPORT_DATABASE_WRITE_FAILED')
  }
}

function assertPointerRestore(statement) {
  const rows = queryRows(statement.verificationSql)
  const count = Number(field(rows[0] || {}, 'matched_row_count'))
  if (rows.length !== 1 || count !== statement.rowCount) {
    throw new Error('MIP_IMPORT_POINTER_RESTORE_VERIFICATION_FAILED')
  }
}

function privateCheckpointPath(value) {
  const resolved = path.resolve(value)
  const relative = path.relative(root, resolved)
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('MIP_IMPORT_CHECKPOINT_MUST_BE_OUTSIDE_REPOSITORY')
  }
  const parent = path.dirname(resolved)
  if (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('MIP_IMPORT_CHECKPOINT_PATH_INVALID')
  }
  return resolved
}

function readCheckpoint(filePath) {
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('MIP_IMPORT_CHECKPOINT_INVALID')
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }
  catch {
    throw new Error('MIP_IMPORT_CHECKPOINT_INVALID')
  }
}

function writeCheckpoint(filePath, checkpoint) {
  const parent = path.dirname(filePath)
  const parentStat = fs.lstatSync(parent)
  const existing = fs.lstatSync(filePath, { throwIfNoEntry: false })
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()
    || (existing && (!existing.isFile() || existing.isSymbolicLink() || (existing.mode & 0o077) !== 0))) {
    throw new Error('MIP_IMPORT_CHECKPOINT_PATH_INVALID')
  }
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  let descriptor
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(descriptor, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temporary, filePath)
    fs.chmodSync(filePath, 0o600)
  }
  finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor)
    }
    const partial = fs.lstatSync(temporary, { throwIfNoEntry: false })
    if (partial?.isFile() && !partial.isSymbolicLink()) {
      fs.unlinkSync(temporary)
    }
  }
}

function field(row, name) {
  if (!row || typeof row !== 'object') {
    return undefined
  }
  const key = Object.keys(row).find(candidate => candidate.toLowerCase() === name.toLowerCase())
  return key ? row[key] : undefined
}

function chunks(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function sqlString(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll('\u0027', '\u0027\u0027')}'`
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(String(value || ''))) {
    throw new Error('MIP_IMPORT_IDENTIFIER_INVALID')
  }
  return `\`${value}\``
}
