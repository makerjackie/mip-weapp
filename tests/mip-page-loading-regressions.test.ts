import { beforeAll, describe, expect, it, vi } from 'vitest'

const identity = vi.hoisted(() => ({ peekSnapshot: vi.fn(), loadSnapshot: vi.fn(), consumePendingResume: vi.fn() }))
const opportunities = vi.hoisted(() => ({ getProfileInfluence: vi.fn(), listReceived: vi.fn() }))
vi.mock('../src/modules/mip-opportunities', () => ({ opportunityModule: opportunities }))
vi.mock('../src/modules/mip-cases', () => ({ superCaseModule: {} }))
vi.mock('../src/modules/mip-cooperation', () => ({ cooperationModule: {} }))
vi.mock('../src/modules/mip-growth/client', () => ({ mipGrowthModule: {} }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: identity, mipBranchesModule: {} }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: {} }))
vi.mock('../src/modules/mip-banners', () => ({ mipBannerModule: {} }))

type Definition = { data: Record<string, unknown> } & Record<string, unknown>
let profile: Definition
let events: Definition
let discovery: Definition
let mine: Definition
function page(definition: Definition) {
  return Object.assign(Object.create(definition), {
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  })
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Definition) => {
    profile = value
  })
  await import('../src/pages/profile/index')
  vi.stubGlobal('Page', (value: Definition) => {
    events = value
  })
  await import('../src/pages/events/index')
  vi.stubGlobal('Page', (value: Definition) => {
    discovery = value
  })
  await import('../src/pages/opportunities/index')
  vi.stubGlobal('Page', (value: Definition) => {
    mine = value
  })
  await import('../src/packages/member/mip-opportunities/mine/index')
  vi.unstubAllGlobals()
})

describe('page loading and profile interaction regressions', () => {
  it('renders freshly returned statistics and unread badge on the first response', async () => {
    opportunities.getProfileInfluence.mockResolvedValue({ guestCount: 3, interactionCount: 4, interestCount: 5, visitorCount: 6 })
    opportunities.listReceived.mockResolvedValue({ unreadCount: 2 })
    const instance = page(profile)
    await instance.loadInfluenceSummary({ authenticated: true })
    expect([instance.data.guestCount, instance.data.interactionCount, instance.data.interestCount, instance.data.visitorCount]).toEqual([3, 4, 5, 6])
    expect(instance.data.visitorUnreadCount).toBe(2)
    opportunities.getProfileInfluence.mockRejectedValue(new Error('unavailable'))
    opportunities.listReceived.mockResolvedValue({ unreadCount: 0 })
    await instance.loadInfluenceSummary({ authenticated: true })
    expect(instance.data.guestCount).toBe(3)
    expect(instance.data.visitorUnreadCount).toBe(0)
  })

  it('opens a unified heart history from the heart statistic', () => {
    const instance = page(profile)
    instance.openProtected = vi.fn()
    instance.openStat({ detail: { label: '心动值' } })
    expect(instance.openProtected).toHaveBeenCalledWith('/packages/member/mip-received/index?scope=hearts&category=ACTIVE_INTEREST', 'INTERACT')
  })

  it.each([['嘉宾', 'GUEST'], ['互动过', 'INTERACTION']])('opens the %s statistic', (label, category) => {
    const instance = page(profile)
    instance.openInfluenceList = vi.fn()
    instance.openStat({ detail: { label } })
    expect(instance.openInfluenceList).toHaveBeenCalledWith({ currentTarget: { dataset: { category } } })
  })

  it('reveals fresh identity before a slow secondary profile section completes', async () => {
    identity.peekSnapshot.mockReturnValue(undefined)
    identity.loadSnapshot.mockResolvedValue({ authenticated: true })
    const instance = page(profile)
    const slow = deferred()
    instance.applyIdentity = vi.fn()
    for (const method of ['loadBranch', 'loadIndustry', 'loadGrowth', 'loadBadges', 'loadCooperation', 'loadCases', 'loadOpportunities', 'loadInfluenceSummary', 'loadNotificationUnread']) {
      instance[method] = vi.fn().mockResolvedValue(undefined)
    }
    instance.loadBadges.mockReturnValue(slow.promise)
    const loading = instance.loadProfileOnce()
    await Promise.resolve()
    expect(instance.data.state).toBe('ready')
    expect(instance.data.initialSectionsState).toBe('loading')
    slow.resolve()
    await loading
    expect(instance.data.initialSectionsState).toBe('ready')
  })

  it('refreshes a recent opportunity list after returning from an editing flow', () => {
    const instance = page(discovery)
    instance.data.state = 'ready'
    instance.lastSuccessfulRefreshAt = Date.now()
    instance.loadCatalogs = vi.fn()
    instance.refreshAuthState = vi.fn()
    instance.loadContent = vi.fn()
    instance.onShow()
    expect(instance.loadContent).not.toHaveBeenCalled()
    instance.refreshOnReturn = true
    instance.onShow()
    expect(instance.loadContent).toHaveBeenCalledWith(true, { preserveContent: true })
    expect(instance.refreshOnReturn).toBe(false)
  })

  it('selects the referral list on arrival and ignores unknown tab values', () => {
    const instance = page(mine)
    instance.onLoad({ tab: 'unknown' })
    expect(instance.data.tab).toBe('PUBLISHED')
    instance.onLoad({ tab: 'REFERRED' })
    expect(instance.data.tab).toBe('REFERRED')
  })

  it('opens the referred-to-me list from the profile shortcut', () => {
    const instance = page(profile)
    instance.openProtected = vi.fn()
    instance.openReferredOpportunities()
    expect(instance.openProtected).toHaveBeenCalledWith('/packages/member/mip-opportunities/mine/index?tab=REFERRED', 'INTERACT')
  })

  it('starts the activity feed and banner while optional filters are still pending', async () => {
    const instance = page(events)
    const filters = deferred()
    instance.initializeDefaultCity = vi.fn().mockResolvedValue(undefined)
    instance.loadDiscoveryFilters = vi.fn().mockReturnValue(filters.promise)
    instance.loadEvents = vi.fn().mockResolvedValue(undefined)
    instance.loadBanners = vi.fn().mockResolvedValue(undefined)
    const loading = instance.loadPage()
    await Promise.resolve()
    expect(instance.loadEvents).toHaveBeenCalledOnce()
    expect(instance.loadBanners).toHaveBeenCalledOnce()
    filters.resolve()
    await loading
  })

  it('validates selected catalog filters before requesting the activity feed', async () => {
    const instance = page(events)
    const filters = deferred()
    instance.data.selectedTagKeys = ['outdoor']
    instance.initializeDefaultCity = vi.fn().mockResolvedValue(undefined)
    instance.loadDiscoveryFilters = vi.fn().mockReturnValue(filters.promise)
    instance.loadEvents = vi.fn().mockResolvedValue(undefined)
    instance.loadBanners = vi.fn().mockResolvedValue(undefined)
    const loading = instance.loadPage()
    await Promise.resolve()
    expect(instance.loadEvents).not.toHaveBeenCalled()
    filters.resolve()
    await loading
    expect(instance.loadEvents).toHaveBeenCalledOnce()
  })
})
