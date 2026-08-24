import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePublicPerson } from '../src/modules/mip-opportunities/validation'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP badge collection', () => {
  it('accepts at most three public equipped badges without identity internals', () => {
    const value = parsePublicPerson({
      profileRef: `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`,
      isSelf: false,
      userKind: 'PLAYER',
      joinedAt: '2026-08-24T08:00:00.000Z',
      badges: [{
        id: '10000000-0000-4000-8000-000000000001',
        key: 'event_participant',
        name: '活动参与',
        description: '已完成活动参与记录',
        placeholderShape: 'CIRCLE',
        equippedSlot: 1,
        userId: 'private',
      }],
    })
    expect(value.badges).toEqual([expect.objectContaining({ name: '活动参与', equippedSlot: 1 })])
    expect(value.badges?.[0]).not.toHaveProperty('userId')
    expect(() => parsePublicPerson({ ...value, badges: Array.from({ length: 4 }, (_, index) => ({
      id: `10000000-0000-4000-8000-00000000000${index + 1}`,
      key: `badge_${index}`,
      name: `勋章 ${index}`,
      description: '',
      placeholderShape: 'CIRCLE',
      equippedSlot: Math.min(index + 1, 3),
    })) })).toThrow()
  })

  it('registers member and admin routes and keeps pages behind modules', () => {
    const app = JSON.parse(source('src/app.json'))
    const routes = app.subPackages.flatMap((pkg: { root: string, pages: string[] }) => (
      pkg.pages.map(page => `${pkg.root}/${page}`)
    ))
    const runtime = JSON.parse(source('config/runtime-pages.json'))
    expect(routes).toContain('packages/member/mip-badges/index')
    expect(routes).toContain('packages/admin/badges/index')
    expect(runtime.routeCount).toBe(runtime.routes.length)
    expect(source('src/packages/member/mip-badges/index.ts')).toContain('mipGrowthModule.equipBadges')
    expect(source('src/packages/admin/badges/index.ts')).toContain('mipAdminModule.gateway.grantBadge')
    expect(`${source('src/packages/member/mip-badges/index.ts')}\n${source('src/packages/admin/badges/index.ts')}`)
      .not
      .toContain('wx.cloud')
  })

  it('locks a server-constrained three-slot award model and exact grants', () => {
    const migration = source('database/mysql/mip/028_badge_collection.sql')
    const rollback = source('database/mysql/mip/rollback/028_badge_collection.sql')
    expect(migration).toContain('mip_user_badge_equipment_slot_ck CHECK (slot_no BETWEEN 1 AND 3)')
    expect(migration).toContain('mip_user_badge_equipment_award_fk')
    expect(migration).toContain('UNIQUE KEY mip_user_badge_equipment_badge_uk')
    expect(rollback.indexOf('mip_user_badge_equipment')).toBeLessThan(rollback.indexOf('mip_user_badges'))
    expect(source('scripts/lib/mysql-privilege-assert.mjs')).toContain('mip_user_badge_equipment: Object.freeze([\'SELECT\', \'INSERT\', \'DELETE\'])')
  })
})
