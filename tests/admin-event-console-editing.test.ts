import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('published event editing contract', () => {
  it('requires an explicit unpublish before opening the event editor', () => {
    const page = read('src/packages/admin/event-console/index.ts')
    const view = read('src/packages/admin/event-console/index.wxml')

    expect(view).toContain('canEdit && (event.status === \'DRAFT\' || event.status === \'UNPUBLISHED\')')
    expect(view).toContain('canEdit && event.status === \'PUBLISHED\'')
    expect(view).toContain('bind:tap="unpublishBeforeEdit"')
    expect(view).toContain('下架后编辑')
    expect(page).toContain('event.status !== \'PUBLISHED\'')
    expect(page).toContain('status: \'UNPUBLISHED\'')
    expect(page).toContain('expectedVersion: event.version')
    expect(page).toContain('confirmText: \'下架并编辑\'')
    expect(page).toContain('await this.loadEvent(true)')
    expect(page).toContain('/packages/admin/events/index?eventId=')
  })
})
