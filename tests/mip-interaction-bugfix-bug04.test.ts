/**
 * 交互类使用 Bug 修复回归（审计 2026-10-12，docs/research/weapp-interaction-bugs-audit-2026-10-12.md）。
 * 覆盖：BUG-04（授权门禁异步窗口无锁：活动详情主按钮/参与人、机会页 openProtected、
 * 订单详情继续支付）、BUG-09.1（退款确认弹窗双弹 + 误导文案）、BUG-04.4（分会设为主分会
 * 版本冲突横幅）、BUG-12.2（活动详情 inviteRef 双请求与失效兜底）。
 * 核心断言口径：双击（第二次调用发生在首次 begin()/身份检查的 await 窗口内）时，
 * 模块方法只被调用一次、只导航一次；锁在完成/取消/异常路径均复位。
 */
import type { MipEventDetail } from '../src/modules/mip-events'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const eventsModule = vi.hoisted(() => ({
  peekEvent: vi.fn(),
  getEvent: vi.fn(),
  resolveInvitationScene: vi.fn(),
  resolveCheckInScene: vi.fn(),
  checkIn: vi.fn(),
  createInvitation: vi.fn(),
  createInvitationUrl: vi.fn(),
  getMyRegistration: vi.fn(),
}))
const checkInStore = vi.hoisted(() => ({ peek: vi.fn(), save: vi.fn(), clear: vi.fn() }))
const identityModule = vi.hoisted(() => ({
  beginProtectedAction: vi.fn(),
  isSignedOut: vi.fn(() => false),
  signIn: vi.fn(),
  loadAccess: vi.fn(),
  bindWechatPhone: vi.fn(),
  loadSnapshot: vi.fn(),
  peekSnapshot: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
  consumePendingResume: vi.fn(() => null),
}))
const branchesModule = vi.hoisted(() => ({ load: vi.fn(), setPrimaryBranch: vi.fn() }))
const commerceModule = vi.hoisted(() => ({
  ensurePaymentCapability: vi.fn(async () => ({ mode: 'test', catalogStage: 'TEST', available: true })),
  getOrder: vi.fn(),
  listPlans: vi.fn(),
  reconcile: vi.fn(),
  payOrder: vi.fn(),
  requestRefund: vi.fn(),
}))
const navigateTo = vi.hoisted(() => vi.fn())
const redirectTo = vi.fn()
const syncCaseNavigation = vi.fn()
const showToast = vi.hoisted(() => vi.fn())
const showModal = vi.hoisted(() => vi.fn())

vi.mock('../src/config/brand', () => ({ brand: { productName: 'MIP', logoPath: '/assets/logo.png' } }))
vi.mock('../src/config/mip-catalogs', () => ({ cooperationRoles: [] }))
vi.mock('../src/config/runtime', () => ({ runtimeConfig: {} }))
vi.mock('../src/components/catalog-selector/model', () => ({
  catalogSelectorView: () => ({ viewGroups: [], popularOptions: [] }),
}))
vi.mock('../src/modules/mip-banners', () => ({ mipBannerModule: { listActive: vi.fn() } }))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: commerceModule }))
vi.mock('../src/modules/mip-cooperation', () => ({ cooperationModule: { listTalents: vi.fn() } }))
vi.mock('../src/modules/mip-cooperation/validation', () => ({
  mergeCooperationTalents: (current: unknown) => current,
}))
vi.mock('../src/modules/mip-events/client', () => ({
  mipCheckInResumeStore: checkInStore,
  mipEventsModule: eventsModule,
}))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: identityModule,
  mipBranchesModule: branchesModule,
}))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: { getCatalogs: vi.fn(), list: vi.fn(), listMine: vi.fn() },
  groupedCityBranches: () => [],
  opportunityTypeLabel: (key: string) => key,
}))
vi.mock('../src/platform/cloudbase/client', () => ({ requireCloudClient: vi.fn() }))
vi.mock('../src/platform/navigation/client', () => ({
  caseNavigateTo: navigateTo,
  caseRedirectTo: redirectTo,
  syncCaseNavigation,
}))
vi.mock('../src/platform/storage/cloud-media', () => ({
  peekCloudFileUrls: (value: unknown) => value,
}))
vi.mock('../src/platform/storage/component-media', () => ({
  clearComponentMedia: vi.fn(),
  updateComponentMedia: vi.fn(),
}))
vi.mock('../src/platform/wechat/channels', () => ({ openWechatChannelsDestination: vi.fn() }))

type PageDefinition = Record<string, any>

const pages: Record<string, PageDefinition> = {}
let latestPage: PageDefinition | undefined

beforeAll(async () => {
  vi.stubGlobal('wx', {
    showToast,
    showModal,
    setClipboardData: vi.fn(),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  })
  vi.stubGlobal('Page', (value: PageDefinition) => {
    latestPage = value
  })
  await import('../src/packages/member/mip-events/detail/index')
  pages.eventDetail = latestPage!
  await import('../src/pages/opportunities/index')
  pages.opportunities = latestPage!
  await import('../src/packages/member/order-detail/index')
  pages.orderDetail = latestPage!
  await import('../src/packages/member/mip-branches/index')
  pages.branches = latestPage!
})

function createPage(definitionKey: string, overrides: Record<string, unknown> = {}) {
  const definition = pages[definitionKey]
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = (patch: Record<string, unknown>) => Object.assign(page.data, patch)
  return page
}

/** begin() 挂起待解：让第二次 tap 落在身份检查的网络往返窗口内（双击时序）。 */
function pendingBegin() {
  let resolveBegin!: (session: unknown) => void
  identityModule.beginProtectedAction.mockImplementation(() => new Promise<unknown>((resolve) => {
    resolveBegin = resolve
  }))
  return (session: unknown) => resolveBegin(session)
}

function readySession() {
  return { token: 'tok-ready', intent: {}, snapshot: { authenticated: true }, decision: { ready: true } }
}

function sheetSession() {
  return {
    token: 'tok-sheet',
    intent: {},
    snapshot: { authenticated: false, phoneBound: false },
    decision: { ready: false, nextRequirement: 'PHONE' },
  }
}

async function flushAsync() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
  }
}

const EVENT_ID = '60000000-0000-4000-8000-000000000001'

function eventDetailFixture(): MipEventDetail {
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
    endsAt: '2026-12-12T12:30:00+08:00',
    status: 'PUBLISHED',
    registrationCount: 45,
    participantPreview: [],
    registrationStatus: 'ATTENDED',
    description: '活动介绍',
    onlineAccessAvailable: false,
    registrationPolicy: 'AUTO',
    registrationSchema: [],
    changes: [],
    canRegister: true,
    canCancel: false,
    canRetryRefund: false,
    canCheckIn: false,
    canInteract: true,
    priceCents: 58900,
    currency: 'CNY',
    formVersion: 1,
    interactionSummary: { myInterestCount: 2, receivedInterestCount: 2 },
  } as MipEventDetail
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const mock of [
    ...Object.values(eventsModule),
    ...Object.values(checkInStore),
    ...Object.values(identityModule),
    ...Object.values(branchesModule),
    ...Object.values(commerceModule),
    navigateTo,
    redirectTo,
    showToast,
    showModal,
  ]) {
    mock.mockReset()
  }
  identityModule.consumePendingResume.mockReturnValue(null)
  identityModule.isSignedOut.mockReturnValue(false)
  identityModule.peekSnapshot.mockReturnValue({ primaryBranchId: 'b1', userVersion: 2 })
  showModal.mockResolvedValue({ confirm: false })
  commerceModule.getOrder.mockResolvedValue({
    id: 'o1',
    orderType: 'MEMBERSHIP',
    status: 'PAID',
    amountCents: 59800,
    priceItems: [],
    refundedAmountCents: 0,
  })
  commerceModule.listPlans.mockResolvedValue([])
  commerceModule.requestRefund.mockResolvedValue({ refundId: 'refund-1', status: 'PENDING' })
})

describe('BUG-04.1 活动详情授权窗口锁（handlePrimary / openParticipants）', () => {
  it('已登录双击「立刻报名」只 begin 一次、报名页只入栈一次，busy 全程复位', async () => {
    const page = createPage('eventDetail', { eventId: EVENT_ID, primaryAction: 'register' })
    const resolveBegin = pendingBegin()

    const first = page.handlePrimary()
    // 双击：第二次 tap 落在 begin() 的网络往返窗口内，须被 busy 闩锁拦下。
    void page.handlePrimary()
    expect(identityModule.beginProtectedAction).toHaveBeenCalledTimes(1)

    resolveBegin(readySession())
    await first
    await flushAsync()

    expect(navigateTo).toHaveBeenCalledTimes(1)
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/packages/member/mip-events/registration/index?eventId='),
    }))
    expect(page.data.busy).toBe(false)
  })

  it('已登录双击参与人数入口只 begin 一次、参与人页只入栈一次', async () => {
    const page = createPage('eventDetail', { eventId: EVENT_ID })
    const resolveBegin = pendingBegin()

    const first = page.openParticipants()
    void page.openParticipants()
    expect(identityModule.beginProtectedAction).toHaveBeenCalledTimes(1)

    resolveBegin(readySession())
    await first
    await flushAsync()

    expect(navigateTo).toHaveBeenCalledTimes(1)
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/packages/member/mip-events/participants/index?eventId='),
    }))
    expect(page.data.busy).toBe(false)
  })

  it('游客双击只产生一个身份会话 token，弹层幂等行为保持不变', async () => {
    const page = createPage('eventDetail', { eventId: EVENT_ID, primaryAction: 'register' })
    identityModule.beginProtectedAction.mockResolvedValue(sheetSession())

    await page.handlePrimary()
    expect(page.data.busy).toBe(false)
    expect(page.data.loginSheetOpen).toBe(true)
    expect(identityModule.beginProtectedAction).toHaveBeenCalledTimes(1)
    expect(page.authToken).toBe('tok-sheet')

    // 弹层挂起期间的再次点击走 authToken 短路，不再发起第二次 begin（不再产生第二个 token）。
    await page.handlePrimary()
    expect(identityModule.beginProtectedAction).toHaveBeenCalledTimes(1)
    expect(page.data.loginSheetOpen).toBe(true)
  })
})

describe('BUG-12.2 活动详情 inviteRef 双请求', () => {
  it('邀请路径只发起一次活动详情请求（loadInvitationScene 内部统一加载）', async () => {
    const page = createPage('eventDetail')
    eventsModule.resolveInvitationScene.mockResolvedValue({ eventId: EVENT_ID, invitationToken: 'inv-tok' })
    eventsModule.getEvent.mockResolvedValue(eventDetailFixture())

    page.onLoad({ eventId: EVENT_ID, inviteRef: 'i1.aaaaaaaaaaa.bbbbbbbbbbb' })
    await flushAsync()

    expect(eventsModule.resolveInvitationScene).toHaveBeenCalledTimes(1)
    expect(eventsModule.getEvent).toHaveBeenCalledTimes(1)
    expect(page.data.state).toBe('ready')
  })

  it('onLoad 后紧跟的 onShow 复验不再抢跑第二次详情请求', async () => {
    const page = createPage('eventDetail')
    let resolveScene!: (value: unknown) => void
    eventsModule.resolveInvitationScene.mockImplementation(() => new Promise((resolve) => {
      resolveScene = resolve
    }))
    eventsModule.getEvent.mockResolvedValue(eventDetailFixture())

    page.onLoad({ eventId: EVENT_ID, inviteRef: 'i1.aaaaaaaaaaa.bbbbbbbbbbb' })
    // 微信生命周期：onShow 紧随 onLoad，且此刻邀请解析仍在途。
    page.onShow()
    await flushAsync()
    expect(eventsModule.getEvent).not.toHaveBeenCalled()

    resolveScene({ eventId: EVENT_ID, invitationToken: 'inv-tok' })
    await flushAsync()
    expect(eventsModule.getEvent).toHaveBeenCalledTimes(1)
    expect(page.data.state).toBe('ready')
  })

  it('邀请解析失败时兜底加载详情，页面不卡 loading 且保留失效提示', async () => {
    const page = createPage('eventDetail')
    eventsModule.resolveInvitationScene.mockRejectedValue(new Error('EVENT_INVITATION_INVALID'))
    eventsModule.getEvent.mockResolvedValue(eventDetailFixture())

    page.onLoad({ eventId: EVENT_ID, inviteRef: 'i1.expired.ref' })
    // 同上：解析失败的兜底加载也要挡住紧随的 onShow 复验。
    page.onShow()
    await flushAsync()

    expect(eventsModule.getEvent).toHaveBeenCalledTimes(1)
    expect(page.data.state).toBe('ready')
    expect(page.data.message).toBe('活动邀请无效或已失效，已按普通活动打开。')
  })
})

describe('BUG-04.2 机会页 openProtected 动作锁', () => {
  it('双击「发布机会」只 begin 一次、编辑器只入栈一次，锁随后释放', async () => {
    const page = createPage('opportunities')
    const resolveBegin = pendingBegin()

    const first = page.openProtected('/packages/member/mip-opportunities/editor/index', 'PUBLISH_OPPORTUNITY')
    void page.openProtected('/packages/member/mip-opportunities/editor/index', 'PUBLISH_OPPORTUNITY')
    expect(identityModule.beginProtectedAction).toHaveBeenCalledTimes(1)

    resolveBegin(readySession())
    await first
    await flushAsync()

    expect(navigateTo).toHaveBeenCalledTimes(1)
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/packages/member/mip-opportunities/editor/index',
    })
    expect(page.data.openingAction).toBe(false)
    expect(page.openingActionLock).toBe(false)
  })

  it('游客双击只产生一个身份会话 token，弹层路径锁复位', async () => {
    const page = createPage('opportunities')
    identityModule.beginProtectedAction.mockResolvedValue(sheetSession())

    page.publish()
    await flushAsync()
    // 双击的第二次在锁复位后抵达：authToken 已挂起，begin 短路成 sheet，不再产生第二个 token。
    page.publish()
    await flushAsync()

    expect(identityModule.beginProtectedAction).toHaveBeenCalledTimes(1)
    expect(page.data.loginSheetOpen).toBe(true)
    expect(page.data.openingAction).toBe(false)
    expect(page.openingActionLock).toBe(false)
  })

  it('身份无法确认时提示并复位锁，入口不被永久哑火', async () => {
    const page = createPage('opportunities')
    identityModule.beginProtectedAction.mockRejectedValue(new Error('identity unavailable'))

    await page.openProtected('/packages/member/mip-opportunities/editor/index', 'PUBLISH_OPPORTUNITY')

    expect(page.data.message).toBe('身份状态暂时无法确认，请稍后重试。')
    expect(page.data.openingAction).toBe(false)
    expect(page.openingActionLock).toBe(false)
    // 复位后可再次触发（新一轮 begin）。
    identityModule.beginProtectedAction.mockResolvedValue(readySession())
    await page.openProtected('/packages/member/mip-opportunities/editor/index', 'PUBLISH_OPPORTUNITY')
    expect(identityModule.beginProtectedAction).toHaveBeenCalledTimes(2)
  })
})

describe('BUG-04.3 订单详情「继续支付」窗口锁', () => {
  function orderPage() {
    const page = createPage('orderDetail', {
      orderId: 'o1',
      order: { id: 'o1', orderType: 'EVENT', resourceId: 'e1' },
      paymentPending: true,
    })
    page.onLoad({ orderId: 'o1' })
    return page
  }

  it('双击只 begin 一次；身份不 ready 时授权页只入栈一次且 accessing 复位', async () => {
    const page = orderPage()
    const resolveBegin = pendingBegin()

    const first = page.requestPayment()
    void page.requestPayment()
    expect(identityModule.beginProtectedAction).toHaveBeenCalledTimes(1)

    resolveBegin({ token: 'tok-access', intent: {}, snapshot: {}, decision: { ready: false } })
    await first
    await flushAsync()

    expect(navigateTo).toHaveBeenCalledTimes(1)
    expect(page.data.accessing).toBe(false)
    expect(commerceModule.payOrder).not.toHaveBeenCalled()
  })

  it('begin 异常时复位 accessing 并提示，不误伤后续重试', async () => {
    const page = orderPage()
    identityModule.beginProtectedAction.mockRejectedValue(new Error('identity unavailable'))

    await page.requestPayment()

    expect(page.data.accessing).toBe(false)
    expect(page.data.message).toBe('身份状态暂时无法确认，请稍后重试。')
  })
})

describe('BUG-09.1 订单详情退款确认窗口锁', () => {
  function refundPage() {
    const page = createPage('orderDetail', {
      orderId: 'o1',
      order: { id: 'o1', orderType: 'MEMBERSHIP' },
      refundable: true,
    })
    page.onLoad({ orderId: 'o1' })
    return page
  }

  it('双击只 begin 一次、只弹一个确认框；取消弹窗后锁复位且不出现误导文案', async () => {
    const page = refundPage()
    const resolveBegin = pendingBegin()

    const first = page.requestRefund()
    void page.requestRefund()
    expect(identityModule.beginProtectedAction).toHaveBeenCalledTimes(1)

    resolveBegin(readySession())
    await first
    await flushAsync()

    expect(showModal).toHaveBeenCalledTimes(1)
    expect(commerceModule.requestRefund).not.toHaveBeenCalled()
    expect(page.data.submittingRefund).toBe(false)
    expect(page.data.message).toBe('')
  })

  it('确认提交走 refundKey 幂等提交一次并复位锁', async () => {
    const page = refundPage()
    showModal.mockResolvedValue({ confirm: true })
    identityModule.beginProtectedAction.mockResolvedValue(readySession())

    await page.requestRefund()
    await flushAsync()

    expect(commerceModule.requestRefund).toHaveBeenCalledTimes(1)
    expect(commerceModule.requestRefund).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'o1',
      idempotencyKey: page.refundKey,
    }))
    expect(page.data.submittingRefund).toBe(false)
    // 提交成功后 load() 的 applyOrder 会复位 message（与原实现一致），此处只锁行为不 pin 文案时序。
    expect(commerceModule.getOrder).toHaveBeenCalledTimes(1)
  })

  it('授权恢复直达入口 confirmAndSubmitRefund 自持锁：一次弹窗、一次提交', async () => {
    const page = refundPage()
    showModal.mockResolvedValue({ confirm: true })

    const first = page.confirmAndSubmitRefund()
    void page.confirmAndSubmitRefund()
    expect(showModal).toHaveBeenCalledTimes(1)

    await first
    await flushAsync()

    expect(commerceModule.requestRefund).toHaveBeenCalledTimes(1)
    expect(page.data.submittingRefund).toBe(false)
  })
})

describe('BUG-04.4 分会页「设为主分会」窗口锁', () => {
  function branchesPage() {
    return createPage('branches', {
      state: 'ready',
      branches: [
        { id: 'b1', name: '深圳分会', cityName: '深圳', selected: true },
        { id: 'b2', name: '广州分会', cityName: '广州', selected: false },
      ],
    })
  }

  function tapEvent(branchId: string) {
    return { currentTarget: { dataset: { id: branchId } } }
  }

  it('双击只 begin / setPrimaryBranch 一次，成功 toast 后不再出现冲突横幅', async () => {
    const page = branchesPage()
    const resolveBegin = pendingBegin()
    branchesModule.setPrimaryBranch.mockResolvedValue({ branches: [], primaryBranchId: 'b2', userVersion: 3 })

    const first = page.selectBranch(tapEvent('b2'))
    // 双击落在身份检查往返窗口内，且按钮 loading（selectingId）已提前置位。
    void page.selectBranch(tapEvent('b2'))
    expect(page.data.selectingId).toBe('b2')
    expect(identityModule.beginProtectedAction).toHaveBeenCalledTimes(1)

    resolveBegin(readySession())
    await first
    await flushAsync()

    expect(branchesModule.setPrimaryBranch).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith({ title: '主分会已更新', icon: 'success' })
    expect(page.data.selectingId).toBe('')
    expect(page.data.message).toBe('')
  })

  it('身份不 ready 转交授权页时复位锁，返回后可重试', async () => {
    const page = branchesPage()
    identityModule.beginProtectedAction.mockResolvedValue({
      token: 'tok-access',
      intent: {},
      snapshot: {},
      decision: { ready: false },
    })

    await page.selectBranch(tapEvent('b2'))

    expect(navigateTo).toHaveBeenCalledTimes(1)
    expect(page.data.selectingId).toBe('')
    expect(branchesModule.setPrimaryBranch).not.toHaveBeenCalled()
  })

  it('身份检查异常时复位锁并提示', async () => {
    const page = branchesPage()
    identityModule.beginProtectedAction.mockRejectedValue(new Error('identity unavailable'))

    await page.selectBranch(tapEvent('b2'))

    expect(page.data.selectingId).toBe('')
    expect(page.data.message).toBe('身份状态暂时无法确认，请稍后重试。')
    expect(branchesModule.setPrimaryBranch).not.toHaveBeenCalled()
  })
})
