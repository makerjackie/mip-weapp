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

test('creates a badge with acquire condition, category, and an owned uploaded artwork', async () => {
  const writes = []
  const assetId = '50000000-0000-4000-8000-000000000001'
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users') && sql.includes('FOR UPDATE')) return { id: actorUserId, status: 'ACTIVE' }
      if (sql.includes('FROM mip_admin_role_bindings')) {
        return { scope_type: 'PLATFORM', scope_id: '00000000-0000-0000-0000-000000000000', role_key: 'PLATFORM_OPERATIONS', status: 'ACTIVE' }
      }
      if (sql.includes('FROM mip_media_assets')) {
        return { id: assetId, owner_user_id: actorUserId, purpose: 'BADGE_IMAGE', status: 'READY', content_type: 'image/png', cloud_file_id: 'cloud://env.mip/badge.png' }
      }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql, params) {
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const repository = createBadgeAdminRepository(
    { transaction: work => work(tx) },
    { createId: () => badgeId },
  )
  const result = await repository.saveBadge({
    appId,
    actorUserId,
    draft: {
      key: 'honor_volunteer',
      name: '荣誉志愿者',
      description: '年度志愿服务',
      acquireCondition: '由运营人工授予年度志愿者',
      category: 'HONOR',
      iconName: '',
      imageUrl: '',
      imageAssetId: assetId,
      placeholderShape: 'CIRCLE',
      sortOrder: 30,
      status: 'ACTIVE',
    },
    authorization: authorization(),
    audit: () => ({}),
  })
  assert.deepEqual(result, { id: badgeId, version: 1 })
  const insert = writes.find(item => item.sql.includes('INSERT INTO mip_badges'))
  assert.ok(insert, 'badge insert missing')
  assert.ok(insert.sql.includes('acquire_condition'))
  assert.ok(insert.sql.includes('image_asset_id'))
  assert.equal(insert.params[5], '由运营人工授予年度志愿者')
  assert.equal(insert.params[6], 'HONOR')
  assert.equal(insert.params[9], assetId)
})

test('rejects artwork assets that are not ready badge uploads or owned by someone else', async () => {
  const assetId = '50000000-0000-4000-8000-000000000002'
  const draft = {
    key: 'honor_volunteer',
    name: '荣誉志愿者',
    description: '',
    acquireCondition: '',
    category: 'HONOR',
    iconName: '',
    imageUrl: '',
    imageAssetId: assetId,
    placeholderShape: 'CIRCLE',
    sortOrder: 30,
    status: 'DRAFT',
  }
  const buildRepository = asset => createBadgeAdminRepository({
    transaction: work => work({
      async one(sql) {
        if (sql.includes('FROM mip_users') && sql.includes('FOR UPDATE')) return { id: actorUserId, status: 'ACTIVE' }
        if (sql.includes('FROM mip_admin_role_bindings')) {
          return { scope_type: 'PLATFORM', scope_id: '00000000-0000-0000-0000-000000000000', role_key: 'PLATFORM_OPERATIONS', status: 'ACTIVE' }
        }
        if (sql.includes('FROM mip_media_assets')) return asset
        throw new Error(`unexpected one: ${sql}`)
      },
      async query() { throw new Error('must not write') },
    }),
  })
  const input = { appId, actorUserId, draft, authorization: authorization(), audit: () => ({}) }
  await assert.rejects(() => buildRepository(null).saveBadge(input), /IMAGE_ASSET_INVALID/)
  await assert.rejects(() => buildRepository({
    id: assetId, owner_user_id: actorUserId, purpose: 'BANNER', status: 'READY', content_type: 'image/png', cloud_file_id: 'cloud://env.mip/banner.png',
  }).saveBadge(input), /IMAGE_ASSET_INVALID/)
  await assert.rejects(() => buildRepository({
    id: assetId, owner_user_id: '60000000-0000-4000-8000-000000000009', purpose: 'BADGE_IMAGE', status: 'READY', content_type: 'image/png', cloud_file_id: 'cloud://env.mip/badge.png',
  }).saveBadge(input), /IMAGE_NOT_OWNED/)
})

test('lists badges with the resolved artwork preview alongside the raw fallback URL', async () => {
  const database = {
    async query(sql, params) {
      assert.equal(params[0], appId)
      assert.match(sql, /LEFT JOIN mip_media_assets asset/)
      assert.match(sql, /asset\.status = 'READY'/)
      assert.match(sql, /COALESCE\(NULLIF\(asset\.cloud_file_id, ''\), badge\.image_url\) AS image_preview_url/)
      return [{
        id: badgeId,
        badge_key: 'honor_volunteer',
        name: '荣誉志愿者',
        description: '年度志愿服务',
        acquire_condition: '由运营人工授予年度志愿者',
        category: 'HONOR',
        icon_name: '',
        image_url: '',
        image_asset_id: '50000000-0000-4000-8000-000000000001',
        image_preview_url: 'cloud://env.mip/badge.png',
        placeholder_shape: 'CIRCLE',
        sort_order: 30,
        status: 'ACTIVE',
        version: 1,
        created_at: '2026-10-05T00:00:00.000Z',
        updated_at: '2026-10-05T00:00:00.000Z',
      }]
    },
  }
  const [badge] = await createBadgeAdminRepository(database).listBadges(appId)
  assert.equal(badge.imageUrl, '')
  assert.equal(badge.imageAssetId, '50000000-0000-4000-8000-000000000001')
  assert.equal(badge.imagePreviewUrl, 'cloud://env.mip/badge.png')
  assert.equal(badge.category, 'HONOR')
  assert.equal(badge.acquireCondition, '由运营人工授予年度志愿者')
})
