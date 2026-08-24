import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP check-in poster contract', () => {
  it('adds an isolated short scene reference without replacing historical credentials', () => {
    const migration = read('database/mysql/mip/007_checkin_poster.sql')
    expect(migration).toContain('ALTER TABLE mip_event_checkin_credentials')
    expect(migration).toContain('scan_key CHAR(11)')
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME|DELETE)\b/i)
  })

  it('opens the published event detail and preserves the scene through registration', () => {
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const checkIn = read('src/packages/member/mip-events/check-in/index.ts')
    expect(detail).toContain('resolveCheckInScene(scene)')
    expect(detail).toContain('&checkInToken=')
    expect(registration).toContain('canContinueCheckIn')
    expect(registration).toContain('&token=')
    expect(checkIn).toContain('query.token || query.scene')
  })

  it('exposes poster generation only in the admin event console', () => {
    const admin = read('src/packages/admin/event-console/index.ts')
    const view = read('src/packages/admin/event-console/index.wxml')
    const config = JSON.parse(read('cloudfunctions/mip-events-api/config.json'))
    expect(admin).toContain(`'events.checkin.manage'`)
    expect(admin).toContain('createCheckInPoster')
    expect(admin).toContain('saveImageToPhotosAlbum')
    expect(view).toContain('签到海报')
    expect(config.permissions.openapi).toContain('wxacode.getUnlimited')
  })
})
