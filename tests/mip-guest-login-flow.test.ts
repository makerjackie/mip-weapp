import type { MipGuestLoginFlowHost, MipGuestLoginSheetState } from '../src/modules/mip-identity/guest-login-flow'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipGuestLoginFlow } from '../src/modules/mip-identity/guest-login-flow'

const showToast = vi.hoisted(() => vi.fn())
const navigateTo = vi.hoisted(() => vi.fn())
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: navigateTo }))
// 控制器只把 client 模块作为缺省身份实现；本测试全部注入假件，这里挡住真实云依赖即可。
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {} }))

type TestSession = Record<string, any>

function identity() {
  return {
    beginProtectedAction: vi.fn(),
    bindWechatPhone: vi.fn(),
    signIn: vi.fn(),
    loadAccess: vi.fn(),
    loadSnapshot: vi.fn(),
    peekSnapshot: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
    consumePendingResume: vi.fn(() => null),
    isSignedOut: vi.fn(() => false),
  }
}

function session(overrides: TestSession = {}): TestSession {
  return {
    token: 'token-1',
    intent: { action: 'REGISTER_EVENT', source: { navigation: 'navigateBack', route: '/packages/member/test/index' } },
    snapshot: { authenticated: false, phoneBound: false },
    decision: { ready: false, block: 'AUTH_REQUIRED', nextRequirement: 'AUTHENTICATED' },
    ...overrides,
  }
}

function host() {
  const target: MipGuestLoginFlowHost & {
    sheet: MipGuestLoginSheetState & Record<string, boolean>
    proceeded: unknown[]
    abandoned: number
    notices: string[]
    unavailableNotices: string[]
  } = {
    route: 'packages/member/test/index',
    authToken: '',
    sheet: { loginSheetOpen: false, loginSheetBusy: false, loginSheetRestoreFirst: false },
    proceeded: [],
    abandoned: 0,
    notices: [],
    unavailableNotices: [],
    getAuthToken: () => target.authToken,
    setAuthToken: (token: string) => { target.authToken = token },
    isSheetActive: () => target.sheet.loginSheetOpen === true || target.sheet.loginSheetBusy === true,
    setSheetState: (state) => { Object.assign(target.sheet, state) },
    proceed: (context) => { target.proceeded.push(context) },
    notice: (message: string) => { target.notices.push(message) },
    noticeUnavailable: (message: string) => { target.unavailableNotices.push(message) },
    onAbandon: () => { target.abandoned += 1 },
  }
  return target
}

const guestIntent = {
  action: 'REGISTER_EVENT' as const,
  source: { navigation: 'navigateBack' as const, route: '/packages/member/test/index', query: { eventId: 'e1' } },
}

beforeAll(() => {
  vi.stubGlobal('wx', { showToast })
})

let fake: ReturnType<typeof identity>
let page: ReturnType<typeof host>
beforeEach(() => {
  fake = identity()
  page = host()
})

describe('universal guest login flow (MIW-20)', () => {
  it('opens the phone sheet for a first-time guest without navigating or calling sign-in', async () => {
    fake.beginProtectedAction.mockResolvedValue(session())
    const flow = createMipGuestLoginFlow(page, fake)

    const result = await flow.begin(guestIntent)

    expect(result.outcome).toBe('sheet')
    expect(page.sheet.loginSheetOpen).toBe(true)
    expect(page.sheet.loginSheetRestoreFirst).toBe(false)
    expect(page.authToken).toBe('token-1')
    expect(navigateTo).not.toHaveBeenCalled()
    expect(fake.signIn).not.toHaveBeenCalled()
    expect(fake.bindWechatPhone).not.toHaveBeenCalled()
  })

  it('opens the sheet in restore-first mode for a signed-out returning account (MIW-20 single button)', async () => {
    fake.beginProtectedAction.mockResolvedValue(session())
    fake.isSignedOut.mockReturnValue(true)
    const flow = createMipGuestLoginFlow(page, fake)

    const result = await flow.begin(guestIntent)

    expect(result.outcome).toBe('sheet')
    expect(page.sheet.loginSheetRestoreFirst).toBe(true)
    // 原生授权窗只能由真实点击调起：先恢复会话，确认未绑后才切回手机号授权形态。
    expect(fake.signIn).not.toHaveBeenCalled()
    expect(fake.bindWechatPhone).not.toHaveBeenCalled()
  })

  it('returns ready for an already complete session and leaves the intent consumed without complete()', async () => {
    fake.beginProtectedAction.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: true },
    }))
    const flow = createMipGuestLoginFlow(page, fake)

    const result = await flow.begin(guestIntent)

    expect(result.outcome).toBe('ready')
    expect(result.session.decision.ready).toBe(true)
    expect(page.sheet.loginSheetOpen).toBe(false)
    expect(fake.complete).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('hands a forbidden or agreement-blocked session to the access page and drops the token', async () => {
    fake.beginProtectedAction.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: false, block: 'AGREEMENT_REQUIRED', nextRequirement: 'AGREEMENTS' },
    }))
    const flow = createMipGuestLoginFlow(page, fake)
    expect((await flow.begin(guestIntent)).outcome).toBe('access')
    expect(navigateTo).toHaveBeenCalledWith({ url: '/packages/member/mip-access/index?token=token-1' })
    expect(page.authToken).toBe('')

    navigateTo.mockClear()
    fake.beginProtectedAction.mockResolvedValue(session({
      decision: { ready: false, block: 'FORBIDDEN' },
    }))
    const second = createMipGuestLoginFlow(page, fake)
    expect((await second.begin(guestIntent)).outcome).toBe('access')
    expect(navigateTo).toHaveBeenCalledTimes(1)
  })

  it('reopens the sheet instead of stacking a second intent while one is still pending', async () => {
    page.authToken = 'token-1'
    const flow = createMipGuestLoginFlow(page, fake)

    const result = await flow.begin(guestIntent)

    expect(result.outcome).toBe('sheet')
    expect(fake.beginProtectedAction).not.toHaveBeenCalled()
    expect(page.sheet.loginSheetOpen).toBe(true)
  })

  it('reports a native-only hint when the phone event carries no code outside WeChat', async () => {
    page.authToken = 'token-1'
    page.sheet.loginSheetOpen = true
    fake.bindWechatPhone.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: true },
    }))
    const flow = createMipGuestLoginFlow(page, fake)

    await flow.phone({ detail: { errMsg: 'getPhoneNumber:fail no permission' } })
    expect(page.notices).toEqual(['手机号授权必须在微信真机完成。'])
    expect(fake.bindWechatPhone).not.toHaveBeenCalled()

    await flow.phone({ detail: { errMsg: 'getPhoneNumber:fail user deny' } })
    expect(page.notices[1]).toBe('你已取消手机号授权，可以稍后再完成。')
    expect(page.sheet.loginSheetOpen).toBe(true)
  })

  it('binds the phone and proceeds in place once every requirement is met', async () => {
    page.authToken = 'token-1'
    fake.bindWechatPhone.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: true },
    }))
    const flow = createMipGuestLoginFlow(page, fake)

    const outcome = await flow.phone({ detail: { code: 'single-use-code' } })

    expect(outcome).toBe('ready')
    expect(fake.bindWechatPhone).toHaveBeenCalledWith('token-1', 'single-use-code')
    expect(fake.complete).toHaveBeenCalledWith('token-1')
    expect(fake.consumePendingResume).toHaveBeenCalledWith(page.route)
    expect(page.sheet.loginSheetOpen).toBe(false)
    expect(page.proceeded).toEqual([{ snapshot: { authenticated: true, phoneBound: true }, resume: null }])
  })

  it('keeps the pending token while a new account completes profile setup, then resumes', async () => {
    page.authToken = 'token-1'
    fake.bindWechatPhone.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: false, block: 'PROFILE_REQUIRED', nextRequirement: 'PROFILE' },
    }))
    const flow = createMipGuestLoginFlow(page, fake)

    await flow.phone({ detail: { code: 'single-use-code' } })

    expect(navigateTo).toHaveBeenCalledWith({ url: '/packages/member/mip-profile/index?token=token-1' })
    expect(page.authToken).toBe('token-1')
    expect(fake.complete).not.toHaveBeenCalled()

    fake.loadAccess.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: true },
    }))
    const resumed = await flow.resume()
    expect(resumed).toBe('resumed')
    expect(fake.complete).toHaveBeenCalledWith('token-1')
    expect(page.proceeded).toHaveLength(1)
    expect(page.authToken).toBe('')
  })

  it('hands remaining requirements to the access page after a successful phone binding', async () => {
    page.authToken = 'token-1'
    fake.bindWechatPhone.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: false, block: 'AGREEMENT_REQUIRED', nextRequirement: 'AGREEMENTS' },
    }))
    const flow = createMipGuestLoginFlow(page, fake)

    await flow.phone({ detail: { code: 'single-use-code' } })

    expect(navigateTo).toHaveBeenCalledWith({ url: '/packages/member/mip-access/index?token=token-1' })
    expect(page.authToken).toBe('')
  })

  it('restores a returning phone-bound account by explicit sign-in without another phone grant', async () => {
    page.authToken = 'token-1'
    fake.isSignedOut.mockReturnValue(true)
    fake.signIn.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: true },
    }))
    const flow = createMipGuestLoginFlow(page, fake)

    const outcome = await flow.signIn()

    expect(outcome).toBe('ready')
    expect(fake.signIn).toHaveBeenCalledWith('token-1')
    expect(fake.bindWechatPhone).not.toHaveBeenCalled()
    expect(fake.complete).toHaveBeenCalledWith('token-1')
    expect(page.proceeded).toHaveLength(1)
    expect(page.sheet.loginSheetOpen).toBe(false)
  })

  it('switches the sheet back to phone authorization when an explicitly restored account has no phone', async () => {
    page.authToken = 'token-1'
    page.sheet.loginSheetOpen = true
    page.sheet.loginSheetRestoreFirst = true
    fake.signIn.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: false },
      decision: { ready: false, block: 'PHONE_REQUIRED', nextRequirement: 'PHONE' },
    }))
    const flow = createMipGuestLoginFlow(page, fake)

    const outcome = await flow.signIn()

    expect(outcome).toBeNull()
    expect(page.sheet.loginSheetOpen).toBe(true)
    expect(page.sheet.loginSheetRestoreFirst).toBe(false)
    expect(fake.complete).not.toHaveBeenCalled()
  })

  it('cancels the pending intent on dismissal', () => {
    page.authToken = 'token-1'
    page.sheet.loginSheetOpen = true
    const flow = createMipGuestLoginFlow(page, fake)

    flow.dismiss()

    expect(fake.cancel).toHaveBeenCalledWith('token-1')
    expect(page.authToken).toBe('')
    expect(page.sheet.loginSheetOpen).toBe(false)
  })

  it('leaves a pending intent untouched while the sheet is still active on return to foreground', async () => {
    page.authToken = 'token-1'
    page.sheet.loginSheetOpen = true
    const flow = createMipGuestLoginFlow(page, fake)

    expect(await flow.resume()).toBe('idle')
    expect(fake.loadAccess).not.toHaveBeenCalled()
    expect(fake.cancel).not.toHaveBeenCalled()
    expect(fake.consumePendingResume).not.toHaveBeenCalled()
  })

  it('resumes the original intent from a pending resume recorded by the access page', async () => {
    const pending = { action: 'REGISTER_EVENT' as const, source: { navigation: 'navigateBack' as const, route: '/packages/member/test/index' } }
    fake.consumePendingResume.mockReturnValueOnce(pending)
    fake.peekSnapshot.mockReturnValue({ authenticated: true, phoneBound: true })
    const flow = createMipGuestLoginFlow(page, fake)

    const resumed = await flow.resume()

    expect(resumed).toBe('resumed')
    expect(fake.loadSnapshot).not.toHaveBeenCalled()
    expect(page.proceeded).toEqual([{ snapshot: { authenticated: true, phoneBound: true }, resume: pending }])
  })

  it('waits for a refreshed snapshot before resuming when the host opts in (#2/B1)', async () => {
    const pending = { action: 'INTERACT' as const, source: { navigation: 'navigateBack' as const, route: '/packages/member/test/index' } }
    fake.consumePendingResume.mockReturnValueOnce(pending)
    let releaseSnapshot!: (snapshot: unknown) => void
    fake.loadSnapshot.mockImplementation(() => new Promise((resolve) => {
      releaseSnapshot = resolve
    }))
    const flow = createMipGuestLoginFlow(page, fake, { refreshBeforeResume: true })
    const resumedStates: Array<unknown> = []
    page.proceed = (context) => {
      resumedStates.push(context)
    }

    const pendingResume = flow.resume()
    await Promise.resolve()
    expect(resumedStates).toEqual([])
    releaseSnapshot({ authenticated: true })
    expect(await pendingResume).toBe('resumed')
    expect(resumedStates).toEqual([{ snapshot: { authenticated: true }, resume: pending }])
  })

  it('abandons the pending intent when the resumed session is no longer ready', async () => {
    page.authToken = 'token-1'
    fake.loadAccess.mockResolvedValue(session({
      decision: { ready: false, block: 'AGREEMENT_REQUIRED', nextRequirement: 'AGREEMENTS' },
    }))
    const flow = createMipGuestLoginFlow(page, fake)

    expect(await flow.resume()).toBe('idle')
    expect(fake.cancel).toHaveBeenCalledWith('token-1')
    expect(page.abandoned).toBe(1)
    expect(page.proceeded).toEqual([])
  })

  it('reports an unavailable notice without abandoning when the resume check fails', async () => {
    page.authToken = 'token-1'
    fake.loadAccess.mockRejectedValue(new Error('identity unavailable'))
    const flow = createMipGuestLoginFlow(page, fake)

    expect(await flow.resume()).toBe('idle')
    expect(page.unavailableNotices).toEqual(['登录失败，请稍后重试。'])
    expect(fake.cancel).toHaveBeenCalledWith('token-1')
    expect(page.abandoned).toBe(1)
  })

  it('reports a failure when complete() rejects after a ready mutation', async () => {
    page.authToken = 'token-1'
    fake.signIn.mockResolvedValue(session({
      snapshot: { authenticated: true, phoneBound: true },
      decision: { ready: true },
    }))
    fake.complete.mockRejectedValue(new Error('ACCESS_INTENT_EXPIRED'))
    const flow = createMipGuestLoginFlow(page, fake)

    const outcome = await flow.signIn()

    expect(outcome).toBe('unavailable')
    expect(page.proceeded).toEqual([])
    expect(page.sheet.loginSheetOpen).toBe(false)
  })

  it('falls back to a toast notice when the host does not provide one', async () => {
    page.authToken = 'token-1'
    const bareHost = { ...page, notice: undefined }
    const flow = createMipGuestLoginFlow(bareHost, fake)

    await flow.phone({ detail: { errMsg: 'getPhoneNumber:fail user deny' } })

    expect(showToast).toHaveBeenCalledWith({ title: '你已取消手机号授权，可以稍后再完成。', icon: 'none' })
  })
})
