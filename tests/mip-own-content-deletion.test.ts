import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => {
  const domain = () => ({ get: vi.fn(), archive: vi.fn(), remove: vi.fn(), listMine: vi.fn(), list: vi.fn(), getPublicProfile: vi.fn() })
  return { cooperation: domain(), cases: domain(), opportunities: domain(), showModal: vi.fn(), showToast: vi.fn() }
})
vi.mock('../src/modules/mip-cooperation', () => ({ cooperationModule: api.cooperation }))
vi.mock('../src/modules/mip-cases', () => ({ superCaseModule: api.cases }))
vi.mock('../src/modules/mip-opportunities', () => ({ opportunityModule: api.opportunities, profileInterestMutations: {} }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {}, mipBranchesModule: {} }))
vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: {} }))
vi.mock('../src/modules/mip-growth/client', () => ({ mipGrowthModule: {} }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/modules/mip-community', () => ({ createCommunityReportIntent: vi.fn(), mipCommunityModule: {}, reportCategoryOptions: [] }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn(), syncCaseNavigation: vi.fn() }))

type TestPage = Record<string, any>
const definitions: Record<string, TestPage> = {}
let registering = ''
beforeAll(async () => {
  vi.stubGlobal('wx', { showModal: api.showModal, showToast: api.showToast })
  vi.stubGlobal('Page', (definition: TestPage) => {
    definitions[registering] = definition
  })
  registering = 'main'
  await import('../src/pages/profile/index')
  registering = 'public'
  await import('../src/packages/member/mip-public-profile/index')
  registering = 'cooperation-list'
  await import('../src/packages/member/mip-cooperation/list/index')
  registering = 'cases-list'
  await import('../src/packages/member/mip-cases/list/index')
})
const records = [
  { id: 'owned', mine: true, version: 3, projectName: '九月案例', publishedAt: '2026-09-01', roleKey: 'FOUNDER', avatars: [] },
  { id: 'other', mine: true, version: 4, projectName: '八月案例', publishedAt: '2026-08-01', roleKey: 'FOUNDER', avatars: [] },
]
const scenarios = [
  { name: 'main cooperation', page: 'main', tab: 'cooperation', method: 'deletePortfolioItem', field: 'cooperationCards', load: 'loadCooperation', lock: 'removingPortfolioId' },
  { name: 'main cases', page: 'main', tab: 'cases', method: 'deletePortfolioItem', field: 'cases', load: 'loadCases', lock: 'removingPortfolioId' },
  { name: 'main opportunities', page: 'main', tab: 'opportunities', method: 'deletePortfolioItem', field: 'opportunities', load: 'loadOpportunities', lock: 'removingPortfolioId' },
  { name: 'public cooperation', page: 'public', tab: 'cooperation', method: 'deleteOwnCooperationCard', field: 'cooperationCards', load: 'loadProfile', lock: 'deletingId' },
  { name: 'public cases', page: 'public', tab: 'cases', method: 'deleteOwnSuperCase', field: 'superCases', load: 'loadProfile', lock: 'deletingId' },
  { name: 'public opportunities', page: 'public', tab: 'opportunities', method: 'deleteOwnOpportunity', field: 'opportunities', load: 'loadProfile', lock: 'deletingId' },
  { name: 'cooperation list', page: 'cooperation-list', tab: 'cooperation', method: 'deleteCard', field: 'cards', load: 'load', lock: 'archivingId' },
  { name: 'cases list', page: 'cases-list', tab: 'cases', method: 'deleteCase', field: 'items', load: 'load', lock: 'archivingId' },
] as const
function createPage(scenario: typeof scenarios[number]) {
  const definition = definitions[scenario.page]
  const instance = Object.create(definition)
  instance.data = { ...structuredClone(definition.data), state: 'ready', authenticated: true, mine: true, isSelf: true, profileRef: 'p1.test', profile: { profileRef: 'p1.test' }, [scenario.field]: structuredClone(records) }
  instance.portfolioVersions = { cooperation: 0, cases: 0, opportunities: 0 }
  instance.setData = (patch: Record<string, unknown>) => Object.assign(instance.data, patch)
  return instance
}
function remove(instance: TestPage, scenario: typeof scenarios[number]) {
  return scenario.page === 'main'
    ? instance[scenario.method](scenario.tab, 'owned')
    : instance[scenario.method]({ currentTarget: { dataset: { id: 'owned' } } })
}
function mutation(scenario: typeof scenarios[number]) {
  return scenario.tab === 'opportunities' ? api.opportunities.remove : api[scenario.tab].archive
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetAllMocks()
  api.showModal.mockResolvedValue({ confirm: true })
  for (const domain of [api.cooperation, api.cases, api.opportunities]) {
    domain.get.mockResolvedValue({ version: 3 })
    domain.archive.mockResolvedValue({})
    domain.remove.mockResolvedValue({})
    domain.listMine.mockResolvedValue({ items: [records[1]], nextCursor: 'next-page' })
  }
})

describe.each(scenarios)('$name deletion', (scenario) => {
  it('keeps records and releases the lock when confirmation is cancelled or unavailable', async () => {
    const instance = createPage(scenario)
    api.showModal.mockResolvedValueOnce({ confirm: false }).mockRejectedValueOnce(new Error('showModal:fail'))
    await remove(instance, scenario)
    await remove(instance, scenario)
    expect(mutation(scenario)).not.toHaveBeenCalled()
    expect(instance.data[scenario.field]).toEqual(records)
    expect(instance.data[scenario.lock]).toBe('')
  })

  it('opens one confirmation while a previous longpress is pending', async () => {
    const instance = createPage(scenario)
    const confirmation = deferred<{ confirm: boolean }>()
    api.showModal.mockReturnValueOnce(confirmation.promise)
    const first = remove(instance, scenario)
    await remove(instance, scenario)
    expect(api.showModal).toHaveBeenCalledOnce()
    confirmation.resolve({ confirm: false })
    await first
    expect(mutation(scenario)).not.toHaveBeenCalled()
  })

  it('removes only the confirmed record and preserves other months/items', async () => {
    const instance = createPage(scenario)
    await remove(instance, scenario)
    expect(mutation(scenario)).toHaveBeenCalledExactlyOnceWith('owned', 3)
    expect(instance.data[scenario.field].map((item: { id: string }) => item.id)).toEqual(['other'])
    expect(instance.data[scenario.lock]).toBe('')
    expect(api.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '已删除' }))
  })

  it('keeps the record after a server failure so deletion can be retried', async () => {
    const instance = createPage(scenario)
    mutation(scenario).mockRejectedValueOnce(new Error('删除失败，请重试'))
    api[scenario.tab].listMine.mockResolvedValue({ items: records })
    await remove(instance, scenario)
    expect(instance.data[scenario.field].map((item: { id: string }) => item.id)).toContain('owned')
    expect(instance.data[scenario.lock]).toBe('')
    expect(api.showToast).toHaveBeenCalledWith(expect.objectContaining({ icon: 'none' }))
  })
})

describe('deletion response ordering', () => {
  it.each(scenarios.filter(scenario => scenario.page === 'main'))('does not restore deleted $name from an older first-page response', async (scenario) => {
    const instance = createPage(scenario)
    const oldList = deferred<{ items: typeof records }>()
    api[scenario.tab].listMine.mockReturnValueOnce(oldList.promise)
    const loading = instance[scenario.load]()
    await remove(instance, scenario)
    oldList.resolve({ items: records })
    await loading
    expect(instance.data[scenario.field].map((item: { id: string }) => item.id)).toEqual(['other'])
  })

  it('ignores an older next-page response after deletion without losing the retry cursor', async () => {
    const scenario = scenarios[1]
    const instance = createPage(scenario)
    instance.setData({ portfolioTab: 'cases', caseCursor: 'page-2' })
    const nextPage = deferred<{ items: typeof records, nextCursor: string }>()
    api.cases.listMine.mockReturnValueOnce(nextPage.promise)
    const loading = instance.loadMorePortfolio()
    await remove(instance, scenario)
    nextPage.resolve({ items: records, nextCursor: '' })
    await loading
    expect(instance.data.cases.map((item: { id: string }) => item.id)).toEqual(['other'])
    expect(instance.data.caseCursor).toBe('page-2')
    expect(instance.data.loadingMorePortfolio).toBe(false)
  })

  it('does not restore a deleted public-profile case from an older aggregate response', async () => {
    const scenario = scenarios[4]
    const instance = createPage(scenario)
    const oldProfile = deferred<Record<string, unknown>>()
    api.opportunities.getPublicProfile.mockReturnValueOnce(oldProfile.promise)
    const loading = instance.loadProfile()
    await remove(instance, scenario)
    oldProfile.resolve({ profile: { profileRef: 'p1.test', isSelf: true }, cooperationCards: [], superCases: records, opportunities: [] })
    await loading
    expect(instance.data.superCases.map((item: { id: string }) => item.id)).toEqual(['other'])
    expect(instance.data.state).toBe('ready')
  })

  it.each(scenarios.filter(scenario => scenario.page.endsWith('-list')))('keeps a successful deletion in $name even when refresh fails', async (scenario) => {
    const instance = createPage(scenario)
    api[scenario.tab].listMine.mockRejectedValue(new Error('刷新失败'))
    await remove(instance, scenario)
    expect(instance.data[scenario.field].map((item: { id: string }) => item.id)).toEqual(['other'])
    expect(api.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '已删除' }))
  })
})
