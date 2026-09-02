import type { MipBannerMediaUploadRequest } from '../src/modules/mip-banners/media-port'
import type {
  MipBannerGateway,
  MipBannerMediaPort,
  MipBannerRequest,
} from '../src/modules/mip-banners/types'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseAdminBanner,
  parsePublicBannerList,
} from '../src/modules/mip-banners/contracts'
import { createMipBannerGateway } from '../src/modules/mip-banners/gateway'
import { createMipBannerMediaPort } from '../src/modules/mip-banners/media-port'
import { createMipBannerModule } from '../src/modules/mip-banners/module'
import { isRetryableBannerAction } from '../src/modules/mip-banners/retry-policy'
import { MipBannerError } from '../src/modules/mip-banners/types'

const publicBanner = {
  id: '10000000-0000-4000-8000-000000000001',
  title: '活动主页头图',
  accessibilityLabel: '活动报名信息',
  imageUrl: '/tmp/banner.jpg',
  targetType: 'MINIPROGRAM_PATH',
  targetValue: '/pages/events/index',
  sortOrder: 10,
} as const

const adminBanner = {
  ...publicBanner,
  imageAssetId: '20000000-0000-4000-8000-000000000001',
  imageWidth: 1500,
  imageHeight: 600,
  imageStatus: 'READY',
  status: 'INACTIVE',
  version: 2,
  activatedAt: '',
  deletedAt: '',
  updatedAt: '2026-08-24T02:00:00.000Z',
} as const

const uploadedBanner = {
  assetId: '30000000-0000-4000-8000-000000000001',
  purpose: 'BANNER',
  imageUrl: '/tmp/uploaded-banner.jpg',
  width: 1500,
  height: 600,
} as const

describe('MIP Banner client contracts', () => {
  it('parses public and admin DTOs without accepting extra server fields', () => {
    expect(parsePublicBannerList([publicBanner])).toEqual([publicBanner])
    expect(parseAdminBanner(adminBanner)).toEqual(adminBanner)
    expect(() => parseAdminBanner({ ...adminBanner, ownerUserId: 'must-not-leak' }))
      .toThrow('无效的Banner 信息')
  })

  it('routes public reads and capability-protected admin writes to the independent API', async () => {
    const bannerCalls: MipBannerRequest[] = []
    const mediaCalls: MipBannerMediaUploadRequest[] = []
    const gateway = createMipBannerGateway({
      async invoke(request) {
        bannerCalls.push(request)
        if (request.action === 'mip.banners.listActive') {
          return { ok: true, data: [publicBanner] }
        }
        return { ok: true, data: adminBanner }
      },
    })
    const mediaPort = createMipBannerMediaPort({
      async invoke(request) {
        mediaCalls.push(request)
        return { ok: true, data: uploadedBanner }
      },
    })
    await expect(gateway.listActive()).resolves.toEqual([publicBanner])
    await expect(gateway.changeStatus(adminBanner.id, 2, 'ACTIVE')).resolves.toEqual(adminBanner)
    await expect(mediaPort.uploadBannerImage('AAAA')).resolves.toEqual({
      assetId: uploadedBanner.assetId,
      imageUrl: uploadedBanner.imageUrl,
      width: uploadedBanner.width,
      height: uploadedBanner.height,
    })
    expect(bannerCalls).toEqual([
      { contractVersion: 1, action: 'mip.banners.listActive', input: {} },
      {
        contractVersion: 1,
        action: 'mip.banners.admin.changeStatus',
        input: { bannerId: adminBanner.id, expectedVersion: 2, status: 'ACTIVE' },
      },
    ])
    expect(mediaCalls).toEqual([{
      action: 'uploadImage',
      purpose: 'BANNER',
      imageBase64: 'AAAA',
    }])
  })

  it('keeps Banner requests and the media upload port as separate interfaces', () => {
    const gateway = createMipBannerGateway({ invoke: async () => ({ ok: true, data: [] }) })
    const mediaPort = createMipBannerMediaPort({ invoke: async () => ({ ok: true, data: uploadedBanner }) })
    expect(gateway).not.toHaveProperty('uploadBannerImage')
    expect(mediaPort).not.toHaveProperty('listActive')
  })

  it('retries only the four Banner read actions', () => {
    for (const action of [
      'mip.banners.listActive',
      'mip.banners.admin.session',
      'mip.banners.admin.list',
      'mip.banners.admin.get',
    ] as const) {
      expect(isRetryableBannerAction(action), action).toBe(true)
    }
    for (const action of [
      'mip.banners.admin.save',
      'mip.banners.admin.changeStatus',
      'mip.banners.admin.move',
      'mip.banners.admin.delete',
    ] as const) {
      expect(isRetryableBannerAction(action), action).toBe(false)
    }
  })

  it('invalidates active, admin list and detail after every successful Banner mutation', async () => {
    const reads = { active: 0, detail: 0, list: 0, session: 0 }
    const gateway = {
      async listActive() {
        reads.active += 1
        return [publicBanner]
      },
      async getAdminSession() {
        reads.session += 1
        return { capability: 'banners.manage', roleKey: 'PLATFORM_OWNER' }
      },
      async listAdmin() {
        reads.list += 1
        return { items: [adminBanner], truncated: false }
      },
      async getAdmin() {
        reads.detail += 1
        return adminBanner
      },
      async saveAdmin() { return adminBanner },
      async changeStatus() { return adminBanner },
      async move() { return { items: [adminBanner], truncated: false } },
      async remove() { return { bannerId: adminBanner.id, deleted: true } },
    } as unknown as MipBannerGateway
    const mediaPort: MipBannerMediaPort = {
      async uploadBannerImage() {
        return uploadedBanner
      },
    }
    const module = createMipBannerModule(gateway, mediaPort)
    const readFacts = async () => {
      await module.query.listActive()
      await module.query.getAdminSession()
      await module.query.listAdmin()
      await module.query.getAdmin(adminBanner.id)
    }
    const mutations = [
      () => module.mutation.saveAdmin({
        bannerId: adminBanner.id,
        expectedVersion: adminBanner.version,
        banner: {
          title: adminBanner.title,
          accessibilityLabel: adminBanner.accessibilityLabel,
          imageAssetId: adminBanner.imageAssetId,
          targetType: adminBanner.targetType,
          targetValue: adminBanner.targetValue,
        },
      }),
      () => module.mutation.changeStatus(adminBanner.id, adminBanner.version, 'ACTIVE'),
      () => module.mutation.move(adminBanner.id, adminBanner.version, 'UP'),
      () => module.mutation.remove(adminBanner.id, adminBanner.version),
    ]

    await readFacts()
    await readFacts()
    expect(reads).toEqual({ active: 1, detail: 1, list: 1, session: 1 })
    for (const mutate of mutations) {
      await mutate()
      await readFacts()
    }
    expect(reads).toEqual({
      active: 1 + mutations.length,
      detail: 1 + mutations.length,
      list: 1 + mutations.length,
      session: 1,
    })
  })

  it.each(['CONFLICT', 'FORBIDDEN'] as const)(
    'preserves %s mutation errors without invalidating cached Banner facts',
    async (code) => {
      let reads = 0
      const failure = new MipBannerError(code, `${code} message`, code === 'CONFLICT')
      const gateway = {
        async listActive() {
          reads += 1
          return [publicBanner]
        },
        async saveAdmin() {
          throw failure
        },
      } as unknown as MipBannerGateway
      const mediaPort = {} as MipBannerMediaPort
      const module = createMipBannerModule(gateway, mediaPort)
      const input = {
        banner: {
          title: adminBanner.title,
          accessibilityLabel: adminBanner.accessibilityLabel,
          imageAssetId: adminBanner.imageAssetId,
          targetType: adminBanner.targetType,
          targetValue: adminBanner.targetValue,
        },
      }

      await module.query.listActive()
      await expect(module.mutation.saveAdmin(input)).rejects.toBe(failure)
      await module.query.listActive()
      expect(reads).toBe(1)
    },
  )

  it('preserves service conflict details for page recovery', async () => {
    const gateway = createMipBannerGateway({
      async invoke() {
        return {
          ok: false,
          error: { code: 'CONFLICT', message: 'Banner 状态已变化，请刷新后重试', retryable: true },
        }
      },
    })
    await expect(gateway.getAdmin(publicBanner.id)).rejects.toEqual(expect.objectContaining({
      name: 'MipBannerError',
      code: 'CONFLICT',
      retryable: true,
    }))
  })

  it('keeps page access and media upload behind their dedicated typed interfaces', () => {
    const root = process.cwd()
    const moduleSource = fs.readFileSync(path.join(root, 'src/modules/mip-banners/module.ts'), 'utf8')
    const gatewaySource = fs.readFileSync(path.join(root, 'src/modules/mip-banners/gateway.ts'), 'utf8')
    const mediaSource = fs.readFileSync(path.join(root, 'src/modules/mip-banners/media-port.ts'), 'utf8')
    const cloudbaseSource = fs.readFileSync(path.join(root, 'src/modules/mip-banners/cloudbase-gateway.ts'), 'utf8')

    expect(moduleSource).not.toMatch(/\n\s+gateway,\n/)
    expect(gatewaySource).not.toContain('uploadImage')
    expect(mediaSource).toContain('action: \'uploadImage\'')
    expect(cloudbaseSource).toContain('name: bannerFunctionName, data: request')
    expect(cloudbaseSource).toContain('name: mediaFunctionName, data: request')
    expect(cloudbaseSource).toMatch(/mediaFunctionName[\s\S]*?\{ attempts: 1 \}/)
    expect(fs.existsSync(path.join(root, 'src/modules/mip-banners/function-routing.ts'))).toBe(false)
  })
})
