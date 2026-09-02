import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP opportunity archive client contract', () => {
  it('keeps archive behind the neutral service contract', () => {
    const types = read('src/modules/mip-admin/types.ts')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')

    expect(types).toContain('\'opportunities.archive\'')
    expect(gateway).toContain('call(\'mip.admin.opportunities.archive\', input)')
  })

  it('keeps archived drafts out of owner reads and editing', () => {
    const source = read('cloudfunctions/mip-opportunities-api/domain/opportunities.js')
    expect(source).toContain('o.status <> \'ARCHIVED\'')
    expect(source).toContain('if (row.status === \'ARCHIVED\') throw new Error(\'NOT_FOUND\')')
    expect(source).toContain('const OWNER_EDITABLE_OPPORTUNITY_STATUSES = new Set([\'DRAFT\', \'PUBLISHED\'])')
    expect(source).toContain('if (!canOwnerEditOpportunity(existing.status)) throw new Error(\'FORBIDDEN\')')
  })
})
