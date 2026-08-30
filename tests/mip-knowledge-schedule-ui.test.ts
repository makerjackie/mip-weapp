import type { AdminTransport } from '../src/modules/mip-admin/transport'
import type { KnowledgeSchedule } from '../src/modules/mip-knowledge/admin'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipAdminError } from '../src/modules/mip-admin/types'
import { createMipKnowledgeAdminModule } from '../src/modules/mip-knowledge/admin'

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

const knowledgeAdminModule = vi.hoisted(() => ({
  closeReport: vi.fn(),
  getContent: vi.fn(),
  list: vi.fn(),
  listSchedules: vi.fn(),
  moderateComment: vi.fn(),
  reviewContent: vi.fn(),
  runIngestion: vi.fn(),
  saveCategory: vi.fn(),
  saveContent: vi.fn(),
  saveProduct: vi.fn(),
  saveSchedule: vi.fn(),
  saveSource: vi.fn(),
}))

vi.mock('../src/modules/mip-knowledge/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/mip-knowledge/admin')>()
  return { ...actual, mipKnowledgeAdminModule: knowledgeAdminModule }
})

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition
const showToast = vi.fn()

const SOURCE_ID = '10000000-0000-4000-8000-000000000001'
const CATEGORY_ID = '20000000-0000-4000-8000-000000000001'
const SCHEDULE_ID = '30000000-0000-4000-8000-000000000001'

const sourceRows = [
  {
    id: SOURCE_ID,
    name: '行业热点',
    sourceKey: 'industry-feed',
    sourceType: 'JSON_FEED',
    status: 'ACTIVE',
    version: 1,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: '手动内容',
    sourceKey: 'manual',
    sourceType: 'MANUAL',
    status: 'ACTIVE',
    version: 1,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    name: '暂停订阅',
    sourceKey: 'paused-rss',
    sourceType: 'RSS',
    status: 'INACTIVE',
    version: 1,
  },
]

const categoryRows = [
  { id: CATEGORY_ID, name: '每日热点', categoryKey: 'daily', status: 'ACTIVE', version: 1 },
  {
    id: '20000000-0000-4000-8000-000000000002',
    name: '停用分类',
    categoryKey: 'inactive',
    status: 'INACTIVE',
    version: 1,
  },
]

function schedule(overrides: Partial<KnowledgeSchedule> = {}): KnowledgeSchedule {
  return {
    id: SCHEDULE_ID,
    source: { id: SOURCE_ID, name: '行业热点', sourceType: 'JSON_FEED', status: 'ACTIVE' },
    category: { id: CATEGORY_ID, name: '每日热点', status: 'ACTIVE' },
    dailyTime: '08:30',
    timeZone: 'Asia/Shanghai',
    status: 'ACTIVE',
    nextRunAt: '2030-08-25T00:30:00.000Z',
    attemptCount: 1,
    lastRunId: '50000000-0000-4000-8000-000000000001',
    lastStartedAt: '2030-08-24T00:30:00.000Z',
    lastCompletedAt: '2030-08-24T00:31:00.000Z',
    lastErrorCode: '',
    version: 7,
    ...overrides,
  }
}

function createPage(overrides: PageData = {}) {
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
  return Reflect.apply(handler, page, args) as unknown
}

function change<T>(value: T) {
  return { detail: { value } } as unknown as WechatMiniprogram.CustomEvent<{ value: T }>
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    showModal: vi.fn(),
    showToast,
    stopPullDownRefresh: vi.fn(),
  })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/admin/knowledge/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  knowledgeAdminModule.list.mockImplementation(async (section: string) => ({
    section,
    items: section === 'SOURCES' ? sourceRows : section === 'CATEGORIES' ? categoryRows : [],
    nextCursor: null,
  }))
  knowledgeAdminModule.listSchedules.mockResolvedValue({ items: [schedule()], nextCursor: null })
})

describe('MIP knowledge schedule module contract', () => {
  it('uses neutral list and save actions and lifts the stable request key', async () => {
    const requests: Array<Record<string, unknown>> = []
    const transport: AdminTransport = {
      async request(request) {
        requests.push(structuredClone(request) as unknown as Record<string, unknown>)
        return request.action.endsWith('.list')
          ? { items: [], nextCursor: null } as never
          : { id: SCHEDULE_ID, version: 1 } as never
      },
    }
    const module = createMipKnowledgeAdminModule(transport)

    await module.listSchedules({ status: 'ACTIVE', limit: 20 })
    await module.saveSchedule({
      expectedVersion: 0,
      sourceId: SOURCE_ID,
      categoryId: CATEGORY_ID,
      timeOfDay: '08:30',
      timeZone: 'Asia/Shanghai',
      status: 'ACTIVE',
      idempotencyKey: 'knowledge-schedule-create-0001',
    })

    expect(requests).toEqual([
      {
        contractVersion: 1,
        action: 'mip.admin.knowledge.schedules.list',
        input: { status: 'ACTIVE', limit: 20 },
      },
      {
        contractVersion: 1,
        action: 'mip.admin.knowledge.schedules.save',
        input: {
          expectedVersion: 0,
          sourceId: SOURCE_ID,
          categoryId: CATEGORY_ID,
          dailyTime: '08:30',
          timeZone: 'Asia/Shanghai',
          status: 'ACTIVE',
        },
        idempotencyKey: 'knowledge-schedule-create-0001',
      },
    ])
  })
})

describe('MIP knowledge schedule administration UI', () => {
  it('loads schedule facts separately and offers only active feed sources and categories', async () => {
    const page = createPage({ section: 'SCHEDULES', state: 'loading' })
    knowledgeAdminModule.listSchedules.mockResolvedValueOnce({
      items: [schedule({ lastRunId: '', lastStartedAt: null, lastCompletedAt: null })],
      nextCursor: null,
    })

    await callPage(page, 'load')

    expect(knowledgeAdminModule.listSchedules).toHaveBeenCalledWith()
    expect(knowledgeAdminModule.list).not.toHaveBeenCalledWith('SCHEDULES')
    expect(page.data.scheduleSourceOptions).toEqual([
      expect.objectContaining({ id: SOURCE_ID, sourceType: 'JSON_FEED', status: 'ACTIVE' }),
    ])
    expect(page.data.scheduleCategoryOptions).toEqual([
      expect.objectContaining({ id: CATEGORY_ID, status: 'ACTIVE' }),
    ])
    expect(page.data.schedules).toEqual([
      expect.objectContaining({
        id: SCHEDULE_ID,
        dailyTime: '08:30',
        timeZone: 'Asia/Shanghai',
        nextRunLabel: '2030-08-25 00:30 UTC',
        lastStartedLabel: '',
        lastCompletedLabel: '',
        version: 7,
      }),
    ])
  })

  it('reuses the exact input and idempotency key until automation is confirmed', async () => {
    const page = createPage({
      section: 'SCHEDULES',
      state: 'ready',
      editorKind: 'SCHEDULE',
      editorId: SCHEDULE_ID,
      editorVersion: 7,
      scheduleSourceOptions: [{ id: SOURCE_ID, name: '行业热点', sourceType: 'JSON_FEED', status: 'ACTIVE' }],
      scheduleCategoryOptions: [{ id: CATEGORY_ID, name: '每日热点', status: 'ACTIVE' }],
      scheduleSourceIndex: 0,
      scheduleCategoryIndex: 0,
      scheduleTimeOfDay: '08:30',
      scheduleTimeZone: 'Asia/Shanghai',
      scheduleStatus: 'ACTIVE',
    })
    knowledgeAdminModule.saveSchedule
      .mockRejectedValueOnce(new MipAdminError(
        'KNOWLEDGE_SCHEDULE_AUTOMATION_UNVERIFIED',
        '热点采集计划已保存，但自动执行状态尚未确认，请使用同一请求重试',
        true,
      ))
      .mockResolvedValueOnce({
        id: SCHEDULE_ID,
        dailyTime: '08:30',
        timeZone: 'Asia/Shanghai',
        status: 'ACTIVE',
        nextRunAt: '2030-08-25T00:30:00.000Z',
        version: 8,
        idempotent: true,
      })

    await callPage(page, 'saveEditor')
    const firstInput = structuredClone(knowledgeAdminModule.saveSchedule.mock.calls[0][0])

    expect(firstInput).toMatchObject({
      scheduleId: SCHEDULE_ID,
      expectedVersion: 7,
      sourceId: SOURCE_ID,
      categoryId: CATEGORY_ID,
      timeOfDay: '08:30',
      timeZone: 'Asia/Shanghai',
      status: 'ACTIVE',
      idempotencyKey: expect.stringMatching(/^knowledge-schedule-/),
    })
    expect(page.data.pendingScheduleSave).toEqual({ input: firstInput })
    expect(page.data.scheduleRetryPending).toBe(true)
    expect(page.data.editorKind).toBe('SCHEDULE')

    callPage(page, 'chooseScheduleTime', change('09:00'))
    expect(page.data.scheduleTimeOfDay).toBe('08:30')
    await callPage(page, 'onPullDownRefresh')
    expect(knowledgeAdminModule.listSchedules).not.toHaveBeenCalled()

    await callPage(page, 'saveEditor')

    expect(knowledgeAdminModule.saveSchedule).toHaveBeenCalledTimes(2)
    expect(knowledgeAdminModule.saveSchedule.mock.calls[1][0]).toEqual(firstInput)
    expect(page.data.pendingScheduleSave).toBeNull()
    expect(page.data.scheduleRetryPending).toBe(false)
    expect(page.data.editorKind).toBe('')
    expect(showToast).toHaveBeenCalledWith({ title: '已保存', icon: 'success' })
  })

  it('keeps schedule fields and server facts visible in the responsive admin workspace', () => {
    const template = readFileSync(
      new URL('../src/packages/admin/knowledge/index.wxml', import.meta.url),
      'utf8',
    )
    const script = readFileSync(
      new URL('../src/packages/admin/knowledge/index.ts', import.meta.url),
      'utf8',
    )

    expect(template).toContain('section === \'SCHEDULES\'')
    expect(template).toContain('mode="time" value="{{scheduleTimeOfDay}}"')
    expect(template).toContain('disabled="{{processing || scheduleRetryPending}}"')
    expect(template).toContain('下次执行：{{item.nextRunLabel')
    expect(template).toContain('最近完成：{{item.lastCompletedLabel')
    expect(template).toContain('mip-admin-section-grid')
    expect(template).toContain('mip-admin-card-list')
    expect(script).toContain('expectedVersion: this.data.editorId ? this.data.editorVersion : 0')
    expect(script).not.toContain('wx.cloud')
  })
})
