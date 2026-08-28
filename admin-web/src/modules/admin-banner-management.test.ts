import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AdminRequest } from './admin-read-contracts.ts'
import {
  ADMIN_BANNER_MUTATION_ACTIONS,
  ADMIN_BANNER_QUERY_ACTIONS,
  buildBannerMutationInput,
  createBannerMutationDefinition,
  loadBannerDetail,
  loadBannerManagementPage,
  webBannerImageUrl,
} from './admin-banner-management.ts'

const BANNER_ID = '10000000-0000-4000-8000-000000000001'
const ASSET_ID = '20000000-0000-4000-8000-000000000002'

function requestWith(responses: Record<string, unknown>, calls: Array<{ action: string; input: unknown }>): AdminRequest {
  return async <T>(action: string, input = {}) => {
    calls.push({ action, input })
    return responses[action] as T
  }
}

const banner = {
  id: BANNER_ID,
  title: '活动首页 Banner',
  accessibilityLabel: '查看本周活动',
  imageAssetId: ASSET_ID,
  imageUrl: 'cloud://env.mip/banner.jpg',
  imageWidth: 1500,
  imageHeight: 600,
  imageStatus: 'READY',
  targetType: 'MINIPROGRAM_PATH',
  targetValue: '/pages/events/index',
  sortOrder: 10,
  status: 'INACTIVE',
  version: 3,
  activatedAt: '',
  updatedAt: '2030-03-01T00:00:00.000Z',
}

describe('admin Banner management', () => {
  it('loads the exact Banner list query and preserves image facts without a forged preview URL', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadBannerManagementPage({
      query: '活动', status: 'INACTIVE', cursor: null, limit: 20,
    }, requestWith({
      'mip.admin.banners.session': { capability: 'banners.manage', roleKey: 'PLATFORM_OPERATIONS' },
      'mip.admin.banners.list': { items: [banner], truncated: true },
    }, calls))

    assert.deepEqual(ADMIN_BANNER_QUERY_ACTIONS, [
      'mip.admin.banners.session', 'mip.admin.banners.list', 'mip.admin.banners.get',
    ])
    assert.deepEqual(calls, [
      { action: 'mip.admin.banners.session', input: {} },
      {
        action: 'mip.admin.banners.list',
        input: { filters: { query: '活动', status: 'INACTIVE' } },
      },
    ])
    assert.equal(page.sections[0].detailTarget, 'banners')
    assert.equal(page.sections[0].rows[0].image, '素材就绪，浏览器暂不可预览')
    assert.equal(page.sections[0].rows[0].imageAssetId, ASSET_ID)
    assert.equal(page.nextCursor, null)
    assert.deepEqual(page.summary, [{ label: '列表状态', value: '仅显示前 100 条' }])
  })

  it('loads Banner details with an explicit browser upload boundary', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const detail = await loadBannerDetail(BANNER_ID, requestWith({
      'mip.admin.banners.get': banner,
    }, calls))

    assert.deepEqual(calls, [{ action: 'mip.admin.banners.get', input: { bannerId: BANNER_ID } }])
    assert.equal(detail.route, 'banners')
    assert.equal(detail.status, '停用')
    const imageFields = detail.sections.find(section => section.title === 'Banner 图片')?.fields
    assert.equal(imageFields?.find(field => field.label === '素材 ID')?.value, ASSET_ID)
    assert.equal(imageFields?.find(field => field.label === '当前 imageUrl')?.value, banner.imageUrl)
    assert.equal(imageFields?.find(field => field.label === '素材更新')?.value, '可从素材上传页获取新的素材 ID')
    assert.equal(webBannerImageUrl(banner.imageUrl), '')
    assert.equal(webBannerImageUrl('https://cdn.example.test/banner.jpg'), 'https://cdn.example.test/banner.jpg')
  })

  it('builds exact typed inputs for create, edit, status, move, and soft delete', () => {
    assert.equal(ADMIN_BANNER_MUTATION_ACTIONS.length, 4)
    const source = { banner }
    const create = createBannerMutationDefinition('mip.admin.banners.save')
    const createValues = {
      ...create.values,
      title: '活动首页 Banner',
      accessibilityLabel: '查看本周活动',
      imageAssetId: ASSET_ID,
    }
    assert.deepEqual(buildBannerMutationInput(create, createValues), {
      banner: {
        title: '活动首页 Banner',
        accessibilityLabel: '查看本周活动',
        imageAssetId: ASSET_ID,
        targetType: 'MINIPROGRAM_PATH',
        targetValue: '/pages/events/index',
      },
    })

    const edit = createBannerMutationDefinition('mip.admin.banners.save', BANNER_ID, source)
    assert.match(edit.description, /素材上传页上传 Banner 图片/)
    assert.deepEqual(buildBannerMutationInput(edit, edit.values), {
      bannerId: BANNER_ID,
      expectedVersion: 3,
      banner: {
        title: banner.title,
        accessibilityLabel: banner.accessibilityLabel,
        imageAssetId: ASSET_ID,
        targetType: 'MINIPROGRAM_PATH',
        targetValue: '/pages/events/index',
      },
    })

    const status = createBannerMutationDefinition('mip.admin.banners.changeStatus', BANNER_ID, source)
    const move = createBannerMutationDefinition('mip.admin.banners.move', BANNER_ID, source)
    const remove = createBannerMutationDefinition('mip.admin.banners.delete', BANNER_ID, source)
    assert.deepEqual(buildBannerMutationInput(status, status.values), {
      bannerId: BANNER_ID, expectedVersion: 3, status: 'ACTIVE',
    })
    assert.deepEqual(buildBannerMutationInput(move, { ...move.values, direction: 'DOWN' }), {
      bannerId: BANNER_ID, expectedVersion: 3, direction: 'DOWN',
    })
    assert.deepEqual(buildBannerMutationInput(remove, remove.values), {
      bannerId: BANNER_ID, expectedVersion: 3,
    })
  })
})
