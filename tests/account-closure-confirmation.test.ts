import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountClosureConfirmationPhrase, MipIdentityGatewayError } from '../src/modules/mip-identity'

const api = vi.hoisted(() => ({ closeAccount: vi.fn(), loadSnapshot: vi.fn(), showModal: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: { closeAccount: api.closeAccount, loadSnapshot: api.loadSnapshot },
}))
vi.mock('../src/modules/mip-identity/local-session-client', () => ({ mipLocalSession: { signOut: vi.fn() } }))
vi.mock('../src/modules/mip-identity/runtime', () => ({ mipGlobalAccessGuard: { enterTarget: vi.fn() } }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))

let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/privacy/index')
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('wx', { showModal: api.showModal })
  api.loadSnapshot.mockResolvedValue({ authenticated: true, userStatus: 'ACTIVE', userVersion: 7 })
})
function page() {
  const instance = Object.create(definition)
  instance.data = { ...structuredClone(definition.data), state: 'ready', userVersion: 7 }
  instance.setData = (patch: Record<string, unknown>) => Object.assign(instance.data, patch)
  return instance
}
function confirmPhrase(instance: ReturnType<typeof page>) {
  instance.updateConfirmationPhrase({ detail: { value: accountClosureConfirmationPhrase } })
}

describe('single account closure confirmation', () => {
  it('opens one confirmation and cancellation clears its input without submitting', () => {
    const instance = page()
    instance.startAccountClosure()
    confirmPhrase(instance)
    instance.startAccountClosure()
    expect(instance.data).toMatchObject({ closureState: 'confirming', confirmationPhrase: accountClosureConfirmationPhrase })
    instance.cancelAccountClosure()
    expect(instance.data).toMatchObject({ closureState: 'idle', confirmationPhrase: '', message: '' })
    expect(api.closeAccount).not.toHaveBeenCalled()
    expect(api.showModal).not.toHaveBeenCalled()
  })

  it('requires an open confirmation and the exact phrase before submitting', async () => {
    const instance = page()
    confirmPhrase(instance)
    await instance.submitAccountClosure()
    expect(api.closeAccount).not.toHaveBeenCalled()
    instance.startAccountClosure()
    await instance.submitAccountClosure()
    expect(api.closeAccount).not.toHaveBeenCalled()
    expect(instance.data).toMatchObject({ closureState: 'failed', message: `请输入“${accountClosureConfirmationPhrase}”` })
  })

  it('locks submission, closing, and edits until the server responds without stacking a second dialog', async () => {
    const instance = page()
    let resolve!: (value: { version: number, closedAt: string }) => void
    api.closeAccount.mockReturnValue(new Promise((done) => {
      resolve = done
    }))
    instance.startAccountClosure()
    confirmPhrase(instance)
    const pending = instance.submitAccountClosure()
    await instance.submitAccountClosure()
    instance.cancelAccountClosure()
    instance.updateConfirmationPhrase({ detail: { value: '' } })
    expect(instance.data).toMatchObject({ state: 'processing', closureState: 'processing', confirmationPhrase: accountClosureConfirmationPhrase })
    expect(api.closeAccount).toHaveBeenCalledExactlyOnceWith({
      confirmationPhrase: accountClosureConfirmationPhrase,
      expectedVersion: 7,
      idempotencyKey: expect.stringMatching(/^identity-close-/),
    })
    expect(api.showModal).not.toHaveBeenCalled()
    resolve({ version: 8, closedAt: '2026-09-26T12:00:00Z' })
    await pending
    expect(instance.data).toMatchObject({ state: 'success', closureState: 'idle', confirmationPhrase: '' })
  })

  it('preserves the input and idempotency key for a failed request retry', async () => {
    const instance = page()
    api.closeAccount.mockRejectedValueOnce(new Error('网络暂不可用')).mockResolvedValueOnce({ version: 8, closedAt: '2026-09-26T12:00:00Z' })
    instance.startAccountClosure()
    confirmPhrase(instance)
    await instance.submitAccountClosure()
    expect(instance.data).toMatchObject({ closureState: 'failed', message: '网络暂不可用', confirmationPhrase: accountClosureConfirmationPhrase })
    await instance.submitAccountClosure()
    expect(api.closeAccount.mock.calls[1][0].idempotencyKey).toBe(api.closeAccount.mock.calls[0][0].idempotencyKey)
    expect(instance.data.state).toBe('success')
  })

  it('can cancel a settlement-blocked attempt and reopen confirmation later', async () => {
    const instance = page()
    api.closeAccount.mockRejectedValue(new MipIdentityGatewayError('ACCOUNT_CLOSURE_PENDING_SETTLEMENT', '仍有待处理订单'))
    instance.startAccountClosure()
    confirmPhrase(instance)
    await instance.submitAccountClosure()
    expect(instance.data).toMatchObject({ state: 'blocked', closureState: 'failed', message: '仍有待处理订单' })
    instance.cancelAccountClosure()
    instance.startAccountClosure()
    expect(instance.data).toMatchObject({ closureState: 'confirming', confirmationPhrase: '', message: '' })
    expect(api.closeAccount).toHaveBeenCalledOnce()
  })
})
