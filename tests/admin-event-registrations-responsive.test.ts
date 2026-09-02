import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('onsite event roster', () => {
  it('loads only a masked roster and keeps phone originals out of page data', () => {
    const page = read('src/packages/admin/event-registrations/index.ts')
    const view = read('src/packages/admin/event-registrations/index.wxml')

    expect(page).toContain('includePhone: false')
    expect(page).toContain('Omit<AdminRosterItem, \'phoneNumber\'>')
    expect(page).not.toContain('users.phone.read')
    expect(view).not.toContain('phoneNumber')
    expect(view).not.toContain('查看完整号码')
  })

  it('supports search, status filtering, paging and onsite check-in only', () => {
    const page = read('src/packages/admin/event-registrations/index.ts')
    const view = read('src/packages/admin/event-registrations/index.wxml')

    for (const operation of [
      'mipAdminModule.events.listRoster(',
      'mipAdminModule.events.checkIn(',
      'mipAdminModule.events.undoCheckIn(',
    ]) {
      expect(page).toContain(operation)
    }
    expect(view).toContain('bind:tap="search"')
    expect(view).toContain('bind:tap="chooseStatus"')
    expect(view).toContain('bind:tap="loadMoreRoster"')
    expect(page).not.toContain('reviewRegistration')
    expect(page).not.toContain('createAndOpen')
  })

  it('keeps undo behind its own capability and a required reason', () => {
    const page = read('src/packages/admin/event-registrations/index.ts')

    expect(page).toContain('\'events.checkin.undo\'')
    expect(page).toContain('if (!reason)')
    expect(page).toContain('reason,')
    expect(page).toContain('/packages/admin/event-console/index?eventId=')
  })
})
