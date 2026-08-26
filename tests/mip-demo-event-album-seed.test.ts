import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

interface DemoEvent {
  id: string
  startsAt: string
  albumEnabled: boolean
  albumSubmissionPolicy: 'AUTO' | 'REVIEW'
}

const seed = JSON.parse(fs.readFileSync(
  new URL('../database/mysql/mip/seed.demo.json', import.meta.url),
  'utf8',
)) as { events: DemoEvent[] }
const seedScript = fs.readFileSync(new URL('../scripts/seed-demo.mjs', import.meta.url), 'utf8')

describe('MIP demo event album seed', () => {
  it('declares an explicit album contract and a stable published 2030 fixture', () => {
    expect(seed.events.length).toBeGreaterThan(0)
    expect(seed.events.every(event => typeof event.albumEnabled === 'boolean')).toBe(true)
    expect(seed.events.every(event => ['AUTO', 'REVIEW'].includes(event.albumSubmissionPolicy))).toBe(true)
    expect(seed.events.some(event => event.albumEnabled && event.startsAt.startsWith('2030-'))).toBe(true)
  })

  it('converges album fields through insert, upsert, and post-write verification SQL', () => {
    expect(seedScript).toContain('album_enabled, album_submission_policy, status')
    expect(seedScript).toContain('album_enabled = VALUES(album_enabled)')
    expect(seedScript).toContain('album_submission_policy = VALUES(album_submission_policy)')
    expect(seedScript).toContain('AS eventAlbumSettings')
    expect(seedScript).toContain('AS eventAlbumRuntimeFixtures')
    expect(seedScript).toContain('eventAlbumSettings: seed.events.length')
    expect(seedScript).toContain('eventAlbumRuntimeFixtures: seed.events.filter(item => item.albumEnabled).length')
  })
})
