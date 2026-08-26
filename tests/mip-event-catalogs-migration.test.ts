import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertMipMigrationSql,
  loadMipMigrationLock,
} from '../scripts/lib/mip-migrations.mjs'
import { RUNTIME_TABLE_PRIVILEGES } from '../scripts/lib/mysql-privilege-assert.mjs'

const migrationPath = 'database/mysql/mip/045_event_catalogs_and_video_recaps.sql'
const rollbackPath = 'database/mysql/mip/rollback/045_event_catalogs_and_video_recaps.sql'

describe('MIP event catalog migration', () => {
  it('locks the append-only migration and all four AppID-scoped tables', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    const rollback = readFileSync(rollbackPath, 'utf8')
    const lock = loadMipMigrationLock(process.cwd())
    const entry = lock.migrations.find(item => item.name === 'mip_event_catalogs_and_video_recaps')

    expect(entry).toMatchObject({
      version: '20260826450000',
      createsTables: [
        'mip_event_types',
        'mip_event_tags',
        'mip_event_tag_assignments',
        'mip_event_video_recaps',
      ],
      altersTables: ['mip_events'],
    })
    expect(entry?.sqlSha256).toBe(createHash('sha256').update(migration).digest('hex'))
    expect(entry?.rollbackSha256).toBe(createHash('sha256').update(rollback).digest('hex'))
    expect(assertMipMigrationSql(migration)).toHaveLength(6)
    expect(assertMipMigrationSql(rollback, { rollback: true }).length).toBeGreaterThan(7)
    for (const table of entry?.createsTables || []) {
      expect(lock.requiredTables).toContain(table)
    }
  })

  it('mechanically backfills event type keys before adding the composite FK and index', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    const backfill = migration.indexOf('INSERT INTO mip_event_types')
    const alter = migration.indexOf('ALTER TABLE mip_events')

    expect(backfill).toBeGreaterThan(0)
    expect(alter).toBeGreaterThan(backfill)
    expect(migration).toMatch(/SELECT UUID\(\), event\.app_id, event\.event_type_key, event\.event_type_key/)
    expect(migration).toMatch(/WHERE NOT EXISTS \([\s\S]*existing\.app_id = event\.app_id[\s\S]*existing\.type_key = event\.event_type_key/)
    expect(migration).toMatch(/GROUP BY event\.app_id, event\.event_type_key/)
    expect(migration).toContain('ADD KEY mip_events_type_catalog_idx (app_id, event_type_key, status, starts_at, id)')
    expect(migration).toContain('FOREIGN KEY (app_id, event_type_key)')
    expect(migration).toContain('REFERENCES mip_event_types (app_id, type_key)')
  })

  it('enforces soft lifecycle and the WECHAT_CHANNELS destination pairing in MySQL', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration).toContain('status IN (\'ACTIVE\', \'INACTIVE\', \'ARCHIVED\')')
    expect(migration).toContain('destination_provider = \'WECHAT_CHANNELS\'')
    expect(migration).toContain('destination_kind = \'PROFILE\' AND feed_id IS NULL')
    expect(migration).toContain('destination_kind = \'ACTIVITY\' AND feed_id IS NOT NULL')
    expect(migration).toContain('status = \'ARCHIVED\' AND archived_at IS NOT NULL')
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i)
  })

  it('fails rollback closed when catalog metadata, tags, assignments, or recaps would be lost', () => {
    const rollback = readFileSync(rollbackPath, 'utf8')

    expect(rollback).toContain('mip_event_catalogs_rollback_guard')
    expect(rollback).toContain('Execute this entire rollback in one MySQL session')
    expect(rollback).toContain('CREATE TEMPORARY TABLE mip_event_catalogs_rollback_guard')
    expect(rollback).toContain('DROP TEMPORARY TABLE IF EXISTS mip_event_catalogs_rollback_guard')
    expect(rollback).toContain('DROP TEMPORARY TABLE mip_event_catalogs_rollback_guard')
    expect(rollback).not.toMatch(/(?:CREATE|DROP) TABLE (?:IF EXISTS )?mip_event_catalogs_rollback_guard/i)
    expect(rollback).toMatch(/SELECT 1 FROM mip_event_tags LIMIT 1/)
    expect(rollback).toMatch(/SELECT 1 FROM mip_event_tag_assignments LIMIT 1/)
    expect(rollback).toMatch(/SELECT 1 FROM mip_event_video_recaps LIMIT 1/)
    expect(rollback).toContain('event_type.name <> event_type.type_key')
    expect(rollback).toContain('event_type.status <> \'ACTIVE\'')
    expect(rollback.indexOf('DROP FOREIGN KEY mip_events_type_catalog_fk')).toBeLessThan(
      rollback.indexOf('DROP TABLE IF EXISTS mip_event_types'),
    )
    expect(rollback).not.toMatch(/\bDELETE\s+FROM\b/i)
  })

  it('grants only required runtime privileges and no physical delete', () => {
    expect(RUNTIME_TABLE_PRIVILEGES.mip_event_types).toEqual(['SELECT', 'INSERT', 'UPDATE'])
    expect(RUNTIME_TABLE_PRIVILEGES.mip_event_tags).toEqual(['SELECT', 'INSERT', 'UPDATE'])
    expect(RUNTIME_TABLE_PRIVILEGES.mip_event_tag_assignments).toEqual(['SELECT', 'INSERT', 'UPDATE'])
    expect(RUNTIME_TABLE_PRIVILEGES.mip_event_video_recaps).toEqual(['SELECT', 'INSERT', 'UPDATE'])
  })
})
