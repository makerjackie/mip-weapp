import type { MipEventDetail } from '../src/modules/mip-events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipEventsError } from '../src/modules/mip-events'

const checkInStore = vi.hoisted(() => ({ peek: vi.fn(), save: vi.fn(), clear: vi.fn() }))
const eventsModule = vi.hoisted(() => ({
  peekEvent: vi.fn(),
  getEvent: vi.fn(),
  resolveCheckInScene: vi.fn(),
  checkIn: vi.fn(),
}))
const identityModule = vi.hoisted(() => ({
  beginProtectedAction: vi.fn(),
  isSignedOut: vi.fn(() => false),
  signIn: vi.fn(),
  loadAccess: vi.fn(),
  bindWechatPhone: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
  consumePendingResume: vi.fn(() => null),
}))
const navigateTo = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())

vi.mock('../src/modules/mip-events/client', () => ({
  mipCheckInResumeStore: checkInStore,
  mipEventsModule: eventsModule,
}))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: identityModule }))
vi.mock('../src/modules/mip-identity', () => ({
  mipAccessPageUrl: (token: string) => `/packages/member/mip-access/index?token=${token}`,
}))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: navigateTo }))
vi.mock('../src/platform/storage/cloud-media', () => ({
  peekCloudFileUrls: (value: unknown) => value,
}))
vi.mock('../src/platform/storage/component-media', () => ({
  clearComponentMedia: vi.fn(),
  updateComponentMedia: vi.fn(),
}))
vi.mock('../src/platform/wechat/channels', () => ({ openWechatChannelsDestination: vi.fn() }))

type PageDefinition = Record<string, unknown> & {
  data: Record<string, unknown>
  setData: (patch: Record<string, unknown>) => void
}

let definition: PageDefinition

const EVENT_ID = '60000000-0000-4000-8000-000000000001'
const SCAN_SCENE = 's1.aaaaaaaaaaa.bbbbbbbbbbb'
const RESUME_TOKEN = `${'r'.repeat(40)}.${'s'.repeat(43)}`
const CHECK_IN_INTENT = {
  eventId: EVENT_ID,
  resumeToken: RESUME_TOKEN,
  validUntil: '2026-12-12T12:30:00+08:00',
  expiresAt: Date.now() + 30 * 60 * 1000,
}

function attendedEvent(overrides: Partial<MipEventDetail> = {}): MipEventDetail {
  return {
    id: EVENT_ID as MipEventDetail['id'],
    scopeType: 'BRANCH',
    title: 'MIP反人性早会第328场',
    summary: '早会',
    eventTypeLabel: '沙龙',
    tags: [],
    videoRecaps: [],
    mode: 'OFFLINE',
    accessType: 'PAID',
    startsAt: '2026-12-12T10:00:00+08:00',
    endsAt: '2026-12-12T12:00:00+08:00',
    status: 'PUBLISHED',
    registrationCount: 45,
    participantPreview: [],
    registrationStatus: 'ATTENDED',
    albumEnabled: false,
    description: '活动介绍',
    onlineAccessAvailable: false,
    registrationPolicy: 'AUTO',
    registrationSchema: [],
    changes: [],
    canRegister: false,
    canCancel: false,
    canRetryRefund: false,
    canCheckIn: false,
    canInteract: true,
    priceCents: 58900,
    currency: 'CNY',
    formVersion: 1,
    interactionSummary: { myInterestCount: 2, receivedInterestCount: 2 },
    ...overrides,
  } as MipEventDetail
}

function createPage(overrides: Record<string, unknown> = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method] as (...rest: unknown[]) => unknown
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown>
}

async function flushAsync() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
  }
}

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

beforeAll(async () => {
  vi.stubGlobal('wx', { showToast })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-events/detail/index')
})

beforeEach(() => {
  for (const mock of [checkInStore.peek, checkInStore.save, checkInStore.clear]) {
    mock.mockReset()
  }
  for (const mock of Object.values(eventsModule)) {
    mock.mockReset()
  }
  for (const mock of Object.values(identityModule)) {
    mock.mockReset()
  }
  identityModule.consumePendingResume.mockReturnValue(null)
  identityModule.isSignedOut.mockReturnValue(false)
  navigateTo.mockReset()
  showToast.mockReset()
  checkInStore.peek.mockReturnValue(CHECK_IN_INTENT)
})

describe('MIP event detail scan check-in (journey J0-01/J0-02)', () => {
  it('auto-checks-in after a scan scene resolves, toasts natively and refreshes to the attended state', async () => {
    const page = createPage()
    checkInStore.clear.mockImplementation(() => {
      checkInStore.peek.mockReturnValue(null)
    })
    eventsModule.resolveCheckInScene.mockResolvedValueOnce({
      eventId: EVENT_ID,
      resumeToken: RESUME_TOKEN,
      validFrom: '2026-12-12T09:30:00+08:00',
      validUntil: CHECK_IN_INTENT.validUntil,
    })
    checkInStore.save.mockReturnValueOnce(CHECK_IN_INTENT)
    eventsModule.getEvent
      .mockResolvedValueOnce(attendedEvent({ registrationStatus: 'REGISTERED' }))
      .mockResolvedValueOnce(attendedEvent({ registrationStatus: 'ATTENDED' }))
    eventsModule.checkIn.mockResolvedValueOnce({
      eventId: EVENT_ID,
      registrationId: 'reg-1',
      status: 'ATTENDED',
      checkedInAt: '2026-12-12T10:01:00+08:00',
      idempotent: false,
    })

    await callPage(page, 'loadCheckInScene', SCAN_SCENE)
    await flushAsync()

    expect(eventsModule.checkIn).toHaveBeenCalledWith(RESUME_TOKEN)
    expect(checkInStore.clear).toHaveBeenCalledWith(EVENT_ID)
    expect(showToast).toHaveBeenCalledWith({ title: '签到成功', icon: 'success' })
    expect(page.data.hasCheckInIntent).toBe(false)
    // 签到后刷新：详情页转入已签到态，「与你互动」在存在互动数据时出现。
    expect(page.data.state).toBe('ready')
    expect(page.data.interactionVisible).toBe(true)
    expect(eventsModule.getEvent).toHaveBeenCalledTimes(2)
  })

  it('routes unauthenticated scans through the phone sheet first and only then retries (J0-02)', async () => {
    const page = createPage()
    eventsModule.resolveCheckInScene.mockResolvedValueOnce({
      eventId: EVENT_ID,
      resumeToken: RESUME_TOKEN,
      validFrom: '2026-12-12T09:30:00+08:00',
      validUntil: CHECK_IN_INTENT.validUntil,
    })
    checkInStore.save.mockReturnValueOnce(CHECK_IN_INTENT)
    eventsModule.getEvent.mockResolvedValue(attendedEvent({ registrationStatus: undefined }))
    eventsModule.checkIn.mockRejectedValueOnce(new MipEventsError('AUTH_REQUIRED', '请先完成登录'))
    identityModule.beginProtectedAction.mockResolvedValueOnce({
      token: 'identity-token',
      decision: { ready: false, block: 'AUTH_REQUIRED', nextRequirement: 'AUTHENTICATED' },
      snapshot: { authenticated: false, phoneBound: false },
    })

    await callPage(page, 'loadCheckInScene', SCAN_SCENE)
    await flushAsync()

    expect(identityModule.beginProtectedAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INTERACT',
    }))
    expect(page.data.loginSheetOpen).toBe(true)
    expect(showToast).not.toHaveBeenCalledWith({ title: '签到成功', icon: 'success' })
    expect(checkInStore.clear).not.toHaveBeenCalled()
  })

  it.each(['register', 'share', 'participants'])('opens the phone sheet over the original event for a first-time %s intent', async (intent) => {
    const page = createPage({ eventId: EVENT_ID, inviteRef: 'public-invite-ref' })
    identityModule.beginProtectedAction.mockResolvedValueOnce({
      token: 'identity-token',
      decision: { ready: false, block: 'AUTH_REQUIRED' },
      snapshot: { authenticated: false, phoneBound: false },
    })
    expect(await callPage(page, 'requireAuthIntent', intent)).toBe(false)
    expect(page.data.loginSheetOpen).toBe(true)
    expect(navigateTo).not.toHaveBeenCalled()
    expect(identityModule.beginProtectedAction).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ query: { eventId: EVENT_ID, intent, inviteRef: 'public-invite-ref' } }),
    }))
  })

  it.each([
    { loginSheetOpen: true, loginSheetBusy: false },
    { loginSheetOpen: false, loginSheetBusy: true },
  ])('keeps an active native authorization intent when the event page returns to foreground (%j)', async (state) => {
    const page = createPage(state)
    page.authToken = 'identity-token'
    page.authIntent = 'participants'
    callPage(page, 'onShow')
    await flushAsync()
    expect(page.authToken).toBe('identity-token')
    expect(identityModule.loadAccess).not.toHaveBeenCalled()
    expect(identityModule.cancel).not.toHaveBeenCalled()
  })

  it('restores an already bound WeChat account and resumes the chosen event action without rebinding', async () => {
    const page = createPage({ eventId: EVENT_ID, loginSheetOpen: true })
    page.authToken = 'identity-token'
    page.authIntent = 'participants'
    identityModule.signIn.mockResolvedValue({
      token: 'identity-token',
      decision: { ready: true },
      snapshot: { authenticated: true, phoneBound: true },
    })
    await callPage(page, 'onLoginSheetSignIn')
    expect(identityModule.bindWechatPhone).not.toHaveBeenCalled()
    expect(identityModule.complete).toHaveBeenCalledWith('identity-token')
    expect(navigateTo).toHaveBeenCalledWith({ url: `/packages/member/mip-events/participants/index?eventId=${EVENT_ID}&view=PUBLIC&kind=PLAYER` })
  })

  it('keeps the manual check-in fallback when the server rejects the auto check-in', async () => {
    const page = createPage()
    eventsModule.resolveCheckInScene.mockResolvedValueOnce({
      eventId: EVENT_ID,
      resumeToken: RESUME_TOKEN,
      validFrom: '2026-12-12T09:30:00+08:00',
      validUntil: CHECK_IN_INTENT.validUntil,
    })
    checkInStore.save.mockReturnValueOnce(CHECK_IN_INTENT)
    eventsModule.getEvent.mockResolvedValue(attendedEvent({ registrationStatus: 'REGISTERED' }))
    eventsModule.checkIn.mockRejectedValueOnce(new MipEventsError('REGISTRATION_REQUIRED', '当前账号尚未完成本场活动报名。'))

    await callPage(page, 'loadCheckInScene', SCAN_SCENE)
    await flushAsync()

    expect(showToast).not.toHaveBeenCalledWith({ title: '签到成功', icon: 'success' })
    expect(page.data.loginSheetOpen).toBe(false)
    expect(page.data.hasCheckInIntent).toBe(true)
    expect(checkInStore.clear).not.toHaveBeenCalled()
  })

  it('caps the auth-driven auto check-in retry at one attempt when identity and event states split', async () => {
    const page = createPage()
    eventsModule.resolveCheckInScene.mockResolvedValueOnce({
      eventId: EVENT_ID,
      resumeToken: RESUME_TOKEN,
      validFrom: '2026-12-12T09:30:00+08:00',
      validUntil: CHECK_IN_INTENT.validUntil,
    })
    checkInStore.save.mockReturnValueOnce(CHECK_IN_INTENT)
    eventsModule.getEvent.mockResolvedValue(attendedEvent({ registrationStatus: 'REGISTERED' }))
    // 状态分裂：身份会话始终 ready（requireAuthIntent 直接放行），活动服务始终要求授权。
    eventsModule.checkIn.mockRejectedValue(new MipEventsError('AUTH_REQUIRED', '请先完成登录'))
    identityModule.beginProtectedAction.mockResolvedValue({
      token: 'identity-token',
      decision: { ready: true },
      snapshot: { authenticated: true, phoneBound: true },
    })

    await callPage(page, 'loadCheckInScene', SCAN_SCENE)
    await flushAsync()

    // 授权驱动的自动重试仅一次（首试 + 单次重试），不形成无界循环。
    expect(eventsModule.checkIn).toHaveBeenCalledTimes(2)
    expect(showToast).not.toHaveBeenCalledWith({ title: '签到成功', icon: 'success' })
    expect(page.data.hasCheckInIntent).toBe(true)
    expect(checkInStore.clear).not.toHaveBeenCalled()
    expect(page.data.message).toContain('确认现场签到')
  })

  it('hides the 与你互动 card when the attended event has no interest data', async () => {
    const page = createPage({ eventId: EVENT_ID })
    eventsModule.getEvent.mockResolvedValueOnce(attendedEvent({
      interactionSummary: { myInterestCount: 0, receivedInterestCount: 0 },
    }))
    await callPage(page, 'loadEvent', { force: true })
    expect(page.data.interactionVisible).toBe(false)

    const withoutSummary = createPage({ eventId: EVENT_ID })
    eventsModule.getEvent.mockResolvedValueOnce(attendedEvent({ interactionSummary: undefined }))
    await callPage(withoutSummary, 'loadEvent', { force: true })
    expect(withoutSummary.data.interactionVisible).toBe(false)
  })

  it('deep-links the interaction pills to the matching participants tab and converges interaction routes', () => {
    const page = createPage({ eventId: EVENT_ID })
    page.data.event = attendedEvent()

    callPage(page, 'openInteractionView', { currentTarget: { dataset: { view: 'SENT' } } })
    expect(navigateTo).toHaveBeenCalledWith({
      url: `/packages/member/mip-events/participants/index?eventId=${EVENT_ID}&view=SENT`,
    })
    callPage(page, 'openInteractionView', { currentTarget: { dataset: { view: 'RECEIVED' } } })
    expect(navigateTo).toHaveBeenCalledWith({
      url: `/packages/member/mip-events/participants/index?eventId=${EVENT_ID}&view=RECEIVED`,
    })
    callPage(page, 'openInteractionView', { currentTarget: { dataset: {} } })
    expect(navigateTo).toHaveBeenLastCalledWith({
      url: `/packages/member/mip-events/participants/index?eventId=${EVENT_ID}&view=PUBLIC&kind=PLAYER`,
    })

    // journey-review J2-02：interaction 页入口全部收敛到 participants（页面文件保留一个迭代做兼容）。
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const checkIn = read('src/packages/member/mip-events/check-in/index.ts')
    const detailView = read('src/packages/member/mip-events/detail/index.wxml')
    expect(detail).not.toContain('mip-events/interaction')
    expect(checkIn).not.toContain('mip-events/interaction/index?eventId')
    expect(checkIn).toContain('mip-events/participants/index?eventId=')
    expect(detailView).toContain('data-view="SENT" catch:tap="openInteractionView"')
    expect(detailView).toContain('data-view="RECEIVED" catch:tap="openInteractionView"')
  })
})
