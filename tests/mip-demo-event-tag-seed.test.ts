import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSeedCollisionQuery,
  buildSeedOwnershipQuery,
  SEED_TABLES,
} from '../scripts/lib/mip-seed-safety.mjs'

interface DemoEventTag {
  id: string
  key: string
  name: string
}

interface DemoEvent {
  id: string
  startsAt: string
  tagIds: string[]
}

const root = path.resolve(import.meta.dirname, '..')
const seed = JSON.parse(fs.readFileSync(
  path.join(root, 'database/mysql/mip/seed.demo.json'),
  'utf8',
)) as { version: string, eventTags: DemoEventTag[], events: DemoEvent[] }
const source = fs.readFileSync(path.join(root, 'scripts/seed-demo.mjs'), 'utf8')

function sourceFunction(name: string, nextName: string) {
  return source.slice(
    source.indexOf(`function ${name}`),
    source.indexOf(`function ${nextName}`),
  )
}

describe('MIP demo event tag seed', () => {
  it('provides neutral tags and single-tag plus multi-tag 2030 fixtures', () => {
    expect(seed.version).toBe('2026-08-26-demo.11')
    expect(seed.eventTags).toHaveLength(3)
    expect(new Set(seed.eventTags.map(item => item.key)).size).toBe(seed.eventTags.length)
    expect(seed.eventTags.every(item => item.name.length > 0)).toBe(true)

    const catalogIds = new Set(seed.eventTags.map(item => item.id))
    const longLived = seed.events.filter(item => item.startsAt.startsWith('2030-'))
    expect(longLived).toHaveLength(2)
    expect(longLived.some(item => item.tagIds.length === 1)).toBe(true)
    expect(longLived.some(item => item.tagIds.length > 1)).toBe(true)
    expect(seed.events.every(item => item.tagIds.every(tagId => catalogIds.has(tagId)))).toBe(true)
    expect(seed.eventTags.every(tag => seed.events.some(event => event.tagIds.includes(tag.id)))).toBe(true)
  })

  it('converges catalogs before AppID-scoped assignments without deleting other rows', () => {
    const plan = sourceFunction('buildSeedStatements()', 'branchStatement')
    expect(plan.indexOf('eventStatement(seed.events)')).toBeGreaterThan(-1)
    expect(plan.indexOf('eventTagStatement(seed.eventTags)'))
      .toBeGreaterThan(plan.indexOf('eventStatement(seed.events)'))
    expect(plan.indexOf('eventTagAssignmentStatement(seed.events)'))
      .toBeGreaterThan(plan.indexOf('eventTagStatement(seed.eventTags)'))

    const catalogs = sourceFunction('eventTagStatement(items)', 'demoEventTagAssignments')
    expect(catalogs).toContain('INSERT INTO mip_event_tags')
    expect(catalogs).toContain('app_id = IF(app_id = VALUES(app_id), app_id, NULL)')
    expect(catalogs).toContain('id = IF(id = VALUES(id), id, NULL)')
    expect(catalogs).toContain('version = IF(')
    expect(catalogs).not.toContain('DELETE FROM')

    const assignments = sourceFunction('eventTagAssignmentStatement(items)', 'eventStatement')
    expect(assignments).toContain('INSERT INTO mip_event_tag_assignments')
    expect(assignments).toContain('status = \'ACTIVE\'')
    expect(assignments).toContain('removed_by_user_id = NULL, removed_at = NULL')
    expect(assignments).not.toContain('DELETE FROM')
  })

  it('keeps fixed tags and composite assignments inside manifest ownership checks', () => {
    expect(SEED_TABLES.eventTags).toBe('mip_event_tags')
    const ownership = buildSeedOwnershipQuery('wx1111111111111111', seed)
    const collisions = buildSeedCollisionQuery('wx1111111111111111', seed)
    expect(ownership).toContain('SELECT id FROM mip_event_tags')
    expect(ownership).toContain('app_id <> \'wx1111111111111111\'')
    expect(collisions).toContain('FROM mip_event_tags')
    expect(collisions).toContain('tag_key =')
    expect(collisions).toContain('FROM mip_event_tag_assignments event_tag_assignment')
    expect(collisions).toContain('\'$.recordsByTable.mip_event_tag_assignments\'')
    expect(source).toContain('mip_event_tags: value.eventTags.map')
    expect(source).toContain('mip_event_tag_assignments: demoEventTagAssignments(value.events).map')
  })

  it('verifies exact active catalog and assignment facts after a real seed run', () => {
    expect(source).toContain('AS eventTags')
    expect(source).toContain('AS eventTagAssignments')
    expect(source).toContain('eventTags: seed.eventTags.length')
    expect(source).toContain('eventTagAssignments: demoEventTagAssignments(seed.events).length')
  })
})
