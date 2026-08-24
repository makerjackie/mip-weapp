import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migration = fs.readFileSync(path.join(root, 'database/mysql/mip/002_events.sql'), 'utf8')
const rollback = fs.readFileSync(path.join(root, 'database/mysql/mip/rollback/002_events.sql'), 'utf8')

describe('MIP event database isolation', () => {
  it('creates only mip-prefixed tables and never mutates historical tables', () => {
    const created = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map(match => match[1])
    expect(created.length).toBeGreaterThanOrEqual(10)
    expect(created.every(name => name.startsWith('mip_'))).toBe(true)
    expect(migration).not.toMatch(/\b(?:FROM|JOIN|REFERENCES|UPDATE|INTO|TABLE)\s+(?:member|dating|sewing)_/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i)
  })

  it('models paid seat holds, one heart per voter/event, and editable one-per-event feedback', () => {
    expect(migration).toContain('mip_event_seat_holds')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_orders')
    expect(migration).toContain('order_type IN (\'MEMBERSHIP\', \'EVENT\')')
    expect(migration).not.toContain('mip_event_orders')
    expect(migration).toContain('mip_event_hearts_voter_uk (app_id, event_id, voter_user_id)')
    expect(migration).toContain('mip_event_feedback_user_uk (app_id, event_id, user_id)')
    expect(migration).toContain('mode IN (\'STATIC\', \'ROTATING\')')
    expect(migration).toContain('token_hash CHAR(64)')
  })

  it('rolls back only the tables introduced by this migration in dependency order', () => {
    const dropped = [...rollback.matchAll(/DROP TABLE IF EXISTS\s+(\w+)/gi)].map(match => match[1])
    expect(dropped[0]).toBe('mip_event_feedback')
    expect(dropped.at(-1)).toBe('mip_membership_plans')
    expect(dropped.every(name => name.startsWith('mip_'))).toBe(true)
    expect(new Set(dropped).size).toBe(dropped.length)
  })
})

describe('MIP event client boundaries', () => {
  it('keeps CloudBase and payment calls out of event pages', () => {
    const sourceRoots = [
      path.join(root, 'src/pages/events'),
      path.join(root, 'src/packages/member/mip-events'),
    ]
    const sources = sourceRoots.flatMap((directory) => {
      const entries: string[] = []
      const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const absolute = path.join(current, entry.name)
          if (entry.isDirectory()) {
            walk(absolute)
          }
          else {
            entries.push(fs.readFileSync(absolute, 'utf8'))
          }
        }
      }
      walk(directory)
      return entries
    }).join('\n')
    expect(sources).not.toContain('wx.cloud')
    expect(sources).not.toContain('wx.requestPayment')
    expect(sources).not.toContain('<t-loading')
  })
})
