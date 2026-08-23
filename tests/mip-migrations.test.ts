import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertMipMigrationSql,
  loadMipMigrationLock,
  MIP_MIGRATION_TRACKING_TABLE,
  MIP_TABLE_PREFIX,
  splitMipSqlStatements,
} from '../scripts/lib/mip-migrations.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('MIP migrations', () => {
  it('loads a checksum-locked, prefix-isolated migration chain', () => {
    const lock = loadMipMigrationLock(root)

    expect(lock.tablePrefix).toBe(MIP_TABLE_PREFIX)
    expect(lock.trackingTable).toBe(MIP_MIGRATION_TRACKING_TABLE)
    expect(lock.requiredTables.every(table => table.startsWith('mip_'))).toBe(true)
    expect(lock.migrations[0].createsTables).toContain('mip_users')
  })

  it('accepts only MIP table targets', () => {
    expect(() => assertMipMigrationSql('CREATE TABLE mip_example (id INT);')).not.toThrow()
    expect(() => assertMipMigrationSql('ALTER TABLE member_profiles ADD COLUMN bad INT;'))
      .toThrow('non-MIP table')
    expect(() => assertMipMigrationSql('DROP TABLE mip_example;'))
      .toThrow('cannot drop')
    const rollback = () => assertMipMigrationSql('DROP TABLE mip_example;', { rollback: true })
    expect(rollback).not.toThrow()
  })

  it('splits statements without breaking quoted semicolons or comments', () => {
    const statements = splitMipSqlStatements(`
      -- first table
      CREATE TABLE mip_one (label VARCHAR(20) DEFAULT ';');
      /* second table */
      CREATE TABLE mip_two (id INT);
    `)

    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('DEFAULT \';\'')
    expect(statements[1]).toContain('mip_two')
  })

  it('keeps forward and rollback files inside the isolated directory', () => {
    const lock = JSON.parse(
      fs.readFileSync(path.join(root, 'database/mysql/mip/migrations.lock.json'), 'utf8'),
    )

    for (const migration of lock.migrations) {
      expect(migration.sql.startsWith('database/mysql/mip/')).toBe(true)
      expect(migration.rollback.startsWith('database/mysql/mip/rollback/')).toBe(true)
    }
  })
})
