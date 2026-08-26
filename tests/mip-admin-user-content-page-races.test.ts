import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
    list: vi.fn(),
    get: vi.fn(),
    unpublish: vi.fn(),
  }
})

vi.mock('../src/modules/mip-admin', () => ({
  MipAdminError: adminMocks.MipAdminError,
  hasCapability: () => true,
  mipAdminModule: {
    governance: { getSession: adminMocks.getSession },
    userContent: {
      list: adminMocks.list,
      get: adminMocks.get,
      unpublish: adminMocks.unpublish,
    },
  },
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

let pageDefinition: PageDefinition

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createPage() {
  const page = Object.create(pageDefinition) as PageDefinition
  page.data = structuredClone(pageDefinition.data)
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

function cardDetail(id: string, positioning: string) {
  return {
    id,
    kind: 'COOPERATION_CARD',
    status: 'PUBLISHED',
    contentSafetyStatus: 'APPROVED',
    version: 1,
    owner: {
      userId: '50000000-0000-4000-8000-000000000001',
      nickname: '林夏（演示）',
      branchId: '10000000-0000-4000-8000-000000000001',
      branchName: '深圳分会',
      cityName: '深圳',
    },
    publishedAt: '2030-01-01T00:00:00.000Z',
    archivedAt: null,
    updatedAt: '2030-01-02T00:00:00.000Z',
    moderationHistory: [],
    roleKey: 'connector',
    positioning,
    targetSummary: '完成 12 次有效引荐',
    roleFields: { circles: ['企业服务'], resources: '渠道资源', target: '完成引荐' },
    abilityScores: {},
  }
}

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: PageDefinition) => {
    pageDefinition = definition
  })
  await import('../src/packages/admin/user-content/index')
})

beforeEach(() => {
  adminMocks.getSession.mockReset().mockResolvedValue({ capabilities: [{}] })
  adminMocks.list.mockReset()
  adminMocks.get.mockReset()
  adminMocks.unpublish.mockReset()
})

describe('MIP admin user content page request ordering', () => {
  it('keeps the newest filtered list when an older response finishes last', async () => {
    const older = deferred<{ items: [], nextCursor: string }>()
    const newer = deferred<{ items: [], nextCursor: string }>()
    adminMocks.list.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const page = createPage()

    const olderRun = callPage(page, 'loadContent', true) as Promise<unknown>
    await Promise.resolve()
    page.data.kindIndex = 1
    const newerRun = callPage(page, 'loadContent', true) as Promise<unknown>
    await Promise.resolve()
    newer.resolve({ items: [], nextCursor: 'newer-cursor' })
    await newerRun
    older.resolve({ items: [], nextCursor: 'older-cursor' })
    await olderRun

    expect(page.data.nextCursor).toBe('newer-cursor')
    expect(adminMocks.list).toHaveBeenCalledTimes(2)
  })

  it('keeps the newest detail and ignores a response after the panel closes', async () => {
    const first = deferred<ReturnType<typeof cardDetail>>()
    const second = deferred<ReturnType<typeof cardDetail>>()
    adminMocks.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const page = createPage()
    const firstId = '63000000-0000-4000-8000-000000000001'
    const secondId = '63000000-0000-4000-8000-000000000002'

    const firstRun = callPage(page, 'loadDetail', 'COOPERATION_CARD', firstId, true) as Promise<unknown>
    const secondRun = callPage(page, 'loadDetail', 'COOPERATION_CARD', secondId, true) as Promise<unknown>
    second.resolve(cardDetail(secondId, '第二张合作卡'))
    await secondRun
    first.resolve(cardDetail(firstId, '第一张合作卡'))
    await firstRun
    expect((page.data.detail as { id: string }).id).toBe(secondId)

    const afterClose = deferred<ReturnType<typeof cardDetail>>()
    adminMocks.get.mockReturnValueOnce(afterClose.promise)
    const closeRun = callPage(page, 'loadDetail', 'COOPERATION_CARD', firstId, true) as Promise<unknown>
    callPage(page, 'closeDetail')
    afterClose.resolve(cardDetail(firstId, '关闭后的响应'))
    await closeRun
    expect(page.data.detailOpen).toBe(false)
    expect(page.data.detail).toBeNull()
  })
})
