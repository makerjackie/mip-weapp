import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  signOut: vi.fn(),
  enterTarget: vi.fn(),
  showModal: vi.fn(),
  showToast: vi.fn(),
}))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {} }))
vi.mock('../src/modules/mip-identity/local-session-client', () => ({ mipLocalSession: { signOut: api.signOut } }))
vi.mock('../src/modules/mip-identity/runtime', () => ({ mipGlobalAccessGuard: { enterTarget: api.enterTarget } }))
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
  vi.stubGlobal('wx', { showModal: api.showModal, showToast: api.showToast })
})

function page() {
  const instance = Object.create(definition)
  instance.data = { ...structuredClone(definition.data), state: 'ready' }
  instance.setData = (patch: Record<string, unknown>) => Object.assign(instance.data, patch)
  return instance
}

describe('account settings logout interaction', () => {
  it('leaves the session and current screen unchanged when confirmation is cancelled', async () => {
    api.showModal.mockResolvedValue({ confirm: false, cancel: true })
    const instance = page()

    await instance.signOutLocally()

    expect(api.signOut).not.toHaveBeenCalled()
    expect(api.enterTarget).not.toHaveBeenCalled()
    expect(instance.data.localLogoutState).toBe('idle')
  })

  it('clears identity before navigating to the explicit login gate and acknowledges success', async () => {
    api.showModal.mockResolvedValue({ confirm: true })
    const instance = page()

    await instance.signOutLocally()

    expect(api.signOut).toHaveBeenCalledOnce()
    expect(api.enterTarget).toHaveBeenCalledWith({ path: 'pages/index/index' })
    expect(api.signOut.mock.invocationCallOrder[0]).toBeLessThan(api.enterTarget.mock.invocationCallOrder[0])
    expect(api.showToast).toHaveBeenCalledWith({ title: '已退出登录', icon: 'success' })
    expect(instance.data.localLogoutState).toBe('idle')
  })

  it('opens one confirmation for repeated taps and blocks logout during account closure', async () => {
    let resolve!: (result: { confirm: boolean }) => void
    api.showModal.mockReturnValue(new Promise((done) => {
      resolve = done
    }))
    const instance = page()
    const pending = instance.signOutLocally()
    await instance.signOutLocally()
    expect(api.showModal).toHaveBeenCalledOnce()
    resolve({ confirm: false })
    await pending

    instance.data.closureState = 'processing'
    await instance.signOutLocally()
    expect(api.showModal).toHaveBeenCalledOnce()
    expect(api.signOut).not.toHaveBeenCalled()
  })

  it('makes a failed logout retryable without pretending that navigation succeeded', async () => {
    api.showModal.mockResolvedValue({ confirm: true })
    api.signOut.mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    const instance = page()

    await instance.signOutLocally()

    expect(instance.data).toMatchObject({ localLogoutState: 'idle', message: '退出未完成，请重试。' })
    expect(api.enterTarget).not.toHaveBeenCalled()
    expect(api.showToast).not.toHaveBeenCalled()
    await instance.signOutLocally()
    expect(api.enterTarget).toHaveBeenCalledOnce()
  })
})
