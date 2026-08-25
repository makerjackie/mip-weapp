import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertSeedSqlScope,
  buildSeedCollisionQuery,
  buildSeedOwnershipQuery,
  SEED_TABLES,
  seedOwnershipConflictCount,
} from '../scripts/lib/mip-seed-safety.mjs'

const root = path.resolve(import.meta.dirname, '..')
const seed = JSON.parse(fs.readFileSync(path.join(root, 'database/mysql/mip/seed.demo.json'), 'utf8'))

describe('MIP demo seed ownership safety', () => {
  it('checks every fixed-ID seed table for a different AppID before writing', () => {
    const query = buildSeedOwnershipQuery('wx1111111111111111', seed)
    for (const table of Object.values(SEED_TABLES)) {
      expect(query).toContain(`SELECT id FROM ${table}`)
    }
    expect(query).toContain('app_id <> \'wx1111111111111111\'')
    expect(query).toContain('COUNT(*) AS conflicts')
  })

  it('rejects same-AppID fixed IDs and alternate keys unless the manifest owns them', () => {
    const query = buildSeedCollisionQuery('wx1111111111111111', seed)
    expect(query).toContain('setting_key LIKE \'demo_seed_manifest%\'')
    expect(query).toContain('\'$.recordIds.users\'')
    expect(query).toContain('branch_key =')
    expect(query).toContain('minimum_experience =')
    expect(query).toContain('merchant_order_no =')
    expect(query).toContain('event_id =')
    expect(query).toContain('owner_user_id =')
    expect(query).toContain('seed_same_app_collisions')
  })

  it('fails closed when the management API response has no trustworthy count', () => {
    expect(seedOwnershipConflictCount({ data: { rows: [{ conflicts: '0' }] } })).toBe(0)
    expect(seedOwnershipConflictCount({ data: { rows: [{ conflicts: 2 }] } })).toBe(2)
    expect(seedOwnershipConflictCount({ data: { rows: [] } })).toBeNull()
    expect(seedOwnershipConflictCount({ conflicts: '-1' })).toBeNull()
  })

  it('runs the ownership probe before constructing or executing seed statements', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/seed-demo.mjs'), 'utf8')
    expect(source.indexOf('const ownershipProbe ='))
      .toBeLessThan(source.indexOf('for (const [index, sql] of statements.entries())'))
    expect(source.indexOf('const collisionProbe ='))
      .toBeLessThan(source.indexOf('for (const [index, sql] of statements.entries())'))
    expect(source).toContain('no seed writes were attempted')
  })

  it('makes every fixed-ID upsert fail when a duplicate belongs to another AppID', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/seed-demo.mjs'), 'utf8')
    expect(source.match(/app_id = IF\(app_id = VALUES\(app_id\), app_id, NULL\)/g))
      .toHaveLength(Object.keys(SEED_TABLES).length)
    expect(source.match(/id = IF\(id = VALUES\(id\), id, NULL\)/g))
      .toHaveLength(Object.keys(SEED_TABLES).length)
  })

  it('keeps every top-level fixed-ID fixture group under the ownership preflight', () => {
    const fixtureGroups = Object.entries(seed)
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key)
      .sort()
    expect(Object.keys(SEED_TABLES).sort()).toEqual(fixtureGroups)
  })

  it('rejects SQL plans that leave the MIP table and AppID boundary', () => {
    expect(assertSeedSqlScope([
      'INSERT INTO mip_users (id, app_id) VALUES (\'id\', \'wx\')',
      'SELECT id FROM mip_events WHERE app_id = \'wx\'',
    ])).toMatchObject({ statementCount: 2 })
    expect(() => assertSeedSqlScope(['SELECT id FROM legacy_users']))
      .toThrow('references non-MIP table')
    expect(() => assertSeedSqlScope(['DELETE FROM mip_users WHERE id = \'id\'']))
      .toThrow('missing AppID scope')
  })

  it('rechecks the generated SQL boundary before normal-mode writes', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/seed-demo.mjs'), 'utf8')
    const planIndex = source.lastIndexOf('const statements = buildSeedStatements()')
    const scopeIndex = source.indexOf('assertSeedSqlScope(statements)', planIndex)
    const writeIndex = source.indexOf('for (const [index, sql] of statements.entries())', planIndex)
    expect(planIndex).toBeGreaterThan(-1)
    expect(scopeIndex).toBeGreaterThan(planIndex)
    expect(scopeIndex).toBeLessThan(writeIndex)
  })

  it('validates the full seed plan offline without database confirmation or writes', () => {
    const output = execFileSync(process.execPath, [path.join(root, 'scripts/seed-demo.mjs'), '--validate-only'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLOUDBASE_ENV_ID: '',
        MINI_PROGRAM_APP_ID: '',
        MIP_DEPLOYMENT_STAGE: 'production',
        MIP_PAYMENT_MODE: 'live',
      },
    })
    const result = JSON.parse(output)
    expect(result).toMatchObject({
      valid: true,
      seedVersion: seed.version,
      fixtureGroups: Object.keys(SEED_TABLES).length,
    })
    expect(result.statementCount).toBeGreaterThan(Object.keys(SEED_TABLES).length)
    expect(result.tableCount).toBeGreaterThan(Object.keys(SEED_TABLES).length)
  })

  it('registers every demo fixture in an explicit replace-before-production manifest', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/seed-demo.mjs'), 'utf8')
    expect(source).toContain('\'demo_seed_manifest\'')
    expect(source).toMatch(/demo_seed_manifest:\$\{value\.version\}/)
    expect(source).toContain('is_demo: 1')
    expect(source).toContain('demoManifestStatement(seed, \'PENDING\')')
    expect(source).toContain('demoManifestStatement(seed, \'READY\')')
    expect(source).toContain('recordIds: Object.fromEntries')
    expect(source).toContain('recordsByTable: {')
    expect(source).toContain('seedSha256')
    for (const table of Object.values(SEED_TABLES)) {
      expect(source).toContain(`${table}:`)
    }
    expect(source).toContain('mip_message_template_revisions:')
    expect(source).toContain('mip_game_ranking_entries:')
  })

  it('keeps demo users out of the platform-owner bootstrap path', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/bootstrap-owner.mjs'), 'utf8')
    const selection = fs.readFileSync(path.join(root, 'scripts/lib/mip-owner-bootstrap.mjs'), 'utf8')
    expect(source).toContain('Demo seed users cannot become platform owners')
    expect(selection).toContain('setting_key LIKE \'demo_seed_manifest%\'')
    expect(selection).toContain('JSON_EXTRACT(demo_manifest.value_json, \'$.recordIds.users\')')
  })
})
