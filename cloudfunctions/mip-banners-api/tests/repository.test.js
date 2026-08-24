'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createBannerRepository } = require('../domain/repository')

const ids = {
  actor: '10000000-0000-4000-8000-000000000001',
  banner: '20000000-0000-4000-8000-000000000001',
  asset: '30000000-0000-4000-8000-000000000001',
}
const caller = { appId: 'wx-app', userId: ids.actor }

function row(overrides = {}) {
  return {
    id: ids.banner,
    app_id: caller.appId,
    title: '活动主页头图',
    accessibility_label: '活动报名信息',
    image_asset_id: ids.asset,
    target_type: 'MINIPROGRAM_PATH',
    target_value: '/pages/events/index',
    sort_order: 10,
    status: 'ACTIVE',
    version: 3,
    activated_at: new Date('2026-08-24T01:00:00Z'),
    deleted_at: null,
    updated_at: new Date('2026-08-24T02:00:00Z'),
    image_url: 'cloud://env/mip/development/app/banners/image.jpg',
    asset_id: ids.asset,
    asset_owner_user_id: ids.actor,
    asset_purpose: 'BANNER',
    asset_content_type: 'image/jpeg',
    asset_width_px: 1500,
    asset_height_px: 600,
    asset_status: 'READY',
    ...overrides,
  }
}

function media(overrides = {}) {
  return {
    id: ids.asset,
    owner_user_id: ids.actor,
    purpose: 'BANNER',
    cloud_file_id: 'cloud://env/mip/development/app/banners/image.jpg',
    content_type: 'image/jpeg',
    width_px: 1500,
    height_px: 600,
    status: 'READY',
    ...overrides,
  }
}

test('public list is active, ordered and fail-closed for invalid historical targets', async () => {
  const queries = []
  const database = {
    async query(sql, params) {
      queries.push({ sql, params })
      return [row(), row({
        id: '20000000-0000-4000-8000-000000000002',
        target_value: '/packages/admin/dashboard/index',
      })]
    },
  }
  const result = await createBannerRepository(database).listActive(caller.appId)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, ids.banner)
  assert.match(queries[0].sql, /banner\.status = 'ACTIVE'/)
  assert.match(queries[0].sql, /asset\.status = 'READY' AND asset\.purpose = 'BANNER'/)
  assert.match(queries[0].sql, /ORDER BY banner\.sort_order, banner\.id/)
})

test('creates an inactive Banner with owned media and a business audit', async () => {
  const writes = []
  let created = false
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('mip_admin_role_bindings')) return { role_key: 'PLATFORM_OPERATIONS' }
      if (sql.includes('FROM mip_media_assets')) return media()
      if (sql.includes('ORDER BY sort_order DESC')) return { sort_order: 10 }
      if (sql.includes('FROM mip_banners banner')) return row({ status: 'INACTIVE', version: 1, sort_order: 20, activated_at: null })
      throw new Error(`unexpected read: ${sql}`)
    },
    async query(sql, params) {
      writes.push({ sql, params })
      if (sql.includes('INSERT INTO mip_banners')) created = true
      return { affectedRows: 1 }
    },
  }
  const database = { transaction: async work => work(tx) }
  const result = await createBannerRepository(database, { createId: () => ids.banner }).save(caller, {
    banner: {
      title: '活动主页头图',
      accessibilityLabel: '活动报名信息',
      imageAssetId: ids.asset,
      targetType: 'MINIPROGRAM_PATH',
      targetValue: '/pages/events/index',
    },
  })
  assert.equal(created, true)
  assert.equal(result.status, 'INACTIVE')
  assert.ok(writes.some(item => /INSERT INTO mip_audit_logs/.test(item.sql)
    && item.params.includes('admin.banners.create')
    && item.params.includes('PLATFORM_OPERATIONS')))
})

test('activation revalidates media and refuses an invalid purpose', async () => {
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
      if (sql.includes('SELECT * FROM mip_banners')) return row({ status: 'INACTIVE', activated_at: null })
      if (sql.includes('FROM mip_media_assets')) return media({ purpose: 'EVENT_COVER' })
      throw new Error(`unexpected read: ${sql}`)
    },
    async query() {
      throw new Error('must not write')
    },
  }
  const database = { transaction: async work => work(tx) }
  await assert.rejects(
    createBannerRepository(database).changeStatus(caller, {
      bannerId: ids.banner,
      expectedVersion: 3,
      status: 'ACTIVE',
    }),
    /IMAGE_ASSET_INVALID/,
  )
})

test('soft deletion uses optimistic locking and never issues DELETE', async () => {
  const writes = []
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
      if (sql.includes('SELECT * FROM mip_banners')) return row()
      throw new Error(`unexpected read: ${sql}`)
    },
    async query(sql, params) {
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const database = { transaction: async work => work(tx) }
  assert.deepEqual(await createBannerRepository(database).remove(caller, {
    bannerId: ids.banner,
    expectedVersion: 3,
  }), { bannerId: ids.banner, deleted: true })
  assert.ok(writes.some(item => /SET status = 'DELETED', deleted_at = UTC_TIMESTAMP/.test(item.sql)))
  assert.ok(writes.every(item => !/DELETE\s+FROM/i.test(item.sql)))
  assert.ok(writes.some(item => item.params.includes('admin.banners.delete')))
})

test('moves a Banner inside one locked ordering transaction and audits the change', async () => {
  const neighborId = '20000000-0000-4000-8000-000000000002'
  const writes = []
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('mip_admin_role_bindings')) return { role_key: 'PLATFORM_OPERATIONS' }
      throw new Error(`unexpected read: ${sql}`)
    },
    async query(sql, params) {
      if (sql.includes('SELECT id, sort_order, version FROM mip_banners')) {
        return [
          { id: neighborId, sort_order: 0, version: 5 },
          { id: ids.banner, sort_order: 10, version: 3 },
        ]
      }
      if (sql.includes('FROM mip_banners banner')) {
        return [row({ sort_order: 0, version: 4 })]
      }
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const database = { transaction: async work => work(tx) }
  const result = await createBannerRepository(database).move(caller, {
    bannerId: ids.banner,
    expectedVersion: 3,
    direction: 'UP',
  })
  assert.equal(result.items[0].sortOrder, 0)
  assert.ok(writes.some(item => /SET sort_order = \?/.test(item.sql)
    && item.params[0] === 0
    && item.params.includes(ids.banner)))
  assert.ok(writes.some(item => item.params.includes('admin.banners.reorder')
    && item.params.some(value => typeof value === 'string' && value.includes('"direction":"UP"'))))
})

test('rejects stale writes before updating a Banner', async () => {
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
      if (sql.includes('SELECT * FROM mip_banners')) return row({ version: 4 })
      throw new Error(`unexpected read: ${sql}`)
    },
    async query() {
      throw new Error('must not write')
    },
  }
  const database = { transaction: async work => work(tx) }
  await assert.rejects(
    createBannerRepository(database).remove(caller, {
      bannerId: ids.banner,
      expectedVersion: 3,
    }),
    /CONFLICT/,
  )
})

test('write transactions stop when the current user is no longer active', async () => {
  let roleRead = false
  const tx = {
    async one(sql) {
      if (sql.includes('FROM mip_users')) return { status: 'CLOSED' }
      if (sql.includes('mip_admin_role_bindings')) roleRead = true
      return null
    },
    async query() { throw new Error('must not write') },
  }
  const database = { transaction: async work => work(tx) }
  await assert.rejects(
    createBannerRepository(database).remove(caller, {
      bannerId: ids.banner,
      expectedVersion: 3,
    }),
    /FORBIDDEN/,
  )
  assert.equal(roleRead, false)
})
