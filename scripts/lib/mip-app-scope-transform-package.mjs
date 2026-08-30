import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import {
  assertNoAppIdMigrationResidue,
  transformAppScopedTable,
} from './mip-app-id-migration-transform.mjs'
import {
  assertPrivateExportDestination,
  createPrivateExportDirectories,
  MIP_APP_SCOPE_EXPORT_FORMAT,
  MIP_APP_SCOPE_TRACKING_TABLES,
  sha256,
  sha256File,
  writePrivateFile,
  writePrivateJson,
} from './mip-app-scope-export.mjs'

export const MIP_APP_SCOPE_TRANSFORM_FORMAT = 'mip-app-scope-transform-v1'

const APP_ID_PATTERN = /^wx[0-9a-f]{16}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/
const TABLE_PATTERN = /^mip_[a-z0-9_]+$/
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/
const STANDARD_FILES = new Set(['manifest.json', 'checksums.sha256', 'README.txt'])

export function loadMigrationEncryptionEnvironment(filePath) {
  const absolutePath = path.resolve(filePath || '')
  const stat = safeRegularFile(absolutePath, 'MIGRATION_ENV_FILE_INVALID')
  if (stat.size > 1024 * 1024) {
    throw new Error('MIGRATION_ENV_FILE_INVALID')
  }
  const values = parseDotEnv(fs.readFileSync(absolutePath, 'utf8'))
  const environmentId = String(values.CLOUDBASE_ENV_ID || '').trim()
  const phoneEncryptionKey = String(values.MIP_PHONE_ENCRYPTION_KEY || '')
  if (!environmentId || phoneEncryptionKey.length < 32) {
    throw new Error('MIGRATION_ENV_CONFIGURATION_INVALID')
  }
  return Object.freeze({
    environmentFingerprint: sha256(environmentId).slice(0, 16),
    phoneEncryptionKey,
    realPath: fs.realpathSync(absolutePath),
  })
}

export function decodeMipExportValue(value) {
  if (Array.isArray(value)) {
    return value.map(decodeMipExportValue)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  if (Object.hasOwn(value, '$binaryBase64')) {
    if (Object.keys(value).length !== 1 || !isCanonicalBase64(value.$binaryBase64)) {
      throw new Error('MIGRATION_BINARY_MARKER_INVALID')
    }
    return Buffer.from(value.$binaryBase64, 'base64')
  }
  if (Buffer.isBuffer(value)) {
    throw new TypeError('MIGRATION_BINARY_MARKER_INVALID')
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, decodeMipExportValue(child)]),
  )
}

export function encodeMipExportValue(value) {
  if (Buffer.isBuffer(value)) {
    return { $binaryBase64: value.toString('base64') }
  }
  if (Array.isArray(value)) {
    return value.map(encodeMipExportValue)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, encodeMipExportValue(child)]),
  )
}

export function validateMipAppScopeExportPackage({
  inputDirectory,
  repoRoot,
  sourceAppId,
  sourceEnvironmentFingerprint,
}) {
  assertAppId(sourceAppId, 'MIGRATION_SOURCE_APP_ID_INVALID')
  const input = path.resolve(inputDirectory || '')
  const repository = path.resolve(repoRoot || '')
  assertDirectoryOutsideRepository(input, repository)
  safeDirectory(input, 'MIGRATION_INPUT_DIRECTORY_INVALID')

  const manifestPath = safePackageFile(input, 'manifest.json')
  const checksumPath = safePackageFile(input, 'checksums.sha256')
  const manifest = parseJsonObject(
    fs.readFileSync(manifestPath, 'utf8'),
    'MIGRATION_MANIFEST_INVALID',
  )
  validateManifestHeader({
    manifest,
    repoRoot: repository,
    sourceAppId,
    sourceEnvironmentFingerprint,
  })

  const tables = validateManifestTables(manifest.tables)
  if (manifest.tableCount !== tables.length) {
    throw new Error('MIGRATION_MANIFEST_INVALID')
  }
  if (manifest.rowCount !== tables.reduce((total, table) => total + table.rowsExported, 0)) {
    throw new Error('MIGRATION_MANIFEST_INVALID')
  }

  const schemaFiles = validateRelativeFileList(manifest.schemaFiles, 'schema/')
  const inventoryFiles = validateInventoryManifest(manifest)
  const expectedPayload = new Set([
    ...schemaFiles,
    ...tables.map(table => table.relativeFile),
    ...inventoryFiles,
  ])
  const checksums = parseChecksumManifest(fs.readFileSync(checksumPath, 'utf8'))
  assertExactSet(checksums.keys(), expectedPayload, 'MIGRATION_CHECKSUM_MANIFEST_INVALID')

  const packageFiles = listPackageFiles(input)
  const expectedFiles = new Set([...expectedPayload, ...STANDARD_FILES])
  assertExactSet(packageFiles, expectedFiles, 'MIGRATION_PACKAGE_FILE_SET_INVALID')

  for (const [relativeFile, expectedHash] of checksums) {
    const filePath = safePackageFile(input, relativeFile)
    if (sha256File(filePath) !== expectedHash) {
      throw new Error('MIGRATION_CHECKSUM_MISMATCH')
    }
  }

  for (const relativeFile of schemaFiles) {
    parseJsonValue(
      fs.readFileSync(safePackageFile(input, relativeFile), 'utf8'),
      'MIGRATION_SCHEMA_JSON_INVALID',
    )
  }
  validateInventoryFiles({ input, inventoryFiles, manifest })

  const rowsByTable = new Map()
  for (const table of tables) {
    const filePath = safePackageFile(input, table.relativeFile)
    if (sha256File(filePath) !== table.sha256) {
      throw new Error('MIGRATION_TABLE_CHECKSUM_MISMATCH')
    }
    const rows = parseJsonLines(fs.readFileSync(filePath, 'utf8'))
      .map(decodeMipExportValue)
    if (rows.length !== table.rowsExported) {
      throw new Error('MIGRATION_JSONL_ROW_COUNT_MISMATCH')
    }
    validateSourceTableRows({ rows, table, sourceAppId })
    rowsByTable.set(table.table, rows)
  }

  return Object.freeze({
    inputDirectory: input,
    manifest,
    manifestSha256: sha256File(manifestPath),
    tables: Object.freeze(tables),
    rowsByTable,
    schemaFiles: Object.freeze(schemaFiles),
    inventoryFiles: Object.freeze(inventoryFiles),
    verifiedPayloadFileCount: expectedPayload.size,
  })
}

export function transformMipAppScopeExportPackage({
  inputDirectory,
  outputDirectory,
  repoRoot,
  sourceAppId,
  targetAppId,
  sourcePhoneEncryptionKey,
  targetPhoneEncryptionKey,
  sourceEnvironmentFingerprint,
  targetEnvironmentFingerprint,
}) {
  assertAppId(sourceAppId, 'MIGRATION_SOURCE_APP_ID_INVALID')
  assertAppId(targetAppId, 'MIGRATION_TARGET_APP_ID_INVALID')
  if (sourceAppId === targetAppId) {
    throw new Error('MIGRATION_APP_ID_MAPPING_MUST_CHANGE')
  }
  assertEncryptionKey(sourcePhoneEncryptionKey)
  assertEncryptionKey(targetPhoneEncryptionKey)
  assertFingerprint(sourceEnvironmentFingerprint)
  assertFingerprint(targetEnvironmentFingerprint)
  if (sourceEnvironmentFingerprint === targetEnvironmentFingerprint) {
    throw new Error('MIGRATION_ENVIRONMENT_MAPPING_MUST_CHANGE')
  }

  const repository = path.resolve(repoRoot || '')
  const output = path.resolve(outputDirectory || '')
  assertPrivateExportDestination({ outputDirectory: output, repoRoot: repository })
  if (output.includes(sourceAppId) || output.includes(targetAppId)) {
    throw new Error('MIGRATION_OUTPUT_PATH_CONTAINS_IDENTIFIER')
  }

  const validated = validateMipAppScopeExportPackage({
    inputDirectory,
    repoRoot: repository,
    sourceAppId,
    sourceEnvironmentFingerprint,
  })
  if (path.resolve(validated.inputDirectory) === output) {
    throw new Error('MIGRATION_OUTPUT_MUST_DIFFER_FROM_INPUT')
  }

  createPrivateExportDirectories({ outputDirectory: output, repoRoot: repository })
  try {
    copyVerifiedMetadataFiles(validated, output)
    const transformedTables = []
    const exclusions = []
    let transformedRowCount = 0
    let excludedRowCount = 0

    for (const table of validated.tables) {
      const sourceRows = validated.rowsByTable.get(table.table) || []
      let rows = sourceRows
      let excludedCount = 0
      let exclusionReason = null

      if (table.scope === 'source-app') {
        const result = transformAppScopedTable({
          tableName: table.table,
          rows: sourceRows,
          sourceAppId,
          targetAppId,
          sourcePhoneEncryptionKey,
          targetPhoneEncryptionKey,
        })
        rows = [...result.rows]
        excludedCount = result.excludedCount
        exclusionReason = result.reason || null
        assertNoAppIdMigrationResidue({
          sourceAppId,
          targetAppId,
          tables: { [table.table]: rows },
        })
      }

      const relativeFile = table.relativeFile
      const filePath = path.join(output, ...relativeFile.split('/'))
      const content = rows
        .map(row => JSON.stringify(encodeMipExportValue(row)))
        .join('\n')
      writePrivateFile(filePath, content ? `${content}\n` : '')
      const bytes = fs.statSync(filePath).size
      const digest = sha256File(filePath)
      transformedRowCount += rows.length
      excludedRowCount += excludedCount

      transformedTables.push({
        ...table,
        rowsBefore: rows.length,
        rowsExported: rows.length,
        rowsAfter: rows.length,
        rowCountStable: true,
        sourceRows: sourceRows.length,
        excludedRows: excludedCount,
        bytes,
        sha256: digest,
      })
      if (exclusionReason) {
        exclusions.push({
          table: table.table,
          reason: exclusionReason,
          excludedRows: excludedCount,
        })
      }
    }

    const payloadFiles = [
      ...validated.schemaFiles,
      ...validated.inventoryFiles,
      ...transformedTables.map(table => table.relativeFile),
    ].sort()
    const checksums = payloadFiles.map((relativeFile) => {
      return `${sha256File(path.join(output, ...relativeFile.split('/')))}  ${relativeFile}`
    })
    writePrivateFile(path.join(output, 'checksums.sha256'), `${checksums.join('\n')}\n`)

    const manifest = {
      format: MIP_APP_SCOPE_TRANSFORM_FORMAT,
      completedAt: new Date().toISOString(),
      sourceExportManifestSha256: validated.manifestSha256,
      sourceEnvironmentFingerprint,
      targetEnvironmentFingerprint,
      sourceAppScopeFingerprint: sha256(sourceAppId).slice(0, 16),
      targetAppScopeFingerprint: sha256(targetAppId).slice(0, 16),
      migrationLock: validated.manifest.migrationLock,
      binaryEncoding: validated.manifest.binaryEncoding,
      schemaFiles: validated.schemaFiles,
      tableCount: transformedTables.length,
      sourceRowCount: validated.manifest.rowCount,
      rowCount: transformedRowCount,
      excludedRowCount,
      tables: transformedTables,
      exclusions,
      unionIdentityInventory: validated.manifest.unionIdentityInventory,
      mediaInventory: validated.manifest.mediaInventory,
      validation: {
        sourceManifest: 'verified',
        sourceChecksums: 'verified',
        sourceJsonLines: 'verified',
        binaryValues: 'decoded-and-reencoded',
        excludedTables: 'verified',
        targetAppScope: 'verified',
        outputChecksums: 'verified',
        outputJsonLines: 'verified',
        verifiedPayloadFileCount: validated.verifiedPayloadFileCount,
      },
      migrationReadiness: 'transformed-verified',
    }
    writePrivateJson(path.join(output, 'manifest.json'), manifest)
    writePrivateFile(path.join(output, 'README.txt'), [
      'MIP transformed AppID-scoped migration package',
      '',
      'This directory contains private MIP user, order, and profile data.',
      'It has been verified, AppID-remapped, and private profile data has been re-encrypted.',
      'Source-bound credentials and operational claims listed in manifest.json are excluded.',
      'Keep this directory outside Git and do not upload or share it.',
      '',
    ].join('\n'))
    verifyTransformedPackageReadback({
      outputDirectory: output,
      manifest,
      payloadFiles,
      sourceAppId,
      targetAppId,
    })
    assertPrivatePermissions(output)

    return Object.freeze({
      tableCount: transformedTables.length,
      rowCount: transformedRowCount,
      excludedRowCount,
      outputDirectory: output,
    })
  }
  catch (error) {
    fs.rmSync(output, { recursive: true, force: true })
    throw error
  }
}

function verifyTransformedPackageReadback({
  outputDirectory,
  manifest,
  payloadFiles,
  sourceAppId,
  targetAppId,
}) {
  const writtenManifest = parseJsonObject(
    fs.readFileSync(safePackageFile(outputDirectory, 'manifest.json'), 'utf8'),
    'MIGRATION_OUTPUT_MANIFEST_INVALID',
  )
  if (
    writtenManifest.format !== MIP_APP_SCOPE_TRANSFORM_FORMAT
    || writtenManifest.tableCount !== manifest.tableCount
    || writtenManifest.rowCount !== manifest.rowCount
    || writtenManifest.excludedRowCount !== manifest.excludedRowCount
  ) {
    throw new Error('MIGRATION_OUTPUT_MANIFEST_INVALID')
  }

  const checksums = parseChecksumManifest(
    fs.readFileSync(safePackageFile(outputDirectory, 'checksums.sha256'), 'utf8'),
  )
  assertExactSet(checksums.keys(), new Set(payloadFiles), 'MIGRATION_OUTPUT_CHECKSUM_INVALID')
  for (const [relativeFile, expectedHash] of checksums) {
    if (sha256File(safePackageFile(outputDirectory, relativeFile)) !== expectedHash) {
      throw new Error('MIGRATION_OUTPUT_CHECKSUM_INVALID')
    }
  }

  let rowCount = 0
  for (const table of manifest.tables) {
    const rows = parseJsonLines(
      fs.readFileSync(safePackageFile(outputDirectory, table.relativeFile), 'utf8'),
    ).map(decodeMipExportValue)
    if (rows.length !== table.rowsExported) {
      throw new Error('MIGRATION_OUTPUT_ROW_COUNT_INVALID')
    }
    rowCount += rows.length
    if (table.scope === 'source-app') {
      assertNoAppIdMigrationResidue({
        sourceAppId,
        targetAppId,
        tables: { [table.table]: rows },
      })
    }
  }
  if (rowCount !== manifest.rowCount) {
    throw new Error('MIGRATION_OUTPUT_ROW_COUNT_INVALID')
  }
}

function validateManifestHeader({
  manifest,
  repoRoot,
  sourceAppId,
  sourceEnvironmentFingerprint,
}) {
  if (
    manifest.format !== MIP_APP_SCOPE_EXPORT_FORMAT
    || manifest.consistency !== 'row-count-verified'
    || manifest.sourceWritesFrozen !== true
    || manifest.primaryKeyInventoryVerified !== true
    || manifest.migrationReadiness !== 'export-verified'
    || manifest.sourceAppScopeFingerprint !== sha256(sourceAppId).slice(0, 16)
    || manifest.sourceEnvironmentFingerprint !== sourceEnvironmentFingerprint
    || manifest.binaryEncoding?.marker !== '$binaryBase64'
    || !Number.isSafeInteger(manifest.tableCount)
    || manifest.tableCount < 1
    || !Number.isSafeInteger(manifest.rowCount)
    || manifest.rowCount < 0
    || !HASH_PATTERN.test(String(manifest.migrationLock?.sha256 || ''))
  ) {
    throw new Error('MIGRATION_MANIFEST_INVALID')
  }
  const currentLockPath = path.join(repoRoot, 'database', 'mysql', 'mip', 'migrations.lock.json')
  if (sha256File(currentLockPath) !== manifest.migrationLock.sha256) {
    throw new Error('MIGRATION_LOCK_MISMATCH')
  }
}

function validateManifestTables(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('MIGRATION_MANIFEST_TABLES_INVALID')
  }
  const seen = new Set()
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('MIGRATION_MANIFEST_TABLES_INVALID')
    }
    const table = String(raw.table || '')
    if (!TABLE_PATTERN.test(table) || seen.has(table)) {
      throw new Error('MIGRATION_MANIFEST_TABLES_INVALID')
    }
    seen.add(table)
    const expectedScope = MIP_APP_SCOPE_TRACKING_TABLES.includes(table)
      ? 'migration-ledger'
      : 'source-app'
    const relativeFile = normalizeRelativeFile(raw.relativeFile)
    if (
      raw.scope !== expectedScope
      || relativeFile !== `data/${encodeURIComponent(table)}.jsonl`
      || !Array.isArray(raw.primaryKey)
      || raw.primaryKey.length === 0
      || raw.primaryKey.some(column => !IDENTIFIER_PATTERN.test(String(column)))
      || !Number.isSafeInteger(raw.rowsExported)
      || raw.rowsExported < 0
      || raw.rowsBefore !== raw.rowsExported
      || raw.rowsAfter !== raw.rowsExported
      || raw.rowCountStable !== true
      || raw.primaryKeyInventoryStable !== true
      || !HASH_PATTERN.test(String(raw.primaryKeyInventorySha256 || ''))
      || !Number.isSafeInteger(raw.bytes)
      || raw.bytes < 0
      || !HASH_PATTERN.test(String(raw.sha256 || ''))
    ) {
      throw new Error('MIGRATION_MANIFEST_TABLES_INVALID')
    }
    return Object.freeze({ ...raw, table, relativeFile })
  })
}

function validateInventoryManifest(manifest) {
  const inventories = [manifest.unionIdentityInventory, manifest.mediaInventory]
  const files = inventories.map((inventory) => {
    if (
      !inventory
      || typeof inventory !== 'object'
      || Array.isArray(inventory)
      || !HASH_PATTERN.test(String(inventory.sha256 || ''))
    ) {
      throw new Error('MIGRATION_INVENTORY_MANIFEST_INVALID')
    }
    const relativeFile = normalizeRelativeFile(inventory.relativeFile)
    if (!relativeFile.startsWith('inventory/')) {
      throw new Error('MIGRATION_INVENTORY_MANIFEST_INVALID')
    }
    return relativeFile
  })
  if (new Set(files).size !== files.length) {
    throw new Error('MIGRATION_INVENTORY_MANIFEST_INVALID')
  }
  return files
}

function validateInventoryFiles({ input, inventoryFiles, manifest }) {
  const inventories = [manifest.unionIdentityInventory, manifest.mediaInventory]
  for (let index = 0; index < inventoryFiles.length; index += 1) {
    const filePath = safePackageFile(input, inventoryFiles[index])
    if (sha256File(filePath) !== inventories[index].sha256) {
      throw new Error('MIGRATION_INVENTORY_CHECKSUM_MISMATCH')
    }
    parseJsonObject(fs.readFileSync(filePath, 'utf8'), 'MIGRATION_INVENTORY_JSON_INVALID')
  }
}

function validateSourceTableRows({ rows, table, sourceAppId }) {
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Buffer.isBuffer(row)) {
      throw new Error('MIGRATION_JSONL_ROW_INVALID')
    }
    if (table.scope === 'source-app' && row.app_id !== sourceAppId) {
      throw new Error('MIGRATION_SOURCE_APP_SCOPE_MISMATCH')
    }
    if (table.scope === 'migration-ledger' && Object.hasOwn(row, 'app_id')) {
      throw new Error('MIGRATION_LEDGER_SCOPE_INVALID')
    }
  }
}

function parseJsonLines(content) {
  if (content === '') {
    return []
  }
  if (!content.endsWith('\n')) {
    throw new Error('MIGRATION_JSONL_INVALID')
  }
  const lines = content.slice(0, -1).split('\n')
  if (lines.some(line => line.trim() === '')) {
    throw new Error('MIGRATION_JSONL_INVALID')
  }
  return lines.map(line => parseJsonObject(line, 'MIGRATION_JSONL_INVALID'))
}

function parseChecksumManifest(content) {
  if (!content.endsWith('\n')) {
    throw new Error('MIGRATION_CHECKSUM_MANIFEST_INVALID')
  }
  const result = new Map()
  const lines = content.slice(0, -1).split(/\r?\n/)
  if (lines.length === 0) {
    throw new Error('MIGRATION_CHECKSUM_MANIFEST_INVALID')
  }
  for (const line of lines) {
    if (!line) {
      throw new Error('MIGRATION_CHECKSUM_MANIFEST_INVALID')
    }
    const match = /^([a-f0-9]{64})\x20{2}(\S.*)$/.exec(line)
    if (!match) {
      throw new Error('MIGRATION_CHECKSUM_MANIFEST_INVALID')
    }
    const relativeFile = normalizeRelativeFile(match[2])
    if (result.has(relativeFile)) {
      throw new Error('MIGRATION_CHECKSUM_MANIFEST_INVALID')
    }
    result.set(relativeFile, match[1])
  }
  return result
}

function copyVerifiedMetadataFiles(validated, output) {
  for (const relativeFile of [...validated.schemaFiles, ...validated.inventoryFiles]) {
    const content = fs.readFileSync(
      safePackageFile(validated.inputDirectory, relativeFile),
      'utf8',
    )
    writePrivateFile(path.join(output, ...relativeFile.split('/')), content)
  }
}

function listPackageFiles(directory, relativeDirectory = '') {
  const result = []
  const absoluteDirectory = relativeDirectory
    ? path.join(directory, ...relativeDirectory.split('/'))
    : directory
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativeFile = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name
    const absoluteFile = path.join(absoluteDirectory, entry.name)
    const stat = fs.lstatSync(absoluteFile)
    if (stat.isSymbolicLink()) {
      throw new Error('MIGRATION_PACKAGE_SYMLINK_FORBIDDEN')
    }
    if (stat.isDirectory()) {
      result.push(...listPackageFiles(directory, relativeFile))
    }
    else if (stat.isFile()) {
      result.push(normalizeRelativeFile(relativeFile))
    }
    else {
      throw new Error('MIGRATION_PACKAGE_FILE_TYPE_INVALID')
    }
  }
  return result.sort()
}

function safePackageFile(directory, relativeFile) {
  const normalized = normalizeRelativeFile(relativeFile)
  const resolved = path.resolve(directory, ...normalized.split('/'))
  const relative = path.relative(path.resolve(directory), resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('MIGRATION_PACKAGE_PATH_INVALID')
  }
  safeRegularFile(resolved, 'MIGRATION_PACKAGE_FILE_INVALID')
  return resolved
}

function normalizeRelativeFile(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.includes('\\')
    || value.includes('\0')
    || path.posix.isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')
    || path.posix.normalize(value) !== value
  ) {
    throw new Error('MIGRATION_PACKAGE_PATH_INVALID')
  }
  return value
}

function validateRelativeFileList(value, prefix) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('MIGRATION_MANIFEST_FILE_LIST_INVALID')
  }
  const result = value.map(normalizeRelativeFile)
  if (new Set(result).size !== result.length || result.some(file => !file.startsWith(prefix))) {
    throw new Error('MIGRATION_MANIFEST_FILE_LIST_INVALID')
  }
  return result
}

function assertExactSet(actualValues, expectedSet, errorCode) {
  const actual = new Set(actualValues)
  if (
    actual.size !== expectedSet.size
    || [...actual].some(value => !expectedSet.has(value))
  ) {
    throw new Error(errorCode)
  }
}

function assertDirectoryOutsideRepository(directory, repository) {
  const relative = path.relative(repository, directory)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('MIGRATION_PACKAGE_MUST_BE_OUTSIDE_REPOSITORY')
  }
}

function assertPrivatePermissions(directory) {
  for (const relativeFile of listPackageFiles(directory)) {
    const filePath = path.join(directory, ...relativeFile.split('/'))
    if ((fs.statSync(filePath).mode & 0o777) !== 0o600) {
      throw new Error('MIGRATION_OUTPUT_PERMISSION_INVALID')
    }
  }
  assertPrivateDirectories(directory)
}

function assertPrivateDirectories(directory) {
  if ((fs.statSync(directory).mode & 0o777) !== 0o700) {
    throw new Error('MIGRATION_OUTPUT_PERMISSION_INVALID')
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      assertPrivateDirectories(path.join(directory, entry.name))
    }
  }
}

function parseDotEnv(content) {
  const result = {}
  for (const line of content.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_]\w*)=(.*)$/i)
    if (match) {
      result[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return result
}

function parseJsonObject(content, errorCode) {
  const value = parseJsonValue(content, errorCode)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorCode)
  }
  return value
}

function parseJsonValue(content, errorCode) {
  try {
    return JSON.parse(content)
  }
  catch {
    throw new Error(errorCode)
  }
}

function isCanonicalBase64(value) {
  if (typeof value !== 'string') {
    return false
  }
  if (value === '') {
    return true
  }
  return /^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(value)
    && Buffer.from(value, 'base64').toString('base64') === value
}

function assertAppId(value, errorCode) {
  if (!APP_ID_PATTERN.test(String(value || ''))) {
    throw new Error(errorCode)
  }
}

function assertFingerprint(value) {
  if (!/^[a-f0-9]{16}$/.test(String(value || ''))) {
    throw new Error('MIGRATION_ENVIRONMENT_FINGERPRINT_INVALID')
  }
}

function assertEncryptionKey(value) {
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error('MIGRATION_ENCRYPTION_KEY_INVALID')
  }
}

function safeRegularFile(filePath, errorCode) {
  let stat
  try {
    stat = fs.lstatSync(filePath)
  }
  catch {
    throw new Error(errorCode)
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(errorCode)
  }
  return stat
}

function safeDirectory(directory, errorCode) {
  let stat
  try {
    stat = fs.lstatSync(directory)
  }
  catch {
    throw new Error(errorCode)
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(errorCode)
  }
}
