import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipIdentityGateway } from '../src/modules/mip-identity/gateway'

const { request, bind, snapshot, leave, toast } = vi.hoisted(() => ({ request: vi.fn(), bind: vi.fn(), snapshot: vi.fn(), leave: vi.fn(), toast: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { requestPhoneSms: request, rebindSmsPhone: bind, loadSnapshot: snapshot } }))
vi.mock('../src/modules/mip-identity/runtime', () => ({ mipGlobalAccessGuard: { enterTarget: vi.fn() } }))
vi.mock('../src/platform/navigation/client', () => ({ leaveSecondaryPage: leave }))
let definition: Record<string, any>
const dto = { challengeId: '10000000-0000-4000-8000-000000000002', retryAfterSeconds: 60, expiresAt: '2026-09-22T08:05:00Z', status: 'ACCEPTED' }
const phone = '13800000000'
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/bind-phone/index')
})
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-22T08:00:00Z'))
  for (const fn of [request, bind, snapshot, leave, toast]) {
    fn.mockReset()
  }
  vi.stubGlobal('wx', { showToast: toast })
  request.mockResolvedValue(dto)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
function page() {
  const instance = Object.create(definition)
  instance.data = structuredClone(definition.data)
  instance.data.state = 'ready'
  instance.data.newPhone = phone
  instance.setData = vi.fn((patch: object) => Object.assign(instance.data, patch))
  return instance
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('SMS phone-rebinding contract and lifecycle', () => {
  it('validates actual success envelope fields and submits the challenge returned by the server once', async () => {
    const invoke = vi.fn(async () => ({ ok: true, data: { ...dto, code: 'must-not-pass', phone: 'must-not-pass' } }))
    const gateway = createMipIdentityGateway({ invoke })
    request.mockImplementation(value => gateway.requestPhoneSms(value))
    const p = page()
    await p.requestSmsCode()
    expect(invoke).toHaveBeenCalledWith({ contractVersion: 1, action: 'requestPhoneSms', input: { phone } })
    expect(p.smsChallenge).toEqual({ id: dto.challengeId, phone, expiresAt: Date.parse(dto.expiresAt) })
    expect(p.data.sendCountdown).toBe(60)
    const pending = deferred<any>()
    bind.mockReturnValue(pending.promise)
    p.data.smsCode = '123456'
    const submission = p.confirmRebind()
    await p.confirmRebind()
    expect(bind).toHaveBeenCalledTimes(1)
    expect(bind).toHaveBeenCalledWith({ phone, code: '123456', challengeId: dto.challengeId })
    expect(toast).not.toHaveBeenCalled()
    pending.resolve({ profile: { privateContact: { phoneMasked: '138****0000' } } })
    await submission
    expect(p.data.currentPhoneMasked).toBe('138****0000')
    expect(p.smsChallenge).toBeUndefined()
    expect(p.data.newPhone).toBe('')
    expect(toast).toHaveBeenCalledWith({ title: '换绑成功', icon: 'success' })
    await vi.advanceTimersByTimeAsync(700)
    expect(leave).toHaveBeenCalledWith('/pages/profile/index')
  })
  it('prevents duplicate sends while pending and uses wall-clock cooldown after backgrounding', async () => {
    const pending = deferred<typeof dto>()
    request.mockReturnValue(pending.promise)
    const p = page()
    const first = p.requestSmsCode()
    await p.requestSmsCode()
    expect(request).toHaveBeenCalledTimes(1)
    pending.resolve(dto)
    await first
    await p.requestSmsCode()
    expect(request).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-22T08:01:01Z'))
    p.onShow()
    expect(p.data.sendCountdown).toBe(0)
    await p.requestSmsCode()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('invalidates a pending phone challenge if the user edits the number', async () => {
    const pending = deferred<typeof dto>()
    request.mockReturnValue(pending.promise)
    const p = page()
    const first = p.requestSmsCode()
    p.onNewPhoneInput({ detail: { value: '13900000000' } })
    pending.resolve(dto)
    await first
    expect(p.smsChallenge).toBeUndefined()
    expect(p.data.sendCountdown).toBe(60)
    p.data.smsCode = '123456'
    await p.confirmRebind()
    expect(bind).not.toHaveBeenCalled()
    expect(p.data.message).toBe('请重新获取短信验证码。')
  })
  it('preserves user input on conflicts and disabled transport never starts a false cooldown', async () => {
    const p = page()
    p.data.smsCode = '123456'
    request.mockRejectedValueOnce(new Error('短信验证尚未开通，可使用微信一键获取换绑'))
    await p.requestSmsCode()
    expect(p.data.sendCountdown).toBe(0)
    expect(p.data.sendingSms).toBe(false)
    expect(p.data.smsCode).toBe('123456')
    expect(p.smsChallenge).toBeUndefined()
    await p.requestSmsCode()
    p.data.smsCode = '654321'
    bind.mockRejectedValueOnce(new Error('该手机号已绑定其他账号'))
    await p.confirmRebind()
    expect(p.data.newPhone).toBe(phone)
    expect(p.data.smsCode).toBe('654321')
    expect(p.data.rebinding).toBe(false)
    expect(p.data.message).toBe('该手机号已绑定其他账号')
    expect(toast).not.toHaveBeenCalled()
    expect(leave).not.toHaveBeenCalled()
  })
  it('requires a current challenge and ignores late responses after page unload', async () => {
    const p = page()
    await p.requestSmsCode()
    p.data.smsCode = '123456'
    vi.setSystemTime(new Date('2026-09-22T08:05:00Z'))
    await p.confirmRebind()
    expect(bind).not.toHaveBeenCalled()
    const pending = deferred<typeof dto>()
    request.mockReturnValue(pending.promise)
    const first = p.requestSmsCode()
    p.onUnload()
    p.setData.mockClear()
    pending.resolve(dto)
    await first
    expect(p.setData).not.toHaveBeenCalled()
    expect(p.countdownTimer).toBeUndefined()
  })
  it('rejects malformed provider envelopes and exposes the server disabled message', async () => {
    for (const data of [{ ...dto, status: 'SENT' }, { ...dto, retryAfterSeconds: 0 }, { ...dto, expiresAt: 'invalid' }, { ...dto, challengeId: 'raw-otp' }]) {
      const gateway = createMipIdentityGateway({ invoke: async () => ({ ok: true, data }) })
      await expect(gateway.requestPhoneSms(phone)).rejects.toThrow('格式不正确')
    }
    const gateway = createMipIdentityGateway({ invoke: async () => ({ ok: false, error: { code: 'SMS_DISABLED', message: '短信验证尚未开通', retryable: false } }) })
    await expect(gateway.requestPhoneSms(phone)).rejects.toThrow('短信验证尚未开通')
  })
})
