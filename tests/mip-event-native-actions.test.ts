import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP event native actions', () => {
  it('derives map coordinates from server facts and supports an address-only fallback', () => {
    const service = read('cloudfunctions/mip-events-api/domain/event-service.js')
    const page = read('src/packages/member/mip-events/detail/index.ts')
    const view = read('src/packages/member/mip-events/detail/index.wxml')

    expect(service).toContain('latitude: row.latitude === null ? undefined : Number(row.latitude)')
    expect(service).toContain('longitude: row.longitude === null ? undefined : Number(row.longitude)')
    expect(page).toContain('wx.openLocation')
    expect(page).toContain('wx.setClipboardData')
    expect(view).toContain('hasCoordinates ? \'地图\' : \'复制\'')
  })

  it('adds the server-provided activity time to the system calendar', () => {
    const page = read('src/packages/member/mip-events/detail/index.ts')
    const view = read('src/packages/member/mip-events/detail/index.wxml')

    expect(page).toContain('wx.addPhoneCalendar')
    expect(page).toContain('new Date(event.startsAt)')
    expect(page).toContain('new Date(event.endsAt)')
    expect(view).toContain('加入系统日历')
  })

  it('stores map coordinates only through the validated event draft', () => {
    const adminPage = read('src/packages/admin/events/index.ts')
    const service = read('cloudfunctions/mip-admin-api/domain/events.js')
    const repository = read('cloudfunctions/mip-admin-api/domain/repository.js')

    expect(adminPage).toContain('wx.chooseLocation')
    expect(service).toContain('coordinate(value.latitude, -90, 90, \'纬度\')')
    expect(service).toContain('coordinate(value.longitude, -180, 180, \'经度\')')
    expect(repository).toContain('latitude = ?, longitude = ?')
  })
})
