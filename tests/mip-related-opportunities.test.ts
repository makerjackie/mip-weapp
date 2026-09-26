import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP related opportunity flow', () => {
  it('uses independent self-cooperation facts in both personal opportunity lists', () => {
    for (const file of ['src/packages/member/mip-opportunities/mine/index.ts', 'src/pages/profile/index.ts']) {
      const page = read(file)
      expect(page).toContain('opportunityModule.listMine(')
      expect(page).toContain('opportunityModule.listMyCooperations(')
      expect(page).not.toContain('listReceived(\'REFERRAL\'')
      expect(page).not.toContain('wx.cloud')
    }
    const view = read('src/packages/member/mip-opportunities/mine/index.wxml')
    expect(view).toContain('我想合作')
    expect(view).toContain('catch:tap="editPublished"')
    expect(view).toContain('bindlongpress="confirmDeletePublished"')
  })

  it('removes the third-person picker and activates only the callers cooperation intent', () => {
    const detail = read('src/packages/member/mip-opportunities/detail/index.ts')
    const view = read('src/packages/member/mip-opportunities/detail/index.wxml')
    expect(detail).toContain('setCooperation(item.id, !item.cooperationActive)')
    expect(detail).toContain('authorizeInteraction(\'cooperation\')')
    expect(view).toContain('bind:tap="cooperationIntent"')
    expect(view).toContain('取消合作意向')
    expect(view).toContain('想合作的人')
    expect(view).not.toContain('选择被引荐人')
    expect(detail).not.toContain('功能建设中')
  })

  it('adds one append-only target migration without changing the actor uniqueness contract', () => {
    const sql = read('database/mysql/mip/021_referral_targets.sql')
    const rollback = read('database/mysql/mip/rollback/021_referral_targets.sql')
    const lock = JSON.parse(read('database/mysql/mip/migrations.lock.json'))
    const foundation = read('database/mysql/mip/003_opportunities.sql')
    const privileges = read('scripts/lib/mysql-privilege-assert.mjs')

    expect(sql).toContain('ADD COLUMN target_user_id')
    expect(sql).toContain('SET referral.target_user_id = opportunity.owner_user_id')
    expect(sql).toContain('MODIFY COLUMN target_user_id')
    expect(sql).toContain('mip_referral_intents_target_fk')
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(rollback).toContain('DROP COLUMN target_user_id')
    expect(foundation).toContain('UNIQUE KEY mip_referral_intents_actor_uk (app_id, opportunity_id, actor_user_id)')
    expect(privileges).toContain('mip_referral_intents: Object.freeze([\'SELECT\', \'INSERT\', \'UPDATE\'])')
    expect(lock.migrations.find((migration: { name: string }) => migration.name === 'mip_referral_targets')).toMatchObject({
      version: '20260824210000',
      name: 'mip_referral_targets',
      altersTables: ['mip_referral_intents'],
    })
  })
})
