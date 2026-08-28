/* eslint-disable ts/no-use-before-define */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_ID_MIGRATION_EXCLUSIONS } from '../scripts/lib/mip-app-id-migration-transform.mjs'
import {
  createPrivateExportDirectories,
  sha256,
  sha256File,
  writePrivateFile,
  writePrivateJson,
} from '../scripts/lib/mip-app-scope-export.mjs'
import {
  assertMipImportVerification,
  assertTargetMipBusinessState,
  buildMipInsertStatements,
  buildMipPointerRestoreStatements,
  buildMipTargetImportPlan,
  createMipImportCheckpoint,
  primaryKeyFingerprint,
  validateMipAppScopeTransformPackage,
  validateMipImportCheckpoint,
} from '../scripts/lib/mip-app-scope-import.mjs'
import { encodeMipExportValue } from '../scripts/lib/mip-app-scope-transform-package.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const sourceAppId = 'wx1111111111111111'
const targetAppId = 'wx2222222222222222'
const targetEnvironmentId = 'target-environment-fixture'
const lockSha256 = 'a'.repeat(64)
const requiredTables = [
  'mip_schema_migrations',
  'mip_users',
  'mip_notification_grants',
]
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('MIP transformed package import boundary', () => {
  it('accepts an exact checksum-bound lock package and ignores ledgers plus exclusions', () => {
    const fixture = transformedPackageFixture()
    const result = validateMipAppScopeTransformPackage({
      inputDirectory: fixture.directory,
      repoRoot,
      migrationLock: { requiredTables },
      migrationLockSha256: lockSha256,
      sourceAppId,
      targetAppId,
      targetEnvironmentId,
    })

    expect(result.importTables).toEqual(['mip_users'])
    expect(result.allBusinessTables).toEqual(['mip_users', 'mip_notification_grants'])
    expect(result.rowsByTable.get('mip_users')).toEqual([{
      app_id: targetAppId,
      id: 'user-1',
      payload: { membership: 'PLAYER' },
      private_bytes: Buffer.from('binary-fixture'),
    }])
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects JSONL tampering, unlocked tables, source AppID residue and exclusion rows', () => {
    const tampered = transformedPackageFixture()
    fs.appendFileSync(path.join(tampered.directory, 'data', 'mip_users.jsonl'), '{}\n')
    expect(() => validateFixture(tampered.directory)).toThrow('MIP_IMPORT_CHECKSUM_MISMATCH')

    const unlocked = transformedPackageFixture()
    const manifestPath = path.join(unlocked.directory, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.tables[1].table = 'mip_unknown'
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    expect(() => validateFixture(unlocked.directory)).toThrow()

    const sourceResidue = transformedPackageFixture({ userAppId: sourceAppId })
    expect(() => validateFixture(sourceResidue.directory)).toThrow('MIP_IMPORT_TARGET_APP_SCOPE_INVALID')

    const excluded = transformedPackageFixture({ excludedRows: [{ app_id: targetAppId, id: 'grant-1' }] })
    expect(() => validateFixture(excluded.directory)).toThrow('MIP_IMPORT_EXCLUSION_INVALID')
  })
})

describe('MIP target import SQL and resume evidence', () => {
  it('renders null, binary, datetime, JSON, booleans and quoted strings without changing FK mode', () => {
    const statements = buildMipInsertStatements({
      table: 'mip_users',
      rows: [{
        app_id: targetAppId,
        id: 'user\'one',
        private_bytes: Buffer.from('private'),
        happened_at: new Date('2026-08-28T01:02:03.004Z'),
        metadata: { role: 'PLAYER' },
        enabled: true,
        optional_value: null,
      }],
      columns: [
        column('app_id', 'varchar', 1),
        column('id', 'varchar', 2),
        column('private_bytes', 'varbinary', 3),
        column('happened_at', 'datetime', 4),
        column('metadata', 'json', 5),
        column('enabled', 'tinyint', 6),
        column('optional_value', 'varchar', 7),
      ],
    })

    expect(statements).toHaveLength(1)
    expect(statements[0].sql).toContain('\'user\'\'one\'')
    expect(statements[0].sql).toContain('FROM_BASE64')
    expect(statements[0].sql).toContain('\'2026-08-28 01:02:03.004\'')
    expect(statements[0].sql).toContain('CAST(')
    expect(statements[0].sql).toContain('NULL')
    expect(statements[0].sql).not.toMatch(/foreign_key_checks/i)
  })

  it('plans users/branches/members, clears excluded dispatch pointers, and restores user pointers', () => {
    const packageData = planPackageData()
    const metadata = planMetadata()
    const counts = Object.fromEntries(packageData.allBusinessTables.map(table => [table, 0]))
    const plan = buildMipTargetImportPlan({ packageData, metadata, targetRowCounts: counts })

    expect(plan.importOrder.indexOf('mip_users'))
      .toBeLessThan(plan.importOrder.indexOf('mip_city_branches'))
    expect(plan.importOrder.indexOf('mip_city_branches'))
      .toBeLessThan(plan.importOrder.indexOf('mip_branch_memberships'))
    expect(plan.importOrder).not.toContain('mip_message_campaign_dispatches')
    expect(plan.pointerRestores).toMatchObject([{
      table: 'mip_users',
      deferredColumns: ['primary_branch_id'],
    }])

    const restore = buildMipPointerRestoreStatements({
      pointer: plan.pointerRestores[0],
      rows: packageData.rowsByTable.get('mip_users'),
      columns: plan.columnsByTable.get('mip_users'),
    })
    expect(restore[0].sql).toContain('UPDATE `mip_users`')
    expect(restore[0].verificationSql).toContain('SELECT COUNT(*) AS matched_row_count')
    expect(restore[0].verificationSql).toContain('`primary_branch_id` =')
    expect(restore[0].sql).not.toMatch(/foreign_key_checks/i)
  })

  it('requires an initially empty target and binds resume checkpoints to package/environment/app', () => {
    expect(() => assertTargetMipBusinessState({
      businessTables: ['mip_users'],
      targetRowCounts: { mip_users: 1 },
      allowExisting: false,
    })).toThrow('MIP_IMPORT_TARGET_NOT_EMPTY')

    const packageData = {
      manifestSha256: 'b'.repeat(64),
      importTables: ['mip_users'],
    }
    const checkpoint = createMipImportCheckpoint({
      packageData,
      targetEnvironmentId,
      targetAppId,
    })
    expect(validateMipImportCheckpoint({
      checkpoint,
      packageData,
      targetEnvironmentId,
      targetAppId,
    })).toBe(true)
    expect(() => validateMipImportCheckpoint({
      checkpoint,
      packageData,
      targetEnvironmentId: 'different-environment',
      targetAppId,
    })).toThrow('MIP_IMPORT_CHECKPOINT_INVALID')
    expect(primaryKeyFingerprint({ id: 'user-1' }, ['id']))
      .toMatch(/^[a-f0-9]{64}$/)
  })

  it('verifies target counts, primary-key inventory, source AppID residue and FK orphans', () => {
    const packageData = {
      allBusinessTables: ['mip_users', 'mip_notification_grants'],
      importTables: ['mip_users'],
      rowsByTable: new Map([
        ['mip_users', [{ app_id: targetAppId, id: 'user-1' }]],
        ['mip_notification_grants', []],
      ]),
      tableMetadata: new Map([
        ['mip_users', { primaryKey: ['id'] }],
        ['mip_notification_grants', { primaryKey: ['id'] }],
      ]),
    }
    const evidence = {
      rowCounts: new Map([['mip_users', 1], ['mip_notification_grants', 0]]),
      primaryKeys: new Map([['mip_users', [{ id: 'user-1' }]]]),
      sourceAppIdResiduals: new Map([['mip_users', 0], ['mip_notification_grants', 0]]),
      orphanCounts: new Map([['mip_users_profile_fk', 0]]),
    }
    expect(assertMipImportVerification({ packageData, evidence })).toBe(true)
    evidence.orphanCounts.set('mip_users_profile_fk', 1)
    expect(() => assertMipImportVerification({ packageData, evidence }))
      .toThrow('MIP_IMPORT_POST_VERIFICATION_FAILED')
  })
})

function validateFixture(directory: string) {
  return validateMipAppScopeTransformPackage({
    inputDirectory: directory,
    repoRoot,
    migrationLock: { requiredTables },
    migrationLockSha256: lockSha256,
    sourceAppId,
    targetAppId,
    targetEnvironmentId,
  })
}

function transformedPackageFixture(options: {
  userAppId?: string
  excludedRows?: Record<string, unknown>[]
} = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-import-test-'))
  temporaryDirectories.push(base)
  const directory = path.join(base, 'package')
  createPrivateExportDirectories({ outputDirectory: directory, repoRoot })
  const rowsByTable: Record<string, Record<string, unknown>[]> = {
    mip_schema_migrations: [{ version: '001' }],
    mip_users: [{
      app_id: options.userAppId ?? targetAppId,
      id: 'user-1',
      payload: { membership: 'PLAYER' },
      private_bytes: Buffer.from('binary-fixture'),
    }],
    mip_notification_grants: options.excludedRows ?? [],
  }
  const sourceRows: Record<string, number> = {
    mip_schema_migrations: 1,
    mip_users: 1,
    mip_notification_grants: options.excludedRows ? options.excludedRows.length : 2,
  }
  const primaryKeys: Record<string, string[]> = {
    mip_schema_migrations: ['version'],
    mip_users: ['id'],
    mip_notification_grants: ['id'],
  }
  const tables = requiredTables.map((table) => {
    const rows = rowsByTable[table]
    const relativeFile = `data/${table}.jsonl`
    writePrivateFile(
      path.join(directory, relativeFile),
      rows.length > 0
        ? `${rows.map(row => JSON.stringify(encodeMipExportValue(row))).join('\n')}\n`
        : '',
    )
    const excluded = table === 'mip_notification_grants'
    return {
      table,
      scope: table === 'mip_schema_migrations' ? 'migration-ledger' : 'source-app',
      relativeFile,
      primaryKey: primaryKeys[table],
      rowsBefore: rows.length,
      rowsExported: rows.length,
      rowsAfter: rows.length,
      rowCountStable: true,
      sourceRows: sourceRows[table],
      excludedRows: excluded ? sourceRows[table] : 0,
      bytes: fs.statSync(path.join(directory, relativeFile)).size,
      sha256: sha256File(path.join(directory, relativeFile)),
    }
  })
  const schemaFile = 'schema/tables.json'
  const unionFile = 'inventory/union-identities.json'
  const mediaFile = 'inventory/media.json'
  writePrivateJson(path.join(directory, schemaFile), [])
  writePrivateJson(path.join(directory, unionFile), { rows: [] })
  writePrivateJson(path.join(directory, mediaFile), { rows: [] })
  const payload = [schemaFile, unionFile, mediaFile, ...tables.map(table => table.relativeFile)].sort()
  writePrivateFile(path.join(directory, 'checksums.sha256'), `${payload.map(file => (
    `${sha256File(path.join(directory, file))}  ${file}`
  )).join('\n')}\n`)
  writePrivateFile(path.join(directory, 'README.txt'), 'private migration fixture\n')
  const excludedRows = sourceRows.mip_notification_grants
  writePrivateJson(path.join(directory, 'manifest.json'), {
    format: 'mip-app-scope-transform-v1',
    sourceExportManifestSha256: 'c'.repeat(64),
    sourceEnvironmentFingerprint: '1'.repeat(16),
    targetEnvironmentFingerprint: sha256(targetEnvironmentId).slice(0, 16),
    sourceAppScopeFingerprint: sha256(sourceAppId).slice(0, 16),
    targetAppScopeFingerprint: sha256(targetAppId).slice(0, 16),
    migrationLock: { sha256: lockSha256 },
    binaryEncoding: { marker: '$binaryBase64' },
    schemaFiles: [schemaFile],
    tableCount: tables.length,
    sourceRowCount: 4,
    rowCount: tables.reduce((total, table) => total + table.rowsExported, 0),
    excludedRowCount: excludedRows,
    tables,
    exclusions: [{
      table: 'mip_notification_grants',
      reason: APP_ID_MIGRATION_EXCLUSIONS.mip_notification_grants,
      excludedRows,
    }],
    unionIdentityInventory: {
      relativeFile: unionFile,
      sha256: sha256File(path.join(directory, unionFile)),
    },
    mediaInventory: {
      relativeFile: mediaFile,
      sha256: sha256File(path.join(directory, mediaFile)),
    },
    validation: {
      outputChecksums: 'verified',
      outputJsonLines: 'verified',
    },
    migrationReadiness: 'transformed-verified',
  })
  return { directory }
}

function planPackageData() {
  const rowsByTable = new Map([
    ['mip_users', [{ app_id: targetAppId, id: 'user-1', primary_branch_id: 'branch-1' }]],
    ['mip_city_branches', [{ app_id: targetAppId, id: 'branch-1', created_by_user_id: 'user-1' }]],
    ['mip_branch_memberships', [{ app_id: targetAppId, branch_id: 'branch-1', user_id: 'user-1' }]],
    ['mip_message_campaigns', [{ app_id: targetAppId, id: 'campaign-1', created_by_user_id: 'user-1', active_dispatch_id: null }]],
    ['mip_message_campaign_dispatches', []],
    ['mip_tags', [{ app_id: targetAppId, id: 'tag-1', parent_id: null }]],
  ])
  return {
    allBusinessTables: [...rowsByTable.keys()],
    importTables: [...rowsByTable.keys()].filter(table => table !== 'mip_message_campaign_dispatches'),
    rowsByTable,
  }
}

function planMetadata() {
  const definitions: Record<string, { name: string, nullable?: boolean }[]> = {
    mip_users: [named('app_id'), named('id'), named('primary_branch_id', true)],
    mip_city_branches: [named('app_id'), named('id'), named('created_by_user_id')],
    mip_branch_memberships: [named('app_id'), named('branch_id'), named('user_id')],
    mip_message_campaigns: [named('app_id'), named('id'), named('created_by_user_id'), named('active_dispatch_id', true)],
    mip_message_campaign_dispatches: [named('app_id'), named('id'), named('campaign_id')],
    mip_tags: [named('app_id'), named('id'), named('parent_id', true)],
  }
  const primaryKeys: Record<string, string[]> = {
    mip_users: ['id'],
    mip_city_branches: ['id'],
    mip_branch_memberships: ['app_id', 'branch_id', 'user_id'],
    mip_message_campaigns: ['id'],
    mip_message_campaign_dispatches: ['id'],
    mip_tags: ['id'],
  }
  return {
    tableRows: Object.keys(definitions).map(table_name => ({ table_name })),
    columnRows: Object.entries(definitions).flatMap(([table_name, columns]) => columns.map(
      (item, index) => ({
        table_name,
        column_name: item.name,
        ordinal_position: index + 1,
        is_nullable: item.nullable ? 'YES' : 'NO',
        data_type: 'varchar',
        extra: '',
        generation_expression: '',
      }),
    )),
    primaryKeyRows: Object.entries(primaryKeys).flatMap(([table_name, columns]) => columns.map(
      (column_name, index) => ({
        constraint_name: 'PRIMARY',
        table_name,
        column_name,
        ordinal_position: index + 1,
      }),
    )),
    foreignKeyRows: [
      ...fk('mip_users_primary_branch_fk', 'mip_users', 'mip_branch_memberships', [
        ['app_id', 'app_id'],
        ['primary_branch_id', 'branch_id'],
        ['id', 'user_id'],
      ]),
      ...fk('mip_city_branches_creator_fk', 'mip_city_branches', 'mip_users', [
        ['app_id', 'app_id'],
        ['created_by_user_id', 'id'],
      ]),
      ...fk('mip_branch_memberships_branch_fk', 'mip_branch_memberships', 'mip_city_branches', [
        ['app_id', 'app_id'],
        ['branch_id', 'id'],
      ]),
      ...fk('mip_branch_memberships_user_fk', 'mip_branch_memberships', 'mip_users', [
        ['app_id', 'app_id'],
        ['user_id', 'id'],
      ]),
      ...fk('mip_message_campaigns_creator_fk', 'mip_message_campaigns', 'mip_users', [
        ['app_id', 'app_id'],
        ['created_by_user_id', 'id'],
      ]),
      ...fk('mip_message_campaigns_active_dispatch_fk', 'mip_message_campaigns', 'mip_message_campaign_dispatches', [
        ['app_id', 'app_id'],
        ['id', 'campaign_id'],
        ['active_dispatch_id', 'id'],
      ]),
      ...fk('mip_message_campaign_dispatches_campaign_fk', 'mip_message_campaign_dispatches', 'mip_message_campaigns', [
        ['app_id', 'app_id'],
        ['campaign_id', 'id'],
      ]),
      ...fk('mip_tags_parent_fk', 'mip_tags', 'mip_tags', [
        ['app_id', 'app_id'],
        ['parent_id', 'id'],
      ]),
    ],
  }
}

function fk(name: string, child: string, parent: string, pairs: string[][]) {
  return pairs.map(([column_name, referenced_column_name], index) => ({
    constraint_name: name,
    table_name: child,
    column_name,
    referenced_table_name: parent,
    referenced_column_name,
    ordinal_position: index + 1,
  }))
}

function column(name: string, dataType: string, ordinal: number) {
  return { name, dataType, ordinal, generated: false }
}

function named(name: string, nullable = false) {
  return { name, nullable }
}
