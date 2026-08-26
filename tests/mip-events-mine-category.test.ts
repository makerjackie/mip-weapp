import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveMyRegistrationCategory } from '../src/packages/member/mip-events/mine/category'

const eventsModule = vi.hoisted(() => ({
  listMyRegistrations: vi.fn(),
}))

vi.mock('../src/modules/mip-events/client', () => ({
  mipCheckInResumeStore: { clear: vi.fn() },
  mipEventsModule: eventsModule,
}))

vi.mock('../src/modules/platform/case-navigation', () => ({
  caseNavigateTo: vi.fn(),
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition

function createPage() {
  const page = Object.create(definition) as PageDefinition
  page.data = structuredClone(definition.data)
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

beforeAll(async () => {
  vi.stubGlobal('wx', {
    showModal: vi.fn(),
    showToast: vi.fn(),
  })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-events/mine/index')
})

beforeEach(() => {
  eventsModule.listMyRegistrations.mockReset().mockResolvedValue({
    counts: { upcoming: 0, attended: 0 },
    items: [],
    nextCursor: '',
  })
})

describe('MIP my-events category query', () => {
  it('uses ATTENDED on the first request when supplied by the route query', async () => {
    const page = createPage()

    callPage(page, 'onLoad', { category: 'ATTENDED' })
    callPage(page, 'onShow')

    await vi.waitFor(() => expect(eventsModule.listMyRegistrations).toHaveBeenCalledOnce())
    expect(eventsModule.listMyRegistrations).toHaveBeenCalledWith(undefined, 'ATTENDED')
    expect(page.data.activeCategory).toBe('ATTENDED')
  })

  it('rejects unsupported category values and keeps the safe default', async () => {
    const page = createPage()

    callPage(page, 'onLoad', { category: 'ATTENDED_OR_UPCOMING' })
    callPage(page, 'onShow')

    await vi.waitFor(() => expect(eventsModule.listMyRegistrations).toHaveBeenCalledOnce())
    expect(eventsModule.listMyRegistrations).toHaveBeenCalledWith(undefined, 'UPCOMING')
    expect(page.data.activeCategory).toBe('UPCOMING')
    expect(resolveMyRegistrationCategory(undefined)).toBe('UPCOMING')
  })
})
