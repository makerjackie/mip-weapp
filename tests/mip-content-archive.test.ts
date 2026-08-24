import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP cooperation card and super case archives', () => {
  it('exposes protected versioned archive actions through the MIP module only', () => {
    const entry = source('cloudfunctions/mip-opportunities-api/index.js')
    const auth = source('cloudfunctions/mip-opportunities-api/lib/auth.js')
    const cooperationClient = source('src/modules/mip-cooperation/client.ts')
    const caseClient = source('src/modules/mip-cases/client.ts')

    expect(entry).toContain('case \'archiveCooperationCard\':')
    expect(entry).toContain('case \'archiveSuperCase\':')
    expect(auth).toContain('\'archiveCooperationCard\'')
    expect(auth).toContain('\'archiveSuperCase\'')
    expect(cooperationClient).toContain('createMutationKey(\'cooperation-archive\')')
    expect(cooperationClient).toContain('\'archiveCooperationCard\'')
    expect(caseClient).toContain('createMutationKey(\'case-archive\')')
    expect(caseClient).toContain('\'archiveSuperCase\'')
    expect(cooperationClient).toContain('{ id, expectedVersion, idempotencyKey }')
    expect(caseClient).toContain('{ id, expectedVersion, idempotencyKey }')
  })

  it('offers confirmed deletion from owner lists and details and refreshes after mutations', () => {
    const cooperationList = source('src/packages/member/mip-cooperation/list/index.ts')
    const cooperationDetail = source('src/packages/member/mip-cooperation/detail/index.ts')
    const caseList = source('src/packages/member/mip-cases/list/index.ts')
    const caseDetail = source('src/packages/member/mip-cases/detail/index.ts')

    expect(cooperationList).toContain('title: \'删除合作卡\'')
    expect(cooperationList).toContain('cooperationModule.archive(item.id, expectedVersion)')
    expect(cooperationList).toContain('await this.load(true)')
    expect(cooperationDetail).toContain('cooperationModule.archive(item.id, item.version)')
    expect(cooperationDetail).toContain('leaveSecondaryPage(\'/pages/opportunities/index\')')
    expect(caseList).toContain('title: \'删除案例\'')
    expect(caseList).toContain('superCaseModule.archive(item.id, expectedVersion)')
    expect(caseList).toContain('await this.load(true)')
    expect(caseDetail).toContain('superCaseModule.archive(item.id, item.version)')
    expect(caseDetail).toContain('leaveSecondaryPage(\'/pages/opportunities/index\')')
    for (const page of [cooperationList, cooperationDetail, caseList, caseDetail]) {
      expect(page).toContain('无法恢复')
      expect(page).not.toContain('wx.cloud.init')
    }
  })

  it('adds isolated soft-archive constraints without deleting business rows', () => {
    const migration = source('database/mysql/mip/018_content_archives.sql')
    const rollback = source('database/mysql/mip/rollback/018_content_archives.sql')
    const lock = JSON.parse(source('database/mysql/mip/migrations.lock.json'))
    const entry = lock.migrations.find((item: { name: string }) => item.name === 'mip_content_archives')

    expect(migration).toContain('ALTER TABLE mip_cooperation_cards')
    expect(migration).toContain('ALTER TABLE mip_super_cases')
    expect(migration.match(/ADD COLUMN archived_at DATETIME\(3\) NULL/g)).toHaveLength(2)
    expect(migration).toContain('status IN (\'DRAFT\', \'PUBLISHED\', \'UNPUBLISHED\', \'ARCHIVED\')')
    expect(migration).toContain('status = \'ARCHIVED\' AND archived_at IS NOT NULL')
    expect(migration).toContain('GENERATED ALWAYS AS')
    expect(migration).toContain('CASE WHEN status = \'ARCHIVED\' THEN NULL ELSE role_key END')
    expect(migration).toContain('mip_cooperation_cards_active_role_uk')
    expect(migration).not.toMatch(/DELETE\s+FROM/i)
    expect(rollback).toContain('Structural rollback only')
    expect(rollback).toContain('mip_cooperation_cards_owner_role_uk')
    expect(entry?.version).toBe('20260824180000')
    expect(entry?.altersTables).toEqual(['mip_cooperation_cards', 'mip_super_cases'])
  })

  it('hides archived owner content and makes archive terminal for save', () => {
    const cooperation = source('cloudfunctions/mip-opportunities-api/domain/cooperation.js')
    const cases = source('cloudfunctions/mip-opportunities-api/domain/cases.js')

    for (const domain of [cooperation, cases]) {
      expect(domain).toContain('c.status <> \'ARCHIVED\'')
      expect(domain).toContain('if (row.status === \'ARCHIVED\') throw new Error(\'NOT_FOUND\')')
      expect(domain).toContain('if (existing.status === \'ARCHIVED\') throw new Error(\'FORBIDDEN\')')
      expect(domain).toContain('SET status = \'ARCHIVED\', archived_at = UTC_TIMESTAMP(3), version = version + 1')
      expect(domain).toContain('version = ? AND status <> \'ARCHIVED\'')
    }
    expect(cooperation).not.toMatch(/DELETE FROM mip_cooperation_cards/)
    expect(cases).not.toMatch(/DELETE FROM mip_super_cases/)
  })
})
