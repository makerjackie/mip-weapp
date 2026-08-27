'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createGrowthRepository } = require('../domain/repository')

const appId = 'wx-badges-app'
const userId = '10000000-0000-4000-8000-000000000001'
const badgeId = '20000000-0000-4000-8000-000000000001'
const lockedBadgeId = '20000000-0000-4000-8000-000000000002'

test('lists the complete catalog with explicit award and equipment state', async () => {
  const database = {
    async one(sql) {
      if (sql.includes('mip_user_badge_profiles')) return { version: 4 }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql) {
      if (sql.includes('INSERT INTO mip_user_badge_profiles')) return { affectedRows: 1 }
      if (sql.includes('FROM mip_badges badge')) {
        return [{
          id: badgeId,
          badge_key: 'event_participant',
          name: '活动参与',
          description: '已完成活动参与记录',
          icon_name: 'calendar-check',
          image_url: '',
          placeholder_shape: 'CIRCLE',
          category: 'IDENTITY',
          sort_order: 10,
          award_id: 'award-1',
          status: 'ACTIVE',
          awarded_at: '2026-08-24T00:00:00.000Z',
          slot_no: 1,
        }, {
          id: lockedBadgeId,
          badge_key: 'delivery_leader',
          name: '交付统筹',
          description: '带领团队按计划完成项目目标',
          icon_name: 'task-done-filled',
          image_url: '/packages/member/assets/generated/badges/badge-delivery-leader.png',
          placeholder_shape: 'HEXAGON',
          category: 'HONOR',
          sort_order: 20,
          award_id: null,
          status: 'ACTIVE',
          awarded_at: null,
          slot_no: null,
        }]
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  const result = await createGrowthRepository(database).listBadgeCollection(appId, userId)
  assert.equal(result.version, 4)
  assert.equal(result.maximumEquipped, 3)
  assert.deepEqual(result.items.map(item => [item.id, item.equippedSlot]), [[badgeId, 1], [lockedBadgeId, undefined]])
  assert.equal(result.items[0].earned, true)
  assert.equal(result.items[0].category, 'IDENTITY')
  assert.equal(result.items[1].earned, false)
  assert.equal(result.items[1].awardedAt, undefined)
  assert.equal(JSON.stringify(result).includes(userId), false)
})

test('replaces at most three equipped badges behind one optimistic version', async () => {
  const writes = []
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_user_badge_profiles')) return { version: 2 }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql, params) {
      writes.push({ sql, params })
      if (sql.includes('SELECT award.badge_id')) return [{ badge_id: badgeId }]
      return { affectedRows: 1 }
    },
  }
  const database = {
    transaction: work => work(tx),
    async one(sql) {
      if (sql.includes('mip_user_badge_profiles')) return { version: 3 }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql) {
      if (sql.includes('INSERT INTO mip_user_badge_profiles')) return { affectedRows: 1 }
      if (sql.includes('FROM mip_badges badge')) return []
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  const result = await createGrowthRepository(database).equipBadges(
    appId,
    userId,
    { badgeIds: [badgeId], expectedVersion: 2 },
  )
  assert.equal(result.version, 3)
  assert.ok(writes.some(item => item.sql.includes('DELETE FROM mip_user_badge_equipment')))
  assert.ok(writes.some(item => item.sql.includes('slot_no, badge_id') && item.params[2] === 1))
  assert.ok(writes.some(item => item.sql.includes('version = version + 1')))
  await assert.rejects(
    () => createGrowthRepository(database).equipBadges(appId, userId, {
      badgeIds: [badgeId, badgeId.replace(/1$/, '2'), badgeId.replace(/1$/, '3'), badgeId.replace(/1$/, '4')],
      expectedVersion: 3,
    }),
    /BADGE_EQUIPMENT_INVALID/,
  )
})
