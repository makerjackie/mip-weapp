import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP opportunity archive client contract', () => {
  it('shows the archive action only for a server-granted platform capability', () => {
    const types = read('src/modules/mip-admin/types.ts')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')
    const page = read('src/packages/admin/opportunities/index.ts')
    const template = read('src/packages/admin/opportunities/index.wxml')

    expect(types).toContain('\'opportunities.archive\'')
    expect(gateway).toContain('call(\'mip.admin.opportunities.archive\', input)')
    expect(page).toContain('hasCapability(session.capabilities, \'opportunities.archive\')')
    expect(page).toContain('expectedVersion: version')
    expect(template).toContain('item.status !== \'PUBLISHED\' && item.status !== \'ARCHIVED\' && canArchive')
    expect(template).toContain('data-value="ARCHIVED"')
  })

  it('keeps archived drafts out of owner reads and editing', () => {
    const source = read('cloudfunctions/mip-opportunities-api/domain/opportunities.js')
    expect(source).toContain('o.status <> \'ARCHIVED\'')
    expect(source).toContain('if (row.status === \'ARCHIVED\') throw new Error(\'NOT_FOUND\')')
    expect(source).toContain('[\'UNPUBLISHED\', \'ARCHIVED\'].includes(existing.status)')
  })
})
