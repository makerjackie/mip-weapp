import type { AdminEventCatalogItem, AdminEventVideoRecap } from '../src/modules/mip-admin/event-catalogs'
import type { AdminTransport } from '../src/modules/mip-admin/transport'
import type { MipAdminGateway } from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import { readActions } from '../src/modules/mip-admin/cloudbase-transport'
import {

  parseAdminEventCatalogItem,
  parseAdminEventCatalogPage,
  parseAdminEventVideoRecap,
  parseAdminEventVideoRecapPage,
} from '../src/modules/mip-admin/event-catalogs'
import { MipAdminError } from '../src/modules/mip-admin/types'

vi.mock('../src/platform/cloudbase/client', () => ({ requireCloudClient: vi.fn() }))
vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const catalog: AdminEventCatalogItem = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'TYPE',
  key: 'workshop',
  name: '工作坊',
  description: '互动活动',
  sortOrder: 10,
  status: 'ACTIVE',
  usageCount: 3,
  version: 2,
  archivedAt: null,
  createdAt: '2030-08-20T08:00:00.000Z',
  updatedAt: '2030-08-26T08:00:00.000Z',
}

const recap: AdminEventVideoRecap = {
  id: '22222222-2222-4222-8222-222222222222',
  eventId: '33333333-3333-4333-8333-333333333333',
  eventTitle: '城市交流会',
  title: '活动视频回顾',
  summary: '活动内容摘要',
  destination: {
    provider: 'WECHAT_CHANNELS',
    type: 'ACTIVITY',
    finderUserName: 'sph6Rngt56a0grn',
    feedId: 'feed-token',
  },
  sortOrder: 10,
  status: 'INACTIVE',
  version: 4,
  activatedAt: null,
  archivedAt: null,
  createdAt: '2030-08-20T08:00:00.000Z',
  updatedAt: '2030-08-26T08:00:00.000Z',
}

describe('MIP event catalog admin contract', () => {
  it('strictly parses exact public DTOs and destination pairings', () => {
    expect(parseAdminEventCatalogItem(catalog)).toEqual(catalog)
    expect(parseAdminEventCatalogPage({ items: [catalog], nextCursor: null }).items).toEqual([catalog])
    expect(parseAdminEventVideoRecap(recap)).toEqual(recap)
    expect(parseAdminEventVideoRecapPage({ items: [recap], nextCursor: null }).items).toEqual([recap])
    expect(parseAdminEventVideoRecap({
      ...recap,
      destination: { ...recap.destination, finderUserName: `sph${'a'.repeat(125)}` },
    }).destination.finderUserName).toHaveLength(128)

    expect(() => parseAdminEventCatalogItem({ ...catalog, createdByUserId: 'private-user' })).toThrow()
    expect(() => parseAdminEventCatalogItem({ ...catalog, key: '<script>' })).toThrow()
    expect(() => parseAdminEventCatalogItem({
      ...catalog,
      status: 'ARCHIVED',
      archivedAt: null,
    })).toThrow()
    expect(() => parseAdminEventVideoRecap({
      ...recap,
      destination: { ...recap.destination, type: 'PROFILE', feedId: 'feed-token' },
    })).toThrow()
    expect(() => parseAdminEventVideoRecap({
      ...recap,
      destination: { ...recap.destination, finderUserName: 'finder with spaces' },
    })).toThrow()
    for (const finderUserName of [
      'sph',
      'finder6Rngt56a0grn',
      'https://channels.weixin.qq.com/sph6Rngt56a0grn',
      `sph${'a'.repeat(126)}`,
    ]) {
      expect(() => parseAdminEventVideoRecap({
        ...recap,
        destination: { ...recap.destination, finderUserName },
      })).toThrow()
    }
    expect(() => parseAdminEventVideoRecap({ ...recap, updatedByUserId: 'private-user' })).toThrow()
  })

  it('uses the neutral v1 envelope for exactly nine catalog and recap actions', async () => {
    const requests: Array<Record<string, unknown>> = []
    const transport: AdminTransport = {
      async request(request) {
        requests.push(structuredClone(request) as unknown as Record<string, unknown>)
        if (request.action === 'mip.admin.events.catalog.list') {
          return { items: [catalog], nextCursor: null } as never
        }
        if (request.action.startsWith('mip.admin.events.catalog.')) {
          return request.action.endsWith('.archive')
            ? { ...catalog, status: 'ARCHIVED', version: 3, archivedAt: '2030-08-26T09:00:00.000Z' } as never
            : catalog as never
        }
        if (request.action === 'mip.admin.events.recaps.list') {
          return { items: [recap], nextCursor: null } as never
        }
        if (request.action.endsWith('.changeStatus')) {
          return { ...recap, status: 'ACTIVE', version: 5, activatedAt: '2030-08-26T09:00:00.000Z' } as never
        }
        if (request.action.endsWith('.archive')) {
          return { ...recap, status: 'ARCHIVED', version: 5, archivedAt: '2030-08-26T09:00:00.000Z' } as never
        }
        return recap as never
      },
    }
    const gateway = createMipAdminGateway(transport)

    await gateway.listEventCatalogs({ kind: 'TYPE', status: 'ACTIVE', limit: 25 })
    await gateway.saveEventCatalog({
      kind: 'TYPE',
      key: 'roundtable',
      name: '圆桌交流',
      description: '',
      sortOrder: 20,
    })
    await gateway.changeEventCatalogStatus({
      kind: 'TYPE',
      catalogId: catalog.id,
      expectedVersion: 2,
      status: 'INACTIVE',
    })
    await gateway.archiveEventCatalog({
      kind: 'TYPE',
      catalogId: catalog.id,
      expectedVersion: 2,
      reason: '停止使用',
    })
    await gateway.listEventVideoRecaps({ eventId: recap.eventId, status: 'INACTIVE' })
    await gateway.getEventVideoRecap(recap.id)
    await gateway.saveEventVideoRecap({
      eventId: recap.eventId,
      title: recap.title,
      summary: recap.summary,
      destination: recap.destination,
      sortOrder: recap.sortOrder,
    })
    await gateway.changeEventVideoRecapStatus({
      recapId: recap.id,
      expectedVersion: 4,
      status: 'ACTIVE',
    })
    await gateway.archiveEventVideoRecap({
      recapId: recap.id,
      expectedVersion: 4,
      reason: '停止展示',
    })

    expect(requests.map(request => request.action)).toEqual([
      'mip.admin.events.catalog.list',
      'mip.admin.events.catalog.save',
      'mip.admin.events.catalog.changeStatus',
      'mip.admin.events.catalog.archive',
      'mip.admin.events.recaps.list',
      'mip.admin.events.recaps.get',
      'mip.admin.events.recaps.save',
      'mip.admin.events.recaps.changeStatus',
      'mip.admin.events.recaps.archive',
    ])
    for (const request of requests) {
      expect(Object.keys(request).sort()).toEqual(['action', 'contractVersion', 'input'])
      expect(request.contractVersion).toBe(1)
      expect(request.input).toEqual(expect.any(Object))
    }
    expect(requests[0]?.input).toEqual({ kind: 'TYPE', status: 'ACTIVE', limit: 25 })
    expect(requests[5]?.input).toEqual({ recapId: recap.id })
    expect(requests[6]?.input).toEqual({
      eventId: recap.eventId,
      title: recap.title,
      summary: recap.summary,
      destination: recap.destination,
      sortOrder: recap.sortOrder,
    })
    expect((requests[6]?.input as { destination: { finderUserName: string } })
      .destination.finderUserName).toBe('sph6Rngt56a0grn')
    expect(requests[8]?.input).toEqual({
      recapId: recap.id,
      expectedVersion: 4,
      reason: '停止展示',
    })
  })

  it('rejects non-sph video account ids before sending a recap save request', async () => {
    const request = vi.fn<AdminTransport['request']>()
    const gateway = createMipAdminGateway({ request })

    for (const finderUserName of [
      'sph',
      'finder6Rngt56a0grn',
      'https://channels.weixin.qq.com/sph6Rngt56a0grn',
      `sph${'a'.repeat(126)}`,
    ]) {
      await expect(gateway.saveEventVideoRecap({
        eventId: recap.eventId,
        title: recap.title,
        summary: recap.summary,
        destination: { ...recap.destination, finderUserName },
        sortOrder: recap.sortOrder,
      })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('retries only reads declared by the generated contract', () => {
    for (const action of [
      'mip.admin.events.catalog.list',
      'mip.admin.events.recaps.list',
      'mip.admin.events.recaps.get',
    ]) { expect(readActions.has(action)).toBe(true) }
    for (const action of [
      'mip.admin.events.catalog.save',
      'mip.admin.events.catalog.changeStatus',
      'mip.admin.events.catalog.archive',
      'mip.admin.events.recaps.save',
      'mip.admin.events.recaps.changeStatus',
      'mip.admin.events.recaps.archive',
    ]) { expect(readActions.has(action)).toBe(false) }
  })

  it('caches reads and invalidates the matching deep module only after successful mutations', async () => {
    const failure = new MipAdminError('FORBIDDEN', '当前账号不能归档视频回顾')
    const spies = {
      listEventCatalogs: vi.fn<MipAdminGateway['listEventCatalogs']>(async () => ({
        items: [catalog],
        nextCursor: null,
      })),
      saveEventCatalog: vi.fn<MipAdminGateway['saveEventCatalog']>(async () => catalog),
      listEventVideoRecaps: vi.fn<MipAdminGateway['listEventVideoRecaps']>(async () => ({
        items: [recap],
        nextCursor: null,
      })),
      getEventVideoRecap: vi.fn<MipAdminGateway['getEventVideoRecap']>(async () => recap),
      saveEventVideoRecap: vi.fn<MipAdminGateway['saveEventVideoRecap']>(async () => recap),
      archiveEventVideoRecap: vi.fn<MipAdminGateway['archiveEventVideoRecap']>(async () => {
        throw failure
      }),
    }
    const module = createMipAdminModule(spies as unknown as MipAdminGateway)

    await module.eventCatalogs.listCatalogs({ kind: 'TYPE' })
    await module.eventCatalogs.listCatalogs({ kind: 'TYPE' })
    await module.eventCatalogs.getRecap(recap.id)
    await module.eventCatalogs.getRecap(recap.id)
    expect(spies.listEventCatalogs).toHaveBeenCalledTimes(1)
    expect(spies.getEventVideoRecap).toHaveBeenCalledTimes(1)

    await module.eventCatalogs.saveCatalog({
      kind: 'TYPE',
      key: 'roundtable',
      name: '圆桌交流',
      description: '',
      sortOrder: 20,
    })
    await module.eventCatalogs.listCatalogs({ kind: 'TYPE' })
    await module.eventCatalogs.getRecap(recap.id)
    expect(spies.listEventCatalogs).toHaveBeenCalledTimes(2)
    expect(spies.getEventVideoRecap).toHaveBeenCalledTimes(1)

    await module.eventCatalogs.saveRecap({
      eventId: recap.eventId,
      title: recap.title,
      summary: recap.summary,
      destination: recap.destination,
      sortOrder: recap.sortOrder,
    })
    await module.eventCatalogs.getRecap(recap.id)
    expect(spies.getEventVideoRecap).toHaveBeenCalledTimes(2)

    await expect(module.eventCatalogs.archiveRecap({
      recapId: recap.id,
      expectedVersion: 4,
      reason: '停止展示',
    })).rejects.toBe(failure)
    await module.eventCatalogs.getRecap(recap.id)
    expect(spies.getEventVideoRecap).toHaveBeenCalledTimes(2)
  })
})
