import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ peekIntent: vi.fn(), cancel: vi.fn(), navigateBack: vi.fn(), redirectTo: vi.fn(), navigateTo: vi.fn(), acceptAgreements: vi.fn(), complete: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { peekIntent: mocks.peekIntent, cancel: mocks.cancel, acceptAgreements: mocks.acceptAgreements, complete: mocks.complete } }))
vi.mock('../src/modules/mip-identity/runtime', () => ({ exitMipMiniProgram: vi.fn(), mipGlobalAccessGuard: {} }))
let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  vi.stubGlobal('wx', { navigateBack: mocks.navigateBack, redirectTo: mocks.redirectTo, navigateTo: mocks.navigateTo })
  await import('../src/packages/member/mip-access/index')
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.peekIntent.mockReturnValue({ action: 'REGISTER_EVENT', source: { query: { eventId: 'e1' } } })
  mocks.cancel.mockReturnValue({ query: { eventId: 'e1', inviteRef: 'ref1' } })
})
function page() {
  const instance = Object.create(definition)
  instance.data = { ...definition.data, token: 'intent' }
  instance.setData = (value: Record<string, unknown>) => Object.assign(instance.data, value)
  return instance
}
describe('denied registration phone permission', () => {
  it('cancels the intent and returns past the form to the matching event detail', async () => {
    vi.stubGlobal('getCurrentPages', () => [
      { route: 'packages/member/mip-events/detail/index', options: { eventId: 'e1' } },
      { route: 'packages/member/mip-events/registration/index' },
      { route: 'packages/member/mip-access/index' },
    ])
    await page().bindPhone({ detail: { errMsg: 'getPhoneNumber:fail user deny' } })
    expect(mocks.cancel).toHaveBeenCalledWith('intent')
    expect(mocks.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 2 }))
  })
  it('opens detail with the invitation reference if the stack has no matching detail', async () => {
    vi.stubGlobal('getCurrentPages', () => [{ route: 'packages/member/mip-access/index' }])
    await page().bindPhone({ detail: { errMsg: 'getPhoneNumber:fail user denied' } })
    expect(mocks.redirectTo).toHaveBeenCalledWith({ url: '/packages/member/mip-events/detail/index?eventId=e1&inviteRef=ref1' })
  })
  it('keeps unrelated permission failures on the access page', async () => {
    await page().bindPhone({ detail: { errMsg: 'getPhoneNumber:fail not supported' } })
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.navigateBack).not.toHaveBeenCalled()
  })
})

describe('access continuation after phone login', () => {
  it('never accepts agreements without a deliberate checked submission', async () => {
    const instance = page()
    await instance.acceptAgreements()
    expect(mocks.acceptAgreements).not.toHaveBeenCalled()
  })

  it('automatically returns to the original intent once all requirements are complete', async () => {
    const instance = page()
    mocks.complete.mockResolvedValue({ navigation: 'navigateBack', route: '/pages/profile/index' })
    await instance.continueAccess({ decision: { ready: true }, intent: { action: 'EDIT_PROFILE' } })
    expect(mocks.complete).toHaveBeenCalledWith('intent')
    expect(mocks.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }))
  })

  it('opens profile setup once, then returns to the source if the user closes it incomplete', async () => {
    const instance = page()
    const session = { decision: { ready: false, nextRequirement: 'PROFILE' }, intent: { action: 'REGISTER_EVENT' } }
    await instance.continueAccess(session)
    expect(mocks.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/packages/member/mip-profile/index?token=intent' }))
    await instance.continueAccess(session)
    expect(mocks.navigateTo).toHaveBeenCalledOnce()
    expect(mocks.cancel).toHaveBeenCalledWith('intent')
    expect(mocks.complete).not.toHaveBeenCalled()
  })
})
