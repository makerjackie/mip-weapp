import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const identity = vi.hoisted(() => ({
  beginProtectedAction: vi.fn(),
  bindWechatPhone: vi.fn(),
  signIn: vi.fn(),
  isSignedOut: vi.fn(),
  loadAccess: vi.fn(),
  loadSnapshot: vi.fn(),
  peekSnapshot: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
  consumePendingResume: vi.fn(),
}))
const navigateTo = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: identity, mipBranchesModule: {} }))
vi.mock('../src/modules/mip-cases', () => ({ superCaseModule: {} }))
vi.mock('../src/modules/mip-cooperation', () => ({ cooperationModule: {} }))
vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: {} }))
vi.mock('../src/modules/mip-growth/client', () => ({ mipGrowthModule: {} }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/modules/mip-opportunities', () => ({ opportunityModule: {} }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: navigateTo, syncCaseNavigation: vi.fn() }))

type TestPage = Record<string, any>
let definition: TestPage
function page() {
  const result = Object.create(definition)
  result.data = structuredClone(definition.data)
  result.setData = (patch: Record<string, unknown>) => Object.assign(result.data, patch)
  result.loadProfile = vi.fn(async () => {})
  return result
}
function session(overrides: TestPage = {}) {
  return {
    token: 'login-intent',
    snapshot: { authenticated: false, phoneBound: false },
    decision: { ready: false, block: 'AUTH_REQUIRED', nextRequirement: 'AUTHENTICATED' },
    ...overrides,
  }
}

beforeAll(async () => {
  vi.stubGlobal('Page', (value: TestPage) => {
    definition = value
  })
  vi.stubGlobal('wx', { showToast })
  await import('../src/pages/profile/index')
})
beforeEach(() => {
  vi.resetAllMocks()
  identity.beginProtectedAction.mockResolvedValue(session())
  identity.isSignedOut.mockReturnValue(false)
  identity.consumePendingResume.mockReturnValue(null)
})

describe('my page native phone login entry (J1-02)', () => {
  it.each(['openLogin', 'openMemberCard', 'openRegistrations', 'openOrders', 'openSettings'])(
    'shows the real phone authorization component for a first-time visitor from %s',
    async (method) => {
      const instance = page()
      instance[method]()
      await Promise.resolve()
      await Promise.resolve()
      expect(instance.data.loginSheetOpen).toBe(true)
      expect(instance.data.loginSheetAllowSignIn).toBe(false)
      expect(navigateTo).not.toHaveBeenCalled()
      expect(identity.signIn).not.toHaveBeenCalled()
      expect(identity.bindWechatPhone).not.toHaveBeenCalled()
      expect(identity.beginProtectedAction).toHaveBeenCalledWith(expect.objectContaining({
        requirements: ['AUTHENTICATED', 'AGREEMENTS', 'PHONE', 'PROFILE'],
        source: expect.objectContaining({ route: '/pages/profile/index' }),
      }))
    },
  )

  it('keeps native denial local and dismissal leaves the original page', async () => {
    const instance = page()
    await instance.openProtected('/packages/member/privacy/index', 'EDIT_PROFILE')
    await instance.onLoginSheetPhone({ detail: { errMsg: 'getPhoneNumber:fail user deny' } })
    expect(identity.bindWechatPhone).not.toHaveBeenCalled()
    expect(instance.data.loginSheetOpen).toBe(true)
    instance.onLoginSheetDismiss()
    expect(identity.cancel).toHaveBeenCalledWith('login-intent')
    expect(instance.data.loginSheetOpen).toBe(false)
    expect(instance.resumeDestination).toBe('')
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('lets a returning account restore its bound phone without another phone grant', async () => {
    const instance = page()
    identity.isSignedOut.mockReturnValue(true)
    const ready = session({ snapshot: { authenticated: true, phoneBound: true }, decision: { ready: true } })
    identity.signIn.mockResolvedValue(ready)
    identity.loadAccess.mockResolvedValue(ready)
    await instance.openProtected('/packages/member/privacy/index', 'EDIT_PROFILE')
    expect(instance.data.loginSheetAllowSignIn).toBe(true)
    await instance.onLoginSheetSignIn()
    expect(identity.signIn).toHaveBeenCalledWith('login-intent')
    expect(identity.bindWechatPhone).not.toHaveBeenCalled()
    expect(identity.complete).toHaveBeenCalledWith('login-intent')
    expect(navigateTo).toHaveBeenCalledWith({ url: '/packages/member/privacy/index' })
  })

  it('retains the phone button when an explicitly restored account has no phone yet', async () => {
    const instance = page()
    identity.signIn.mockResolvedValue(session({ snapshot: { authenticated: true, phoneBound: false } }))
    await instance.openProtected('', 'EDIT_PROFILE')
    await instance.onLoginSheetSignIn()
    expect(instance.data.loginSheetOpen).toBe(true)
    expect(instance.data.loginSheetAllowSignIn).toBe(false)
    expect(identity.complete).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('keeps explicit agreement acceptance in the access flow after receiving a native phone code', async () => {
    const instance = page()
    identity.bindWechatPhone.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: false, nextRequirement: 'AGREEMENTS' },
    }))
    await instance.openProtected('/packages/member/privacy/index', 'EDIT_PROFILE')
    await instance.onLoginSheetPhone({ detail: { code: 'single-use-test-code' } })
    expect(identity.bindWechatPhone).toHaveBeenCalledWith('login-intent', 'single-use-test-code')
    expect(identity.complete).not.toHaveBeenCalled()
    expect(navigateTo).toHaveBeenCalledWith({ url: '/packages/member/mip-access/index?token=login-intent' })
  })

  it('returns to my page when a new user closes unfinished profile setup without resuming a protected destination', async () => {
    const instance = page()
    identity.bindWechatPhone.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: false, nextRequirement: 'PROFILE' },
    }))
    identity.loadAccess.mockResolvedValue(session({ decision: { ready: false, nextRequirement: 'PROFILE' } }))
    await instance.openProtected('/packages/member/privacy/index', 'EDIT_PROFILE')
    await instance.onLoginSheetPhone({ detail: { code: 'single-use-test-code' } })
    expect(navigateTo).toHaveBeenCalledWith({ url: '/packages/member/mip-profile/index?token=login-intent' })
    navigateTo.mockClear()
    await instance.resumeLogin()
    expect(identity.cancel).toHaveBeenCalledWith('login-intent')
    expect(identity.complete).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
    expect(instance.loadProfile).toHaveBeenCalledWith({ force: true })
  })

  it('refreshes the real page after login even when anonymous first-screen sections are still in flight', async () => {
    const instance = page()
    delete instance.loadProfile
    let releaseSections!: () => void
    const sections = new Promise<void>((resolve) => {
      releaseSections = resolve
    })
    const anonymous = { authenticated: false }
    const authenticated = { authenticated: true }
    identity.loadSnapshot.mockResolvedValueOnce(anonymous).mockResolvedValueOnce(authenticated)
    identity.peekSnapshot.mockReturnValue(undefined)
    instance.applyIdentity = vi.fn((snapshot: { authenticated: boolean }) => {
      instance.setData({ authenticated: snapshot.authenticated })
    })
    for (const method of ['loadIndustry', 'loadGrowth', 'loadBadges', 'loadCooperation', 'loadCases', 'loadOpportunities', 'loadCollaborationOpportunities', 'loadInfluenceSummary', 'loadNotificationUnread']) {
      instance[method] = vi.fn(async () => {})
    }
    instance.loadBranch = vi.fn().mockImplementationOnce(() => sections).mockResolvedValue(undefined)
    const initialLoad = instance.loadProfile()
    await Promise.resolve()
    expect(instance.data.authenticated).toBe(false)
    expect(instance.loadPromise).not.toBeNull()

    identity.loadAccess.mockResolvedValue(session({ decision: { ready: true } }))
    instance.authToken = 'login-intent'
    const resume = instance.resumeLogin()
    await Promise.resolve()
    await Promise.resolve()
    releaseSections()
    await Promise.all([initialLoad, resume])
    expect(identity.loadSnapshot).toHaveBeenCalledTimes(2)
    expect(instance.data.authenticated).toBe(true)
    expect(instance.loadPromise).toBeNull()
  })

  it('retains the pending destination while a native phone authorization sheet is active', async () => {
    const instance = page()
    await instance.openProtected('/packages/member/privacy/index', 'EDIT_PROFILE')
    instance.onShow()
    expect(instance.resumeDestination).toBe('/packages/member/privacy/index')
    expect(instance.authToken).toBe('login-intent')
    expect(identity.cancel).not.toHaveBeenCalled()
  })

  it('restores the original destination from persisted intent even when page-local state was lost', () => {
    const instance = page()
    identity.consumePendingResume.mockReturnValue({ source: { query: { destination: '/packages/member/orders/index' } } })
    instance.onShow()
    expect(navigateTo).toHaveBeenCalledWith({ url: '/packages/member/orders/index' })
  })
})
