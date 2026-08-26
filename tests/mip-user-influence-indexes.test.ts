import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP user influence indexes', () => {
  it('locks one append-only migration for cross-event influence timelines', () => {
    const migration = read('database/mysql/mip/044_user_influence_indexes.sql')
    const rollback = read('database/mysql/mip/rollback/044_user_influence_indexes.sql')
    const lock = JSON.parse(read('database/mysql/mip/migrations.lock.json')) as {
      migrations: Array<Record<string, unknown>>
    }
    const entry = lock.migrations.find(item => item.name === 'mip_user_influence_indexes')

    expect(entry).toMatchObject({
      version: '20260826440000',
      createsTables: [],
      altersTables: [
        'mip_event_invitation_attributions',
        'mip_event_hearts',
        'mip_profile_visits',
      ],
    })
    expect(entry?.sqlSha256).toBe(createHash('sha256').update(migration).digest('hex'))
    expect(entry?.rollbackSha256).toBe(createHash('sha256').update(rollback).digest('hex'))
    expect(migration).toContain('app_id, guest_user_id, captured_at DESC, registration_id DESC')
    expect(migration).toContain('app_id, inviter_user_id, captured_at DESC, registration_id DESC')
    expect(migration).toContain('app_id, voter_user_id, updated_at DESC, id DESC')
    expect(migration).toContain('app_id, target_user_id, updated_at DESC, id DESC')
    expect(migration).toContain('app_id, visitor_user_id, visited_at DESC, id DESC')
    expect(migration).not.toMatch(/\b(?:DELETE FROM|TRUNCATE TABLE|DROP TABLE)\b/i)
  })
})
