import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ access: vi.fn(), navigate: vi.fn(), toast: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { beginProtectedAction: mocks.access } }))
vi.mock('../src/modules/mip-identity/runtime', () => ({ mipGlobalAccessGuard: {} }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: mocks.navigate }))
let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('wx', { showToast: mocks.toast })
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/privacy/index')
})
beforeEach(() => vi.clearAllMocks())

describe('settings service navigation', () => {
  it('keeps the profile and phone requirements when entering team PK', async () => {
    mocks.access.mockResolvedValue({ decision: { ready: false }, token: 'test-access' })
    await Object.create(definition).openGame()
    expect(mocks.access).toHaveBeenCalledWith({
      action: 'VIEW_RESTRICTED_PROFILE',
      source: { navigation: 'redirectTo', route: '/packages/member/mip-game/index' },
    })
    expect(mocks.navigate.mock.calls[0][0].url).toContain('/packages/member/mip-access/index?token=test-access')
  })

  it('prevents duplicate taps and lets the user retry a failed identity check', async () => {
    const page = Object.create(definition)
    let reject!: (error: Error) => void
    mocks.access.mockImplementationOnce(() => new Promise((_resolve, fail) => {
      reject = fail
    }))
    const first = page.openGame()
    await page.openGame()
    expect(mocks.access).toHaveBeenCalledTimes(1)
    reject(new Error('offline'))
    await first
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalled()
    mocks.access.mockResolvedValue({ decision: { ready: true } })
    await page.openGame()
    expect(mocks.navigate).toHaveBeenCalledWith({ url: '/packages/member/mip-game/index' })
  })
})
