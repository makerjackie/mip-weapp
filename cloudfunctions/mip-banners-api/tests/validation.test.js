'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  MINIPROGRAM_PATH_ALLOWLIST,
  assertBannerAsset,
  normalizeArticleUrl,
  normalizeBannerDraft,
  normalizeMiniprogramPath,
} = require('../domain/validation')

const asset = {
  id: '10000000-0000-4000-8000-000000000001',
  owner_user_id: '20000000-0000-4000-8000-000000000001',
  purpose: 'BANNER',
  cloud_file_id: 'cloud://env/mip/development/app/banner/image.jpg',
  content_type: 'image/jpeg',
  width_px: 1500,
  height_px: 600,
  status: 'READY',
}

test('allows only repository-owned absolute mini-program routes', () => {
  assert.equal(normalizeMiniprogramPath('/pages/events/index'), '/pages/events/index')
  assert.equal(
    normalizeMiniprogramPath('/packages/member/mip-events/detail/index?eventId=30000000-0000-4000-8000-000000000001'),
    '/packages/member/mip-events/detail/index?eventId=30000000-0000-4000-8000-000000000001',
  )
  assert.equal(
    normalizeMiniprogramPath('/packages/member/mip-tasks/detail/index?taskId=30000000-0000-4000-8000-000000000001'),
    '/packages/member/mip-tasks/detail/index?taskId=30000000-0000-4000-8000-000000000001',
  )
  assert.equal(normalizeMiniprogramPath('/packages/member/mip-game/index'), '/packages/member/mip-game/index')
  assert.equal(
    normalizeMiniprogramPath('/packages/member/mip-game/team/index?teamId=30000000-0000-4000-8000-000000000001'),
    '/packages/member/mip-game/team/index?teamId=30000000-0000-4000-8000-000000000001',
  )
  assert.ok(Object.keys(MINIPROGRAM_PATH_ALLOWLIST).every(path => path.startsWith('/')))
  assert.throws(() => normalizeMiniprogramPath('/packages/admin/dashboard/index'), /TARGET_INVALID/)
  assert.throws(() => normalizeMiniprogramPath('/pages/events/index?next=%2Fpackages%2Fadmin'), /TARGET_INVALID/)
  assert.throws(
    () => normalizeMiniprogramPath('/packages/member/mip-events/detail/index?eventId=not-a-uuid'),
    /TARGET_INVALID/,
  )
})

test('keeps every allowlisted mini-program route inside the current app manifest', () => {
  const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../src/app.json'), 'utf8'))
  const routes = new Set([
    ...app.pages,
    ...app.subPackages.flatMap(item => item.pages.map(page => `${item.root}/${page}`)),
  ])
  for (const route of Object.keys(MINIPROGRAM_PATH_ALLOWLIST)) {
    assert.equal(routes.has(route.slice(1)), true, `${route} is not declared by src/app.json`)
  }
})

test('allows WeChat HTTPS articles and rejects other web targets', () => {
  assert.equal(
    normalizeArticleUrl('https://mp.weixin.qq.com/s/DeJ38RyOILq5hPAz5jrVUQ'),
    'https://mp.weixin.qq.com/s/DeJ38RyOILq5hPAz5jrVUQ',
  )
  assert.throws(() => normalizeArticleUrl('http://mp.weixin.qq.com/s/article'), /TARGET_INVALID/)
  assert.throws(() => normalizeArticleUrl('https://example.com/article'), /TARGET_INVALID/)
  assert.throws(() => normalizeArticleUrl('https://mp.weixin.qq.com/s/article#fragment'), /TARGET_INVALID/)
})

test('normalizes a complete Banner draft', () => {
  assert.deepEqual(normalizeBannerDraft({
    title: ' 活动主页头图 ',
    accessibilityLabel: ' 活动报名信息 ',
    imageAssetId: asset.id,
    targetType: 'article_url',
    targetValue: 'https://mp.weixin.qq.com/s/article',
  }), {
    title: '活动主页头图',
    accessibilityLabel: '活动报名信息',
    imageAssetId: asset.id,
    targetType: 'ARTICLE_URL',
    targetValue: 'https://mp.weixin.qq.com/s/article',
  })
})

test('requires owned READY BANNER media with the production dimensions', () => {
  assert.deepEqual(assertBannerAsset(asset, { actorUserId: asset.owner_user_id }), {
    width: 1500,
    height: 600,
  })
  assert.throws(() => assertBannerAsset({ ...asset, purpose: 'EVENT_COVER' }), /IMAGE_ASSET_INVALID/)
  assert.throws(() => assertBannerAsset({ ...asset, status: 'PENDING' }), /IMAGE_ASSET_INVALID/)
  assert.throws(() => assertBannerAsset({ ...asset, owner_user_id: null }), /IMAGE_ASSET_INVALID/)
  assert.throws(() => assertBannerAsset({
    ...asset,
    owner_user_id: '20000000-0000-4000-8000-000000000002',
  }, {
    actorUserId: asset.owner_user_id,
  }), /IMAGE_NOT_OWNED/)
  assert.throws(() => assertBannerAsset({ ...asset, width_px: 749 }), /IMAGE_DIMENSIONS_INVALID/)
  assert.throws(() => assertBannerAsset({ ...asset, width_px: 1500, height_px: 900 }), /IMAGE_DIMENSIONS_INVALID/)
})
