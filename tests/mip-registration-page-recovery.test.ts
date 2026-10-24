import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getEvent: vi.fn(),
  getMyRegistration: vi.fn(),
  register: vi.fn(),
  payOrder: vi.fn(),
  loadSnapshot: vi.fn(),
  peekSnapshot: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  removeDraft: vi.fn(),
  scroll: vi.fn(),
  toast: vi.fn(),
  navigateBack: vi.fn(),
  redirectTo: vi.fn(),
}))
vi.mock('../src/modules/mip-events/client', () => ({
  mipEventsModule: { getEvent: mocks.getEvent, getMyRegistration: mocks.getMyRegistration, register: mocks.register },
  mipCheckInResumeStore: { peek: vi.fn() },
  mipRegistrationDraftStore: { load: mocks.loadDraft, save: mocks.saveDraft, remove: mocks.removeDraft },
}))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: { payOrder: mocks.payOrder } }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: { subscriptionCapability: vi.fn(() => ({ available: false })), peekUnreadCount: vi.fn(() => 0), refreshUnreadCount: vi.fn() } }))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: { consumePendingResume: () => null, loadSnapshot: mocks.loadSnapshot, peekSnapshot: mocks.peekSnapshot },
  mipBranchesModule: {},
}))
vi.mock('../src/platform/feedback/client', () => ({ showErrorFeedback: vi.fn(), showPaymentLaunchFeedback: vi.fn(), hidePaymentLaunchFeedback: vi.fn() }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn(), caseRedirectTo: mocks.redirectTo }))
vi.mock('../src/platform/storage/component-media', () => ({ updatePageMedia: vi.fn(), clearPageMedia: vi.fn() }))

let definition: Record<string, any>
// MIW-106 review：页面栈用可变量注入而不是测试内 vi.stubGlobal 覆盖——后者会
// 永久替换同文件后续用例的栈，无栈兜底用例之后的用例再依赖双页栈会静默踩错。
const registrationStack = () => [{ route: 'packages/member/mip-events/registration/index' }, { route: 'packages/member/mip-events/detail/index' }]
let currentPages = registrationStack()
function page() {
  const instance = Object.create(definition)
  instance.data = structuredClone(definition.data)
  instance.setData = (value: Record<string, unknown>) => Object.assign(instance.data, value)
  return instance
}
const event = { formVersion: 2, canRegister: true, eventTypeLabel: '活动', registrationSchema: [
  { key: 'reason', label: '说明', type: 'TEXT', required: true },
  { key: 'choice', label: '选择', type: 'SELECT', options: ['新选项'] },
] }

beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  // MIW-126：报名支付全程有 loading 反馈。
  vi.stubGlobal('wx', { pageScrollTo: mocks.scroll, setNavigationBarTitle: vi.fn(), showToast: mocks.toast, navigateBack: mocks.navigateBack, showLoading: vi.fn(), hideLoading: vi.fn() })
  vi.stubGlobal('getCurrentPages', () => currentPages)
  await import('../src/packages/member/mip-events/registration/index')
})
beforeEach(() => {
  vi.clearAllMocks()
  currentPages = registrationStack()
  mocks.getEvent.mockResolvedValue(event)
  mocks.getMyRegistration.mockResolvedValue(null)
  mocks.loadSnapshot.mockResolvedValue({ userId: 'u1', profile: { nickname: '新昵称' }, phoneBound: true })
  mocks.peekSnapshot.mockReturnValue({ userId: 'u1' })
})
describe('registration page recovery', () => {
  it('submits only once when tapped twice while an invitation is resolving', async () => {
    const instance = page()
    instance.data.eventId = 'e1'
    await instance.loadEvent()
    instance.onTextInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '参加交流' } })
    let resolveInvitation!: () => void
    instance.invitationResolution = new Promise<void>((resolve) => {
      resolveInvitation = resolve
    })
    mocks.register.mockResolvedValue({ kind: 'REGISTERED' })
    const first = instance.submit()
    const second = instance.submit()
    expect(instance.data.busy).toBe(true)
    instance.onTextInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '提交时更改' } })
    expect(instance.data.fields[0].value).toBe('参加交流')
    expect(instance.submissionIdempotencyKey).not.toBe('')
    resolveInvitation()
    await Promise.all([first, second])
    expect(mocks.register).toHaveBeenCalledTimes(1)
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'e1',
      formVersion: 2,
      answers: { reason: '参加交流', choice: '' },
    }))
    // MIW-91：提交 payload 不再包含 shareProfile（开关已下线，服务端默认公开）。
    expect(mocks.register.mock.calls[0][0]).not.toHaveProperty('shareProfile')
    expect(instance.data.state).toBe('submitted')
    expect(instance.data.resultTitle).toBe('报名成功')
    expect(instance.data.busy).toBe(false)
  })
  it('retries an uncertain submission with the same request and preserves the form', async () => {
    const instance = page()
    instance.data.eventId = 'e1'
    await instance.loadEvent()
    instance.onTextInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '参加交流' } })
    mocks.register.mockRejectedValueOnce(new Error('连接中断')).mockResolvedValueOnce({ kind: 'REGISTERED' })
    await instance.submit()
    expect(instance.data.state).toBe('ready')
    expect(instance.data.busy).toBe(false)
    expect(instance.data.fields[0].value).toBe('参加交流')
    expect(mocks.removeDraft).not.toHaveBeenCalled()
    await instance.submit()
    expect(mocks.register).toHaveBeenCalledTimes(2)
    expect(mocks.register.mock.calls[1][0]).toEqual(mocks.register.mock.calls[0][0])
    expect(instance.data.state).toBe('submitted')
    expect(mocks.removeDraft).toHaveBeenCalledWith('u1', 'e1')
  })
  it('refreshes a first-registration schema conflict while preserving compatible answers', async () => {
    const instance = page()
    instance.data.eventId = 'e1'
    await instance.recoverUpdateConflict({ reason: '保留内容', choice: '已删除选项' })
    expect(instance.data.state).toBe('ready')
    expect(instance.data.editing).toBe(false)
    expect(instance.data.event.formVersion).toBe(2)
    expect(instance.data.fields[0].value).toBe('保留内容')
    expect(instance.data.fields[1].value).toBe('')
    expect(instance.data.fields[1].selectedIndex).toBe(-1)
  })
  it('opens pending-payment forms even though new registrations are disabled', async () => {
    mocks.getEvent.mockResolvedValue({ ...event, canRegister: false })
    mocks.getMyRegistration.mockResolvedValue({ status: 'PAYMENT_PENDING', version: 4, formVersion: 1, answers: { reason: '原内容' }, canEdit: false })
    const instance = page()
    instance.data.eventId = 'e1'
    await instance.loadEvent()
    expect(instance.data.state).toBe('ready')
    expect(instance.data.editing).toBe(false)
    expect(instance.data.fields[0].value).toBe('原内容')
  })
  it('shows an explicit unpaid state when payment is cancelled', async () => {
    const instance = page()
    instance.data.eventId = 'e1'
    await instance.loadEvent()
    instance.onTextInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '参加交流' } })
    mocks.register.mockResolvedValue({
      kind: 'PAYMENT_REQUIRED',
      status: 'PAYMENT_PENDING',
      registrationId: 'r1',
      orderId: 'o1',
      amountCents: 100,
      currency: 'CNY',
      holdExpiresAt: '2026-10-01T00:00:00.000Z',
      paymentAvailable: true,
    })
    mocks.payOrder.mockResolvedValue({ kind: 'CANCELLED' })

    await instance.submit()

    expect(instance.data.resultTitle).toBe('报名待支付')
    expect(instance.data.resultDescription).toContain('订单尚未支付，报名尚未生效')
    expect(instance.data.resultDescription).toContain('完成支付并确认报名资格后，报名才会生效')
    expect(instance.data.canContinueCheckIn).toBe(false)
  })
  it('keeps an uncertain payment result separate from the unpaid state', async () => {
    const instance = page()
    instance.data.eventId = 'e1'
    await instance.loadEvent()
    instance.onTextInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '参加交流' } })
    mocks.register.mockResolvedValue({
      kind: 'PAYMENT_REQUIRED',
      status: 'PAYMENT_PENDING',
      registrationId: 'r1',
      orderId: 'o1',
      amountCents: 100,
      currency: 'CNY',
      holdExpiresAt: '2026-10-01T00:00:00.000Z',
      paymentAvailable: true,
    })
    mocks.payOrder.mockResolvedValue({ kind: 'PENDING', order: {} })

    await instance.submit()

    expect(instance.data.resultTitle).toBe('报名待确认')
    expect(instance.data.resultDescription).toContain('支付结果正在确认')
    expect(instance.data.resultDescription).not.toContain('订单尚未支付')
    expect(instance.data.canContinueCheckIn).toBe(false)
  })
  it('returns to the event detail with a paid toast after a confirmed payment (MIW-106)', async () => {
    const instance = page()
    instance.data.eventId = 'e1'
    await instance.loadEvent()
    instance.onTextInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '参加交流' } })
    const draftsAfterFill = mocks.saveDraft.mock.calls.length
    const registrationsAfterLoad = mocks.getMyRegistration.mock.calls.length
    mocks.register.mockResolvedValue({
      kind: 'PAYMENT_REQUIRED',
      status: 'PAYMENT_PENDING',
      registrationId: 'r1',
      orderId: 'o1',
      amountCents: 100,
      currency: 'CNY',
      holdExpiresAt: '2026-10-01T00:00:00.000Z',
      paymentAvailable: true,
    })
    mocks.payOrder.mockResolvedValue({ kind: 'CONFIRMED', order: { id: 'o1', status: 'PAID' } })

    await instance.submit()

    expect(mocks.toast).toHaveBeenCalledWith({ title: '支付成功', icon: 'success' })
    expect(mocks.navigateBack).toHaveBeenCalledTimes(1)
    expect(mocks.redirectTo).not.toHaveBeenCalled()
    // 早退不重查报名资格；state 已置 submitted，finally 的 persistDraft 不回写已完成报名的草稿。
    expect(mocks.getMyRegistration.mock.calls.length).toBe(registrationsAfterLoad)
    expect(mocks.saveDraft.mock.calls.length).toBe(draftsAfterFill)
  })
  it('returns to the event detail with a success toast after a direct registration (MIW-129)', async () => {
    const instance = page()
    instance.data.eventId = 'e1'
    await instance.loadEvent()
    instance.onTextInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '参加交流' } })
    const draftsAfterFill = mocks.saveDraft.mock.calls.length
    const registrationsAfterLoad = mocks.getMyRegistration.mock.calls.length
    mocks.register.mockResolvedValue({ kind: 'REGISTERED', registrationId: 'r1', status: 'REGISTERED' })

    await instance.submit()

    expect(mocks.toast).toHaveBeenCalledWith({ title: '报名成功', icon: 'success' })
    expect(mocks.navigateBack).toHaveBeenCalledTimes(1)
    expect(mocks.redirectTo).not.toHaveBeenCalled()
    expect(instance.data.state).toBe('submitted')
    // 早退不重查报名资格；finally 的 persistDraft 不回写已完成报名的草稿。
    expect(mocks.getMyRegistration.mock.calls.length).toBe(registrationsAfterLoad)
    expect(mocks.saveDraft.mock.calls.length).toBe(draftsAfterFill)
  })
  it('keeps the check-in resume result view for a free registration too (MIW-129)', async () => {
    const instance = page()
    instance.data.eventId = 'e1'
    instance.data.resumeCheckIn = true
    await instance.loadEvent()
    instance.onTextInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '参加交流' } })
    mocks.register.mockResolvedValue({ kind: 'REGISTERED', registrationId: 'r1', status: 'REGISTERED' })

    await instance.submit()

    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.navigateBack).not.toHaveBeenCalled()
    expect(instance.data.state).toBe('submitted')
    expect(instance.data.resultTitle).toBe('报名成功')
    expect(instance.data.canContinueCheckIn).toBe(true)
  })
  it('keeps the check-in resume result view instead of auto-returning (MIW-106)', async () => {
    const instance = page()
    instance.data.eventId = 'e1'
    instance.data.resumeCheckIn = true
    await instance.loadEvent()
    instance.onTextInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '参加交流' } })
    mocks.getMyRegistration.mockResolvedValue({ status: 'REGISTERED' })
    mocks.register.mockResolvedValue({
      kind: 'PAYMENT_REQUIRED',
      status: 'PAYMENT_PENDING',
      registrationId: 'r1',
      orderId: 'o1',
      amountCents: 100,
      currency: 'CNY',
      holdExpiresAt: '2026-10-01T00:00:00.000Z',
      paymentAvailable: true,
    })
    mocks.payOrder.mockResolvedValue({ kind: 'CONFIRMED', order: { id: 'o1', status: 'PAID' } })

    await instance.submit()

    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.navigateBack).not.toHaveBeenCalled()
    expect(instance.data.state).toBe('submitted')
    expect(instance.data.resultTitle).toBe('报名成功')
    expect(instance.data.canContinueCheckIn).toBe(true)
  })
  it('falls back to the detail page when there is no stack to pop', async () => {
    currentPages = [{ route: 'packages/member/mip-events/registration/index' }]
    const instance = page()
    instance.data.eventId = 'e1'
    instance.returnToEventDetail()
    expect(mocks.navigateBack).not.toHaveBeenCalled()
    expect(mocks.redirectTo).toHaveBeenCalledWith({ url: '/packages/member/mip-events/detail/index?eventId=e1' })
  })
  it('blocks retry after the event closes', async () => {
    mocks.getEvent.mockResolvedValue({ ...event, canRegister: false })
    const instance = page()
    await instance.recoverUpdateConflict({ reason: '保留内容' }, false)
    expect(instance.data.state).toBe('blocked')
  })
  it('refreshes profile on return without replacing the form draft', async () => {
    const instance = page()
    instance.data.state = 'ready'
    instance.data.fields = [{ value: '正在填写' }]
    instance.onShow()
    await vi.waitFor(() => expect(instance.data.profileNickname).toBe('新昵称'))
    expect(instance.data.profilePhoneText).toBe('手机号已绑定')
    expect(instance.data.fields).toEqual([{ value: '正在填写' }])
  })
  it('scrolls to the first invalid field in long forms', () => {
    const instance = page()
    instance.data.fields = [
      { label: '选填', type: 'TEXT', value: '', required: false },
      { label: '必填', type: 'TEXT', value: '', required: true },
    ]
    expect(instance.validate()).toBe(false)
    expect(mocks.scroll).toHaveBeenCalledWith({ selector: '#registration-field-1', duration: 200 })
  })
})

it('starts independent registration reads together and reveals the form before profile metadata', async () => {
  let finishEvent!: (value: unknown) => void
  const eventResponse = new Promise((resolve) => {
    finishEvent = resolve
  })
  mocks.getEvent.mockReturnValueOnce(eventResponse)
  const instance = page()
  instance.data.eventId = 'event-1'
  instance.loadProfileSummary = vi.fn(() => new Promise(() => {}))
  const loading = instance.loadEvent()
  expect(mocks.getMyRegistration).toHaveBeenCalledWith('event-1')
  finishEvent(event)
  await loading
  expect(instance.data.state).toBe('ready')
  expect(instance.data.fields).toHaveLength(2)
  expect(mocks.getEvent).toHaveBeenCalledWith('event-1', { progressiveMedia: true })
})

it('keeps a saved draft available before slow profile metadata arrives', async () => {
  mocks.loadDraft.mockReturnValueOnce({ answers: { reason: '已保存的报名说明' } })
  const instance = page()
  instance.data.eventId = 'event-1'
  instance.loadProfileSummary = vi.fn(() => new Promise(() => {}))
  await instance.loadEvent()
  expect(instance.data.fields[0].value).toBe('已保存的报名说明')
  expect(mocks.loadDraft).toHaveBeenCalledWith('u1', 'event-1', null)
})

it('does not overwrite newly typed answers when late identity metadata discovers an old draft', async () => {
  let finishProfile!: (value: unknown) => void
  mocks.peekSnapshot.mockReturnValueOnce(undefined)
  mocks.loadSnapshot.mockReturnValueOnce(new Promise((resolve) => {
    finishProfile = resolve
  }))
  const instance = page()
  instance.data.eventId = 'event-1'
  await instance.loadEvent()
  instance.onTextInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '刚输入的新说明' } })
  finishProfile({ userId: 'u1', profile: { nickname: '新昵称' }, phoneBound: true })
  await vi.waitFor(() => expect(mocks.saveDraft).toHaveBeenCalled())
  expect(instance.data.fields[0].value).toBe('刚输入的新说明')
  expect(mocks.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'u1', answers: expect.objectContaining({ reason: '刚输入的新说明' }) }))
  expect(mocks.loadDraft).not.toHaveBeenCalled()
})
