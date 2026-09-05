import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ peekIntent: vi.fn(), cancel: vi.fn(), navigateBack: vi.fn(), redirectTo: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { peekIntent: mocks.peekIntent, cancel: mocks.cancel } }))
vi.mock('../src/modules/mip-identity/runtime', () => ({ exitMipMiniProgram: vi.fn(), mipGlobalAccessGuard: {} }))
let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  vi.stubGlobal('wx', { navigateBack: mocks.navigateBack, redirectTo: mocks.redirectTo })
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
