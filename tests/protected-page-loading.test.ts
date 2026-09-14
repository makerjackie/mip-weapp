import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ begin: vi.fn(), hearts: vi.fn(), blocked: vi.fn() }))
vi.mock('../src/modules/mip-identity', () => ({ mipAccessPageUrl: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { beginProtectedAction: mocks.begin } }))
vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: { listHeartHistory: mocks.hearts } }))
vi.mock('../src/modules/mip-community', () => ({ mipCommunityModule: { listBlocked: mocks.blocked } }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn() }))

type PageDefinition = { data: Record<string, unknown>, cache?: unknown } & Record<string, any>
const definitions: PageDefinition[] = []
beforeAll(async () => {
  vi.stubGlobal('Page', (definition: PageDefinition) => definitions.push(definition))
  await import('../src/packages/member/mip-hearts/index')
  await import('../src/packages/member/mip-blocked/index')
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.begin.mockResolvedValue({ token: '', decision: { ready: true } })
  mocks.hearts.mockResolvedValue({ items: [] })
  mocks.blocked.mockResolvedValue({ items: [] })
})
function page(index: number) {
  const definition = definitions[index]
  return Object.assign(Object.create(definition), {
    data: structuredClone(definition.data),
    cache: structuredClone(definition.cache),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  })
}

describe.each([['heart history', 0], ['blocked users', 1]] as const)('%s loading', (_name, index) => {
  it('recovers from failed identity using the visible retry button', async () => {
    const p = page(index)
    mocks.begin.mockRejectedValueOnce(new Error('unavailable'))
    await p.checkAccess()
    expect(p.data.state).toBe('error')
    await p.retry()
    expect(mocks.begin).toHaveBeenCalledTimes(2)
    expect(p.data.state).toBe('empty')
  })
  it('releases the identity lock before a slow list completes', async () => {
    const p = page(index)
    const read = index === 0 ? mocks.hearts : mocks.blocked
    let finish!: (value: unknown) => void
    read.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    const loading = p.checkAccess()
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    expect(p.checkingAccess).toBe(false)
    finish({ items: [] })
    await loading
  })
})
