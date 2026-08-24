import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertMipMigrationSql,
  loadMipMigrationLock,
  MIP_MIGRATION_STEP_TABLE,
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
    expect(lock.requiredTables).toContain(MIP_MIGRATION_STEP_TABLE)
    expect(lock.requiredTables.every(table => table.startsWith('mip_'))).toBe(true)
    expect(lock.migrations[0].createsTables).toContain('mip_users')
    expect(lock.migrations.some(migration => migration.altersTables.includes('mip_event_checkin_credentials'))).toBe(true)
    expect(lock.migrations.some(migration => migration.altersTables.includes('mip_user_identities'))).toBe(true)
    const accountClosure = lock.migrations.find(migration => migration.name === 'mip_account_closure')
    expect(accountClosure?.altersTables).toEqual([
      'mip_users',
      'mip_user_identities',
    ])
    const eventAlbum = lock.migrations.find(migration => migration.name === 'mip_event_album')
    expect(eventAlbum?.createsTables).toEqual(['mip_event_album_photos'])
    expect(eventAlbum?.altersTables).toEqual(['mip_events'])
  })

  it('accepts only MIP table targets', () => {
    expect(() => assertMipMigrationSql('CREATE TABLE mip_example (id INT);')).not.toThrow()
    expect(() => assertMipMigrationSql('ALTER TABLE member_profiles ADD COLUMN bad INT;'))
      .toThrow('non-MIP table')
    expect(() => assertMipMigrationSql('DROP TABLE mip_example;'))
      .toThrow('cannot drop')
    const rollback = () => assertMipMigrationSql('DROP TABLE mip_example;', { rollback: true })
    expect(rollback).not.toThrow()
    expect(() => assertMipMigrationSql('INSERT INTO mip_example SELECT * FROM member_profiles;'))
      .toThrow('non-MIP table')
    expect(() => assertMipMigrationSql('UPDATE mip_example JOIN member_profiles ON 1 = 1 SET mip_example.id = 1;'))
      .toThrow('non-MIP table')
    expect(() => assertMipMigrationSql('DELETE FROM mip_orders;')).toThrow('cannot delete')
    expect(() => assertMipMigrationSql('ALTER TABLE mip_orders DROP COLUMN amount_cents;'))
      .toThrow('cannot drop columns')
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

  it('locks event content media columns to the append-only runtime contract', () => {
    const migration = fs.readFileSync(
      path.join(root, 'database/mysql/mip/022_event_content_media.sql'),
      'utf8',
    )
    const rollback = fs.readFileSync(
      path.join(root, 'database/mysql/mip/rollback/022_event_content_media.sql'),
      'utf8',
    )
    const lock = loadMipMigrationLock(root)
    const entry = lock.migrations.find(item => item.name === 'mip_event_content_media')

    expect(entry?.createsTables).toEqual(['mip_event_content_media'])
    expect(migration).toContain('status VARCHAR(16)')
    expect(migration).toContain('version BIGINT UNSIGNED')
    expect(migration).toContain('mip_event_content_media_status_ck')
    expect(migration).toContain('mip_event_content_media_version_ck')
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(rollback.trim()).toBe('DROP TABLE IF EXISTS mip_event_content_media;')
  })

  it('fails closed on unknown or incomplete durable step journals', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/apply-mip-schema.mjs'), 'utf8')
    expect(source).toContain('unknownStepVersions')
    expect(source).toContain('migration step versions absent from this lock')
    expect(source).toContain('Recorded MIP migration step journal is incomplete')
  })

  it('keeps operations notifications app-scoped, immutable and deduplicated per recipient', () => {
    const migration = fs.readFileSync(
      path.join(root, 'database/mysql/mip/009_operations_notifications.sql'),
      'utf8',
    )

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_operations_messages')
    expect(migration).toContain('app_id, publication_id, recipient_user_id')
    expect(migration).toContain('REFERENCES mip_users (app_id, id) ON DELETE RESTRICT')
    expect(migration).toContain('template_key = \'EVENT_REMINDER\'')
    expect(migration).toContain('template_key = \'EVENT_REMINDER\'\n      AND scope_type = \'EVENT\'')
    expect(migration).toContain('scope_type = \'PLATFORM\' AND branch_id IS NULL')
    expect(migration).toContain('scope_type = \'BRANCH\' AND branch_id IS NOT NULL')
    expect(migration).not.toContain('scope_type = \'PLATFORM\' AND branch_id IS NULL AND event_id IS NULL')
    expect(migration).not.toMatch(/\bUPDATE\s+mip_operations_messages\b/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+mip_operations_messages\b/i)
  })

  it('adds irreversible account closure structure without deleting business records', () => {
    const migration = fs.readFileSync(
      path.join(root, 'database/mysql/mip/011_account_closure.sql'),
      'utf8',
    )
    const rollback = fs.readFileSync(
      path.join(root, 'database/mysql/mip/rollback/011_account_closure.sql'),
      'utf8',
    )
    expect(migration).toContain('closed_identity_key')
    expect(migration).toContain('closed_at')
    expect(migration).toContain('mip_users_closure_ck')
    expect(migration).toContain('WHERE closed_user.status = \'CLOSED\'')
    expect(migration).toContain('identity_record.closed_identity_key = identity_record.identity_key')
    expect(migration).not.toMatch(/DELETE\s+FROM/i)
    expect(rollback).toContain('Structural rollback only')
    expect(rollback).not.toMatch(/UPDATE\s+mip_/i)
    expect(rollback).not.toMatch(/INSERT\s+INTO\s+mip_/i)
  })
})
