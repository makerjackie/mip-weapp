import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP related opportunity flow', () => {
  it('shows published and referred-to-me opportunities from separate server facts', () => {
    const page = read('src/packages/member/mip-opportunities/mine/index.ts')
    const view = read('src/packages/member/mip-opportunities/mine/index.wxml')

    expect(page).toContain('opportunityModule.listMine(')
    expect(page).toContain('opportunityModule.listReceived(\n        \'REFERRAL\'')
    expect(page).toContain('opportunityModule.markReceivedRead(item.messageId)')
    expect(page).toContain('item.actor.profileRef')
    expect(page).not.toContain('wx.cloud')
    expect(view).toContain('我发布的')
    expect(view).toContain('引荐给我的')
    expect(view).toContain('其他用户向你引荐机会后会显示在这里。')
    expect(view).toContain('向你引荐了这个机会')
  })

  it('requires an explicit visible profile target before activating a referral', () => {
    const detail = read('src/packages/member/mip-opportunities/detail/index.ts')
    const view = read('src/packages/member/mip-opportunities/detail/index.wxml')
    const client = read('src/modules/mip-opportunities/client.ts')
    const server = read('cloudfunctions/mip-opportunities-api/domain/opportunities.js')

    expect(detail).toContain('scope: \'GLOBAL\'')
    expect(detail).toContain('kind: \'ALL\'')
    expect(detail).toContain('item => !item.isSelf')
    expect(detail).toContain('setReferral(item.id, true, target.profileRef)')
    expect(view).toContain('选择被引荐人')
    expect(view).toContain('更换被引荐人')
    expect(view).not.toContain('更换引荐人')
    expect(view).toContain('玩家和嘉宾均可选择')
    expect(view).toContain('确认引荐')
    expect(client).toContain('targetProfileRef: targetProfileRef.trim()')
    expect(server).toContain('async function resolveReferralTarget')
    expect(server).toContain('target.status = \'ACTIVE\'')
    expect(server).toContain('if (targetUserId === caller.userId) throw new Error(\'CONFLICT\')')
    expect(server).toContain('target_user_id = CASE WHEN ? = 1 THEN ? ELSE target_user_id END')
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
