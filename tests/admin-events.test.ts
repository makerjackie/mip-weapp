import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP admin event contract', () => {
  it('keeps the full scoped event model in the MIP admin boundary', () => {
    const types = read('src/modules/mip-admin/types.ts')
    const service = read('cloudfunctions/mip-admin-api/domain/events.js')

    expect(types).toContain('accessType: \'FREE\' | \'MEMBER_INCLUDED\' | \'PAID\'')
    expect(types).toContain('registrationPolicy: \'AUTO\' | \'APPROVAL\'')
    expect(types).toContain('scopeType: \'PLATFORM\' | \'BRANCH\'')
    expect(types).toContain('registrationDeadline: string | null')
    expect(types).toContain('cancellationDeadline: string | null')
    expect(types).toContain('waitlistEnabled: boolean')
    expect(types).toContain('priceCents: number')
    expect(service).toContain('registrationPolicy !== \'AUTO\'')
    expect(service).toContain('当前账号不能修改活动归属')
    expect(service).toContain('contentSafety')
  })

  it('keeps event list filters, price DTO, and sort-bound cursor behavior end to end', () => {
    const types = read('src/modules/mip-admin/types.ts')
    const service = read('cloudfunctions/mip-admin-api/domain/events.js')
    const repository = read('cloudfunctions/mip-admin-api/domain/repositories/events.js')

    for (const field of [
      'startsFrom',
      'startsTo',
      'cityOrBranch',
      'eventTypeKey',
      'accessType',
      'priceMinCents',
      'priceMaxCents',
    ]) {
      expect(types).toContain(`${field}?:`)
    }
    expect(types).toContain('field: \'startsAt\'')
    expect(types).toContain('direction: AdminEventSortDirection')
    expect(types).toContain('eventTypeKey: string')
    expect(types).toContain('priceCents: number')
    expect(service).toContain('decodeCursor(source.cursor, [\'startsAt\', \'id\', \'sortField\', \'sortDirection\'])')
    expect(service).toContain('cursor.sortDirection !== sort.direction')
    expect(repository).toMatch(/ORDER BY e\.starts_at \$\{direction\}, e\.id \$\{direction\}/)
    expect(repository).toContain('e.event_type_key = ?')
    expect(repository).toContain('e.price_cents >= ?')
  })
})
