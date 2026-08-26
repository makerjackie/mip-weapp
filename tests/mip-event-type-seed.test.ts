import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const source = fs.readFileSync(path.join(root, 'scripts/seed-demo.mjs'), 'utf8')
const seed = JSON.parse(fs.readFileSync(
  path.join(root, 'database/mysql/mip/seed.demo.json'),
  'utf8',
)) as {
  events: Array<{ eventTypeKey: string, organizerUserId: string }>
}

function sourceFunction(name: string, nextName: string) {
  return source.slice(
    source.indexOf(`function ${name}`),
    source.indexOf(`function ${nextName}`),
  )
}

describe('MIP demo event-type catalog safety', () => {
  it('ensures each distinct demo event type before the demo event upsert', () => {
    const plan = sourceFunction('buildSeedStatements()', 'branchStatement')
    expect(plan.indexOf('eventTypeStatement(seed.events)')).toBeGreaterThan(-1)
    expect(plan.indexOf('eventTypeStatement(seed.events)'))
      .toBeLessThan(plan.indexOf('eventStatement(seed.events)'))
    expect(source).toContain('\'mip_event_types\',\n  \'mip_event_tags\',\n  \'mip_event_tag_assignments\',\n  \'mip_events\'')
    expect(new Set(seed.events.map(event => event.eventTypeKey)).size).toBeGreaterThan(0)
  })

  it('creates only missing ACTIVE name-equals-key rows under the AppID and demo organizer', () => {
    const statement = sourceFunction('eventTypeStatement(items)', 'eventTagStatement')
    expect(statement).toContain('INSERT INTO mip_event_types')
    expect(statement).toContain('type_key, name, description, sort_order, status, version')
    expect(statement).toContain('\'\', 0, \'ACTIVE\', 1')
    expect(statement).toContain('WHERE NOT EXISTS (')
    expect(statement).toMatch(/existing\.app_id = \$\{sqlLiteral\(appId\)\}/)
    expect(statement).toMatch(/existing\.type_key = \$\{sqlLiteral\(item\.key\)\}/)
    expect(statement.match(/sqlLiteral\(item\.organizerUserId\)/g)).toHaveLength(2)
    expect(statement).not.toMatch(/INSERT IGNORE|ON DUPLICATE KEY UPDATE|UPDATE mip_event_types/i)
  })

  it('verifies the AppID-bound type keys without rewriting pre-existing metadata', () => {
    const verification = source.slice(
      source.indexOf('(SELECT COUNT(*) FROM mip_event_types'),
      source.indexOf('(SELECT COUNT(*) FROM mip_event_tags'),
    )
    expect(verification).toMatch(/WHERE app_id = \$\{sqlLiteral\(appId\)\}/)
    expect(verification).toContain('demoEventTypes(seed.events)')
    expect(verification).not.toContain('status = \'ACTIVE\'')
    expect(source).toContain('eventTypes: demoEventTypes(seed.events).length')
  })
})
