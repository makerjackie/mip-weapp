'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createBadgeAdminRepository } = require('../domain/badges')

const appId = 'wx-badges-app'
const actorUserId = '10000000-0000-4000-8000-000000000001'
const awardId = '20000000-0000-4000-8000-000000000001'
const userId = '30000000-0000-4000-8000-000000000001'
const badgeId = '40000000-0000-4000-8000-000000000001'

function authorization() {
  return {
    capability: 'badges.manage',
    effectiveGrant: { roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null },
  }
}

test('blocks revocation while the award is still equipped', async () => {
  let mutated = false
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users') && sql.includes('FOR UPDATE')) return { id: actorUserId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) {
        return { scope_type: 'PLATFORM', scope_id: '00000000-0000-0000-0000-000000000000', role_key: 'PLATFORM_OPERATIONS', status: 'ACTIVE' }
      }
      if (sql.includes('FROM mip_user_badges')) {
        return { id: awardId, user_id: userId, badge_id: badgeId, status: 'ACTIVE', version: 2 }
      }
      if (sql.includes('FROM mip_user_badge_equipment')) return { slot_no: 1 }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query() {
      mutated = true
      return { affectedRows: 1 }
    },
  }
  const repository = createBadgeAdminRepository({ transaction: work => work(tx) })
  await assert.rejects(() => repository.revokeBadge({
    appId,
    actorUserId,
    awardId,
    expectedVersion: 2,
    reason: '事实复核',
    authorization: authorization(),
    audit: () => ({}),
  }), /BADGE_EQUIPPED/)
  assert.equal(mutated, false)
})

test('grants an active badge to an active user and appends an audit record', async () => {
  const writes = []
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users') && sql.includes('id = ? FOR UPDATE')) return { id: userId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) {
        return { scope_type: 'PLATFORM', scope_id: '00000000-0000-0000-0000-000000000000', role_key: 'PLATFORM_OPERATIONS', status: 'ACTIVE' }
      }
      if (sql.includes('FROM mip_badges')) return { id: badgeId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_user_badges')) return null
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql, params) {
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const repository = createBadgeAdminRepository(
    { transaction: work => work(tx) },
    { createId: () => awardId },
  )
  const result = await repository.grantBadge({
    appId,
    actorUserId,
    userId,
    badgeId,
    reason: '完成活动参与记录',
    authorization: authorization(),
    audit: resourceId => ({
      appId, actorUserId, scopeType: 'PLATFORM', action: 'admin.badge.grant',
      resourceType: 'USER_BADGE', resourceId, effectiveRole: 'PLATFORM_OPERATIONS', metadata: {},
    }),
  })
  assert.deepEqual(result, { id: awardId, status: 'ACTIVE', version: 1, idempotent: false })
  assert.ok(writes.some(item => item.sql.includes('INSERT INTO mip_user_badges')))
  assert.ok(writes.some(item => item.sql.includes('INSERT INTO mip_audit_logs')))
})

test('blocks catalog deactivation while any user is wearing the badge', async () => {
  let mutated = false
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users') && sql.includes('FOR UPDATE')) return { id: actorUserId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) {
        return { scope_type: 'PLATFORM', scope_id: '00000000-0000-0000-0000-000000000000', role_key: 'PLATFORM_OPERATIONS', status: 'ACTIVE' }
      }
      if (sql.includes('FROM mip_badges')) return { id: badgeId, status: 'ACTIVE', version: 4 }
      if (sql.includes('FROM mip_user_badge_equipment')) return { total: 1 }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query() {
      mutated = true
      return { affectedRows: 1 }
    },
  }
  const repository = createBadgeAdminRepository({ transaction: work => work(tx) })
  await assert.rejects(() => repository.saveBadge({
    appId,
    actorUserId,
    badgeId,
    expectedVersion: 4,
    draft: {
      key: 'event_participant',
      name: '活动参与',
      description: '',
      iconName: '',
      imageUrl: '',
      placeholderShape: 'CIRCLE',
      sortOrder: 20,
      status: 'INACTIVE',
    },
    authorization: authorization(),
    audit: () => ({}),
  }), /BADGE_IN_USE/)
  assert.equal(mutated, false)
})
