import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSeedOwnershipQuery,
  seedOwnershipConflictCount,
} from '../scripts/lib/mip-seed-safety.mjs'

const root = path.resolve(import.meta.dirname, '..')
const seed = JSON.parse(fs.readFileSync(path.join(root, 'database/mysql/mip/seed.demo.json'), 'utf8'))

describe('MIP demo seed ownership safety', () => {
  it('checks every fixed-ID seed table for a different AppID before writing', () => {
    const query = buildSeedOwnershipQuery('wx1111111111111111', seed)
    for (const table of [
      'mip_city_branches',
      'mip_tags',
      'mip_membership_plans',
      'mip_growth_levels',
      'mip_growth_rules',
    ]) {
      expect(query).toContain(`SELECT id FROM ${table}`)
    }
    expect(query).toContain('app_id <> \'wx1111111111111111\'')
    expect(query).toContain('COUNT(*) AS conflicts')
  })

  it('fails closed when the management API response has no trustworthy count', () => {
    expect(seedOwnershipConflictCount({ data: { rows: [{ conflicts: '0' }] } })).toBe(0)
    expect(seedOwnershipConflictCount({ data: { rows: [{ conflicts: 2 }] } })).toBe(2)
    expect(seedOwnershipConflictCount({ data: { rows: [] } })).toBeNull()
    expect(seedOwnershipConflictCount({ conflicts: '-1' })).toBeNull()
  })

  it('runs the ownership probe before constructing or executing seed statements', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/seed-demo.mjs'), 'utf8')
    expect(source.indexOf('buildSeedOwnershipQuery(appId, seed)'))
      .toBeLessThan(source.indexOf('const statements = ['))
    expect(source).toContain('no seed writes were attempted')
  })

  it('makes every fixed-ID upsert fail when a duplicate belongs to another AppID', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/seed-demo.mjs'), 'utf8')
    expect(source.match(/app_id = IF\(app_id = VALUES\(app_id\), app_id, NULL\)/g))
      .toHaveLength(6)
  })
})
