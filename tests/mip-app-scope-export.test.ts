import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertMipAppScopeForeignKeyMetadata,
  assertPrivateExportDestination,
  buildMediaInventory,
  buildMipAppScopeCountSelect,
  buildMipAppScopePrimaryKeySelect,
  buildMipAppScopeSelect,
  buildMipAppScopeTablePlan,
  buildUnionIdentityInventory,
  createPrivateExportDirectories,
  encodeMipExportRow,
  resolveMipAppScopeTableNames,
  sha256File,
  writePrivateFile,
} from '../scripts/lib/mip-app-scope-export.mjs'
import { loadMipMigrationLock } from '../scripts/lib/mip-migrations.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const sourceAppId = 'wx0123456789abcdef'
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function lockFixture() {
  return {
    requiredTables: [
      'mip_schema_migrations',
      'mip_schema_migration_steps',
      'mip_users',
      'mip_media_assets',
    ],
  }
}

function schemaFixture() {
  const tables = lockFixture().requiredTables.map(table_name => ({
    table_name,
    table_type: 'BASE TABLE',
  }))
  const columns = [
    ['mip_schema_migrations', 'version', 'varchar'],
    ['mip_schema_migration_steps', 'migration_version', 'varchar'],
    ['mip_schema_migration_steps', 'step_index', 'int'],
    ['mip_users', 'id', 'char'],
    ['mip_users', 'app_id', 'varchar'],
    ['mip_users', 'private_ciphertext', 'varbinary'],
    ['mip_media_assets', 'id', 'char'],
    ['mip_media_assets', 'app_id', 'varchar'],
  ].map(([table_name, column_name, data_type], index) => ({
    table_name,
    column_name,
    data_type,
    ordinal_position: index + 1,
  }))
  const statistics = [
    ['mip_schema_migrations', 'version', 1],
    ['mip_schema_migration_steps', 'migration_version', 1],
    ['mip_schema_migration_steps', 'step_index', 2],
    ['mip_users', 'id', 1],
    ['mip_media_assets', 'id', 1],
  ].map(([table_name, column_name, seq_in_index]) => ({
    table_name,
    column_name,
    seq_in_index,
    index_name: 'PRIMARY',
  }))
  return { tables, columns, statistics }
}

describe('MIP source AppID scoped export', () => {
  it('derives its complete allowlist from the verified migration lock', () => {
    const lock = loadMipMigrationLock(repoRoot)
    const tables = resolveMipAppScopeTableNames(lock)

    expect(tables.length).toBeGreaterThan(100)
    expect(tables).toContain('mip_schema_migrations')
    expect(tables).toContain('mip_schema_migration_steps')
    expect(tables).toContain('mip_users')
    expect(tables.every(table => /^mip_[a-z0-9_]+$/.test(table))).toBe(true)
  })

  it.each([
    ['shared_users'],
    ['member_users'],
    ['mip_unlocked_shadow_table'],
    ['mip_users', 'mip_users'],
  ])('rejects a non-lock or duplicate table request: %j', (...requestedTables) => {
    expect(() => resolveMipAppScopeTableNames(lockFixture(), requestedTables)).toThrow()
  })

  it('requires app_id on every business table and only exempts migration ledgers', () => {
    const schema = schemaFixture()
    const plan = buildMipAppScopeTablePlan({
      migrationLock: lockFixture(),
      ...schema,
    })

    expect(plan.find(table => table.table === 'mip_users')).toMatchObject({
      scope: 'source-app',
      primaryKey: ['id'],
      binaryColumns: ['private_ciphertext'],
    })
    expect(plan.find(table => table.table === 'mip_schema_migrations')).toMatchObject({
      scope: 'migration-ledger',
      primaryKey: ['version'],
    })

    const columnsWithoutScope = schema.columns.filter(row => !(
      row.table_name === 'mip_users' && row.column_name === 'app_id'
    ))
    expect(() => buildMipAppScopeTablePlan({
      migrationLock: lockFixture(),
      ...schema,
      columns: columnsWithoutScope,
    })).toThrow('cannot be exported without app_id')
  })

  it('refuses schema metadata that escapes the requested migration-lock table set', () => {
    const schema = schemaFixture()
    expect(() => buildMipAppScopeTablePlan({
      migrationLock: lockFixture(),
      ...schema,
      tables: [...schema.tables, { table_name: 'shared_orders', table_type: 'BASE TABLE' }],
    })).toThrow('outside the requested MIP lock set')
  })

  it('rejects a drifted MIP foreign key that points into a shared-project table', () => {
    expect(() => assertMipAppScopeForeignKeyMetadata({
      migrationLock: lockFixture(),
      keyColumnUsage: [{
        table_name: 'mip_users',
        referenced_table_name: 'member_users',
      }],
      referentialConstraints: [],
    })).toThrow('outside the migration lock')
    expect(assertMipAppScopeForeignKeyMetadata({
      migrationLock: lockFixture(),
      keyColumnUsage: [{
        table_name: 'mip_media_assets',
        referenced_table_name: 'mip_users',
      }],
      referentialConstraints: [],
    })).toBe(true)
  })

  it('adds an AppID predicate to business reads but never to the two migration ledgers', () => {
    const plan = buildMipAppScopeTablePlan({
      migrationLock: lockFixture(),
      ...schemaFixture(),
    })
    const users = plan.find(table => table.table === 'mip_users')!
    const migrations = plan.find(table => table.table === 'mip_schema_migrations')!

    expect(buildMipAppScopeSelect({
      tablePlan: users,
      sourceAppId,
      limit: 200,
    })).toBe('SELECT `id`, `app_id`, TO_BASE64(`private_ciphertext`) AS `private_ciphertext` FROM `mip_users` WHERE `app_id` = \'wx0123456789abcdef\' ORDER BY `id` LIMIT 200')
    expect(buildMipAppScopeCountSelect({
      tablePlan: users,
      sourceAppId,
    })).toContain('WHERE `app_id` = \'wx0123456789abcdef\'')
    expect(buildMipAppScopeSelect({
      tablePlan: migrations,
      sourceAppId,
      limit: 10,
    })).toBe('SELECT `version` FROM `mip_schema_migrations` ORDER BY `version` LIMIT 10')
    expect(buildMipAppScopeCountSelect({
      tablePlan: migrations,
      sourceAppId,
    })).toBe('SELECT COUNT(*) AS row_count FROM `mip_schema_migrations`')

    expect(buildMipAppScopeSelect({
      tablePlan: users,
      sourceAppId,
      limit: 20,
      afterPrimaryKey: ['user-10'],
    })).toContain('WHERE `app_id` = \'wx0123456789abcdef\' AND ((`id` > \'user-10\'))')
    expect(buildMipAppScopePrimaryKeySelect({
      tablePlan: users,
      sourceAppId,
      limit: 20,
      afterPrimaryKey: ['user-10'],
    })).toContain('SELECT `id` FROM `mip_users`')
  })

  it('uses an explicit stable codec for MySQL binary columns', () => {
    expect(encodeMipExportRow({
      id: 'user-1',
      private_ciphertext: 'AQID\nBA==',
    }, ['private_ciphertext'])).toEqual({
      id: 'user-1',
      private_ciphertext: { $binaryBase64: 'AQIDBA==' },
    })
    expect(() => encodeMipExportRow({
      private_ciphertext: { type: 'Buffer', data: [1, 2, 3] },
    }, ['private_ciphertext'])).toThrow('invalid encoded binary column')
  })

  it('records UnionID digest coverage and duplicate groups deterministically', () => {
    const inventory = buildUnionIdentityInventory([
      { user_id: 'user-b', provider: 'WECHAT_MINIPROGRAM', union_identity_key: 'b'.repeat(64) },
      { user_id: 'user-a', provider: 'WECHAT_MINIPROGRAM', union_identity_key: 'a'.repeat(64) },
      { user_id: 'user-c', provider: 'WECHAT_MINIPROGRAM', union_identity_key: 'a'.repeat(64) },
      { user_id: 'user-d', provider: 'WECHAT_MINIPROGRAM', union_identity_key: null },
    ])

    expect(inventory).toMatchObject({
      totalIdentityRows: 4,
      populatedUnionIdentityRows: 3,
      distinctUnionIdentityKeys: 2,
      duplicateKeyGroups: 1,
      duplicateRows: 2,
    })
    expect(inventory.rows.map(row => row.userId)).toEqual(['user-a', 'user-c', 'user-b'])
    expect(inventory.recordsSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('records only MIP cloud objects in the media copy inventory', () => {
    const inventory = buildMediaInventory([
      {
        id: 'asset-1',
        owner_user_id: null,
        purpose: 'EVENT_COVER',
        object_key: 'mip/demo/event-cover.jpg',
        cloud_file_id: 'cloud://private/mip/demo/event-cover.jpg',
        content_sha256: 'c'.repeat(64),
        content_type: 'image/jpeg',
        content_bytes: 1024,
        status: 'READY',
      },
    ])
    expect(inventory).toMatchObject({
      objectCount: 1,
      readyObjectCount: 1,
      contentBytes: 1024,
    })
    expect(() => buildMediaInventory([{
      ...inventory.rows[0],
      object_key: 'other-project/private.jpg',
    }])).toThrow('out-of-scope object reference')
  })

  it('writes repository-external export files with private permissions', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-app-export-test-'))
    temporaryDirectories.push(base)
    const output = path.join(base, 'private', 'export')
    createPrivateExportDirectories({ outputDirectory: output, repoRoot })
    const manifest = path.join(output, 'manifest.json')
    writePrivateFile(manifest, '{}\n')

    expect(fs.statSync(output).mode & 0o777).toBe(0o700)
    expect(fs.statSync(manifest).mode & 0o777).toBe(0o600)
    expect(sha256File(manifest)).toMatch(/^[a-f0-9]{64}$/)
    expect(() => assertPrivateExportDestination({
      outputDirectory: path.join(repoRoot, '.tmp', 'forbidden-export'),
      repoRoot,
    })).toThrow('outside the repository')
  })
})
