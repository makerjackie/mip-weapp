import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getEvent: vi.fn(),
  getMyRegistration: vi.fn(),
  register: vi.fn(),
  loadSnapshot: vi.fn(),
  peekSnapshot: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  removeDraft: vi.fn(),
  scroll: vi.fn(),
}))
vi.mock('../src/modules/mip-events/client', () => ({
  mipEventsModule: { getEvent: mocks.getEvent, getMyRegistration: mocks.getMyRegistration, register: mocks.register },
  mipCheckInResumeStore: { peek: vi.fn() },
  mipRegistrationDraftStore: { load: mocks.loadDraft, save: mocks.saveDraft, remove: mocks.removeDraft },
}))
vi.mock('../src/modules/mip-commerce/client', () => ({ mipCommerceModule: {} }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: {} }))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: { consumePendingResume: () => null, loadSnapshot: mocks.loadSnapshot, peekSnapshot: mocks.peekSnapshot },
  mipBranchesModule: {},
}))
vi.mock('../src/platform/feedback/client', () => ({ showErrorFeedback: vi.fn() }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))

let definition: Record<string, any>
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
  vi.stubGlobal('wx', { pageScrollTo: mocks.scroll, setNavigationBarTitle: vi.fn() })
  await import('../src/packages/member/mip-events/registration/index')
})
beforeEach(() => {
  vi.clearAllMocks()
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
    instance.onShareProfileChange({ detail: { value: true } })
    expect(instance.data.fields[0].value).toBe('参加交流')
    expect(instance.submissionIdempotencyKey).not.toBe('')
    resolveInvitation()
    await Promise.all([first, second])
    expect(mocks.register).toHaveBeenCalledTimes(1)
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'e1',
      formVersion: 2,
      answers: { reason: '参加交流', choice: '' },
      shareProfile: false,
    }))
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
    await instance.recoverUpdateConflict({ reason: '保留内容', choice: '已删除选项' }, true)
    expect(instance.data.state).toBe('ready')
    expect(instance.data.editing).toBe(false)
    expect(instance.data.event.formVersion).toBe(2)
    expect(instance.data.fields[0].value).toBe('保留内容')
    expect(instance.data.fields[1].value).toBe('')
    expect(instance.data.fields[1].selectedIndex).toBe(-1)
    expect(instance.data.shareProfile).toBe(true)
  })
  it('opens pending-payment forms even though new registrations are disabled', async () => {
    mocks.getEvent.mockResolvedValue({ ...event, canRegister: false })
    mocks.getMyRegistration.mockResolvedValue({ status: 'PAYMENT_PENDING', version: 4, formVersion: 1, answers: { reason: '原内容' }, shareProfile: true, canEdit: false })
    const instance = page()
    instance.data.eventId = 'e1'
    await instance.loadEvent()
    expect(instance.data.state).toBe('ready')
    expect(instance.data.editing).toBe(false)
    expect(instance.data.fields[0].value).toBe('原内容')
    expect(instance.data.shareProfile).toBe(true)
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
