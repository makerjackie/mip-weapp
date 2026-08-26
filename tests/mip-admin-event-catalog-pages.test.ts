import type {
  AdminEventCatalogItem,
  AdminEventVideoRecap,
} from '../src/modules/mip-admin'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  eventCatalogDraftError,
  eventCatalogView,
  hasPlatformCatalogCapability,
} from '../src/packages/admin/event-catalogs/model'
import {
  eventVideoRecapDraftError,
  eventVideoRecapView,
  hasPlatformRecapCapability,
} from '../src/packages/admin/event-recaps/model'

const adminMocks = vi.hoisted(() => {
  class MipAdminError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
  return {
    MipAdminError,
    getSession: vi.fn(),
    listCatalogs: vi.fn(),
    saveCatalog: vi.fn(),
    changeCatalogStatus: vi.fn(),
    archiveCatalog: vi.fn(),
    listEvents: vi.fn(),
    listRecaps: vi.fn(),
    saveRecap: vi.fn(),
    changeRecapStatus: vi.fn(),
    archiveRecap: vi.fn(),
  }
})

vi.mock('../src/modules/mip-admin', () => ({
  MipAdminError: adminMocks.MipAdminError,
  mipAdminModule: {
    getSession: adminMocks.getSession,
    eventCatalogs: {
      listCatalogs: adminMocks.listCatalogs,
      saveCatalog: adminMocks.saveCatalog,
      changeCatalogStatus: adminMocks.changeCatalogStatus,
      archiveCatalog: adminMocks.archiveCatalog,
      listRecaps: adminMocks.listRecaps,
      saveRecap: adminMocks.saveRecap,
      changeRecapStatus: adminMocks.changeRecapStatus,
      archiveRecap: adminMocks.archiveRecap,
    },
    events: {
      list: adminMocks.listEvents,
    },
  },
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

const pageDefinitions: PageDefinition[] = []
let catalogDefinition: PageDefinition
let recapDefinition: PageDefinition

function createPage(definition: PageDefinition, overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown> | void
}

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

const catalogGrant = {
  capability: 'events.catalog.manage' as const,
  scopeType: 'PLATFORM' as const,
  scopeId: null,
}
const recapGrant = {
  capability: 'events.recaps.manage' as const,
  scopeType: 'PLATFORM' as const,
  scopeId: null,
}
const eventReadGrant = {
  capability: 'events.read' as const,
  scopeType: 'PLATFORM' as const,
  scopeId: null,
}
const eventOption = {
  id: recap.eventId,
  title: recap.eventTitle,
  status: 'PUBLISHED' as const,
  startsAt: '2030-09-01T11:00:00.000Z',
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    showModal: vi.fn(),
    showToast: vi.fn(),
  })
  vi.stubGlobal('Page', (definition: PageDefinition) => {
    pageDefinitions.push(definition)
  })
  await import('../src/packages/admin/event-catalogs/index')
  await import('../src/packages/admin/event-recaps/index')
  ;[catalogDefinition, recapDefinition] = pageDefinitions
})

beforeEach(() => {
  vi.mocked(wx.showModal).mockReset()
  vi.mocked(wx.showToast).mockReset()
  adminMocks.getSession.mockReset().mockResolvedValue({
    enabled: true,
    capabilities: [catalogGrant, recapGrant, eventReadGrant],
    roles: [],
  })
  adminMocks.listCatalogs.mockReset().mockResolvedValue({ items: [catalog], nextCursor: null })
  adminMocks.saveCatalog.mockReset().mockResolvedValue(catalog)
  adminMocks.changeCatalogStatus.mockReset().mockResolvedValue(catalog)
  adminMocks.archiveCatalog.mockReset().mockResolvedValue(catalog)
  adminMocks.listEvents.mockReset().mockResolvedValue({ items: [eventOption], nextCursor: null })
  adminMocks.listRecaps.mockReset().mockResolvedValue({ items: [recap], nextCursor: null })
  adminMocks.saveRecap.mockReset().mockResolvedValue(recap)
  adminMocks.changeRecapStatus.mockReset().mockResolvedValue(recap)
  adminMocks.archiveRecap.mockReset().mockResolvedValue(recap)
})

describe('MIP admin event catalog and recap pages', () => {
  it('requires the matching platform capability before loading protected data', async () => {
    const branchCatalogGrant = { ...catalogGrant, scopeType: 'BRANCH' as const, scopeId: 'branch-1' }
    expect(hasPlatformCatalogCapability([branchCatalogGrant])).toBe(false)
    expect(hasPlatformRecapCapability([recapGrant])).toBe(true)
    adminMocks.getSession.mockResolvedValue({
      enabled: true,
      capabilities: [branchCatalogGrant],
      roles: [],
    })

    const catalogPage = createPage(catalogDefinition)
    await callPage(catalogPage, 'loadCatalogs')
    expect(catalogPage.data.state).toBe('forbidden')
    expect(adminMocks.listCatalogs).not.toHaveBeenCalled()

    const recapPage = createPage(recapDefinition)
    await callPage(recapPage, 'loadRecaps')
    expect(recapPage.data.state).toBe('forbidden')
    expect(adminMocks.listRecaps).not.toHaveBeenCalled()
  })

  it('keeps submitted catalog filters bound to pagination and validates editor drafts', async () => {
    const second = { ...catalog, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', key: 'roundtable' }
    adminMocks.listCatalogs
      .mockResolvedValueOnce({ items: [catalog], nextCursor: 'catalog-cursor' })
      .mockResolvedValueOnce({ items: [second], nextCursor: null })
    const page = createPage(catalogDefinition, {
      kind: 'TYPE',
      statusFilter: 'ACTIVE',
      appliedQuery: '工作',
    })

    await callPage(page, 'loadCatalogs', true)
    page.data.queryInput = '尚未提交'
    await callPage(page, 'loadCatalogs', false, true)

    expect(adminMocks.listCatalogs).toHaveBeenNthCalledWith(1, {
      kind: 'TYPE',
      status: 'ACTIVE',
      query: '工作',
      cursor: undefined,
      limit: 20,
    }, true)
    expect(adminMocks.listCatalogs).toHaveBeenNthCalledWith(2, {
      kind: 'TYPE',
      status: 'ACTIVE',
      query: '工作',
      cursor: 'catalog-cursor',
      limit: 20,
    }, false)
    expect(page.data.items).toHaveLength(2)
    expect(eventCatalogDraftError({ key: 'bad key', name: '名称', description: '', sortOrder: '0' }, false)).toContain('稳定标识')
    expect(eventCatalogDraftError({ key: 'workshop', name: '名称', description: '', sortOrder: '10' }, false)).toBe('')
  })

  it('submits exact catalog intent and refreshes facts after a version conflict', async () => {
    const page = createPage(catalogDefinition, {
      state: 'ready',
      canManage: true,
      kind: 'TAG',
      editorOpen: true,
      editorKey: 'founder',
      editorName: '创业者',
      editorDescription: '创业主题',
      editorSortOrder: '20',
      items: [eventCatalogView({ ...catalog, kind: 'TAG', key: 'founder' })],
    })
    await callPage(page, 'saveCatalog')
    expect(adminMocks.saveCatalog).toHaveBeenCalledWith({
      kind: 'TAG',
      key: 'founder',
      name: '创业者',
      description: '创业主题',
      sortOrder: 20,
    })
    expect(wx.showToast).toHaveBeenCalledWith({ title: '活动目录已创建', icon: 'success' })

    adminMocks.changeCatalogStatus.mockRejectedValueOnce(new adminMocks.MipAdminError('CONFLICT', '记录版本冲突'))
    page.data.items = [eventCatalogView(catalog)]
    await callPage(page, 'changeStatus', { currentTarget: { dataset: { id: catalog.id } } })
    expect(adminMocks.listCatalogs).toHaveBeenCalled()
    expect(page.data.state).toBe('ready')
    expect(page.data.message).toContain('列表已刷新')
  })

  it('keeps duplicate catalog keys in the editor and reports the stable-key collision', async () => {
    adminMocks.saveCatalog.mockRejectedValueOnce(new adminMocks.MipAdminError('CONFLICT', '记录冲突'))
    const page = createPage(catalogDefinition, {
      state: 'ready',
      canManage: true,
      editorOpen: true,
      editorKey: 'workshop',
      editorName: '工作坊',
      editorDescription: '',
      editorSortOrder: '10',
    })

    await callPage(page, 'saveCatalog')

    expect(page.data.editorOpen).toBe(true)
    expect(page.data.editorKey).toBe('workshop')
    expect(page.data.editorError).toBe('稳定标识已存在，请使用其他标识。')
    expect(adminMocks.listCatalogs).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  it('does not claim that a conflict refresh succeeded when the reload fails', async () => {
    adminMocks.changeCatalogStatus.mockRejectedValueOnce(new adminMocks.MipAdminError('CONFLICT', '记录版本冲突'))
    adminMocks.listCatalogs.mockRejectedValueOnce(new Error('网络不可用'))
    const catalogPage = createPage(catalogDefinition, {
      state: 'ready',
      canManage: true,
      items: [eventCatalogView(catalog)],
    })
    await callPage(catalogPage, 'changeStatus', { currentTarget: { dataset: { id: catalog.id } } })
    expect(catalogPage.data.message).toBe('记录状态已变化，自动刷新失败，请手动重新加载。')
    expect(String(catalogPage.data.message)).not.toContain('列表已刷新')

    adminMocks.changeRecapStatus.mockRejectedValueOnce(new adminMocks.MipAdminError('CONFLICT', '记录版本冲突'))
    adminMocks.listRecaps.mockRejectedValueOnce(new Error('网络不可用'))
    const recapPage = createPage(recapDefinition, {
      state: 'ready',
      canManage: true,
      items: [eventVideoRecapView(recap)],
      eventCatalogState: 'ready',
    })
    await callPage(recapPage, 'changeStatus', { currentTarget: { dataset: { id: recap.id } } })
    expect(recapPage.data.message).toBe('记录状态已变化，自动刷新失败，请手动重新加载。')
    expect(String(recapPage.data.message)).not.toContain('列表已刷新')
  })

  it('validates recap destination pairing and sends profile targets with a null content id', async () => {
    expect(eventVideoRecapDraftError({
      eventId: recap.eventId,
      title: recap.title,
      summary: '',
      destinationType: 'ACTIVITY',
      finderUserName: 'sph6Rngt56a0grn',
      feedId: '',
      sortOrder: '0',
    })).toContain('内容标识')
    for (const finderUserName of ['sph', 'plainToken', 'https://channels.example/profile']) {
      expect(eventVideoRecapDraftError({
        eventId: recap.eventId,
        title: recap.title,
        summary: '',
        destinationType: 'PROFILE',
        finderUserName,
        feedId: '',
        sortOrder: '0',
      })).toBe('视频号账号格式无效')
    }
    expect(eventVideoRecapDraftError({
      eventId: recap.eventId,
      title: recap.title,
      summary: '',
      destinationType: 'PROFILE',
      finderUserName: 'sph6Rngt56a0grn',
      feedId: '',
      sortOrder: '0',
    })).toBe('')

    const page = createPage(recapDefinition, {
      state: 'ready',
      canManage: true,
      editorOpen: true,
      editorEventId: recap.eventId,
      editorTitle: '主页回顾',
      editorSummary: '活动内容',
      destinationType: 'PROFILE',
      finderUserName: 'sph6Rngt56a0grn',
      feedId: 'stale-feed-id',
      editorSortOrder: '8',
    })
    await callPage(page, 'saveRecap')
    expect(adminMocks.saveRecap).toHaveBeenCalledWith({
      eventId: recap.eventId,
      title: '主页回顾',
      summary: '活动内容',
      destination: {
        provider: 'WECHAT_CHANNELS',
        type: 'PROFILE',
        finderUserName: 'sph6Rngt56a0grn',
        feedId: null,
      },
      sortOrder: 8,
    })
    expect(wx.showToast).toHaveBeenCalledWith({ title: '视频回顾已创建', icon: 'success' })
  })

  it('locks editor and record actions while saving and permits UUID entry only in fallback mode', async () => {
    const catalogPage = createPage(catalogDefinition, {
      state: 'ready',
      canManage: true,
      saving: true,
      kind: 'TYPE',
      editorOpen: true,
      editorName: '原名称',
      items: [eventCatalogView(catalog)],
    })
    callPage(catalogPage, 'updateEditorField', {
      currentTarget: { dataset: { field: 'editorName' } },
      detail: { value: '修改名称' },
    })
    callPage(catalogPage, 'chooseKind', { currentTarget: { dataset: { kind: 'TAG' } } })
    await callPage(catalogPage, 'changeStatus', { currentTarget: { dataset: { id: catalog.id } } })
    expect(catalogPage.data.editorName).toBe('原名称')
    expect(catalogPage.data.kind).toBe('TYPE')
    expect(adminMocks.changeCatalogStatus).not.toHaveBeenCalled()

    const recapPage = createPage(recapDefinition, {
      state: 'ready',
      canManage: true,
      saving: true,
      destinationType: 'PROFILE',
      eventCatalogState: 'ready',
      eventIdInput: recap.eventId,
      editorEventId: recap.eventId,
      editorTitle: '原标题',
      items: [eventVideoRecapView(recap)],
    })
    callPage(recapPage, 'chooseDestination', { currentTarget: { dataset: { type: 'ACTIVITY' } } })
    callPage(recapPage, 'openEventPicker', { currentTarget: { dataset: { target: 'EDITOR' } } })
    callPage(recapPage, 'updateEditorField', {
      currentTarget: { dataset: { field: 'editorTitle' } },
      detail: { value: '修改标题' },
    })
    await callPage(recapPage, 'changeStatus', { currentTarget: { dataset: { id: recap.id } } })
    expect(recapPage.data.destinationType).toBe('PROFILE')
    expect(recapPage.data.eventPickerOpen).toBe(false)
    expect(recapPage.data.editorTitle).toBe('原标题')
    expect(adminMocks.changeRecapStatus).not.toHaveBeenCalled()

    recapPage.data.saving = false
    callPage(recapPage, 'updateFilterField', {
      currentTarget: { dataset: { field: 'eventIdInput' } },
      detail: { value: '44444444-4444-4444-8444-444444444444' },
    })
    expect(recapPage.data.eventIdInput).toBe(recap.eventId)
    recapPage.data.eventCatalogState = 'unavailable'
    callPage(recapPage, 'updateFilterField', {
      currentTarget: { dataset: { field: 'eventIdInput' } },
      detail: { value: '44444444-4444-4444-8444-444444444444' },
    })
    expect(recapPage.data.eventIdInput).toBe('44444444-4444-4444-8444-444444444444')
  })

  it('preserves open drafts by blocking list mutations and replacement editors', async () => {
    const catalogPage = createPage(catalogDefinition, {
      state: 'ready',
      canManage: true,
      editorOpen: true,
      editorId: catalog.id,
      editorName: '未保存的分类名称',
      items: [eventCatalogView(catalog)],
    })
    callPage(catalogPage, 'openCreate')
    callPage(catalogPage, 'editCatalog', { currentTarget: { dataset: { id: catalog.id } } })
    await callPage(catalogPage, 'changeStatus', { currentTarget: { dataset: { id: catalog.id } } })
    await callPage(catalogPage, 'archiveCatalog', { currentTarget: { dataset: { id: catalog.id } } })
    expect(catalogPage.data.editorName).toBe('未保存的分类名称')
    expect(adminMocks.changeCatalogStatus).not.toHaveBeenCalled()
    expect(adminMocks.archiveCatalog).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()

    const recapPage = createPage(recapDefinition, {
      state: 'ready',
      canManage: true,
      editorOpen: true,
      editorId: recap.id,
      editorTitle: '未保存的视频标题',
      items: [eventVideoRecapView(recap)],
    })
    callPage(recapPage, 'openCreate')
    callPage(recapPage, 'editRecap', { currentTarget: { dataset: { id: recap.id } } })
    await callPage(recapPage, 'changeStatus', { currentTarget: { dataset: { id: recap.id } } })
    await callPage(recapPage, 'archiveRecap', { currentTarget: { dataset: { id: recap.id } } })
    expect(recapPage.data.editorTitle).toBe('未保存的视频标题')
    expect(adminMocks.changeRecapStatus).not.toHaveBeenCalled()
    expect(adminMocks.archiveRecap).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
  })

  it('loads searchable event choices and writes the selected event into either target', async () => {
    const secondEvent = {
      ...eventOption,
      id: '44444444-4444-4444-8444-444444444444',
      title: '第二场活动',
      status: 'ENDED' as const,
    }
    adminMocks.listEvents
      .mockReset()
      .mockResolvedValueOnce({ items: [eventOption], nextCursor: 'event-cursor' })
      .mockResolvedValueOnce({ items: [secondEvent], nextCursor: null })
      .mockResolvedValueOnce({ items: [eventOption], nextCursor: null })
    const page = createPage(recapDefinition)
    await callPage(page, 'loadRecaps')

    expect(adminMocks.listEvents).toHaveBeenCalledWith({
      filters: { query: '' },
      sort: { field: 'startsAt', direction: 'DESC' },
      cursor: undefined,
      limit: 20,
    }, false)
    expect(page.data.eventCatalogState).toBe('ready')
    expect(page.data.eventOptions).toEqual([expect.objectContaining({
      id: recap.eventId,
      title: recap.eventTitle,
      statusText: '已发布',
    })])

    await callPage(page, 'loadEventOptions', false, true)
    expect(adminMocks.listEvents).toHaveBeenNthCalledWith(2, {
      filters: { query: '' },
      sort: { field: 'startsAt', direction: 'DESC' },
      cursor: 'event-cursor',
      limit: 20,
    }, false)
    expect(page.data.eventOptions).toHaveLength(2)
    expect(page.data.eventOptionsNextCursor).toBeNull()

    page.data.eventSearchInput = '城市'
    callPage(page, 'searchEventOptions')
    await vi.waitFor(() => expect(adminMocks.listEvents).toHaveBeenCalledTimes(3))
    expect(adminMocks.listEvents).toHaveBeenLastCalledWith({
      filters: { query: '城市' },
      sort: { field: 'startsAt', direction: 'DESC' },
      cursor: undefined,
      limit: 20,
    }, true)

    callPage(page, 'openEventPicker', { currentTarget: { dataset: { target: 'EDITOR' } } })
    callPage(page, 'chooseEventOption', { currentTarget: { dataset: { id: recap.eventId } } })
    expect(page.data.editorEventId).toBe(recap.eventId)
    expect(page.data.eventPickerOpen).toBe(false)

    callPage(page, 'openEventPicker', { currentTarget: { dataset: { target: 'FILTER' } } })
    callPage(page, 'chooseEventOption', { currentTarget: { dataset: { id: recap.eventId } } })
    expect(page.data.eventIdInput).toBe(recap.eventId)
  })

  it('keeps recap management available when the optional event chooser cannot load', async () => {
    adminMocks.getSession.mockResolvedValueOnce({
      enabled: true,
      capabilities: [recapGrant],
      roles: [],
    }).mockResolvedValueOnce({
      enabled: true,
      capabilities: [recapGrant],
      roles: [],
    })
    const noReadPage = createPage(recapDefinition)
    await callPage(noReadPage, 'loadRecaps')
    expect(noReadPage.data.state).toBe('ready')
    expect(noReadPage.data.eventCatalogState).toBe('unavailable')
    expect(adminMocks.listEvents).not.toHaveBeenCalled()

    adminMocks.getSession.mockReset().mockResolvedValue({
      enabled: true,
      capabilities: [recapGrant, eventReadGrant],
      roles: [],
    })
    adminMocks.listEvents.mockRejectedValueOnce(new Error('活动列表不可用'))
    const page = createPage(recapDefinition)
    await callPage(page, 'loadRecaps')

    expect(page.data.state).toBe('ready')
    expect(page.data.canManage).toBe(true)
    expect(page.data.eventCatalogState).toBe('unavailable')
    expect(page.data.eventCatalogMessage).toContain('可继续填写活动 ID')
    expect(adminMocks.listRecaps).toHaveBeenCalled()
  })

  it('uses shared 375px and 960px workspace contracts with explicit operational states', () => {
    const root = process.cwd()
    const catalogTemplate = readFileSync(`${root}/src/packages/admin/event-catalogs/index.wxml`, 'utf8')
    const recapTemplate = readFileSync(`${root}/src/packages/admin/event-recaps/index.wxml`, 'utf8')
    const globalStyles = readFileSync(`${root}/src/app.css`, 'utf8')
    for (const template of [catalogTemplate, recapTemplate]) {
      expect(template).toContain('mip-admin-workspace-page')
      expect(template).toContain('mip-admin-filter-grid')
      expect(template).toContain('mip-admin-section-grid')
      expect(template).toContain('mip-admin-card-list')
      expect(template.match(/min-h-\[88rpx\]/g)?.length).toBeGreaterThanOrEqual(10)
      expect(template).toContain('state === \'loading\'')
      expect(template).toContain('state === \'forbidden\'')
      expect(template).toContain('state === \'error\' || state === \'conflict\'')
      expect(template).toContain('加载更多')
      expect(template).not.toContain('space-y-')
      expect(template).toContain('disabled="{{saving')
    }
    expect(recapTemplate).toContain('wx:if="{{eventCatalogState === \'unavailable\'}}"')
    expect(recapTemplate).toContain('eventOptionsNextCursor')
    expect(recapTemplate).toContain('bind:tap="loadMoreEventOptions"')
    expect(recapTemplate).toContain('aria-disabled="{{saving}}"')
    expect(globalStyles).toContain('@media (max-width: 599px)')
    expect(globalStyles).toContain('@media (min-width: 960px)')
  })

  it('registers both workspaces in project and runtime route contracts', () => {
    const root = process.cwd()
    const app = JSON.parse(readFileSync(`${root}/src/app.json`, 'utf8')) as {
      subPackages: Array<{ root: string, pages: string[] }>
    }
    const project = JSON.parse(readFileSync(`${root}/config/project.json`, 'utf8')) as {
      routes: Array<{ pathName: string }>
    }
    const runtime = JSON.parse(readFileSync(`${root}/config/runtime-pages.json`, 'utf8')) as {
      routeCount: number
      routes: Array<{ path: string, selector: string }>
    }
    const admin = app.subPackages.find(item => item.root === 'packages/admin')
    const paths = [
      'packages/admin/event-catalogs/index',
      'packages/admin/event-recaps/index',
    ]

    expect(runtime.routeCount).toBe(100)
    expect(admin?.pages).toEqual(expect.arrayContaining(['event-catalogs/index', 'event-recaps/index']))
    expect(project.routes.map(route => route.pathName)).toEqual(expect.arrayContaining(paths))
    expect(runtime.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: paths[0], selector: '#admin-event-catalogs-page' }),
      expect.objectContaining({ path: paths[1], selector: '#admin-event-recaps-page' }),
    ]))
  })
})
