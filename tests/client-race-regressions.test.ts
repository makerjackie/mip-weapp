import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipGrowthModule } from '../src/modules/mip-growth'

const homeMocks = vi.hoisted(() => ({
  listAnnouncements: vi.fn(),
  listBanners: vi.fn(),
  listEvents: vi.fn(),
  listOpportunities: vi.fn(),
  loadBranches: vi.fn(),
  loadIdentity: vi.fn(),
}))
const paymentMocks = vi.hoisted(() => ({
  listOrders: vi.fn(),
  listPlans: vi.fn(),
  reconcile: vi.fn(),
}))
const matchingMocks = vi.hoisted(() => ({
  listMatchingResults: vi.fn(),
}))

vi.mock('../src/modules/mip-announcements', () => ({
  mipAnnouncementsModule: { list: homeMocks.listAnnouncements },
}))
vi.mock('../src/modules/mip-banners', () => ({
  mipBannerModule: { listActive: homeMocks.listBanners },
}))
vi.mock('../src/modules/mip-events/client', () => ({
  mipCheckInResumeStore: { peek: vi.fn() },
  mipEventsModule: {
    getMyRegistration: vi.fn(),
    listEvents: homeMocks.listEvents,
    peekEvents: vi.fn(),
  },
}))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipBranchesModule: {
    load: homeMocks.loadBranches,
    peek: vi.fn(),
  },
  mipIdentityModule: {
    loadSnapshot: homeMocks.loadIdentity,
    peekSnapshot: vi.fn(),
  },
}))
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: {
    list: homeMocks.listOpportunities,
    listMatchingResults: matchingMocks.listMatchingResults,
    listMatchingRequests: vi.fn(),
    listMine: vi.fn(),
  },
  retainMatchingFeedbackIntent: vi.fn(),
  retainMatchingRequestIntent: vi.fn(),
}))
vi.mock('../src/modules/mip-commerce/client', () => ({
  mipCommerceModule: {
    listOrders: paymentMocks.listOrders,
    listPlans: paymentMocks.listPlans,
    reconcile: paymentMocks.reconcile,
  },
}))
vi.mock('../src/modules/mip-messaging/client', () => ({
  mipMessagingModule: {
    requestWechatSubscription: vi.fn(),
    subscriptionCapability: vi.fn(() => ({ available: false })),
  },
}))
vi.mock('../src/platform/navigation/client', () => ({
  caseNavigateTo: vi.fn(),
  caseSwitchPrimary: vi.fn(),
  syncCaseNavigation: vi.fn(),
}))

interface PageDefinition {
  data: Record<string, unknown>
  [key: string]: unknown
}

let capturedPage: PageDefinition
let homePage: PageDefinition
let paymentResultPage: PageDefinition
let matchingPage: PageDefinition

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createPage(definition: PageDefinition) {
  const page = Object.create(definition) as PageDefinition
  page.data = structuredClone(definition.data)
  page.setData = (patch: Record<string, unknown>) => Object.assign(page.data, patch)
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown> | void
}

beforeAll(async () => {
  vi.stubGlobal('wx', {})
  vi.stubGlobal('Page', (definition: PageDefinition) => {
    capturedPage = definition
  })
  await import('../src/pages/index/index')
  homePage = capturedPage
  await import('../src/packages/member/payment-result/index')
  paymentResultPage = capturedPage
  await import('../src/packages/member/mip-opportunity-matching/index')
  matchingPage = capturedPage
})

beforeEach(() => {
  homeMocks.listAnnouncements.mockReset()
  paymentMocks.listOrders.mockReset()
  paymentMocks.listPlans.mockReset().mockResolvedValue([])
  paymentMocks.reconcile.mockReset()
  matchingMocks.listMatchingResults.mockReset()
})

describe('module request ordering', () => {
  it('does not let an older growth snapshot overwrite a newer forced refresh', async () => {
    const older = deferred<{ marker: string }>()
    const newer = deferred<{ marker: string }>()
    const getSnapshot = vi.fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const module = createMipGrowthModule({ getSnapshot } as never)

    const olderRun = module.getSnapshot()
    const newerRun = module.getSnapshot({ force: true })
    const newerSnapshot = { marker: 'newer' }
    newer.resolve(newerSnapshot)
    await newerRun
    older.resolve({ marker: 'older' })
    await olderRun

    expect(module.peekSnapshot()).toBe(newerSnapshot)
  })
})

describe('page request ordering', () => {
  it('keeps the branch announcement when the initial unscoped response finishes last', async () => {
    const unscoped = deferred<{ items: Array<{ id: string, isPinned: boolean }> }>()
    const branch = deferred<{ items: Array<{ id: string, isPinned: boolean }> }>()
    homeMocks.listAnnouncements.mockReturnValueOnce(unscoped.promise).mockReturnValueOnce(branch.promise)
    const page = createPage(homePage)

    const unscopedRun = callPage(page, 'loadAnnouncements') as Promise<unknown>
    page.data.primaryBranchId = 'branch-1'
    const branchRun = callPage(page, 'loadAnnouncements', 'branch-1') as Promise<unknown>
    branch.resolve({ items: [{ id: 'branch-announcement', isPinned: true }] })
    await branchRun
    unscoped.resolve({ items: [{ id: 'platform-announcement', isPinned: true }] })
    await unscopedRun

    expect(page.data.announcement).toEqual(expect.objectContaining({ id: 'branch-announcement' }))
  })

  it('does not resume payment polling after the page is hidden during a request', async () => {
    vi.useFakeTimers()
    try {
      const orders = deferred<never[]>()
      paymentMocks.listOrders.mockReturnValue(orders.promise)
      const page = createPage(paymentResultPage)
      callPage(page, 'onLoad', { orderId: 'order-1' })

      const checkRun = callPage(page, 'check') as Promise<unknown>
      callPage(page, 'onHide')
      orders.reject(new Error('temporary failure'))
      await checkRun

      expect(page.data.attempts).toBe(0)
      expect(page.pollTimer).toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('does not let an older matching tab response replace the active tab', async () => {
    const talent = deferred<{ items: Array<{ id: string, explanation: never[], feedback: null }>, nextCursor: string }>()
    const project = deferred<{ items: Array<{ id: string, explanation: never[], feedback: null }>, nextCursor: string }>()
    matchingMocks.listMatchingResults.mockReturnValueOnce(talent.promise).mockReturnValueOnce(project.promise)
    const page = createPage(matchingPage)
    page.data.requestId = 'request-1'
    page.data.tab = 'TALENT'

    const talentRun = callPage(page, 'loadResults', true) as Promise<unknown>
    page.data.tab = 'PROJECT'
    const projectRun = callPage(page, 'loadResults', true) as Promise<unknown>
    project.resolve({ items: [{ id: 'project-result', explanation: [], feedback: null }], nextCursor: '' })
    await projectRun
    talent.resolve({ items: [{ id: 'talent-result', explanation: [], feedback: null }], nextCursor: '' })
    await talentRun

    expect(page.data.tab).toBe('PROJECT')
    expect(page.data.results).toEqual([expect.objectContaining({ id: 'project-result' })])
  })
})
