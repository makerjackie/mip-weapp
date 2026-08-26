import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertMipMigrationSql,
  loadMipMigrationLock,
} from '../scripts/lib/mip-migrations.mjs'

const migrationPath = 'database/mysql/mip/047_game_team_lifecycle.sql'
const rollbackPath = 'database/mysql/mip/rollback/047_game_team_lifecycle.sql'

describe('MIP game team lifecycle migration', () => {
  it('appends and checksum-locks the team capacity migration', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    const rollback = readFileSync(rollbackPath, 'utf8')
    const lock = loadMipMigrationLock(process.cwd())
    const entry = lock.migrations.find(item => item.name === 'mip_game_team_lifecycle')

    expect(entry).toMatchObject({
      version: '20260826470000',
      createsTables: [],
      altersTables: ['mip_game_teams'],
    })
    expect(entry?.sqlSha256).toBe(createHash('sha256').update(migration).digest('hex'))
    expect(entry?.rollbackSha256).toBe(createHash('sha256').update(rollback).digest('hex'))
    expect(assertMipMigrationSql(migration)).toHaveLength(1)
    expect(assertMipMigrationSql(rollback, { rollback: true }).length).toBeGreaterThan(5)
  })

  it('adds a bounded default without creating fixed teams', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    expect(migration).toMatch(/member_limit TINYINT UNSIGNED NOT NULL DEFAULT 100/)
    expect(migration).toContain('CHECK (member_limit BETWEEN 1 AND 100)')
    expect(migration).not.toMatch(/INSERT INTO mip_game_teams/i)
    expect(migration).not.toMatch(/九队|固定队伍/)
  })

  it('fails rollback closed when a configured capacity would be lost', () => {
    const rollback = readFileSync(rollbackPath, 'utf8')
    expect(rollback).toContain('CREATE TEMPORARY TABLE mip_game_team_lifecycle_rollback_guard')
    expect(rollback).toMatch(/FROM mip_game_teams\s+WHERE member_limit <> 100/)
    expect(rollback.indexOf('WHERE member_limit <> 100')).toBeLessThan(
      rollback.indexOf('DROP COLUMN member_limit'),
    )
    expect(rollback).not.toMatch(/\bDELETE\s+FROM\b/i)
  })
})
