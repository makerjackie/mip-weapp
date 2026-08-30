import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const eventsModule = vi.hoisted(() => ({
  listMyRegistrations: vi.fn(),
}))
const casesModule = vi.hoisted(() => ({
  list: vi.fn(),
  listMine: vi.fn(),
}))

vi.mock('../src/modules/mip-events/client', () => ({
  mipCheckInResumeStore: { clear: vi.fn() },
  mipEventsModule: eventsModule,
}))
vi.mock('../src/modules/mip-cases', () => ({
  superCaseModule: casesModule,
}))
vi.mock('../src/modules/platform/case-navigation', () => ({
  caseNavigateTo: vi.fn(),
  caseSwitchPrimary: vi.fn(),
}))

interface PageDefinition {
  data: Record<string, unknown>
  [key: string]: unknown
}

let capturedPage: PageDefinition
let myEventsDefinition: PageDefinition
let caseListDefinition: PageDefinition

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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

function registration(id: string) {
  return {
    id: `registration-${id}`,
    status: 'REGISTERED',
    version: 1,
    event: {
      id,
      title: id,
      startsAt: '2026-09-01T00:00:00.000Z',
      cityName: '深圳',
      venueName: '',
      accessType: 'FREE',
      participantPreview: [],
      registrationCount: 1,
      eventTypeLabel: '活动',
    },
    venueAddress: '',
  }
}

function superCase(id: string) {
  return {
    id,
    title: id,
    status: 'PUBLISHED',
    publishedAt: '2026-08-01T00:00:00.000Z',
    cityLabel: '深圳',
    industryLabel: '',
    caseType: '项目',
    mine: true,
    version: 1,
  }
}

beforeAll(async () => {
  vi.stubGlobal('wx', { showModal: vi.fn(), showToast: vi.fn() })
  vi.stubGlobal('Page', (definition: PageDefinition) => {
    capturedPage = definition
  })
  await import('../src/packages/member/mip-events/mine/index')
  myEventsDefinition = capturedPage
  await import('../src/packages/member/mip-cases/list/index')
  caseListDefinition = capturedPage
})

beforeEach(() => {
  eventsModule.listMyRegistrations.mockReset()
  casesModule.list.mockReset()
  casesModule.listMine.mockReset()
})

describe('second-pass client request ordering', () => {
  it('drops an old my-events append after a newer refresh', async () => {
    const append = deferred<unknown>()
    const refresh = deferred<unknown>()
    eventsModule.listMyRegistrations.mockReturnValueOnce(append.promise).mockReturnValueOnce(refresh.promise)
    const page = createPage(myEventsDefinition)
    page.data.registrations = [registration('cached')]
    page.data.nextCursor = 'old-cursor'

    const appendRun = callPage(page, 'loadMore') as Promise<unknown>
    const refreshRun = callPage(page, 'loadRegistrations') as Promise<unknown>
    refresh.resolve({ counts: { upcoming: 1, attended: 0 }, items: [registration('fresh')], nextCursor: '' })
    await refreshRun
    append.resolve({ counts: { upcoming: 2, attended: 0 }, items: [registration('stale')], nextCursor: '' })
    await appendRun

    expect(page.data.registrations).toEqual([expect.objectContaining({ event: expect.objectContaining({ id: 'fresh' }) })])
  })

  it('keeps the selected case scope when an older response finishes last', async () => {
    const allCases = deferred<unknown>()
    const mine = deferred<unknown>()
    casesModule.list.mockReturnValue(allCases.promise)
    casesModule.listMine.mockReturnValue(mine.promise)
    const page = createPage(caseListDefinition)

    const oldRun = callPage(page, 'load', true) as Promise<unknown>
    page.data.mine = true
    const currentRun = callPage(page, 'load', true) as Promise<unknown>
    mine.resolve({ items: [superCase('mine')], nextCursor: '' })
    await currentRun
    allCases.resolve({ items: [superCase('all')], nextCursor: '' })
    await oldRun

    expect(page.data.mine).toBe(true)
    expect(page.data.items).toEqual([expect.objectContaining({ id: 'mine' })])
  })
})

describe('second-pass client source guards', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

  it('locks opportunity completion before opening its confirmation', () => {
    const detail = source('src/packages/member/mip-opportunities/detail/index.ts')
    expect(detail).toContain('endConfirmationBusy: false')
    expect(detail).toMatch(/this\.data\.acting \|\| this\.endConfirmationBusy/)
    expect(detail).toMatch(/this\.endConfirmationBusy = true[\s\S]*await wx\.showModal/)
    expect(detail).toMatch(/finally \{[\s\S]{0,100}this\.endConfirmationBusy = false/)
  })
})
