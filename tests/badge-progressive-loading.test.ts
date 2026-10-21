import { beforeAll, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ loadSnapshot: vi.fn(), listBadgeCollection: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { loadSnapshot: mocks.loadSnapshot } }))
vi.mock('../src/modules/mip-growth/client', () => ({ mipGrowthModule: { listBadgeCollection: mocks.listBadgeCollection } }))
interface Definition { data: Record<string, unknown>, [key: string]: unknown }
let definition: Definition
function page() {
  const instance = Object.create(definition) as Definition
  instance.data = structuredClone(definition.data)
  instance.setData = (patch: Record<string, unknown>) => Object.assign(instance.data, patch)
  return instance
}
function call(instance: Definition, method: string) {
  return Reflect.apply(instance[method] as () => Promise<void>, instance, [])
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Definition) => {
    definition = value
  })
  await import('../src/packages/member/mip-badges/index')
})
beforeEach(() => {
  mocks.loadSnapshot.mockReset()
  mocks.listBadgeCollection.mockReset().mockResolvedValue({
    version: 5,
    maximumEquipped: 3,
    items: [{ id: 'badge', key: 'event_participant', name: '活动参与', status: 'ACTIVE', category: 'IDENTITY', earned: true, equippedSlot: 1 }],
  })
})
it('shows a nonempty badge collection without waiting for optional header identity', async () => {
  const identity = deferred<unknown>()
  mocks.loadSnapshot.mockReturnValue(identity.promise)
  const instance = page()
  await call(instance, 'loadBadges')
  expect(instance.data).toMatchObject({ state: 'ready', version: 5, earnedCount: 1, items: [{ name: '活动参与', selected: true }] })
  identity.resolve({ profile: { nickname: '真实昵称' } })
  await vi.waitFor(() => expect(instance.data.memberName).toBe('真实昵称'))
  expect(instance.data.version).toBe(5)
})
it('keeps the collection when header identity fails and discards header responses after unload', async () => {
  mocks.loadSnapshot.mockRejectedValueOnce(new Error('identity unavailable'))
  const instance = page()
  await call(instance, 'loadBadges')
  expect(instance.data.state).toBe('ready')
  const late = deferred<unknown>()
  mocks.loadSnapshot.mockReturnValueOnce(late.promise)
  await call(instance, 'loadBadges')
  await call(instance, 'onUnload')
  const snapshot = structuredClone(instance.data)
  late.resolve({ profile: { nickname: 'late' } })
  await Promise.resolve()
  expect(instance.data).toEqual(snapshot)
})
