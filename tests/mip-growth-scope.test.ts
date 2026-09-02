import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('growth rule scope migration and admin surface', () => {
  it('locks the requested scope and effective window constraints', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const migration = fs.readFileSync(
      path.join(root, 'database/mysql/mip/051_growth_rule_scope_window.sql'),
      'utf8',
    )
    expect(migration).toContain('scope_type')
    expect(migration).toContain('scope_id')
    expect(migration).toContain('scope_type = \'PLATFORM\' AND scope_id IS NULL')
    expect(migration).toContain('scope_type = \'BRANCH\' AND scope_id IS NOT NULL')
    expect(migration).toContain('effective_to > effective_from')
    expect(migration).toContain('REFERENCES mip_city_branches')
    expect(migration).not.toMatch(/\b(?:member|dating|sewing)_/i)
  })
})
